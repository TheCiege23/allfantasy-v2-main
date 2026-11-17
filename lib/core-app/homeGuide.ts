import type { CoreIssue } from './outstandingIssues'
import type { StandingSnap } from './sinceLastVisit'

/**
 * The /core home as a guide (2026-11-12, owner: "a teaching tool and a notification system").
 *
 * The home already knew what was wrong in every league; what it did not do was say how urgent each
 * thing was in one consistent language, why it mattered, or how the season was going. This module is
 * the pure half of that: it sorts every decision into one of three tiers, attaches a one-sentence
 * reason to the kinds it understands, folds per-league injury rows into one row when the injury
 * report is on the page, and summarises standings across every league.
 *
 * PURE and client-safe. Every function takes what the loaders already produced; none reads anything.
 */

/* ── Tiers ───────────────────────────────────────────────────────────────────────────────────── */

/**
 * The three tiers every alert on the home is sorted into, whatever its platform:
 *   now   costs points (or a pick) if nothing changes — happening already, or inside a day
 *   week  will cost points before this week's games if nothing changes
 *   fyi   worth knowing; nothing is lost by waiting
 */
export type DecisionTier = 'now' | 'week' | 'fyi'

const DECISION_TIERS: readonly DecisionTier[] = ['now', 'week', 'fyi']

const DAY_MS = 86_400_000

function deadlineMs(issue: CoreIssue): number | null {
  const raw = issue.deadline as Date | string | null
  if (raw == null) return null
  const ms = raw instanceof Date ? raw.getTime() : new Date(raw).getTime()
  return Number.isNaN(ms) ? null : ms
}

/**
 * Which tier an issue belongs in. Severity says how bad it is; the deadline says how soon. An untimed
 * `bad` row states something that has already happened (a slot scoring zero, a draft on the clock), so
 * it is `now` — the same reading `rankDecisions` gives it.
 */
export function decisionTier(issue: CoreIssue, nowMs: number): DecisionTier {
  const at = deadlineMs(issue)
  const left = at == null ? null : at - nowMs
  if (issue.severity === 'bad') {
    if (left == null || left < DAY_MS) return 'now'
    return 'week'
  }
  if (issue.severity === 'warn' && left != null && left < 7 * DAY_MS) return 'week'
  return 'fyi'
}

/** Ranked issues grouped by tier, keeping each tier's ranked order. Empty tiers are dropped. */
export function groupByTier(
  ranked: readonly CoreIssue[],
  nowMs: number,
): Array<{ tier: DecisionTier; issues: CoreIssue[] }> {
  const buckets: Record<DecisionTier, CoreIssue[]> = { now: [], week: [], fyi: [] }
  for (const issue of ranked) buckets[decisionTier(issue, nowMs)].push(issue)
  return DECISION_TIERS.filter((t) => buckets[t].length > 0).map((tier) => ({ tier, issues: buckets[tier] }))
}

/* ── Why it matters ──────────────────────────────────────────────────────────────────────────── */

/**
 * The one-sentence reason behind a decision, as a message key and its values — the words live in
 * `lib/core-app/messages/homeGuide.ts` so they can be said in the reader's language. Null for an
 * issue whose kind is not known here: no sentence beats a generic one.
 */
export type TeachLine =
  | { key: 'emptySlot' }
  | { key: 'starterOut' }
  | { key: 'injurySummary' }
  | { key: 'drafting' }
  | { key: 'draftUpcoming' }
  | { key: 'bestBall' }
  | { key: 'stale'; platform: string | null }

export function teachLine(issue: CoreIssue): TeachLine | null {
  switch (issue.parts?.kind) {
    case 'empty-slot':
      return { key: 'emptySlot' }
    case 'starter-out':
      return { key: 'starterOut' }
    case 'injury-summary':
      return { key: 'injurySummary' }
    case 'drafting':
      return { key: 'drafting' }
    case 'draft-upcoming':
      return { key: 'draftUpcoming' }
    case 'best-ball':
      return { key: 'bestBall' }
    case 'stale':
      return { key: 'stale', platform: issue.parts.platform || null }
    case 'stale-aggregate':
      return { key: 'stale', platform: issue.parts.platforms.length === 1 ? issue.parts.platforms[0]! : null }
    default:
      return null
  }
}

/* ── Meta clean-up ───────────────────────────────────────────────────────────────────────────── */

/**
 * Drops the lineup-verification stamp ("· Checked 21:27 UTC · 2026-11-12", or its Spanish form) from
 * the end of a row's meta line. The stamp is true and useful to someone debugging a sync; to someone
 * deciding whether to bench a player it is noise in a time zone they do not live in. The card's own
 * freshness line still says how old the data is.
 */
const STAMP = /\s·\s[^·]*\d{2}:\d{2} UTC · \d{4}-\d{2}-\d{2}\s*$/

export function stripVerificationStamp(meta: string): string {
  return meta.replace(STAMP, '')
}

/* ── One injury row instead of one per league ────────────────────────────────────────────────── */

export const INJURY_SUMMARY_ID = 'injury-summary'
export const INJURY_REPORT_ANCHOR = '#af-home-triage'

/**
 * When the injury report ("Starters in doubt") is on the page, each injured starter appeared twice —
 * once per league in the decision queue, then again, grouped by player, in the report below. This
 * folds the queue's per-league `starter-out` rows into ONE row that counts them and points at the
 * report, which is where the swaps are. With the report hidden, the rows are left exactly as they were.
 *
 * Nothing else is touched, and the summary takes the soonest kickoff of the rows it replaces so it
 * still sorts by when the first point is lost.
 */
export function foldInjuredStarters(issues: readonly CoreIssue[], reportShown: boolean): CoreIssue[] {
  if (!reportShown) return [...issues]
  const out: CoreIssue[] = []
  let starters = 0
  const leagues = new Set<string>()
  let soonest: number | null = null
  let insertAt = -1
  for (const issue of issues) {
    if (issue.parts?.kind !== 'starter-out') {
      out.push(issue)
      continue
    }
    if (insertAt < 0) insertAt = out.length
    starters += Math.max(1, issue.parts.flaggedCount)
    leagues.add(issue.leagueId ?? issue.parts.leagueName)
    const at = deadlineMs(issue)
    if (at != null && (soonest == null || at < soonest)) soonest = at
  }
  if (insertAt < 0) return out
  const leagueCount = leagues.size
  out.splice(insertAt, 0, {
    id: INJURY_SUMMARY_ID,
    severity: 'bad',
    glyph: '+',
    title: `${starters} injured ${starters === 1 ? 'starter' : 'starters'} in ${leagueCount} ${leagueCount === 1 ? 'league' : 'leagues'}`,
    meta: 'Lineup · each one shows its best swap in the injury report below',
    leagueId: null,
    leagueName: null,
    platform: null,
    deadline: soonest == null ? null : new Date(soonest),
    action: { label: 'See swaps', href: INJURY_REPORT_ANCHOR, external: false },
    parts: { kind: 'injury-summary', starters, leagues: leagueCount },
  })
  return out
}

/* ── Am I winning? ───────────────────────────────────────────────────────────────────────────── */

export type PulseLeague = {
  id: string
  name: string
  platform: string
  /** Teams in the league, when known. Without it a rank cannot be placed in a half. */
  teams: number | null
  standing: StandingSnap | null
}

export type PulseRow = {
  id: string
  name: string
  platform: string
  rank: number
  teams: number
  record: string
}

export type SeasonPulse = {
  /** Leagues with at least one game on record and a rank we can place. */
  ranked: number
  /** Leagues read but with no games yet, or no rank. */
  unranked: number
  topHalf: number
  /** Within one place of the top half's edge, either side — where one week moves you in or out. */
  bubble: number
  bottomHalf: number
  firstPlace: number
  wins: number
  losses: number
  ties: number
  /** Best three by how high in the table, as a share of league size. */
  best: PulseRow[]
  /** Worst three, the same way — the leagues most worth a look. */
  worst: PulseRow[]
}

function recordOf(s: StandingSnap): string {
  return s.ties > 0 ? `${s.wins}-${s.losses}-${s.ties}` : `${s.wins}-${s.losses}`
}

/**
 * Standings across every league, honestly bucketed. "Top half" is used rather than "playoff spot"
 * because playoff size differs league by league and is not read here — the card says so in words.
 */
export function buildSeasonPulse(leagues: readonly PulseLeague[]): SeasonPulse {
  const pulse: SeasonPulse = {
    ranked: 0,
    unranked: 0,
    topHalf: 0,
    bubble: 0,
    bottomHalf: 0,
    firstPlace: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    best: [],
    worst: [],
  }
  const rows: Array<PulseRow & { share: number; top: boolean }> = []
  for (const league of leagues) {
    const s = league.standing
    if (s) {
      pulse.wins += s.wins
      pulse.losses += s.losses
      pulse.ties += s.ties
    }
    const played = s ? s.wins + s.losses + s.ties > 0 : false
    const teams = league.teams && league.teams > 1 ? league.teams : null
    if (!s || !played || s.rank == null || s.rank < 1 || teams == null || s.rank > teams) {
      pulse.unranked += 1
      continue
    }
    pulse.ranked += 1
    const cut = Math.ceil(teams / 2)
    if (s.rank <= cut) pulse.topHalf += 1
    else pulse.bottomHalf += 1
    if (s.rank === cut || s.rank === cut + 1) pulse.bubble += 1
    if (s.rank === 1) pulse.firstPlace += 1
    rows.push({
      id: league.id,
      name: league.name,
      platform: league.platform,
      rank: s.rank,
      teams,
      record: recordOf(s),
      share: (s.rank - 1) / (teams - 1),
      top: s.rank <= cut,
    })
  }
  /*
   * "Strongest" draws only from the top half and "Needs a look" only from the bottom half, so a
   * last-place team is never listed as strong just because the reader has few leagues.
   */
  const strip = ({ share: _share, top: _top, ...row }: PulseRow & { share: number; top: boolean }): PulseRow => row
  const byShare = [...rows].sort((a, b) => a.share - b.share || a.rank - b.rank || a.name.localeCompare(b.name))
  pulse.best = byShare.filter((r) => r.top).slice(0, 3).map(strip)
  pulse.worst = byShare
    .filter((r) => !r.top)
    .reverse()
    .slice(0, 3)
    .map(strip)
  return pulse
}
