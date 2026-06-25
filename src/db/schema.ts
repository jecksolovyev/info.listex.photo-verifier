// IndexedDB schema for the real data layer (ADR-0002, ADR-0003).
//
// One database, two stores:
//   - `sessions`: one record per loaded batch, plus the running counters the
//     start screen needs (so stats never require scanning all photos).
//   - `photos`:   every row of every session, keyed by `${sessionId}:${photoId}`.
//
// The sort that ADR-0003 mandates is done *by IndexedDB*: rows stream in
// unsorted, then a single cursor pass over the `bySort` index stamps each
// row's sequential `position`. At runtime pages are read by `byPosition`
// range (O(50)), and the resume cursor is one integer.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { PHOTO_TYPE_ORDER, type SessionStatus } from '../types'

export const DB_NAME = 'photo-verifier'
export const DB_VERSION = 1

/** A photo row as stored in IndexedDB (mirrors the CSV plus derived sort keys). */
export interface PhotoRow {
  /** `${sessionId}:${photoId}` — unique within a session, store keyPath. */
  rowKey: string
  sessionId: string
  /** 0…N-1 in canonical order; -1 while staging, before the sort pass. */
  position: number

  goodId: number
  goodName: string
  gtin: string
  /** Full PhotoURI as it appears in the CSV (first path segment = size). */
  photoURI: string
  photoId: number
  photoType: string
  photoDate: string

  // --- derived sort keys (ADR-0003 ordering) ---
  /** Rank of photoType in canonical order; UNKNOWN_TYPE_RANK if unknown/blank. */
  photoTypeRank: number
  /** photoDate, or a high sentinel so blank dates sort last within a type. */
  sortDate: string

  // --- mutable state ---
  flagged: boolean
  userId: string
}

/** Session metadata + running counters (kept current on every mutation). */
export interface SessionRecord {
  id: string
  filename: string
  loadedAt: number
  status: SessionStatus
  /** Page index (0-based) the reviewer last left off on. */
  cursorPage: number
  /** Total rows in the batch. */
  total: number
  /** Rows with Flagged=YES. */
  flaggedCount: number
  /** Rows with a non-blank UserId (reviewed by someone). */
  reviewedCount: number
}

interface PhotoVerifierDB extends DBSchema {
  sessions: {
    key: string
    value: SessionRecord
  }
  photos: {
    key: string
    value: PhotoRow
    indexes: {
      /** Import-time sort: groups a session's rows in canonical order. */
      bySort: [string, string, number, string]
      /** Runtime page reads + position lookups. */
      byPosition: [string, number]
    }
  }
}

export type AppDB = IDBPDatabase<PhotoVerifierDB>

/** photoTypeRank for an unrecognised or blank PhotoType — sorts last. */
export const UNKNOWN_TYPE_RANK = PHOTO_TYPE_ORDER.length
/** sortDate sentinel for a blank PhotoDate — sorts last within its type group. */
export const BLANK_DATE_SENTINEL = '9999-12-31'

const TYPE_RANK = new Map<string, number>(PHOTO_TYPE_ORDER.map((t, i) => [t, i]))

/** Canonical rank of a PhotoType (unknown/blank → last). */
export function photoTypeRank(type: string): number {
  return TYPE_RANK.get(type.trim()) ?? UNKNOWN_TYPE_RANK
}

/** A key range that bounds a compound-index scan to one session. */
export function sessionBound(sessionId: string): IDBKeyRange {
  // Upper bound: a 1-element array sorts before any longer array sharing its
  // first element, and appending the max BMP codepoint keeps every
  // [sessionId, ...] key strictly below the upper key.
  const HI = '￿'
  return IDBKeyRange.bound([sessionId], [sessionId + HI])
}

let dbPromise: Promise<AppDB> | null = null

export function getDB(): Promise<AppDB> {
  if (!dbPromise) {
    dbPromise = openDB<PhotoVerifierDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('sessions', { keyPath: 'id' })
        const photos = db.createObjectStore('photos', { keyPath: 'rowKey' })
        photos.createIndex('bySort', ['sessionId', 'gtin', 'photoTypeRank', 'sortDate'])
        // Not unique: during staging every row shares position -1; positions
        // only become unique after the sort pass stamps them.
        photos.createIndex('byPosition', ['sessionId', 'position'])
      },
    })
  }
  return dbPromise
}

/** Close the cached connection (so a pending deleteDatabase isn't blocked). */
export async function closeDB(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise.catch(() => null)
    db?.close()
    dbPromise = null
  }
}

/** Test seam: drop the cached connection so a fresh DB can be opened. */
export function _resetDBForTests() {
  dbPromise = null
}
