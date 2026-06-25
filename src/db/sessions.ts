// Session CRUD against IndexedDB (ADR-0002).

import { getDB, sessionBound, type SessionRecord } from './schema'
import type { SessionStatus } from '../types'

/** All sessions, newest first (start-screen list). */
export async function listSessions(): Promise<SessionRecord[]> {
  const db = await getDB()
  const all = await db.getAll('sessions')
  return all.sort((a, b) => b.loadedAt - a.loadedAt)
}

export async function getSession(id: string): Promise<SessionRecord | undefined> {
  return (await getDB()).get('sessions', id)
}

/** Persist the resume cursor at page granularity. */
export async function setCursorPage(id: string, cursorPage: number): Promise<void> {
  const db = await getDB()
  const s = await db.get('sessions', id)
  if (s && s.cursorPage !== cursorPage) {
    s.cursorPage = cursorPage
    await db.put('sessions', s)
  }
}

export async function setStatus(id: string, status: SessionStatus): Promise<void> {
  const db = await getDB()
  const s = await db.get('sessions', id)
  if (s) {
    s.status = status
    await db.put('sessions', s)
  }
}

/** Delete a session and all its photo rows. */
export async function deleteSession(id: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['photos', 'sessions'], 'readwrite')
  let cursor = await tx.objectStore('photos').index('byPosition').openCursor(sessionBound(id))
  while (cursor) {
    cursor.delete() // don't await mid-iteration
    cursor = await cursor.continue()
  }
  void tx.objectStore('sessions').delete(id)
  await tx.done
}

/** Cumulative stat across all sessions: flagged · reviewed · loaded totals. */
export async function cumulativeTotals(): Promise<{
  flagged: number
  reviewed: number
  loaded: number
}> {
  const sessions = await listSessions()
  return sessions.reduce(
    (acc, s) => ({
      flagged: acc.flagged + s.flaggedCount,
      reviewed: acc.reviewed + s.reviewedCount,
      loaded: acc.loaded + s.total,
    }),
    { flagged: 0, reviewed: 0, loaded: 0 },
  )
}

export type { SessionRecord }
