// Wipe the IndexedDB between tests so each starts from an empty database.
// Mirrors the inline helper in db/import.test.ts; shared by the DB-backed
// resume/cursor tests.

import { DB_NAME, closeDB } from '../db/schema'

export async function freshDB(): Promise<void> {
  await closeDB()
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}
