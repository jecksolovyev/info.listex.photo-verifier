// CSV export — round-trip to the 9-column input shape (ADR-0003).
//
// Re-emits the entire batch in canonical (position) order with updated
// `Flagged`/`UserId`; all other columns are byte-for-byte source data. Fields
// are always quoted (RFC 4180), comma-delimited, UTF-8 with a BOM so Excel
// renders Cyrillic Good_Names.

import Papa from 'papaparse'
import { getDB, sessionBound } from '../db/schema'
import { COLUMNS } from './contract'
import type { PhotoRow } from '../db/schema'

const BOM = '﻿'

function toRecord(row: PhotoRow): Record<string, string> {
  return {
    GoodId: String(row.goodId),
    Good_Name: row.goodName,
    GTIN: row.gtin,
    PhotoURI: row.photoURI,
    PhotoId: String(row.photoId),
    PhotoType: row.photoType,
    PhotoDate: row.photoDate,
    Flagged: row.flagged ? 'YES' : 'NO',
    UserId: row.userId,
  }
}

/** Serialize a whole session to a round-trippable CSV string (with BOM). */
export async function exportSessionCsv(sessionId: string): Promise<string> {
  const db = await getDB()
  const rows: PhotoRow[] = []
  let cursor = await db.transaction('photos').store.index('byPosition').openCursor(sessionBound(sessionId))
  while (cursor) {
    rows.push(cursor.value)
    cursor = await cursor.continue()
  }
  const body = Papa.unparse(
    { fields: [...COLUMNS], data: rows.map(toRecord) },
    { quotes: true, newline: '\r\n' },
  )
  return BOM + body
}

/** Trigger a browser download of a session's CSV. */
export async function downloadSessionCsv(sessionId: string, filename: string): Promise<void> {
  const csv = await exportSessionCsv(sessionId)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
