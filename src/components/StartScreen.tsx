import { useRef, useState } from 'react'
import type { SessionRecord } from '../db/schema'
import { cumulativeStat, formatStat, statForSession, num } from '../stats'
import { CsvFormatHelp } from './CsvFormatHelp'

interface Props {
  userId: string
  onUserId: (v: string) => void
  sessions: SessionRecord[]
  importing: boolean
  loadError: string | null
  onClearError: () => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onLoadBatch: (file: File) => void
  onDownload: (session: SessionRecord) => void
}

export function StartScreen({
  userId,
  onUserId,
  sessions,
  importing,
  loadError,
  onClearError,
  onOpen,
  onDelete,
  onLoadBatch,
  onDownload,
}: Props) {
  const hasSessions = sessions.length > 0
  const cumulative = cumulativeStat(sessions)

  return (
    <div className="screen start">
      <header className="start__head">
        <h1>Visual Audit</h1>
      </header>

      <section className="panel reviewer">
        <div className="reviewer__row">
          <label className="field reviewer__field">
            <span className="field__label">Reviewer ID</span>
            <input
              className="field__input"
              placeholder="e.g. anna"
              value={userId}
              onChange={(e) => onUserId(e.target.value)}
              autoFocus={!userId}
            />
          </label>

          <LoadBatchButton
            disabled={userId.trim() === ''}
            importing={importing}
            onLoadBatch={onLoadBatch}
          />

          <CsvFormatInfo />
        </div>
        <span className="field__hint">Reviewer ID is saved on this browser · stamped onto every photo you review</span>
      </section>

      {loadError && (
        <div className="loaderror" role="alert">
          <strong>Couldn’t load that CSV.</strong> {loadError}
          <button className="loaderror__close" onClick={onClearError} title="Dismiss">✕</button>
        </div>
      )}

      {hasSessions && (
        <p className="cumulative">
          Across all sessions: <strong>{formatStat(cumulative)}</strong>
        </p>
      )}

      {hasSessions ? (
        <ul className="sessions">
          {sessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              canOpen={userId.trim() !== ''}
              onOpen={() => onOpen(s.id)}
              onDelete={() => onDelete(s.id)}
              onDownload={() => onDownload(s)}
            />
          ))}
        </ul>
      ) : (
        <EmptyState reviewerReady={userId.trim() !== ''} />
      )}
    </div>
  )
}

function LoadBatchButton({
  disabled,
  importing,
  onLoadBatch,
}: {
  disabled: boolean
  importing: boolean
  onLoadBatch: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="loadbatch">
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onLoadBatch(file)
          e.target.value = '' // allow re-picking the same file
        }}
      />
      <button
        className="btn btn--primary"
        disabled={disabled || importing}
        onClick={() => inputRef.current?.click()}
        title={disabled ? 'Enter your Reviewer ID first' : 'Load a batch CSV'}
      >
        {importing ? 'Importing…' : '⬆ Load batch CSV'}
      </button>
    </div>
  )
}

function CsvFormatInfo() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        className="infobtn"
        onClick={() => setOpen(true)}
        title="What CSV format does this expect?"
        aria-label="Batch CSV format help"
      >
        i
      </button>
      {open && <CsvFormatHelp onClose={() => setOpen(false)} />}
    </>
  )
}

function SessionRow({
  session,
  canOpen,
  onOpen,
  onDelete,
  onDownload,
}: {
  session: SessionRecord
  canOpen: boolean
  onOpen: () => void
  onDelete: () => void
  onDownload: () => void
}) {
  const stat = statForSession(session)
  return (
    <li className="session">
      <div className="session__main">
        <div className="session__title">
          <button
            className="session__file"
            disabled={!canOpen}
            onClick={onOpen}
            title={canOpen ? 'Open session' : 'Enter Reviewer ID first'}
          >
            {session.filename}
          </button>
          <StatusBadge status={session.status} />
        </div>
        <div className="session__meta">
          <span>{formatLoadedAt(session.loadedAt)}</span>
          <span className="dot">·</span>
          <span className="session__stat">{formatStat(stat)}</span>
        </div>
        <ProgressBar reviewed={stat.reviewed} loaded={stat.loaded} flagged={stat.flagged} />
      </div>
      <div className="session__actions">
        <button className="btn" disabled={!canOpen} onClick={onOpen} title={canOpen ? '' : 'Enter Reviewer ID first'}>
          Open
        </button>
        <button className="btn btn--ghost" onClick={onDownload} title="Download result CSV">Download</button>
        <DeleteButton filename={session.filename} onConfirm={onDelete} />
      </div>
    </li>
  )
}

function DeleteButton({ filename, onConfirm }: { filename: string; onConfirm: () => void }) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const match = typed === filename
  return (
    <>
      <button className="btn btn--danger-ghost" onClick={() => setOpen(true)}>Delete</button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete session</h3>
            <p>
              This permanently removes the session and its saved flags. Type the filename to confirm:
            </p>
            <code className="modal__filename">{filename}</code>
            <input
              className="field__input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Type filename to confirm"
              autoFocus
            />
            <div className="modal__actions">
              <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button
                className="btn btn--danger"
                disabled={!match}
                onClick={() => { onConfirm(); setOpen(false) }}
              >
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function StatusBadge({ status }: { status: SessionRecord['status'] }) {
  return <span className={`badge badge--${status === 'finished' ? 'done' : 'progress'}`}>{status}</span>
}

function ProgressBar({ reviewed, loaded, flagged }: { reviewed: number; loaded: number; flagged: number }) {
  const reviewedPct = loaded ? (reviewed / loaded) * 100 : 0
  const flaggedPct = loaded ? (flagged / loaded) * 100 : 0
  return (
    <div className="progress" title={`${num(reviewed)} reviewed / ${num(loaded)}`}>
      <div className="progress__reviewed" style={{ width: `${reviewedPct}%` }} />
      <div className="progress__flagged" style={{ width: `${flaggedPct}%` }} />
    </div>
  )
}

function EmptyState({ reviewerReady }: { reviewerReady: boolean }) {
  return (
    <div className="empty">
      <div className="empty__art">📷</div>
      <h2>No sessions yet</h2>
      <p>
        {reviewerReady
          ? 'Load a batch CSV to start reviewing. Your session autosaves and resumes here.'
          : 'Enter your Reviewer ID above, then load a batch CSV to begin.'}
      </p>
      <ol className="empty__steps">
        <li className={reviewerReady ? 'done' : ''}>Enter your Reviewer ID</li>
        <li>Load a batch CSV</li>
        <li>Flip pages of 50 and flag bad photos</li>
      </ol>
    </div>
  )
}

function formatLoadedAt(ts: number): string {
  const d = new Date(ts)
  const date = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  return `loaded ${date}, ${time}`
}
