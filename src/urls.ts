// Image URL derivation (ADR-0003 "Image sizing").
//
// PhotoURI stores the full URI; the FIRST path segment is the size. We never
// request the stored size — we rewrite that segment to `300x200` for grid
// thumbnails and `med` for the enlarged view, preserving the rest (including
// the extension) byte-for-byte.

function rewriteSize(photoURI: string, size: string): string {
  try {
    const u = new URL(photoURI)
    const parts = u.pathname.split('/') // ['', 'orig', 'uuid.png']
    const i = parts.findIndex((p, idx) => idx > 0 && p !== '')
    if (i === -1) return photoURI
    parts[i] = size
    u.pathname = parts.join('/')
    return u.toString()
  } catch {
    // Relative URI fallback (e.g. "orig/uuid.png").
    const parts = photoURI.split('/')
    const i = parts.findIndex((p) => p !== '')
    if (i === -1) return photoURI
    parts[i] = size
    return parts.join('/')
  }
}

/** 300x200 grid thumbnail source. */
export const gridUrl = (photoURI: string): string => rewriteSize(photoURI, '300x200')

/** `med` enlarged (popup) source. */
export const medUrl = (photoURI: string): string => rewriteSize(photoURI, 'med')
