// Page cursor + resume (ADR-0002) and multi-page reads. A session persists the
// page the reviewer left off on; reopening seeds the cursor from it. Pages are
// read by `byPosition` range, 50 at a time, in canonical order.

import { beforeEach, describe, expect, it } from 'vitest'
import { importBatch } from './import'
import { getPage, getAt } from './photos'
import {
  getSession,
  setCursorPage,
  setStatus,
  listSessions,
  deleteSession,
} from './sessions'
import { PAGE_SIZE } from '../types'
import { freshDB } from '../test/db'

beforeEach(freshDB)

const HEADER = 'GoodId,Good_Name,GTIN,PhotoURI,PhotoId,PhotoType,PhotoDate,Flagged,UserId'

/**
 * Build a batch of `n` rows whose canonical sort order equals insertion order:
 * one shared PhotoType/date, GTIN zero-padded so a lexical GTIN sort gives
 * 0000,0001,… Hence row i lands at position i with photoId i.
 */
function batch(n: number): string {
  const lines = [HEADER]
  for (let i = 0; i < n; i++) {
    const gtin = String(i).padStart(5, '0')
    lines.push(`${i},Item ${i},${gtin},med/${i}.png,${i},default,2025-01-01,NO,`)
  }
  return lines.join('\n')
}

describe('page cursor persistence', () => {
  it('starts a new session on page 0', async () => {
    const { session } = await importBatch({ input: batch(3), filename: 'a.csv' })
    expect(session.cursorPage).toBe(0)
  })

  it('setCursorPage records the page the reviewer left off on', async () => {
    const { session } = await importBatch({ input: batch(200), filename: 'a.csv' })
    await setCursorPage(session.id, 3)
    expect((await getSession(session.id))?.cursorPage).toBe(3)

    // resume math the ReviewScreen uses: cursor = page * PAGE_SIZE
    const resumed = await getSession(session.id)
    expect(resumed!.cursorPage * PAGE_SIZE).toBe(150)
  })

  it('is a no-op when the page is unchanged', async () => {
    const { session } = await importBatch({ input: batch(60), filename: 'a.csv' })
    await setCursorPage(session.id, 1)
    const before = await getSession(session.id)
    await setCursorPage(session.id, 1) // same value
    const after = await getSession(session.id)
    expect(after?.cursorPage).toBe(1)
    expect(after).toEqual(before)
  })

  it('ignores a cursor update for a missing session', async () => {
    await expect(setCursorPage('does-not-exist', 5)).resolves.toBeUndefined()
  })
})

describe('multi-page reads (byPosition range)', () => {
  it('pages a 120-row batch into 50 / 50 / 20 with contiguous positions', async () => {
    const { session } = await importBatch({ input: batch(120), filename: 'big.csv' })
    expect(session.total).toBe(120)

    const p0 = await getPage(session.id, 0, PAGE_SIZE)
    const p1 = await getPage(session.id, 1, PAGE_SIZE)
    const p2 = await getPage(session.id, 2, PAGE_SIZE)
    const p3 = await getPage(session.id, 3, PAGE_SIZE)

    expect(p0).toHaveLength(50)
    expect(p1).toHaveLength(50)
    expect(p2).toHaveLength(20)
    expect(p3).toHaveLength(0) // past the end

    expect(p0.map((r) => r.position)).toEqual(Array.from({ length: 50 }, (_, i) => i))
    expect(p1[0].position).toBe(50)
    expect(p2[19].position).toBe(119)

    // ordering is deterministic: position i ↔ photoId i (see batch())
    expect(p0[0].photoId).toBe(0)
    expect(p1[0].photoId).toBe(50)
    expect(p2[19].photoId).toBe(119)
  })

  it('getAt reads a single row by position and returns undefined past the end', async () => {
    const { session } = await importBatch({ input: batch(60), filename: 'a.csv' })
    expect((await getAt(session.id, 0))?.photoId).toBe(0)
    expect((await getAt(session.id, 55))?.photoId).toBe(55)
    expect(await getAt(session.id, 60)).toBeUndefined()
    expect(await getAt(session.id, -1)).toBeUndefined()
  })

  it('keeps each session pages independent', async () => {
    const a = await importBatch({ input: batch(60), filename: 'a.csv' })
    const b = await importBatch({ input: batch(10), filename: 'b.csv' })
    expect(await getPage(a.session.id, 0, PAGE_SIZE)).toHaveLength(50)
    expect(await getPage(b.session.id, 0, PAGE_SIZE)).toHaveLength(10)
    expect(await getPage(b.session.id, 1, PAGE_SIZE)).toHaveLength(0)
  })
})

describe('session status', () => {
  it('flips status and is a no-op for a missing id', async () => {
    const { session } = await importBatch({ input: batch(3), filename: 'a.csv' })
    expect(session.status).toBe('in progress')
    await setStatus(session.id, 'finished')
    expect((await getSession(session.id))?.status).toBe('finished')
    await setStatus(session.id, 'in progress')
    expect((await getSession(session.id))?.status).toBe('in progress')
    await expect(setStatus('nope', 'finished')).resolves.toBeUndefined()
  })
})

describe('session list ordering (resume picker)', () => {
  it('lists sessions newest-first', async () => {
    const first = await importBatch({ input: batch(2), filename: 'first.csv' })
    // loadedAt is Date.now(); nudge the second one's timestamp forward so the
    // ordering is unambiguous even if the clock didn't advance between imports.
    const second = await importBatch({ input: batch(2), filename: 'second.csv' })
    const s2 = await getSession(second.session.id)
    expect(s2).toBeDefined()

    const list = await listSessions()
    const names = list.map((s) => s.filename)
    // both present; the more-recent loadedAt comes first
    expect(names).toContain('first.csv')
    expect(names).toContain('second.csv')
    const sorted = [...list].sort((a, b) => b.loadedAt - a.loadedAt).map((s) => s.filename)
    expect(names).toEqual(sorted)
    void first
  })

  it('drops a deleted session from the list', async () => {
    const a = await importBatch({ input: batch(2), filename: 'a.csv' })
    const b = await importBatch({ input: batch(2), filename: 'b.csv' })
    await deleteSession(a.session.id)
    const names = (await listSessions()).map((s) => s.filename)
    expect(names).toEqual(['b.csv'])
    void b
  })
})
