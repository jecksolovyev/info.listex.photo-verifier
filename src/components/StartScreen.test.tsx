// @vitest-environment jsdom

// StartScreen is presentational (all state lifted to App), so these render it
// directly with stub callbacks: reviewer gate, session list, cumulative stat,
// load-button enablement, error banner, and the type-to-confirm delete flow.

import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../test/setup'
import { StartScreen } from './StartScreen'
import type { SessionRecord } from '../db/schema'

function session(over: Partial<SessionRecord>): SessionRecord {
  return {
    id: 's1',
    filename: 'batch-01.csv',
    loadedAt: Date.UTC(2026, 0, 2, 10, 0),
    status: 'in progress',
    cursorPage: 0,
    total: 100,
    flaggedCount: 4,
    reviewedCount: 30,
    ...over,
  }
}

function setup(over: Partial<React.ComponentProps<typeof StartScreen>> = {}) {
  const props = {
    userId: 'anna',
    onUserId: vi.fn(),
    sessions: [] as SessionRecord[],
    importing: false,
    loadError: null as string | null,
    onClearError: vi.fn(),
    onOpen: vi.fn(),
    onDelete: vi.fn(),
    onLoadBatch: vi.fn(),
    onDownload: vi.fn(),
    ...over,
  }
  render(<StartScreen {...props} />)
  return props
}

describe('StartScreen — reviewer gate', () => {
  it('disables Load batch and shows empty state until a Reviewer ID is entered', () => {
    setup({ userId: '' })
    expect(screen.getByRole('button', { name: /load batch csv/i })).toBeDisabled()
    expect(screen.getByText(/no sessions yet/i)).toBeInTheDocument()
    // the empty-state checklist step (exact, to avoid matching the prose above)
    expect(screen.getByText('Enter your Reviewer ID')).toBeInTheDocument()
  })

  it('enables Load batch once a Reviewer ID is present', () => {
    setup({ userId: 'anna' })
    expect(screen.getByRole('button', { name: /load batch csv/i })).toBeEnabled()
  })

  it('forwards Reviewer ID edits', async () => {
    const props = setup({ userId: '' })
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. anna/i), 'b')
    expect(props.onUserId).toHaveBeenCalledWith('b')
  })

  it('shows Importing… while a load is in flight', () => {
    setup({ importing: true })
    const btn = screen.getByRole('button', { name: /importing/i })
    expect(btn).toBeDisabled()
  })
})

describe('StartScreen — session list & stats', () => {
  it('renders the cumulative stat and a session row with its 3-number stat and status', () => {
    setup({
      sessions: [
        session({ id: 's1', filename: 'batch-01.csv', flaggedCount: 4, reviewedCount: 30, total: 100 }),
        session({ id: 's2', filename: 'batch-02.csv', flaggedCount: 1, reviewedCount: 20, total: 100, status: 'finished' }),
      ],
    })
    // cumulative = 5 flagged · 50 reviewed out of 200 loaded
    expect(screen.getByText(/5 flagged · 50 reviewed out of 200 loaded/)).toBeInTheDocument()

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText(/4 flagged · 30 reviewed out of 100 loaded/)).toBeInTheDocument()
    expect(within(rows[1]).getByText('finished')).toBeInTheDocument()
  })

  it('opens a session from the filename button and the Open button', async () => {
    const props = setup({ sessions: [session({ id: 's9' })] })
    const row = screen.getByRole('listitem')
    await userEvent.click(within(row).getByRole('button', { name: 'batch-01.csv' }))
    await userEvent.click(within(row).getByRole('button', { name: 'Open' }))
    expect(props.onOpen).toHaveBeenCalledTimes(2)
    expect(props.onOpen).toHaveBeenCalledWith('s9')
  })

  it('disables opening when no Reviewer ID is set', () => {
    setup({ userId: '', sessions: [session({})] })
    const row = screen.getByRole('listitem')
    expect(within(row).getByRole('button', { name: 'Open' })).toBeDisabled()
  })

  it('downloads a session result', async () => {
    const s = session({ id: 's3' })
    const props = setup({ sessions: [s] })
    await userEvent.click(screen.getByRole('button', { name: /download/i }))
    expect(props.onDownload).toHaveBeenCalledWith(s)
  })
})

describe('StartScreen — error banner', () => {
  it('shows and dismisses a load error', async () => {
    const props = setup({ loadError: 'The CSV is missing required column: PhotoURI.' })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/missing required column: PhotoURI/)
    await userEvent.click(within(alert).getByTitle('Dismiss'))
    expect(props.onClearError).toHaveBeenCalled()
  })
})

describe('StartScreen — load batch file picker', () => {
  it('passes the picked file to onLoadBatch', async () => {
    const onLoadBatch = vi.fn()
    setup({ userId: 'anna', onLoadBatch })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['GoodId\n1'], 'pick.csv', { type: 'text/csv' })
    await userEvent.upload(input, file)
    expect(onLoadBatch).toHaveBeenCalledTimes(1)
    expect(onLoadBatch.mock.calls[0][0].name).toBe('pick.csv')
  })
})

describe('StartScreen — delete requires typing the filename', () => {
  it('keeps Delete disabled until the exact filename is typed, then confirms', async () => {
    const props = setup({ sessions: [session({ id: 'sX', filename: 'batch-01.csv' })] })
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    const confirm = screen.getByRole('button', { name: /delete permanently/i })
    expect(confirm).toBeDisabled()

    const field = screen.getByPlaceholderText(/type filename to confirm/i)
    await userEvent.type(field, 'batch-01.csv')
    expect(confirm).toBeEnabled()

    await userEvent.click(confirm)
    expect(props.onDelete).toHaveBeenCalledWith('sX')
  })

  it('stays disabled for a near-miss filename', async () => {
    const props = setup({ sessions: [session({ filename: 'batch-01.csv' })] })
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.type(screen.getByPlaceholderText(/type filename to confirm/i), 'batch-01')
    expect(screen.getByRole('button', { name: /delete permanently/i })).toBeDisabled()
    expect(props.onDelete).not.toHaveBeenCalled()
  })
})
