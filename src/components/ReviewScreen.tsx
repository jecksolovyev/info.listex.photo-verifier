import { useCallback, useEffect, useRef, useState } from 'react'
import { PAGE_SIZE, type SessionStatus } from '../types'
import { formatStat, num, statForSession } from '../stats'
import type { PhotoRow, SessionRecord } from '../db/schema'
import { getPage, stampPageReviewed, stampAllReviewed, toggleFlag as toggleFlagDb } from '../db/photos'
import { getSession, setCursorPage, setStatus as setSessionStatus } from '../db/sessions'
import { gridUrl } from '../urls'
import { PhotoTile } from './PhotoTile'
import { PhotoPopup } from './PhotoPopup'

interface Props {
  sessionId: string
  userId: string
  onBack: () => void
}

export function ReviewScreen({ sessionId, userId, onBack }: Props) {
  const [session, setSession] = useState<SessionRecord | null>(null)
  // Global cursor = index into the whole working set. Page derives from it.
  const [cursor, setCursor] = useState(0)
  const [pageRows, setPageRows] = useState<PhotoRow[]>([])
  const [popupOpen, setPopupOpen] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)
  // The page currently on screen — used to mark it reviewed when we leave it.
  const displayedPageRef = useRef<number | null>(null)

  const total = session?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const page = Math.floor(cursor / PAGE_SIZE)
  const pageStart = page * PAGE_SIZE

  // --- load the session record once, and seed the cursor from its saved page ---
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const s = await getSession(sessionId)
      if (cancelled || !s) return
      setSession(s)
      setCursor(Math.min(s.cursorPage * PAGE_SIZE, Math.max(0, s.total - 1)))
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  // --- load the current page whenever it changes. Displaying a page does NOT
  // mark it reviewed; navigating to another page marks the page we just left
  // (blank UserIds → current reviewer, ADR-0003). Finishing marks the whole
  // batch; neither display nor going back to the session list marks anything. ---
  useEffect(() => {
    if (!session) return
    let cancelled = false
    const leaving = displayedPageRef.current
    displayedPageRef.current = page
    void (async () => {
      if (leaving !== null && leaving !== page) {
        await stampPageReviewed(sessionId, leaving, PAGE_SIZE, userId)
      }
      const rows = await getPage(sessionId, page, PAGE_SIZE)
      if (cancelled) return
      setPageRows(rows)
      void setCursorPage(sessionId, page)
      // refresh counters (leaving a page may have bumped reviewedCount)
      const s = await getSession(sessionId)
      if (s && !cancelled) setSession(s)
      // preload next page's thumbnails
      if (page + 1 < pageCount) {
        const next = await getPage(sessionId, page + 1, PAGE_SIZE)
        if (!cancelled) for (const r of next) new Image().src = gridUrl(r.photoURI)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, page, session !== null, userId])

  const toggleFlag = useCallback(
    async (position: number) => {
      const updated = await toggleFlagDb(sessionId, position, userId)
      if (!updated) return
      setPageRows((rows) => rows.map((r) => (r.position === position ? updated : r)))
      const s = await getSession(sessionId)
      if (s) setSession(s)
    },
    [sessionId, userId],
  )

  const changeStatus = useCallback(
    async (status: SessionStatus) => {
      await setSessionStatus(sessionId, status)
      // Marking finished counts the whole batch as reviewed (ADR-0003).
      if (status === 'finished') await stampAllReviewed(sessionId, userId)
      const s = await getSession(sessionId)
      if (s) setSession(s)
      const rows = await getPage(sessionId, page, PAGE_SIZE)
      setPageRows(rows)
    },
    [sessionId, userId, page],
  )

  const stepCursor = useCallback(
    (delta: number) => {
      setCursor((c) => {
        const n = c + delta
        if (n < 0) return 0
        if (n > total - 1) return Math.max(0, total - 1)
        return n
      })
    },
    [total],
  )

  const jumpPage = useCallback(
    (delta: number) => {
      setCursor((c) => {
        const p = Math.floor(c / PAGE_SIZE)
        const np = Math.min(Math.max(p + delta, 0), pageCount - 1)
        return np * PAGE_SIZE
      })
    },
    [pageCount],
  )

  const goToPage = useCallback(
    (p1based: number) => {
      const p = Math.min(Math.max(p1based - 1, 0), pageCount - 1)
      setCursor(p * PAGE_SIZE)
    },
    [pageCount],
  )

  // --- keyboard navigation (ADR-0004) ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      const k = e.key.toLowerCase()
      const isRight = e.key === 'ArrowRight' || k === 'd'
      const isLeft = e.key === 'ArrowLeft' || k === 'a'
      const pageMod = e.metaKey || e.ctrlKey

      if (popupOpen) {
        if (e.key === 'Escape') setPopupOpen(false)
        if (e.code === 'Space') { e.preventDefault(); void toggleFlag(cursor) }
        if (isRight) { e.preventDefault(); stepCursor(1) }
        if (isLeft) { e.preventDefault(); stepCursor(-1) }
        return
      }

      if (isRight) { e.preventDefault(); pageMod ? jumpPage(1) : stepCursor(1) }
      else if (isLeft) { e.preventDefault(); pageMod ? jumpPage(-1) : stepCursor(-1) }
      else if (e.code === 'Space') { e.preventDefault(); void toggleFlag(cursor) }
      else if (e.key === 'Enter') { e.preventDefault(); setPopupOpen(true) }
      else if (e.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cursor, popupOpen, stepCursor, jumpPage, toggleFlag, onBack])

  // keep the focused tile scrolled into view
  useEffect(() => {
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor, pageRows])

  const focusedRow = pageRows.find((r) => r.position === cursor)

  if (!session) {
    return (
      <div className="screen review">
        <div className="review__notice">Loading session…</div>
      </div>
    )
  }

  return (
    <div className="screen review">
      <header className="review__bar">
        <button className="btn btn--ghost" onClick={onBack} title="Back (Esc)">← Sessions</button>

        <div className="review__id">
          <span className="review__file">{session.filename}</span>
          <span className="review__progress">
            Page {page + 1} of {num(pageCount)} · {formatStat(statForSession(session))}
          </span>
        </div>

        <div className="review__nav">
          <StatusToggle status={session.status} onStatus={changeStatus} />
          <button className="btn" onClick={() => jumpPage(-1)} disabled={page === 0}>‹ Prev</button>
          <GoToPage pageCount={pageCount} current={page + 1} onGo={goToPage} />
          <button className="btn" onClick={() => jumpPage(1)} disabled={page >= pageCount - 1}>Next ›</button>
        </div>
      </header>

      <div className="grid" ref={gridRef}>
        {pageRows.map((p, i) => {
          const idx = pageStart + i
          return (
            <PhotoTile
              key={p.photoId}
              photo={p}
              index={idx}
              focused={idx === cursor}
              onFocus={() => setCursor(idx)}
              onToggle={() => void toggleFlag(idx)}
              onOpen={() => { setCursor(idx); setPopupOpen(true) }}
            />
          )
        })}
      </div>

      <footer className="review__hints">
        <kbd>←</kbd>/<kbd>→</kbd> or <kbd>A</kbd>/<kbd>D</kbd> move · <kbd>⌘/Ctrl</kbd>+arrows page ·
        <kbd>Space</kbd> flag · <kbd>Enter</kbd> open · <kbd>Esc</kbd> back
      </footer>

      {popupOpen && focusedRow && (
        <PhotoPopup
          photo={focusedRow}
          onClose={() => setPopupOpen(false)}
          onToggle={() => void toggleFlag(cursor)}
          onPrev={() => stepCursor(-1)}
          onNext={() => stepCursor(1)}
        />
      )}
    </div>
  )
}

function StatusToggle({ status, onStatus }: { status: SessionStatus; onStatus: (s: SessionStatus) => void }) {
  const finished = status === 'finished'
  return (
    <button
      className={`btn ${finished ? 'btn--done' : ''}`}
      onClick={() => onStatus(finished ? 'in progress' : 'finished')}
      title={finished ? 'Reopen session' : 'Mark session finished (stamps all unreviewed rows)'}
    >
      {finished ? '✓ Finished' : 'Mark finished'}
    </button>
  )
}

function GoToPage({ pageCount, current, onGo }: { pageCount: number; current: number; onGo: (p: number) => void }) {
  const [val, setVal] = useState(String(current))
  useEffect(() => setVal(String(current)), [current])
  return (
    <form
      className="goto"
      onSubmit={(e) => {
        e.preventDefault()
        const n = parseInt(val, 10)
        if (!Number.isNaN(n)) onGo(n)
        ;(document.activeElement as HTMLElement)?.blur()
      }}
    >
      <input
        className="goto__input"
        value={val}
        onChange={(e) => setVal(e.target.value.replace(/\D/g, ''))}
        aria-label="Go to page"
      />
      <span className="goto__total">/ {num(pageCount)}</span>
    </form>
  )
}
