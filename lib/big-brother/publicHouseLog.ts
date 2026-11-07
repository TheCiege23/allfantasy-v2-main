/**
 * Big Brother house log — the PUBLIC view of `bigBrotherAuditLog`, for the History tab.
 *
 * The audit log is an engine record, not a feed. Its rows carry things a houseguest must not see:
 *   - `eviction.voteCount`  the per-nominee tally, which leagues hide by default
 *                           (`publicVoteTotalsVisibility: 'evicted_only'`), and `commissionerTieBreak`
 *   - `roster_archived`     the evicted member's user id and a full roster snapshot
 *   - admin actions         `rerun_vote_tally` repeats the tally as `votesByTarget`; config diffs; waiver forces
 * Until 2026-11-07 the audit route returned every row's raw `metadata` to any member, and the History tab printed
 * it as JSON — so the tally the House screen carefully withheld was one tab away.
 *
 * 🛑 ALLOW-LIST, NEVER SPREAD. Each entry is built field by field from a known event; an event type that is not
 * listed here is dropped. Vote counts appear only when the league set `publicVoteTotalsVisibility = 'exact'` — the
 * same switch `publicEvictionResult` and the chat announcement honour. No voter id is ever logged, so none can leak.
 */
import { publicEvictionResult } from '@/lib/league-specialty/bigBrotherHome'

import { PUBLIC_PHASES, type PublicHouseLogEntry } from './houseLogLine'

export { houseLogLine, PUBLIC_PHASES } from './houseLogLine'
export type { HouseLogKind, PublicHouseLogEntry } from './houseLogLine'

type Row = { eventType: string; metadata: unknown; createdAt: string | Date }

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const ids = (...v: unknown[]): string[] => v.map(str).filter((x): x is string => x != null)

export function publicHouseLogEntry(row: Row, visibility: string | null | undefined): PublicHouseLogEntry | null {
  const m = row.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : {}
  const at = typeof row.createdAt === 'string' ? row.createdAt : row.createdAt.toISOString()
  const week = num(m.week) ?? num(m.evictedWeek)
  const base = { at, week }

  switch (row.eventType) {
    case 'hoh_assigned': {
      const r = ids(m.winnerId)
      return r.length ? { ...base, kind: 'hoh', rosterIds: r } : null
    }
    case 'auto_nomination': {
      const r = ids(m.nominee1RosterId, m.nominee2RosterId)
      return r.length ? { ...base, kind: 'nominations', rosterIds: r, auto: true } : null
    }
    case 'auto_replacement_nominee': {
      const r = ids(m.replacementRosterId)
      return r.length ? { ...base, kind: 'replacement', rosterIds: r, auto: true } : null
    }
    case 'jury_enrolled': {
      const r = ids(m.rosterId)
      return r.length ? { ...base, kind: 'jury', rosterIds: r } : null
    }
    case 'eviction': {
      const e = publicEvictionResult(row.metadata, visibility)
      if (!e) return null
      return { at, week: e.week, kind: 'eviction', rosterIds: e.nomineeRosterIds, votesByNominee: e.votesByNominee, tied: e.tied }
    }
    case 'finale_vote': {
      const r = ids(m.winnerRosterId)
      if (!r.length) return null
      return { ...base, kind: 'finale', rosterIds: r, votes: visibility === 'exact' ? num(m.voteCount) : null }
    }
    case 'phase_transition': {
      if (m.event === 'first_cycle_created') return { ...base, week: week ?? 1, kind: 'season_start', rosterIds: [] }
      if (m.action === 'resolve_veto_challenge') {
        const r = ids(m.winnerId)
        return r.length ? { ...base, kind: 'veto', rosterIds: r } : null
      }
      if (m.action === 'set_have_not_override') {
        const r = Array.isArray(m.haveNotRosterIds) ? ids(...m.haveNotRosterIds) : []
        return r.length ? { ...base, kind: 'have_nots', rosterIds: r } : null
      }
      const to = str(m.toPhase)
      if (to && to in PUBLIC_PHASES) return { ...base, kind: 'phase', rosterIds: [], phase: to }
      return null
    }
    default:
      return null
  }
}

export function publicHouseLog(rows: Row[], visibility: string | null | undefined): PublicHouseLogEntry[] {
  const out: PublicHouseLogEntry[] = []
  for (const row of rows) {
    const e = publicHouseLogEntry(row, visibility)
    if (e) out.push(e)
  }
  return out
}
