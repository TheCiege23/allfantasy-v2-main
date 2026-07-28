/**
 * "Top outstanding issues" — the live dashboard's per-league alert list (NocturneDashboard). PURE:
 * given the rows the `/api/dashboard/today-actions` bundle already carries (each lineup action + each
 * pending-trade league), it collapses, ranks, and caps the highest-priority attention items.
 *
 * SECURITY / DB-first contract: the external source-platform link is NOT resolved here. Each row simply
 * REUSES the `actionLinks` the today-actions route already resolved SERVER-SIDE from the canonical League
 * row (validated `resolveSourceLink`) — never a client-reconstructed, cached, or prop-supplied URL. The
 * row keeps its own canonical `leagueId` so one league's action can never render another league's link,
 * and a native / unknown / unresolved league fails safe (no external link).
 */
import type { LineupActionItem, DecisionOsActionLinks } from '@/lib/lineup-actions/types'
import type { PendingTradeLeague } from '@/app/dashboard/dashboardStripApiTypes'

export type OutstandingIssueKind = 'lineup' | 'trade'

export type OutstandingIssueRow = {
  key: string
  /** Normalized kind — drives which internal AF modal the row opens (never display text). */
  kind: OutstandingIssueKind
  /** Canonical internal League.id — preserved end-to-end so links stay league-scoped. */
  leagueId: string
  label: string
  /** League display name. */
  league: string
  severity: string
  sev: number
  urg: number
  count: number
  /** True when the league is imported (non-native) → the read-only disclosure applies. */
  imported: boolean
  /** Server-resolved external source action (or null) — passed straight through from the route. */
  external: DecisionOsActionLinks['external']
}

const SEV_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 }
const URG_RANK: Record<string, number> = { urgent: 0, soon: 1, normal: 2, low: 3 }
const CAP = 10

export interface OutstandingIssuesInput {
  /** `today.lineup.actions` — each action carries its own message/severity/urgency + server actionLinks. */
  lineupActions: LineupActionItem[]
  /** `today.trades.trades` — each pending-trade league + server actionLinks. */
  tradeLeagues: PendingTradeLeague[]
  /** League display name for an id (from the dashboard league list). */
  leagueName: (leagueId: string) => string
  /** Top-bar league filter predicate (`'all'` → always true). */
  inScope: (leagueId: string) => boolean
}

/**
 * Build the ranked outstanding-issue rows. Deterministic + side-effect free. Lineup actions are per-slot,
 * so identical (league, message) pairs collapse into one row with a count (keeping the most severe/urgent
 * variant); pending trades add one row per league. Sorted by severity then urgency, capped at 10.
 */
export function buildOutstandingIssues(input: OutstandingIssuesInput): OutstandingIssueRow[] {
  const { lineupActions, tradeLeagues, leagueName, inScope } = input
  const rows: OutstandingIssueRow[] = []

  const grouped = new Map<string, OutstandingIssueRow>()
  for (const a of lineupActions) {
    const leagueId = (a.leagueId ?? '').trim()
    if (!leagueId || !inScope(leagueId)) continue
    const message = (a.message ?? '').trim()
    if (!message) continue
    const severity = a.severity ?? 'info'
    const sev = SEV_RANK[severity] ?? 2
    const urg = URG_RANK[a.urgency ?? 'normal'] ?? 2
    const key = `lineup:${leagueId}:${message}`
    const hit = grouped.get(key)
    if (hit) {
      hit.count += 1
      // Keep the most severe / most urgent variant of a collapsed group.
      hit.sev = Math.min(hit.sev, sev)
      hit.urg = Math.min(hit.urg, urg)
      if (sev < (SEV_RANK[hit.severity] ?? 2)) hit.severity = severity
    } else {
      // Reuse the route's server-resolved link — never re-resolve or reconstruct a URL here.
      const links = a.actionLinks
      grouped.set(key, {
        key,
        kind: 'lineup',
        leagueId,
        label: message,
        league: leagueName(leagueId),
        severity,
        sev,
        urg,
        count: 1,
        imported: links?.imported ?? false,
        external: links?.external ?? null,
      })
    }
  }
  for (const [, v] of grouped) rows.push(v)

  for (const tl of tradeLeagues) {
    const leagueId = (tl.leagueId ?? '').trim()
    if (!leagueId || !inScope(leagueId)) continue
    const count = Array.isArray(tl.trades) ? tl.trades.length : 0
    if (count === 0) continue
    rows.push({
      key: `trade:${leagueId}`,
      kind: 'trade',
      leagueId,
      label: `${count} trade offer${count > 1 ? 's' : ''} waiting on your response`,
      league: tl.leagueName ?? leagueName(leagueId),
      severity: 'warning',
      sev: 1,
      urg: 0,
      count: 1,
      imported: tl.actionLinks?.imported ?? false,
      external: tl.actionLinks?.external ?? null,
    })
  }

  return rows.sort((a, b) => a.sev - b.sev || a.urg - b.urg).slice(0, CAP)
}
