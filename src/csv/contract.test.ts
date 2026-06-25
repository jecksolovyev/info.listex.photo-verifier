// Unit tests for the CSV contract's pure helpers (ADR-0003). Import-level
// behaviour (streaming, sort, de-dupe, round-trip) lives in db/import.test.ts
// and csv/import-edge-cases.test.ts; here we pin the field-level rules.

import { describe, expect, it } from 'vitest'
import {
  COLUMNS,
  CsvValidationError,
  detectDelimiter,
  parseFlagged,
  parseRow,
  resolveHeaders,
  stripBom,
} from './contract'

describe('detectDelimiter', () => {
  it('defaults to comma', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
  })

  it('picks semicolon when the header has more semicolons', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
  })

  it('only inspects the header line', () => {
    // header is comma-delimited even though the body uses semicolons
    expect(detectDelimiter('a,b\n1;2;3;4')).toBe(',')
  })

  it('keeps comma on a tie', () => {
    expect(detectDelimiter('a;b,c')).toBe(',')
  })
})

describe('stripBom', () => {
  it('removes a leading UTF-8 BOM', () => {
    expect(stripBom('﻿GoodId')).toBe('GoodId')
  })

  it('leaves BOM-free text untouched', () => {
    expect(stripBom('GoodId')).toBe('GoodId')
  })
})

describe('resolveHeaders', () => {
  it('maps every canonical column case-insensitively, ignoring order/extras', () => {
    const map = resolveHeaders(['extra', 'photoid', 'GTIN', 'goodid', 'Good_Name', 'phototype', 'PhotoURI', 'photodate'])
    // required columns all resolve to the raw header that was present
    expect(map.get('PhotoId')).toBe('photoid')
    expect(map.get('GoodId')).toBe('goodid')
    expect(map.get('PhotoURI')).toBe('PhotoURI')
    // optional columns simply absent
    expect(map.has('Flagged')).toBe(false)
    expect(map.has('UserId')).toBe(false)
  })

  it('trims whitespace around header names', () => {
    const map = resolveHeaders([' GoodId ', 'Good_Name', 'GTIN', 'PhotoURI', 'PhotoId', 'PhotoType', '  PhotoDate'])
    expect(map.get('GoodId')).toBe(' GoodId ')
    expect(map.get('PhotoDate')).toBe('  PhotoDate')
  })

  it('throws (singular) when one required column is missing', () => {
    expect(() =>
      resolveHeaders(['GoodId', 'Good_Name', 'GTIN', 'PhotoURI', 'PhotoId', 'PhotoType']),
    ).toThrow(/missing required column: PhotoDate/)
  })

  it('throws (plural, listing all) when several required columns are missing', () => {
    let err: unknown
    try {
      resolveHeaders(['GoodId', 'GTIN'])
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(CsvValidationError)
    expect((err as Error).message).toMatch(/missing required columns:/)
    expect((err as Error).message).toContain('Good_Name')
    expect((err as Error).message).toContain('PhotoURI')
  })

  it('does not require the optional columns', () => {
    expect(() =>
      resolveHeaders(['GoodId', 'Good_Name', 'GTIN', 'PhotoURI', 'PhotoId', 'PhotoType', 'PhotoDate']),
    ).not.toThrow()
  })
})

describe('parseFlagged', () => {
  it.each(['YES', 'yes', 'Y', 'true', '1', 'да', ' Yes '])('treats %j as flagged', (v) => {
    expect(parseFlagged(v)).toBe(true)
  })

  it.each(['NO', 'no', 'false', '0', '', 'maybe'])('treats %j as not flagged', (v) => {
    expect(parseFlagged(v)).toBe(false)
  })

  it('treats undefined as not flagged', () => {
    expect(parseFlagged(undefined)).toBe(false)
  })
})

describe('parseRow', () => {
  // headers map keyed by canonical → canonical (the full 9 columns present)
  const headers = resolveHeaders([...COLUMNS])

  const record = (over: Record<string, string>) => ({
    GoodId: '7',
    Good_Name: 'Milk',
    GTIN: '100',
    PhotoURI: 'med/a.png',
    PhotoId: '42',
    PhotoType: 'default',
    PhotoDate: '2025-01-01',
    Flagged: 'NO',
    UserId: '',
    ...over,
  })

  it('maps and trims a well-formed row', () => {
    const row = parseRow(record({ Good_Name: '  Milk  ', UserId: '  anna ' }), headers, 1)
    expect(row).toMatchObject({
      goodId: 7,
      goodName: 'Milk',
      gtin: '100',
      photoURI: 'med/a.png',
      photoId: 42,
      photoType: 'default',
      photoDate: '2025-01-01',
      flagged: false,
      userId: 'anna',
    })
  })

  it('truncates non-integer numeric ids', () => {
    expect(parseRow(record({ PhotoId: '42.9', GoodId: '7.6' }), headers, 1)).toMatchObject({
      photoId: 42,
      goodId: 7,
    })
  })

  it('defaults a blank GoodId to 0', () => {
    expect(parseRow(record({ GoodId: '' }), headers, 1).goodId).toBe(0)
  })

  it('honours a flagged cell', () => {
    expect(parseRow(record({ Flagged: 'да' }), headers, 1).flagged).toBe(true)
  })

  it('throws on a blank PhotoId', () => {
    expect(() => parseRow(record({ PhotoId: '' }), headers, 3)).toThrow(CsvValidationError)
    expect(() => parseRow(record({ PhotoId: '' }), headers, 3)).toThrow(/Row 3/)
  })

  it('throws on a non-numeric PhotoId', () => {
    expect(() => parseRow(record({ PhotoId: 'abc' }), headers, 5)).toThrow(/non-numeric PhotoId/)
  })

  it('throws on a blank PhotoURI, naming the PhotoId', () => {
    expect(() => parseRow(record({ PhotoURI: '   ' }), headers, 2)).toThrow(/PhotoId 42.*blank PhotoURI/)
  })

  it('throws on a non-numeric GTIN (barcode)', () => {
    expect(() => parseRow(record({ GTIN: 'ABC123' }), headers, 4)).toThrow(CsvValidationError)
    expect(() => parseRow(record({ GTIN: 'ABC123' }), headers, 4)).toThrow(/non-numeric GTIN/)
  })

  it('throws on a blank GTIN', () => {
    expect(() => parseRow(record({ GTIN: '' }), headers, 4)).toThrow(/non-numeric GTIN/)
  })

  it('keeps a leading-zero GTIN as a string (barcodes are not numbers)', () => {
    expect(parseRow(record({ GTIN: '04600000017' }), headers, 1).gtin).toBe('04600000017')
  })
})
