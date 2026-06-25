// CSV contract: the 9-column batch shape and its validation rules (ADR-0003).
//
// Headers are matched by name, case-insensitively, so column order is free and
// unknown columns are ignored. The seven immutable columns are required;
// `Flagged`/`UserId` are optional on import. Validation is strict-refuse: a
// missing required column, or a row missing PhotoId/PhotoURI or with a
// non-numeric GTIN, rejects the whole file with a description of what to fix.

/** Canonical column names, in export order. */
export const COLUMNS = [
  'GoodId',
  'Good_Name',
  'GTIN',
  'PhotoURI',
  'PhotoId',
  'PhotoType',
  'PhotoDate',
  'Flagged',
  'UserId',
] as const

export type Column = (typeof COLUMNS)[number]

/** The seven immutable columns that must be present as headers. */
export const REQUIRED_COLUMNS: Column[] = [
  'GoodId',
  'Good_Name',
  'GTIN',
  'PhotoURI',
  'PhotoId',
  'PhotoType',
  'PhotoDate',
]

/** A parsed, validated source row (pre-sort, pre-position). */
export interface ParsedRow {
  goodId: number
  goodName: string
  gtin: string
  photoURI: string
  photoId: number
  photoType: string
  photoDate: string
  flagged: boolean
  userId: string
}

export class CsvValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CsvValidationError'
  }
}

/** Auto-detect the delimiter (comma or semicolon) from the header line. */
export function detectDelimiter(sample: string): ',' | ';' {
  const firstLine = sample.split(/\r?\n/, 1)[0] ?? ''
  const commas = (firstLine.match(/,/g) || []).length
  const semis = (firstLine.match(/;/g) || []).length
  return semis > commas ? ';' : ','
}

/** Strip a UTF-8 BOM if present. */
export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

/**
 * Map raw header names to canonical columns (case-insensitive, trimmed).
 * Returns a lookup from canonical column → the raw header key PapaParse used.
 * Throws if any required column is absent.
 */
export function resolveHeaders(rawHeaders: string[]): Map<Column, string> {
  const byLower = new Map<string, string>()
  for (const h of rawHeaders) {
    const key = h.trim().toLowerCase()
    if (!byLower.has(key)) byLower.set(key, h)
  }

  const resolved = new Map<Column, string>()
  const missing: Column[] = []
  for (const col of COLUMNS) {
    const raw = byLower.get(col.toLowerCase())
    if (raw !== undefined) resolved.set(col, raw)
    else if (REQUIRED_COLUMNS.includes(col)) missing.push(col)
  }

  if (missing.length > 0) {
    throw new CsvValidationError(
      `The CSV is missing required column${missing.length > 1 ? 's' : ''}: ` +
        `${missing.join(', ')}. Required columns are ${REQUIRED_COLUMNS.join(', ')} ` +
        `(Flagged and UserId are optional). Column names are matched ignoring case and order.`,
    )
  }
  return resolved
}

const TRUTHY = new Set(['yes', 'y', 'true', '1', 'да'])

/** Parse a Flagged cell to a boolean (YES/NO, tolerant of common variants). */
export function parseFlagged(raw: string | undefined): boolean {
  return raw !== undefined && TRUTHY.has(raw.trim().toLowerCase())
}

function toInt(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const t = raw.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

/**
 * Validate and map one raw record (keyed by raw header) to a ParsedRow.
 * `rowNumber` is 1-based over data rows, for error messages.
 * Throws CsvValidationError on a row missing PhotoId or PhotoURI.
 */
export function parseRow(
  record: Record<string, string | undefined>,
  headers: Map<Column, string>,
  rowNumber: number,
): ParsedRow {
  const cell = (col: Column): string => {
    const raw = headers.get(col)
    return raw === undefined ? '' : (record[raw] ?? '').trim()
  }

  const photoId = toInt(record[headers.get('PhotoId')!])
  const photoURI = cell('PhotoURI')
  // GTIN (barcode) stays a string — leading zeros are significant and must
  // round-trip — but every character must be a digit (strict-refuse).
  const gtin = cell('GTIN')

  if (photoId === null) {
    throw new CsvValidationError(
      `Row ${rowNumber} has a missing or non-numeric PhotoId. Every row must have a PhotoId.`,
    )
  }
  if (photoURI === '') {
    throw new CsvValidationError(`Row ${rowNumber} (PhotoId ${photoId}) has a blank PhotoURI.`)
  }
  if (!/^\d+$/.test(gtin)) {
    throw new CsvValidationError(
      `Row ${rowNumber} (PhotoId ${photoId}) has a non-numeric GTIN "${gtin}". ` +
        `GTIN is a barcode and must contain only digits.`,
    )
  }

  return {
    goodId: toInt(record[headers.get('GoodId')!]) ?? 0,
    goodName: cell('Good_Name'),
    gtin,
    photoURI,
    photoId,
    photoType: cell('PhotoType'),
    photoDate: cell('PhotoDate'),
    flagged: parseFlagged(headers.has('Flagged') ? record[headers.get('Flagged')!] : undefined),
    userId: headers.has('UserId') ? cell('UserId') : '',
  }
}
