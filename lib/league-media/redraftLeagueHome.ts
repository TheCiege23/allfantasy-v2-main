/**
 * Redraft League home (batch A1 of the redraft visual upgrade): the pure mappings behind the score
 * bug, the playoff race, last week's recap, the draft countdown and the post-draft grades. Every
 * function here takes a payload an existing endpoint already returns and decides what may be shown;
 * the components only draw what comes back. Client-safe, no I/O.
 *
 * ⚠ REAL DATA ONLY, AND A PIECE WITHOUT DATA IS DROPPED — NOT ZEROED, NOT GUESSED. Each builder
 * returns null when its source cannot honestly support the card, and the card then does not render:
 *   - score bug: no head-to-head opponent this week → null (guillotine/survivor style byes). Win
 *     chance only from `winProbabilityLeft`, which the server already nulls when either projection
 *     leans on the flat per-position fallback (lib/matchup-center/winProbability.ts), and never on a
 *     final. A projection quoted only when the side's total is free of that fallback too.
 *   - playoff race: only when the league's OWN settings name a playoff field (`readPlayoffFormat`,
 *     the same reader the Standings tab draws its cut with) — never a sport default — and the field
 *     is smaller than the league. Clinched / eliminated are NOT drawn here: proving either needs the
 *     remaining schedule (lib/core-app/standingsModel.ts `computeZones`), which League home does not
 *     load, and a second copy of that rule is the bug CLAUDE.md records twice.
 *   - recap: finalized `TeamWeekResult` rows for the previous week only, head-to-head pairs only.
 *   - draft grades: persisted `DraftGrade` rows matched to a team of this league; unmatched rows drop.
 *
 * Docs: docs/design/redraft-identity.md (tokens), docs/design/redraft-tab-inventory.md (batch A1).
 */
import type { MatchupCenterPayload, MatchupSidePayload } from '@/lib/matchup-center/types'
import { formatWinProbabilityPercents } from '@/lib/matchup-center/winProbability'
import { readPlayoffFormat } from '@/lib/league/native/nativeScreenModels'

/** Sports whose lineups are set per day (lib/redraft/sportAdapters): the "week" is a scoring period. */
const DAILY_SPORTS = new Set(['NBA', 'NHL', 'MLB', 'NCAAB'])

export function isDailyRedraftSport(sport: string | null | undefined): boolean {
  return DAILY_SPORTS.has(String(sport ?? '').toUpperCase())
}

function fmtRecord(r: { wins: number; losses: number; ties: number } | null | undefined): string | null {
  if (!r || ![r.wins, r.losses, r.ties].every((n) => Number.isFinite(n))) return null
  if (r.wins + r.losses + r.ties === 0) return null
  return `${r.wins}–${r.losses}${r.ties ? `–${r.ties}` : ''}`
}

const round1 = (n: number) => Math.round(n * 10) / 10

function noOpponent(name: string): boolean {
  return /^no opponent$/i.test(name.trim())
}

export type ScoreBugSide = {
  name: string
  record: string | null
  points: number
  /** Null when the total leans on the flat per-position fallback, or the matchup is final. */
  projected: number | null
  /** Starters whose game has not finished. */
  yetToPlay: number
}

export type ScoreBug = {
  week: number
  status: MatchupCenterPayload['matchupStatus']
  you: ScoreBugSide
  them: ScoreBugSide
  /** Integer percent for your side, or null (unavailable, or the matchup is final). */
  winChance: number | null
  /** Your highest scorer so far; null before anyone has scored. */
  topScorer: { name: string; points: number } | null
  /** "Winning by 12.4", "Lost by 3.0", "Projected 121.4 – 108.0", "All square". */
  headline: string
}

function side(p: MatchupSidePayload, final: boolean): ScoreBugSide {
  return {
    name: p.teamName,
    record: fmtRecord(p.record),
    points: round1(Number(p.totalPoints) || 0),
    projected: final || p.projectedTotalIncludesFallback || !Number.isFinite(p.projectedTotal) ? null : round1(p.projectedTotal),
    yetToPlay: Number.isFinite(p.remainingStarters) ? Math.max(0, p.remainingStarters) : 0,
  }
}

/** The broadcast score bug for this week's head-to-head matchup, or null when there is none. */
export function buildScoreBug(payload: MatchupCenterPayload | null | undefined): ScoreBug | null {
  if (!payload || !payload.left || !payload.right) return null
  if (noOpponent(payload.right.teamName) || !payload.left.teamName) return null
  const final = payload.matchupStatus === 'final'
  const you = side(payload.left, final)
  const them = side(payload.right, final)
  const pcts = final ? null : formatWinProbabilityPercents(payload.winProbabilityLeft)
  const scorers = (payload.left.starters ?? []).filter((s) => Number.isFinite(s.currentPoints) && s.currentPoints > 0)
  const top = scorers.sort((a, b) => b.currentPoints - a.currentPoints)[0]
  let headline: string
  if (payload.matchupStatus === 'upcoming') {
    headline = you.projected != null && them.projected != null ? `Projected ${you.projected.toFixed(1)} – ${them.projected.toFixed(1)}` : 'Not started yet'
  } else {
    const diff = round1(you.points - them.points)
    if (diff === 0) headline = final ? 'Tied' : 'All square'
    else headline = `${final ? (diff > 0 ? 'Won by' : 'Lost by') : diff > 0 ? 'Winning by' : 'Down'} ${Math.abs(diff).toFixed(1)}`
  }
  return {
    week: payload.week,
    status: payload.matchupStatus,
    you,
    them,
    winChance: pcts ? pcts.leftPct : null,
    topScorer: top ? { name: top.name, points: round1(top.currentPoints) } : null,
    headline,
  }
}

export type PlayoffRaceTeam = { id: string; teamName: string; wins: number; losses: number; ties: number }

export type PlayoffRaceRow = { id: string; rank: number; teamName: string; record: string; isYou: boolean; inField: boolean }

export type PlayoffRace = {
  /** How many teams make it, from the league's own settings. */
  field: number
  rows: PlayoffRaceRow[]
  /** The line is drawn after this many rows (= field, when the field is inside the rows shown). */
  lineAfter: number | null
}

/**
 * The standings with the playoff line drawn where the league's own settings put it. `ordered` must
 * already be in standings order (sortTeamsForManagerListing). Null when the league has not set a
 * playoff field, or every team makes it.
 */
export function buildPlayoffRace(
  ordered: readonly PlayoffRaceTeam[],
  settings: unknown,
  userTeamId: string | null,
  opts: { maxRows?: number } = {},
): PlayoffRace | null {
  const field = readPlayoffFormat(settings).teams
  if (field == null || !Number.isInteger(field) || field < 1 || field >= ordered.length) return null
  // Show the whole field plus the first two chasing it, so the line always has something below it.
  const shown = Math.min(ordered.length, Math.max(field + 2, Math.min(opts.maxRows ?? 8, ordered.length)))
  const rows = ordered.slice(0, shown).map((t, i) => ({
    id: t.id,
    rank: i + 1,
    teamName: t.teamName,
    record: `${t.wins}–${t.losses}${t.ties ? `–${t.ties}` : ''}`,
    isYou: t.id === userTeamId,
    inField: i < field,
  }))
  // Your team is always on the board, even when it is below the rows shown.
  const youIndex = userTeamId ? ordered.findIndex((t) => t.id === userTeamId) : -1
  if (youIndex >= shown) {
    const t = ordered[youIndex]!
    rows.push({ id: t.id, rank: youIndex + 1, teamName: t.teamName, record: `${t.wins}–${t.losses}${t.ties ? `–${t.ties}` : ''}`, isYou: true, inField: false })
  }
  return { field, rows, lineAfter: field }
}

export type WeekResultRow = {
  rosterId: string
  teamName: string
  totalPoints: number
  opponentRosterId: string | null
  opponentName: string | null
  winLoss: string | null
  status: string
}

export type LastWeekRecap = {
  week: number
  topScore: { team: string; points: number }
  /** The smallest winning margin of the week. */
  closest: { winner: string; loser: string; margin: number } | null
  /** The largest winning margin of the week. */
  biggest: { winner: string; loser: string; margin: number } | null
}

/**
 * Last week's recap from `/api/leagues/[id]/scoring/matchups` (finalized TeamWeekResult rows).
 * Null unless every row is final and at least one head-to-head pair exists — a half-processed week
 * would crown the wrong top score.
 */
export function buildLastWeekRecap(week: number, rows: readonly WeekResultRow[] | null | undefined): LastWeekRecap | null {
  if (!rows || rows.length < 2 || !Number.isInteger(week) || week < 1) return null
  if (rows.some((r) => r.status !== 'final' || !Number.isFinite(r.totalPoints))) return null
  const top = [...rows].sort((a, b) => b.totalPoints - a.totalPoints)[0]!
  const byId = new Map(rows.map((r) => [r.rosterId, r]))
  const pairs: { winner: string; loser: string; margin: number }[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (!r.opponentRosterId || seen.has(r.rosterId)) continue
    const o = byId.get(r.opponentRosterId)
    if (!o) continue
    seen.add(r.rosterId)
    seen.add(o.rosterId)
    const margin = round1(Math.abs(r.totalPoints - o.totalPoints))
    if (margin === 0) continue
    const [w, l] = r.totalPoints > o.totalPoints ? [r, o] : [o, r]
    pairs.push({ winner: w.teamName, loser: l.teamName, margin })
  }
  if (pairs.length === 0) return null
  const sorted = [...pairs].sort((a, b) => a.margin - b.margin)
  return {
    week,
    topScore: { team: top.teamName, points: round1(top.totalPoints) },
    closest: sorted[0] ?? null,
    biggest: sorted.length > 1 ? sorted[sorted.length - 1]! : null,
  }
}

export type DraftCountdown = { days: number; hours: number; mins: number; label: string }

/** Time to the draft, or null when there is no valid future draft time. */
export function draftCountdown(draftIso: string | null | undefined, nowMs: number): DraftCountdown | null {
  if (!draftIso) return null
  const at = new Date(draftIso).getTime()
  if (!Number.isFinite(at) || at <= nowMs) return null
  const totalMins = Math.floor((at - nowMs) / 60_000)
  const days = Math.floor(totalMins / 1440)
  const hours = Math.floor((totalMins % 1440) / 60)
  const mins = totalMins % 60
  const label = days > 0 ? `${days}d ${String(hours).padStart(2, '0')}h` : hours > 0 ? `${hours}h ${String(mins).padStart(2, '0')}m` : `${Math.max(1, mins)}m`
  return { days, hours, mins, label }
}

export type DraftGradeRow = { rosterId: string; grade: string; score: number }
export type DraftGradeTeam = { id: string; externalId?: string | null; platformUserId?: string | null; claimedByUserId?: string | null; teamName: string }
export type DraftGradeLine = { teamId: string; teamName: string; grade: string; score: number; isYou: boolean }

const LETTER = /^[A-F][+-]?$/

/**
 * Persisted post-draft grades (`/api/leagues/[id]/draft-grades`), named by this league's teams.
 * A row whose roster matches no team, or whose grade is not a letter, is dropped rather than shown
 * under a raw id. Null when nothing survives.
 */
export function buildDraftGrades(rows: readonly DraftGradeRow[] | null | undefined, teams: readonly DraftGradeTeam[], userTeamId: string | null): DraftGradeLine[] | null {
  if (!rows?.length) return null
  const lines: DraftGradeLine[] = []
  for (const r of rows) {
    const key = String(r.rosterId)
    const team = teams.find((t) => [t.id, t.externalId, t.platformUserId, t.claimedByUserId].some((k) => k != null && String(k) === key))
    const grade = String(r.grade ?? '').trim().toUpperCase()
    if (!team || !LETTER.test(grade) || !Number.isFinite(Number(r.score))) continue
    if (lines.some((l) => l.teamId === team.id)) continue
    lines.push({ teamId: team.id, teamName: team.teamName, grade, score: Math.round(Number(r.score)), isYou: team.id === userTeamId })
  }
  if (!lines.length) return null
  return lines.sort((a, b) => b.score - a.score)
}
