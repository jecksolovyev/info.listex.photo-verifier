import { useCallback, useEffect, useState } from 'react'
import { StartScreen } from './components/StartScreen'
import { ReviewScreen } from './components/ReviewScreen'
import { importBatch } from './db/import'
import { listSessions, deleteSession as deleteSessionDb, type SessionRecord } from './db/sessions'
import { downloadSessionCsv } from './csv/export'
import { CsvValidationError } from './csv/contract'

// Two screens, switched by app state — no router (ADR-0005).
type Screen = { name: 'start' } | { name: 'review'; sessionId: string }

const REVIEWER_KEY = 'photo-verifier:userId'
// Remember which session is open so a browser refresh resumes the review
// screen instead of bouncing back to the start screen. The page cursor itself
// lives per-session in IndexedDB, so ReviewScreen reopens the exact page.
const OPEN_SESSION_KEY = 'photo-verifier:openSession'

export function App() {
  // The UserId is entered once and persisted per-browser (ADR-0003).
  const [userId, setUserId] = useState<string>(() => localStorage.getItem(REVIEWER_KEY) ?? '')
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [screen, setScreen] = useState<Screen>(() => {
    const id = localStorage.getItem(OPEN_SESSION_KEY)
    return id ? { name: 'review', sessionId: id } : { name: 'start' }
  })
  const [importing, setImporting] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    localStorage.setItem(REVIEWER_KEY, userId)
  }, [userId])

  // Keep the persisted "open session" in sync with the current screen.
  useEffect(() => {
    if (screen.name === 'review') localStorage.setItem(OPEN_SESSION_KEY, screen.sessionId)
    else localStorage.removeItem(OPEN_SESSION_KEY)
  }, [screen])

  const refresh = useCallback(async () => {
    const list = await listSessions()
    setSessions(list)
    // If the remembered session is gone (e.g. deleted in another tab), don't
    // get stuck on a session that no longer exists — fall back to the start screen.
    setScreen((s) =>
      s.name === 'review' && !list.some((x) => x.id === s.sessionId) ? { name: 'start' } : s,
    )
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openSession = (id: string) => setScreen({ name: 'review', sessionId: id })

  const goStart = useCallback(() => {
    void refresh() // pick up any flag/review changes made in the session
    setScreen({ name: 'start' })
  }, [refresh])

  const loadBatch = useCallback(
    async (file: File) => {
      setLoadError(null)
      setImporting(true)
      try {
        // Import only — do NOT auto-open the session. Opening displays page 1,
        // which (ADR-0003) stamps those rows reviewed; uploading must not count
        // as reviewing. The new session appears in the start-screen list at 0
        // reviewed; the reviewer opens it deliberately to begin.
        await importBatch({ input: file, filename: file.name })
        await refresh()
      } catch (err) {
        setLoadError(
          err instanceof CsvValidationError
            ? err.message
            : 'Unexpected error while reading the file. Make sure it is a valid CSV.',
        )
      } finally {
        setImporting(false)
      }
    },
    [refresh],
  )

  const deleteSession = useCallback(
    async (id: string) => {
      await deleteSessionDb(id)
      await refresh()
    },
    [refresh],
  )

  const download = useCallback((session: SessionRecord) => {
    void downloadSessionCsv(session.id, resultFilename(session.filename))
  }, [])

  const active = screen.name === 'review' ? screen.sessionId : null

  return active ? (
    <ReviewScreen sessionId={active} userId={userId} onBack={goStart} />
  ) : (
    <StartScreen
      userId={userId}
      onUserId={setUserId}
      sessions={sessions}
      importing={importing}
      loadError={loadError}
      onClearError={() => setLoadError(null)}
      onOpen={openSession}
      onDelete={deleteSession}
      onLoadBatch={loadBatch}
      onDownload={download}
    />
  )
}

/** "audit_batch_01.csv" → "audit_batch_01.reviewed.csv" */
function resultFilename(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? `${name}.reviewed.csv` : `${name.slice(0, dot)}.reviewed${name.slice(dot)}`
}
