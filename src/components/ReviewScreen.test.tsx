// @vitest-environment jsdom

// Keyboard-first navigation (ADR-0004) and the review grid, driven end-to-end:
// a real batch is imported into (fake) IndexedDB, ReviewScreen is rendered, and
// we exercise the actual keydown handler on window.
//
//   ←/→ or A/D  step the cursor (rolling over page edges)
//   ⌘/Ctrl+←/→  jump a whole page
//   Space       toggle the flag in place — NO auto-advance
//   Enter       open the popup · Esc closes it (or returns to the list)

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../test/setup'
import { ReviewScreen } from './ReviewScreen'
import { importBatch } from '../db/import'
import { freshDB } from '../test/db'

const HEADER = 'GoodId,Good_Name,GTIN,PhotoURI,PhotoId,PhotoType,PhotoDate,Flagged,UserId'

// Rows whose canonical order equals insertion order (position i ↔ photoId i).
function batch(n: number): string {
  const lines = [HEADER]
  for (let i = 0; i < n; i++) {
    const gtin = String(i).padStart(5, '0')
    lines.push(`${i},Item ${i},${gtin},med/${i}.png,${i},default,2025-01-01,NO,`)
  }
  return lines.join('\n')
}

/** Import a batch and render ReviewScreen against it, waiting for first paint. */
async function renderReview(n = 60, userId = 'anna') {
  const { session } = await importBatch({ input: batch(n), filename: 'batch.csv' })
  const onBack = vi.fn()
  render(<ReviewScreen sessionId={session.id} userId={userId} onBack={onBack} />)
  await screen.findByText(/Page 1 of/)
  // the grid fills in a second async effect after the header — wait for tiles
  await waitFor(() => expect(document.querySelectorAll('.tile').length).toBeGreaterThan(0))
  return { sessionId: session.id, onBack }
}

const focusedIdx = () =>
  Number(document.querySelector('.tile--focused')?.getAttribute('data-idx') ?? NaN)
const tileCount = () => document.querySelectorAll('.tile').length
const tile = (idx: number) => document.querySelector(`[data-idx="${idx}"]`) as HTMLElement

const press = (init: KeyboardEventInit) => fireEvent.keyDown(window, init)
const RIGHT = { key: 'ArrowRight', code: 'ArrowRight' }
const LEFT = { key: 'ArrowLeft', code: 'ArrowLeft' }
const SPACE = { key: ' ', code: 'Space' }

beforeEach(freshDB)

describe('ReviewScreen — grid', () => {
  it('renders one page of 50 tiles with the progress header', async () => {
    await renderReview(60)
    expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument()
    expect(tileCount()).toBe(50)
    expect(focusedIdx()).toBe(0)
    // 3-number stat starts empty
    expect(screen.getByText(/0 flagged · 0 reviewed out of 60 loaded/)).toBeInTheDocument()
  })
})

describe('ReviewScreen — cursor stepping (←/→, A/D)', () => {
  it('moves right with ArrowRight and D, left with ArrowLeft and A', async () => {
    await renderReview(60)
    expect(focusedIdx()).toBe(0)

    press(RIGHT)
    expect(focusedIdx()).toBe(1)
    press({ key: 'd', code: 'KeyD' })
    expect(focusedIdx()).toBe(2)

    press(LEFT)
    expect(focusedIdx()).toBe(1)
    press({ key: 'a', code: 'KeyA' })
    expect(focusedIdx()).toBe(0)
  })

  it('clamps at the start of the batch', async () => {
    await renderReview(60)
    press(LEFT)
    expect(focusedIdx()).toBe(0)
  })

  it('rolls the cursor over the page edge onto the next page', async () => {
    await renderReview(60)
    fireEvent.click(tile(49)) // focus the last tile of page 1
    expect(focusedIdx()).toBe(49)

    press(RIGHT)
    await screen.findByText(/Page 2 of 2/)
    await waitFor(() => expect(focusedIdx()).toBe(50))
    await waitFor(() => expect(tileCount()).toBe(10)) // page 2 holds the remaining rows
  })
})

describe('ReviewScreen — page jumps (⌘/Ctrl+←/→)', () => {
  it('jumps a whole page with the modifier held, both directions', async () => {
    await renderReview(60)

    press({ ...RIGHT, metaKey: true })
    await screen.findByText(/Page 2 of 2/)
    await waitFor(() => expect(focusedIdx()).toBe(50))

    press({ ...LEFT, ctrlKey: true })
    await screen.findByText(/Page 1 of 2/)
    await waitFor(() => expect(focusedIdx()).toBe(0))
  })

  it('clamps page jumps at the last page', async () => {
    await renderReview(60)
    press({ ...RIGHT, metaKey: true })
    await screen.findByText(/Page 2 of 2/)
    press({ ...RIGHT, metaKey: true }) // already on the last page
    await screen.findByText(/Page 2 of 2/)
  })
})

describe('ReviewScreen — spacebar flag (in place, no auto-advance)', () => {
  it('flags and unflags the focused tile without moving the cursor', async () => {
    await renderReview(60)

    press(SPACE)
    await waitFor(() =>
      expect(screen.getByText(/1 flagged · 1 reviewed out of 60 loaded/)).toBeInTheDocument(),
    )
    expect(tile(0)).toHaveClass('tile--flagged')
    expect(focusedIdx()).toBe(0) // deliberately did NOT advance

    press(SPACE)
    await waitFor(() =>
      expect(screen.getByText(/0 flagged · 1 reviewed out of 60 loaded/)).toBeInTheDocument(),
    )
    expect(tile(0)).not.toHaveClass('tile--flagged')
  })
})

describe('ReviewScreen — popup (Enter / Esc / double-click)', () => {
  it('Enter opens the popup and Esc closes it without leaving the screen', async () => {
    const { onBack } = await renderReview(60)

    fireEvent.keyDown(window, { key: 'Enter' })
    expect(await screen.findByText(/Open in goods editor/i)).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText(/Open in goods editor/i)).not.toBeInTheDocument())
    expect(onBack).not.toHaveBeenCalled()
  })

  it('double-clicking a tile opens the popup for that photo', async () => {
    await renderReview(60)
    fireEvent.dblClick(tile(2))
    expect(await screen.findByText(/Open in goods editor/i)).toBeInTheDocument()
    expect(focusedIdx()).toBe(2)
  })
})

describe('ReviewScreen — Esc returns to the session list', () => {
  it('calls onBack when no popup is open', async () => {
    const { onBack } = await renderReview(60)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('ReviewScreen — Prev/Next and go-to-page controls', () => {
  it('pages with the Next/Prev buttons, disabled at the edges', async () => {
    await renderReview(60)
    const prev = screen.getByRole('button', { name: /Prev/ })
    const next = screen.getByRole('button', { name: /Next/ })
    expect(prev).toBeDisabled()

    await userEvent.click(next)
    await screen.findByText(/Page 2 of 2/)
    expect(next).toBeDisabled()
    expect(prev).toBeEnabled()

    await userEvent.click(prev)
    await screen.findByText(/Page 1 of 2/)
  })

  it('jumps to a typed page number', async () => {
    await renderReview(60)
    const input = screen.getByLabelText(/go to page/i)
    await userEvent.clear(input)
    await userEvent.type(input, '2{Enter}')
    await screen.findByText(/Page 2 of 2/)
  })

  it('does not navigate on arrow keys typed inside the go-to-page input', async () => {
    await renderReview(60)
    const input = screen.getByLabelText(/go to page/i)
    fireEvent.keyDown(input, RIGHT) // bubbles to the window handler, which ignores inputs
    expect(focusedIdx()).toBe(0)
  })
})
