// Streaming CSV import → IndexedDB (ADR-0003 import strategy).
//
// Rows are parsed in chunks and inserted unsorted (flat heap), then a single
// cursor pass over the `bySort` index stamps each row's sequential `position`.
// Import memory stays roughly constant from 1K to 390K rows: we never hold the
// whole batch as a JS array — only a Set of seen PhotoIds (for per-session
// de-dupe) and one chunk at a time.

import Papa from 'papaparse'
import {
  getDB,
  photoTypeRank,
  sessionBound,
  BLANK_DATE_SENTINEL,
  type PhotoRow,
  type SessionRecord,
} from './schema'
import {
  parseRow,
  resolveHeaders,
  CsvValidationError,
  type Column,
  type ParsedRow,
} from '../csv/contract'

export interface ImportProgress {
  /** Rows inserted so far (during the parse phase). */
  inserted: number
  /** Phase label for a progress UI. */
  phase: 'parsing' | 'sorting' | 'done'
}

export interface ImportResult {
  session: SessionRecord
  /** PhotoIds skipped as in-batch duplicates (keep-first). */
  duplicates: number
}

export interface ImportOptions {
  /** CSV source: a picked File (browser) or a raw string (tests). */
  input: File | string
  filename: string
  onProgress?: (p: ImportProgress) => void
  /** Parse off the main thread (browser File imports). Off for string/tests. */
  worker?: boolean
}

const CHUNK_FLUSH = 2000

function newSessionId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function toPhotoRow(parsed: ParsedRow, sessionId: string): PhotoRow {
  return {
    rowKey: `${sessionId}:${parsed.photoId}`,
    sessionId,
    position: -1,
    goodId: parsed.goodId,
    goodName: parsed.goodName,
    gtin: parsed.gtin,
    photoURI: parsed.photoURI,
    photoId: parsed.photoId,
    photoType: parsed.photoType,
    photoDate: parsed.photoDate,
    photoTypeRank: photoTypeRank(parsed.photoType),
    sortDate: parsed.photoDate.trim() === '' ? BLANK_DATE_SENTINEL : parsed.photoDate,
    flagged: parsed.flagged,
    userId: parsed.userId,
  }
}

/**
 * Import a batch CSV into a new Session. Resolves with the created session
 * record (counters included) or rejects with a CsvValidationError describing
 * exactly what to fix (strict-refuse — nothing is left half-loaded: on failure
 * the partially-inserted rows are deleted).
 */
export async function importBatch(opts: ImportOptions): Promise<ImportResult> {
  const { input, filename, onProgress, worker = false } = opts
  const db = await getDB()
  const sessionId = newSessionId()

  let headers: Map<Column, string> | null = null
  const seen = new Set<number>()
  let inserted = 0
  let duplicates = 0
  let flaggedCount = 0
  let reviewedCount = 0
  let rowNumber = 0

  const cleanup = async () => {
    const tx = db.transaction('photos', 'readwrite')
    let cur = await tx.store.index('byPosition').openCursor(sessionBound(sessionId))
    // staging rows have position -1 so they share the sessionBound range
    while (cur) {
      cur.delete() // don't await (see insert loop)
      cur = await cur.continue()
    }
    await tx.done
  }

  try {
    await new Promise<void>((resolve, reject) => {
      // Settle exactly once. `parser.abort()` fires `complete` synchronously, so
      // a validation failure must reject *before* aborting, and `complete` must
      // not resolve a promise we've already rejected — otherwise the descriptive
      // CsvValidationError is masked and a bad row mid-file is silently dropped.
      let settled = false
      const fail = (err: unknown) => {
        if (!settled) {
          settled = true
          reject(err)
        }
      }
      const done = () => {
        if (!settled) {
          settled = true
          resolve()
        }
      }
      Papa.parse<Record<string, string | undefined>>(input as never, {
        header: true,
        skipEmptyLines: 'greedy',
        delimitersToGuess: [',', ';'],
        worker,
        chunk: (results, parser) => {
          parser.pause()
          void (async () => {
            try {
              if (!headers) {
                const fields = results.meta.fields ?? []
                headers = resolveHeaders(fields) // throws CsvValidationError
              }
              const tx = db.transaction('photos', 'readwrite')
              for (const record of results.data) {
                rowNumber++
                const parsed = parseRow(record, headers, rowNumber)
                if (seen.has(parsed.photoId)) {
                  duplicates++
                  continue
                }
                seen.add(parsed.photoId)
                // Don't await each put: awaiting a write mid-loop lets the
                // transaction auto-commit after the first request. Issue all
                // writes, then await tx.done.
                void tx.store.put(toPhotoRow(parsed, sessionId))
                inserted++
                if (parsed.flagged) flaggedCount++
                if (parsed.userId.trim() !== '') reviewedCount++
              }
              await tx.done
              onProgress?.({ inserted, phase: 'parsing' })
              if (inserted % CHUNK_FLUSH === 0) onProgress?.({ inserted, phase: 'parsing' })
              parser.resume()
            } catch (err) {
              fail(err)
              parser.abort()
            }
          })()
        },
        complete: () => done(),
        error: (err) => fail(err),
      })
    })

    if (!headers) {
      throw new CsvValidationError('The CSV has no header row, or no data rows were found.')
    }
    if (inserted === 0) {
      throw new CsvValidationError('The CSV has a valid header but no data rows.')
    }

    // --- IndexedDB performs the sort: one cursor pass stamps `position`. ---
    onProgress?.({ inserted, phase: 'sorting' })
    const tx = db.transaction('photos', 'readwrite')
    let pos = 0
    let cur = await tx.store.index('bySort').openCursor(sessionBound(sessionId))
    while (cur) {
      cur.update({ ...cur.value, position: pos }) // don't await (see above)
      pos++
      cur = await cur.continue()
    }
    await tx.done

    const session: SessionRecord = {
      id: sessionId,
      filename,
      loadedAt: Date.now(),
      status: 'in progress',
      cursorPage: 0,
      total: inserted,
      flaggedCount,
      reviewedCount,
    }
    await db.put('sessions', session)
    onProgress?.({ inserted, phase: 'done' })

    return { session, duplicates }
  } catch (err) {
    await cleanup().catch(() => {})
    throw err
  }
}
