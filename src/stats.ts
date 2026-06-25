// Derived stats. These come straight from the per-session IndexedDB counters
// (flaggedCount / reviewedCount / total) — no row scanning (ADR-0001).

import type { SessionRecord } from './db/schema'

export interface Stat {
  flagged: number
  reviewed: number
  loaded: number
}

export function statForSession(s: SessionRecord): Stat {
  return { flagged: s.flaggedCount, reviewed: s.reviewedCount, loaded: s.total }
}

export function cumulativeStat(sessions: SessionRecord[]): Stat {
  return sessions.reduce<Stat>(
    (acc, s) => ({
      flagged: acc.flagged + s.flaggedCount,
      reviewed: acc.reviewed + s.reviewedCount,
      loaded: acc.loaded + s.total,
    }),
    { flagged: 0, reviewed: 0, loaded: 0 },
  )
}

const nf = new Intl.NumberFormat('en-US')

/** "120 flagged · 4,500 reviewed out of 100,000 loaded" */
export function formatStat(s: Stat): string {
  return `${nf.format(s.flagged)} flagged · ${nf.format(s.reviewed)} reviewed out of ${nf.format(s.loaded)} loaded`
}

export function num(n: number): string {
  return nf.format(n)
}
