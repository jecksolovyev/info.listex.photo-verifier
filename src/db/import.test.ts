import { beforeEach, describe, expect, it } from 'vitest'
import { importBatch } from './import'
import { getPage, toggleFlag, stampPageReviewed, stampAllReviewed } from './photos'
import { getSession, deleteSession, cumulativeTotals } from './sessions'
import { exportSessionCsv } from '../csv/export'
import { CsvValidationError } from '../csv/contract'
import { DB_NAME, closeDB, getDB } from './schema'

async function freshDB() {
  await closeDB()
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

beforeEach(freshDB)

const HEADER = 'GoodId,Good_Name,GTIN,PhotoURI,PhotoId,PhotoType,PhotoDate,Flagged,UserId'

describe('importBatch — ordering (ADR-0003)', () => {
  it('sorts by GTIN, then PhotoType rank, then PhotoDate asc', async () => {
    // intentionally scrambled input order
    const csv = [
      HEADER,
      '10,Prod B,200,med/b1.png,5001,13,2025-01-02,NO,',
      '10,Prod B,200,med/b2.png,5002,default,2025-03-01,NO,',
      '20,Prod A,100,med/a-text,5003,text,2024-12-01,NO,',
      '20,Prod A,100,med/a-def-old,5004,default,2024-01-01,NO,',
      '20,Prod A,100,med/a-def-new,5005,default,2024-06-01,NO,',
      '30,Prod C,300,med/c-unknown,5006,zzz-weird,2025-01-01,NO,',
      '30,Prod C,300,med/c-def,5007,default,,NO,',
    ].join('\n')

    const { session } = await importBatch({ input: csv, filename: 'b.csv' })
    expect(session.total).toBe(7)

    const page = await getPage(session.id, 0, 50)
    const ids = page.map((p) => p.photoId)
    // GTIN 100 group (default old, default new, text), then 200 (default, back),
    // then 300 (default, then unknown type sorts last; blank date sorts within)
    expect(ids).toEqual([5004, 5005, 5003, 5002, 5001, 5007, 5006])
    expect(page.map((p) => p.position)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })
})

describe('importBatch — validation (strict-refuse)', () => {
  it('rejects a missing required column', async () => {
    const csv = 'GoodId,Good_Name,GTIN,PhotoURI,PhotoId,PhotoType\n1,X,9,u,1,default'
    await expect(importBatch({ input: csv, filename: 'x.csv' })).rejects.toBeInstanceOf(
      CsvValidationError,
    )
    // nothing left half-loaded
    const db = await getDB()
    expect(await db.count('photos')).toBe(0)
  })

  it('rejects a row missing PhotoId', async () => {
    const csv = [HEADER, '1,X,9,med/u.png,,default,2025-01-01,NO,'].join('\n')
    await expect(importBatch({ input: csv, filename: 'x.csv' })).rejects.toBeInstanceOf(
      CsvValidationError,
    )
  })

  it('matches headers case-insensitively and ignores order/extra columns', async () => {
    const csv = [
      'extra,photoid,gtin,GOODID,good_name,phototype,photouri,photodate',
      'junk,42,55,7,Thing,default,med/t.png,2025-01-01',
    ].join('\n')
    const { session } = await importBatch({ input: csv, filename: 'ci.csv' })
    const [row] = await getPage(session.id, 0, 50)
    expect(row.photoId).toBe(42)
    expect(row.goodId).toBe(7)
    expect(row.flagged).toBe(false)
    expect(row.userId).toBe('')
  })
})

describe('importBatch — de-dupe (keep first)', () => {
  it('drops in-batch duplicate PhotoIds and reports the count', async () => {
    const csv = [
      HEADER,
      '1,First,9,med/first.png,777,default,2025-01-01,NO,',
      '1,Dup,9,med/dup.png,777,text,2025-02-01,YES,',
    ].join('\n')
    const { session, duplicates } = await importBatch({ input: csv, filename: 'd.csv' })
    expect(duplicates).toBe(1)
    expect(session.total).toBe(1)
    const [row] = await getPage(session.id, 0, 50)
    expect(row.photoURI).toBe('med/first.png') // first wins
  })
})

describe('round-trip export (ADR-0003)', () => {
  it('re-emits all 9 columns with a BOM, preserving Flagged/UserId', async () => {
    const csv = [
      HEADER,
      '10,Молоко,200,med/m.png,5001,default,2025-01-02,YES,anna',
      '10,Молоко,200,med/m2.png,5002,13,2025-01-03,NO,',
    ].join('\n')
    const { session } = await importBatch({ input: csv, filename: 'rt.csv' })
    const out = await exportSessionCsv(session.id)

    expect(out.charCodeAt(0)).toBe(0xfeff) // BOM
    expect(out).toContain('"Молоко"') // quoted, Cyrillic preserved
    expect(out).toContain('"YES"')
    expect(out).toContain('"anna"')

    // header order is canonical
    const firstLine = out.slice(1).split('\r\n')[0]
    expect(firstLine).toBe(
      '"GoodId","Good_Name","GTIN","PhotoURI","PhotoId","PhotoType","PhotoDate","Flagged","UserId"',
    )
  })
})

describe('attribution invariant (ADR-0003)', () => {
  const csv = [
    HEADER,
    '1,A,100,med/a.png,1,default,2025-01-01,NO,',
    '1,A,100,med/b.png,2,13,2025-01-02,NO,',
    '1,A,100,med/c.png,3,text,2025-01-03,NO,',
  ].join('\n')

  it('toggleFlag overwrites UserId and updates counters', async () => {
    const { session } = await importBatch({ input: csv, filename: 'a.csv' })
    const updated = await toggleFlag(session.id, 1, 'bob')
    expect(updated?.flagged).toBe(true)
    expect(updated?.userId).toBe('bob')

    const s = await getSession(session.id)
    expect(s?.flaggedCount).toBe(1)
    expect(s?.reviewedCount).toBe(1)

    // unflag puts the counter back
    await toggleFlag(session.id, 1, 'bob')
    expect((await getSession(session.id))?.flaggedCount).toBe(0)
  })

  it('navigating off a page fills blank UserIds only', async () => {
    const { session } = await importBatch({ input: csv, filename: 'a.csv' })
    await toggleFlag(session.id, 0, 'bob') // pre-review row 0 as bob
    const rows = await stampPageReviewed(session.id, 0, 50, 'anna')
    expect(rows.map((r) => r.userId)).toEqual(['bob', 'anna', 'anna'])
    expect((await getSession(session.id))?.reviewedCount).toBe(3)
  })

  it('marking finished stamps all remaining blanks', async () => {
    const { session } = await importBatch({ input: csv, filename: 'a.csv' })
    await stampAllReviewed(session.id, 'anna')
    const rows = await getPage(session.id, 0, 50)
    expect(rows.every((r) => r.userId === 'anna')).toBe(true)
    expect((await getSession(session.id))?.reviewedCount).toBe(3)
  })
})

describe('sessions store', () => {
  it('deletes a session and its photo rows; cumulative totals reflect it', async () => {
    const a = await importBatch({ input: csv1(), filename: 'one.csv' })
    const b = await importBatch({ input: csv1(), filename: 'two.csv' })
    await toggleFlag(a.session.id, 0, 'anna')

    let totals = await cumulativeTotals()
    expect(totals.loaded).toBe(4)
    expect(totals.flagged).toBe(1)

    await deleteSession(b.session.id)
    totals = await cumulativeTotals()
    expect(totals.loaded).toBe(2)

    const db = await getDB()
    expect(await db.count('photos')).toBe(2) // only session a's rows remain
  })
})

function csv1() {
  return [
    HEADER,
    '1,A,100,med/a.png,1,default,2025-01-01,NO,',
    '1,A,100,med/b.png,2,13,2025-01-02,NO,',
  ].join('\n')
}
