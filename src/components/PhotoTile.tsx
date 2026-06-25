import { useState } from 'react'
import type { PhotoRow } from '../db/schema'
import { gridUrl } from '../urls'

interface Props {
  photo: PhotoRow
  index: number
  focused: boolean
  onFocus: () => void
  onToggle: () => void
  onOpen: () => void
}

export function PhotoTile({ photo, index, focused, onFocus, onToggle, onOpen }: Props) {
  const [broken, setBroken] = useState(false)

  const cls = [
    'tile',
    focused ? 'tile--focused' : '',
    photo.flagged ? 'tile--flagged' : '',
    broken ? 'tile--broken' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={cls}
      data-idx={index}
      onClick={onFocus}
      onDoubleClick={onOpen}
      role="button"
      tabIndex={-1}
      title={photo.goodName}
    >
      <div className="tile__img">
        {broken ? (
          // Broken URLs never block — they become a flaggable placeholder.
          <div className="tile__placeholder" title={photo.photoURI}>
            <span className="tile__placeholder-icon">🚫</span>
            <span className="tile__placeholder-text">image unavailable</span>
          </div>
        ) : (
          <img
            src={gridUrl(photo.photoURI)}
            alt={photo.goodName}
            // No loading="lazy": only the current page's 50 tiles are ever
            // mounted (and the next page is preloaded), so lazy loading buys
            // nothing and leaves below-the-fold tiles blank in the DOM until the
            // browser's intersection observer happens to fire.
            onError={() => setBroken(true)}
          />
        )}
      </div>

      {photo.flagged && <span className="tile__flag" title="Flagged">⚑</span>}

      <button
        className="tile__toggle"
        onClick={(e) => { e.stopPropagation(); onToggle() }}
        title={photo.flagged ? 'Unflag (Space)' : 'Flag (Space)'}
      >
        {photo.flagged ? 'Flagged' : 'Flag'}
      </button>

      <div className="tile__caption">
        <span className="tile__type">{photo.photoType}</span>
        <span className="tile__gtin">{photo.gtin}</span>
      </div>
    </div>
  )
}
