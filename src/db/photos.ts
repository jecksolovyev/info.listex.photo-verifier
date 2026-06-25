// Runtime photo reads + mutations against IndexedDB.
//
// Pages are read by `byPosition` range (O(50)). Mutations keep the session's
// running counters (flaggedCount / reviewedCount) current so the start screen
// never has to scan all rows. All writes honour the attribution invariant
// (ADR-0003): navigating off a page fills that page's blank UserIds; toggling a
// flag overwrites; finishing stamps the whole batch. Display alone marks nothing.

import { getDB, type PhotoRow, type SessionRecord } from './schema'

const range = (sessionId: string, lo: number, hi: number) =>
  IDBKeyRange.bound([sessionId, lo], [sessionId, hi])

/** Read one page (positions [page*size, page*size+size)) in canonical order. */
export async function getPage(
  sessionId: string,
  page: number,
  pageSize: number,
): Promise<PhotoRow[]> {
  const db = await getDB()
  const start = page * pageSize
  return db.getAllFromIndex('photos', 'byPosition', range(sessionId, start, start + pageSize - 1))
}

/** Read a single row by its canonical position. */
export async function getAt(sessionId: string, position: number): Promise<PhotoRow | undefined> {
  const db = await getDB()
  return db.getFromIndex('photos', 'byPosition', [sessionId, position])
}

/**
 * Toggle a photo's flag (by position). Overwrites the row's UserId with the
 * current reviewer (attribution invariant) and updates session counters.
 * Returns the updated row, or undefined if the position is out of range.
 */
export async function toggleFlag(
  sessionId: string,
  position: number,
  userId: string,
): Promise<PhotoRow | undefined> {
  const db = await getDB()
  const tx = db.transaction(['photos', 'sessions'], 'readwrite')
  const byPos = tx.objectStore('photos').index('byPosition')
  const cursor = await byPos.openCursor([sessionId, position])
  if (!cursor) {
    await tx.done
    return undefined
  }
  const row = cursor.value
  const wasReviewed = row.userId.trim() !== ''
  const updated: PhotoRow = {
    ...row,
    flagged: !row.flagged,
    userId: userId.trim() !== '' ? userId : row.userId,
  }
  cursor.update(updated) // don't await mid-transaction (auto-commit guard)

  const session = await tx.objectStore('sessions').get(sessionId)
  if (session) {
    session.flaggedCount += updated.flagged ? 1 : -1
    if (!wasReviewed && updated.userId.trim() !== '') session.reviewedCount++
    void tx.objectStore('sessions').put(session)
  }
  await tx.done
  return updated
}

/**
 * Stamp the current reviewer onto every blank UserId on a page. Called when the
 * reviewer navigates *off* this page (page navigation = reviewed), not on
 * display. Returns the page rows after stamping. No-op if userId is blank.
 */
export async function stampPageReviewed(
  sessionId: string,
  page: number,
  pageSize: number,
  userId: string,
): Promise<PhotoRow[]> {
  const db = await getDB()
  if (userId.trim() === '') return getPage(sessionId, page, pageSize)

  const start = page * pageSize
  const tx = db.transaction(['photos', 'sessions'], 'readwrite')
  const byPos = tx.objectStore('photos').index('byPosition')
  const rows: PhotoRow[] = []
  let newlyReviewed = 0
  let cursor = await byPos.openCursor(range(sessionId, start, start + pageSize - 1))
  while (cursor) {
    let row = cursor.value
    if (row.userId.trim() === '') {
      row = { ...row, userId }
      cursor.update(row) // don't await mid-iteration
      newlyReviewed++
    }
    rows.push(row)
    cursor = await cursor.continue()
  }
  if (newlyReviewed > 0) {
    const session = await tx.objectStore('sessions').get(sessionId)
    if (session) {
      session.reviewedCount += newlyReviewed
      void tx.objectStore('sessions').put(session)
    }
  }
  await tx.done
  return rows
}

/**
 * Marking a session finished counts the whole batch as reviewed: stamp every
 * still-blank UserId with the current reviewer. No-op if userId is blank.
 */
export async function stampAllReviewed(sessionId: string, userId: string): Promise<void> {
  const db = await getDB()
  if (userId.trim() === '') return

  const tx = db.transaction(['photos', 'sessions'], 'readwrite')
  let newlyReviewed = 0
  let cursor = await tx
    .objectStore('photos')
    .index('byPosition')
    .openCursor(IDBKeyRange.bound([sessionId, -Infinity], [sessionId, Infinity]))
  while (cursor) {
    const row = cursor.value
    if (row.userId.trim() === '') {
      cursor.update({ ...row, userId }) // don't await mid-iteration
      newlyReviewed++
    }
    cursor = await cursor.continue()
  }
  if (newlyReviewed > 0) {
    const session = (await tx.objectStore('sessions').get(sessionId)) as SessionRecord | undefined
    if (session) {
      session.reviewedCount += newlyReviewed
      void tx.objectStore('sessions').put(session)
    }
  }
  await tx.done
}
