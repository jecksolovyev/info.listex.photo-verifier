import { describe, expect, it } from 'vitest'
import { gridUrl, medUrl } from './urls'

describe('image URL rewrite (ADR-0003)', () => {
  it('rewrites the first path segment (size) and preserves the rest', () => {
    const orig = 'https://icf.listex.info/orig/c4e3f212-031d-61bb-1f29-3e7e92dbee4a.png'
    expect(gridUrl(orig)).toBe(
      'https://icf.listex.info/300x200/c4e3f212-031d-61bb-1f29-3e7e92dbee4a.png',
    )
    expect(medUrl(orig)).toBe(
      'https://icf.listex.info/med/c4e3f212-031d-61bb-1f29-3e7e92dbee4a.png',
    )
  })

  it('preserves the extension byte-for-byte', () => {
    expect(medUrl('https://h/orig/a.JPG')).toBe('https://h/med/a.JPG')
  })

  it('handles relative URIs', () => {
    expect(gridUrl('orig/x.png')).toBe('300x200/x.png')
  })
})
