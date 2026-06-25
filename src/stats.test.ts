import { describe, expect, it } from 'vitest'
import { statForSession, cumulativeStat, formatStat, num, type Stat } from './stats'
import type { SessionRecord } from './db/schema'

function session(over: Partial<SessionRecord>): SessionRecord {
  return {
    id: 's',
    filename: 'f.csv',
    loadedAt: 0,
    status: 'in progress',
    cursorPage: 0,
    total: 0,
    flaggedCount: 0,
    reviewedCount: 0,
    ...over,
  }
}

describe('statForSession', () => {
  it('reads the three counters straight off the session record', () => {
    const s = session({ flaggedCount: 12, reviewedCount: 40, total: 100 })
    expect(statForSession(s)).toEqual<Stat>({ flagged: 12, reviewed: 40, loaded: 100 })
  })
})

describe('cumulativeStat', () => {
  it('sums flagged/reviewed/loaded across sessions', () => {
    const sessions = [
      session({ flaggedCount: 1, reviewedCount: 2, total: 10 }),
      session({ flaggedCount: 3, reviewedCount: 4, total: 20 }),
      session({ flaggedCount: 5, reviewedCount: 6, total: 30 }),
    ]
    expect(cumulativeStat(sessions)).toEqual<Stat>({ flagged: 9, reviewed: 12, loaded: 60 })
  })

  it('is all zeros for no sessions', () => {
    expect(cumulativeStat([])).toEqual<Stat>({ flagged: 0, reviewed: 0, loaded: 0 })
  })
})

describe('formatStat', () => {
  it('renders the canonical 3-number line with thousands separators', () => {
    expect(formatStat({ flagged: 120, reviewed: 4500, loaded: 100000 })).toBe(
      '120 flagged · 4,500 reviewed out of 100,000 loaded',
    )
  })

  it('handles the empty/zero case', () => {
    expect(formatStat({ flagged: 0, reviewed: 0, loaded: 0 })).toBe(
      '0 flagged · 0 reviewed out of 0 loaded',
    )
  })
})

describe('num', () => {
  it('groups thousands in en-US', () => {
    expect(num(385216)).toBe('385,216')
    expect(num(7)).toBe('7')
  })
})
