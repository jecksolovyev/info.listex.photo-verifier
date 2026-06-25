// Parsing edge cases and malformed-CSV handling, exercised end-to-end through
// importBatch (PapaParse streaming → IndexedDB). The happy-path sort/de-dupe/
// round-trip lives in db/import.test.ts; this file pins the rough edges:
// alternate delimiters, BOM, quoting, line endings, blank lines, and the
// strict-refuse failures that must leave nothing half-loaded.

import { beforeEach, describe, expect, it } from 'vitest'
import { importBatch } from '../db/import'
import { getPage } from '../db/photos'
import { getSession } from '../db/sessions'
import { getDB } from '../db/schema'
import { exportSessionCsv } from './export'
import { CsvValidationError } from './contract'
import { freshDB } from '../test/db'

beforeEach(freshDB)

const HEADER = 'GoodId,Good_Name,GTIN,PhotoURI,PhotoId,PhotoType,PhotoDate,Flagged,UserId'

async function rows(sessionId: string) {
  return getPage(sessionId, 0, 50)
}

describe('delimiter handling', () => {
  it('auto-detects a semicolon-delimited file', async () => {
    const csv = [
      'GoodId;Good_Name;GTIN;PhotoURI;PhotoId;PhotoType;PhotoDate;Flagged;UserId',
      '1;Milk;100;med/a.png;1;default;2025-01-01;NO;',
      '2;Bread;200;med/b.png;2;default;2025-01-02;YES;anna',
    ].join('\n')
    const { session } = await importBatch({ input: csv, filename: 'semi.csv' })
    expect(session.total).toBe(2)
    const [r] = await rows(session.id)
    expect(r.gtin).toBe('100')
    expect(session.flaggedCount).toBe(1)
    expect(session.reviewedCount).toBe(1)
  })
})

describe('encoding & line endings', () => {
  it('imports a file with a UTF-8 BOM on the header', async () => {
    const csv = '﻿' + [HEADER, '1,Молоко,100,med/a.png,1,default,2025-01-01,NO,'].join('\n')
    const { session } = await importBatch({ input: csv, filename: 'bom.csv' })
    expect(session.total).toBe(1)
    const [r] = await rows(session.id)
    expect(r.goodName).toBe('Молоко')
  })

  it('imports CRLF line endings', async () => {
    const csv = [HEADER, '1,Milk,100,med/a.png,1,default,2025-01-01,NO,'].join('\r\n')
    const { session } = await importBatch({ input: csv, filename: 'crlf.csv' })
    expect(session.total).toBe(1)
  })

  it('greedily skips blank lines', async () => {
    const csv = [
      HEADER,
      '',
      '1,Milk,100,med/a.png,1,default,2025-01-01,NO,',
      '   ',
      '2,Bread,200,med/b.png,2,default,2025-01-02,NO,',
      '',
    ].join('\n')
    const { session } = await importBatch({ input: csv, filename: 'blanks.csv' })
    expect(session.total).toBe(2)
  })
})

describe('quoting', () => {
  it('preserves a quoted field containing a comma and a newline', async () => {
    const csv = [HEADER, '1,"Milk, 2%\nlow-fat",100,med/a.png,1,default,2025-01-01,NO,'].join('\n')
    const { session } = await importBatch({ input: csv, filename: 'quoted.csv' })
    const [r] = await rows(session.id)
    expect(r.goodName).toBe('Milk, 2%\nlow-fat')

    // and it round-trips back out intact (export quotes every field)
    const out = await exportSessionCsv(session.id)
    expect(out).toContain('"Milk, 2%\nlow-fat"')
  })
})

describe('header tolerance', () => {
  it('accepts surrounding whitespace in header names', async () => {
    const csv = [
      ' GoodId , Good_Name , GTIN , PhotoURI , PhotoId , PhotoType , PhotoDate ',
      '1,Milk,100,med/a.png,1,default,2025-01-01',
    ].join('\n')
    const { session } = await importBatch({ input: csv, filename: 'ws.csv' })
    const [r] = await rows(session.id)
    expect(r.photoId).toBe(1)
    expect(r.goodId).toBe(1)
  })
})

describe('malformed CSVs (strict-refuse)', () => {
  it('rejects an empty file (no header row)', async () => {
    await expect(importBatch({ input: '', filename: 'empty.csv' })).rejects.toBeInstanceOf(
      CsvValidationError,
    )
  })

  it('rejects a header with no data rows', async () => {
    await expect(importBatch({ input: HEADER, filename: 'header-only.csv' })).rejects.toThrow(
      /no data rows/,
    )
  })

  it('rejects when a required column header is absent', async () => {
    // PhotoURI missing
    const csv = [
      'GoodId,Good_Name,GTIN,PhotoId,PhotoType,PhotoDate',
      '1,Milk,100,1,default,2025-01-01',
    ].join('\n')
    await expect(importBatch({ input: csv, filename: 'nocol.csv' })).rejects.toThrow(/PhotoURI/)
  })

  it('rejects a row with a blank PhotoURI and leaves nothing half-loaded', async () => {
    const csv = [
      HEADER,
      '1,Milk,100,med/a.png,1,default,2025-01-01,NO,',
      '2,Bad,200,,2,default,2025-01-02,NO,',
    ].join('\n')
    await expect(importBatch({ input: csv, filename: 'badrow.csv' })).rejects.toBeInstanceOf(
      CsvValidationError,
    )
    const db = await getDB()
    expect(await db.count('photos')).toBe(0)
    expect(await db.count('sessions')).toBe(0)
  })

  it('rejects a non-numeric PhotoId', async () => {
    const csv = [HEADER, '1,Milk,100,med/a.png,not-a-number,default,2025-01-01,NO,'].join('\n')
    await expect(importBatch({ input: csv, filename: 'badid.csv' })).rejects.toThrow(
      /non-numeric PhotoId/,
    )
  })

  it('rejects a non-numeric GTIN (barcode) and leaves nothing half-loaded', async () => {
    const csv = [
      HEADER,
      '1,Milk,4600000000017,med/a.png,1,default,2025-01-01,NO,',
      '2,Bad,NOT-A-BARCODE,med/b.png,2,default,2025-01-02,NO,',
    ].join('\n')
    await expect(importBatch({ input: csv, filename: 'badgtin.csv' })).rejects.toThrow(
      /non-numeric GTIN/,
    )
    const db = await getDB()
    expect(await db.count('photos')).toBe(0)
    expect(await db.count('sessions')).toBe(0)
  })

  it('accepts a GTIN with significant leading zeros', async () => {
    const csv = [HEADER, '1,Milk,04600000017,med/a.png,1,default,2025-01-01,NO,'].join('\n')
    const { session } = await importBatch({ input: csv, filename: 'lz.csv' })
    const [r] = await rows(session.id)
    expect(r.gtin).toBe('04600000017') // not coerced to a number
  })

  it('does not create a session record on failure', async () => {
    await expect(importBatch({ input: '', filename: 'x.csv' })).rejects.toThrow()
    expect(await getSession('whatever')).toBeUndefined()
    const db = await getDB()
    expect(await db.count('sessions')).toBe(0)
  })
})
