import { useEffect } from 'react'
import { PHOTO_TYPE_ORDER } from '../types'

interface ColumnDoc {
  name: string
  required: boolean
  rule: string
}

// Mirrors the contract in src/csv/contract.ts (ADR-0003). Keep in sync when
// validation rules change.
const COLUMN_DOCS: ColumnDoc[] = [
  { name: 'GoodId', required: true, rule: 'Integer product id. Used for the “Open in goods editor” link. A blank or non-numeric value falls back to 0.' },
  { name: 'Good_Name', required: true, rule: 'Free-text product name. Shown in the popup and used for the Google image search.' },
  { name: 'GTIN', required: true, rule: 'Barcode — digits only. Leading zeros are kept and round-trip unchanged. A non-numeric GTIN rejects the file.' },
  { name: 'PhotoURI', required: true, rule: 'Full image URL. Must not be blank. The first path segment (the size) is rewritten to a thumbnail / med view; the rest is preserved byte-for-byte.' },
  { name: 'PhotoId', required: true, rule: 'Integer — the unique key for a photo. Must be present and numeric, or the file is rejected. Duplicate PhotoIds within the batch keep the first and skip the rest.' },
  { name: 'PhotoType', required: true, rule: `Photo type label. Drives sort order (see below). Recognised types: ${PHOTO_TYPE_ORDER.join(', ')}. Anything else sorts last.` },
  { name: 'PhotoDate', required: true, rule: 'Date string (e.g. 2025-04-30). Sorted ascending; blank dates sort last. Free text is accepted — it is not strictly validated.' },
  { name: 'Flagged', required: false, rule: 'Optional. Whether the photo is already flagged. Truthy values: yes, y, true, 1, да (case-insensitive); everything else is treated as not flagged. Mutable — written back on export.' },
  { name: 'UserId', required: false, rule: 'Optional. Who reviewed the row. Blank means never reviewed; it is filled when you view a page and overwritten when you toggle a flag. Mutable — written back on export.' },
]

const FILE_RULES: string[] = [
  'Encoding: UTF-8. A leading byte-order mark (BOM) is allowed and stripped automatically.',
  'Delimiter: comma or semicolon — auto-detected from the header line.',
  'Quoting: standard CSV quoting is supported (commas/newlines inside quoted fields are fine).',
  'Header row required. Columns are matched by name, ignoring case and order. Unknown columns are ignored.',
  'Blank lines are skipped.',
  'Strict-refuse: a single bad row or a missing required column rejects the whole file with a message describing what to fix. Nothing is left half-loaded.',
  'Round-trip: the exported CSV keeps the same 9-column shape; only Flagged and UserId change.',
]

export function CsvFormatHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide csvhelp" onClick={(e) => e.stopPropagation()}>
        <button className="popup__close csvhelp__close" onClick={onClose} title="Close (Esc)">✕</button>
        <h3>Batch CSV format</h3>
        <p>
          A batch is a CSV with these <strong>9 columns</strong>. Seven are required; the
          last two (<code>Flagged</code>, <code>UserId</code>) are optional on import and are
          the only columns this tool changes.
        </p>

        <table className="csvhelp__table">
          <thead>
            <tr><th>Column</th><th>Req.</th><th>Rule</th></tr>
          </thead>
          <tbody>
            {COLUMN_DOCS.map((c) => (
              <tr key={c.name}>
                <td><code>{c.name}</code></td>
                <td>{c.required ? 'yes' : <span className="csvhelp__opt">optional</span>}</td>
                <td>{c.rule}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4 className="csvhelp__subhead">Sort order</h4>
        <p className="csvhelp__note">
          Rows are sorted on import by <strong>GTIN</strong>, then <strong>PhotoType</strong> rank,
          then <strong>PhotoDate</strong> ascending — so every product’s photos appear together in a
          consistent order.
        </p>

        <h4 className="csvhelp__subhead">File requirements</h4>
        <ul className="csvhelp__rules">
          {FILE_RULES.map((r, i) => <li key={i}>{r}</li>)}
        </ul>

        <div className="modal__actions">
          <button className="btn btn--primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  )
}
