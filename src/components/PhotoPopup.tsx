import { useEffect, useState } from 'react'
import type { PhotoRow } from '../db/schema'
import { medUrl } from '../urls'

interface Props {
  photo: PhotoRow
  onClose: () => void
  onToggle: () => void
  onPrev: () => void
  onNext: () => void
}

export function PhotoPopup({ photo, onClose, onToggle, onPrev, onNext }: Props) {
  const [broken, setBroken] = useState(false)
  const [copied, setCopied] = useState<'gtin' | 'name' | null>(null)

  useEffect(() => setBroken(false), [photo.photoId])

  const editorUrl = `https://a.listex.info/goods/edit?GoodId=${photo.goodId}`
  const googleUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`${photo.goodName} ${photo.gtin}`)}`

  const copy = async (field: 'gtin' | 'name', value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(field)
      setTimeout(() => setCopied((c) => (c === field ? null : c)), 1200)
    } catch {
      /* clipboard may be blocked in some contexts; no-op for prototype */
    }
  }

  return (
    <div className="modal-backdrop popup-backdrop" onClick={onClose}>
      <div
        className={`popup ${photo.flagged ? 'popup--flagged' : 'popup--ok'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="popup__nav popup__nav--prev" onClick={onPrev} title="Previous (←)">‹</button>

        <div className="popup__imgwrap">
          {broken ? (
            <div className="popup__placeholder">
              <span className="tile__placeholder-icon">🚫</span>
              <span>image unavailable</span>
              <code className="popup__uri">{photo.photoURI}</code>
            </div>
          ) : (
            <img src={medUrl(photo.photoURI)} alt={photo.goodName} onError={() => setBroken(true)} />
          )}
        </div>

        <aside className="popup__side">
          <button className="popup__name" onClick={() => copy('name', photo.goodName)} title="Copy product name">
            <span className="popup__name-text">{photo.goodName}</span>
            <span className="popup__copy-tag">{copied === 'name' ? 'copied ✓' : 'copy'}</span>
          </button>

          <button className="popup__gtin" onClick={() => copy('gtin', photo.gtin)} title="Copy GTIN">
            <span className="popup__gtin-num">{photo.gtin}</span>
            <span className="popup__copy-tag">{copied === 'gtin' ? 'copied ✓' : 'copy'}</span>
          </button>

          <dl className="popup__meta">
            <div><dt>Photo type</dt><dd>{photo.photoType}</dd></div>
            <div><dt>Photo date</dt><dd>{photo.photoDate}</dd></div>
            <div><dt>Photo ID</dt><dd>{photo.photoId}</dd></div>
            <div><dt>Good ID</dt><dd>{photo.goodId}</dd></div>
            <div><dt>Reviewed by</dt><dd>{photo.userId || <em>not yet</em>}</dd></div>
          </dl>

          <button
            className={`btn btn--block ${photo.flagged ? 'btn--danger' : 'btn--primary'}`}
            onClick={onToggle}
          >
            {photo.flagged ? '⚑ Flagged — click to unflag' : 'Flag this photo (Space)'}
          </button>

          <a className="btn btn--block btn--ghost" href={editorUrl} target="_blank" rel="noreferrer">
            ↗ Open in goods editor
          </a>
          <a className="btn btn--block btn--ghost" href={googleUrl} target="_blank" rel="noreferrer">
            ↗ Search images on Google
          </a>
        </aside>

        <button className="popup__nav popup__nav--next" onClick={onNext} title="Next (→)">›</button>
        <button className="popup__close" onClick={onClose} title="Close (Esc)">✕</button>
      </div>
    </div>
  )
}
