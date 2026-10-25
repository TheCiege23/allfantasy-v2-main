/**
 * The extra matchup — an odd-team league's replacement for the weekly bye (AF Commissioner).
 *
 * The rules, pure and client-safe (the settings panel reads them); the database half — fixing the
 * pick and reading it back for the screens — is lib/redraft/oddTeamExtraMatchup.ts.
 *
 * Each regular-season week the rotation leaves one team without an opponent
 * (lib/schedule-runtime/canonicalScheduleRuntime.ts). With this setting on, that team instead plays an
 * extra matchup against a team chosen from the previous completed week:
 *   - `top_scorer` (default): the week's highest scorer;
 *   - `median`: the week's middle scorer, ties broken by the standings order.
 * The leftover team itself is never chosen; when the rule lands on it, the next team down is taken.
 * Week 1 has no previous week: the highest projected team, else a seeded draw (below).
 *
 * Scoring (`scoring`):
 *   - `leftover_only` (default, "main matchup only"): the extra game counts for the leftover team only;
 *     the chosen team's own head-to-head game is its result that week.
 *   - `both`: the chosen team also gets the extra game's result, so it can go 2-0, 1-1 or 0-2.
 * Standings rank by win percentage (lib/redraft/standingsEngine.ts), so unequal games played stays fair.
 * Points for/against: the leftover team's extra game counts toward its own PF/PA, like any game. The
 * chosen team's PF/PA are never touched — its points that week are already counted once, in its own
 * game, and counting them twice would hand it a points tiebreak for being picked.
 *
 * 🛑 NO SECOND ROW. The extra game is recorded on the leftover team's own bye row
 * (`RedraftMatchup.lineupSnapshots.extraMatchup`), which keeps `awayRosterId: null`. A second row
 * holding the chosen team would put that team in two rows of one week, and ~40 readers look a team's
 * week up as "the" row with its id on either side. The leftover's score is its bye row's own
 * (`updateByeRowScore`); the chosen team's is read from its own game. No migration.
 *
 * FIXED WHEN THE WEEK OPENS, ONCE. `assignExtraMatchupForWeek` runs from the week-advance hook
 * (`advanceNflRedraftScheduleWeek`, the one the weekly waiver reset uses) and again, as a fallback,
 * when the bye row is scored — which is how week 1, which no advance opens, gets its pick. Once a row
 * carries a pick it is never re-decided: the setting changing later does not rewrite a week already
 * assigned, and its `scoring` is the one in force when it was fixed.
 *
 * Playoffs are unaffected: only weeks before the playoff start week are assigned.
 *
 * SEEDED DRAW (week 1 without projections): every candidate's `coinFlipDraw('<leagueId>:<week>', rosterId)`
 * (lib/standings/tiebreakerOrder.ts, the standings coin flip) is computed and the highest draw is chosen.
 * Deterministic: the same league and week always pick the same team, on any server, on any rerun.
 */

import { coinFlipDraw } from '@/lib/standings/tiebreakerOrder'

export const EXTRA_MATCHUP_SETTINGS_KEY = 'odd_team_extra_matchup'

export type ExtraMatchupOpponentRule = 'top_scorer' | 'median'
export type ExtraMatchupScoring = 'leftover_only' | 'both'

export type ExtraMatchupSettings = {
  enabled: boolean
  opponent: ExtraMatchupOpponentRule
  scoring: ExtraMatchupScoring
}

export const DEFAULT_EXTRA_MATCHUP_SETTINGS: ExtraMatchupSettings = {
  enabled: false,
  opponent: 'top_scorer',
  scoring: 'leftover_only',
}

/** Why this opponent: the rule that applied, or the week-1 fallback that stood in for it. */
export type ExtraMatchupReason = 'top_scorer' | 'median' | 'projected' | 'seeded_draw'

/** What is stored on the leftover team's bye row. */
export type ExtraMatchupRecord = {
  opponentRosterId: string
  rule: ExtraMatchupOpponentRule
  reason: ExtraMatchupReason
  scoring: ExtraMatchupScoring
  /** The completed week the pick was read from; null for a projection or the draw. */
  basisWeek: number | null
  decidedAt: string
}

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function readExtraMatchupSettings(leagueSettings: unknown): ExtraMatchupSettings {
  const raw = obj(obj(leagueSettings)?.[EXTRA_MATCHUP_SETTINGS_KEY])
  if (!raw) return { ...DEFAULT_EXTRA_MATCHUP_SETTINGS }
  return {
    enabled: raw.enabled === true,
    opponent: raw.opponent === 'median' ? 'median' : 'top_scorer',
    scoring: raw.scoring === 'both' ? 'both' : 'leftover_only',
  }
}

/** A settings value as sent by a client: refused unless every field is one this module knows. */
export function parseExtraMatchupSettings(value: unknown): { ok: true; value: ExtraMatchupSettings } | { ok: false; error: string } {
  const raw = obj(value)
  if (!raw) return { ok: false, error: 'The extra matchup setting must be an object.' }
  if (typeof raw.enabled !== 'boolean') return { ok: false, error: 'Say whether the extra matchup is on (enabled: true or false).' }
  const opponent = raw.opponent ?? DEFAULT_EXTRA_MATCHUP_SETTINGS.opponent
  if (opponent !== 'top_scorer' && opponent !== 'median') {
    return { ok: false, error: 'The extra matchup opponent is last week\'s top scorer or its median team.' }
  }
  const scoring = raw.scoring ?? DEFAULT_EXTRA_MATCHUP_SETTINGS.scoring
  if (scoring !== 'leftover_only' && scoring !== 'both') {
    return { ok: false, error: 'The extra matchup counts for the leftover team only, or for both teams.' }
  }
  return { ok: true, value: { enabled: raw.enabled, opponent, scoring } }
}

export function readExtraMatchupRecord(lineupSnapshots: unknown): ExtraMatchupRecord | null {
  const raw = obj(obj(lineupSnapshots)?.extraMatchup)
  if (!raw || typeof raw.opponentRosterId !== 'string' || !raw.opponentRosterId) return null
  const reason = raw.reason
  return {
    opponentRosterId: raw.opponentRosterId,
    rule: raw.rule === 'median' ? 'median' : 'top_scorer',
    reason: reason === 'median' || reason === 'projected' || reason === 'seeded_draw' ? reason : 'top_scorer',
    scoring: raw.scoring === 'both' ? 'both' : 'leftover_only',
    basisWeek: typeof raw.basisWeek === 'number' ? raw.basisWeek : null,
    decidedAt: typeof raw.decidedAt === 'string' ? raw.decidedAt : '',
  }
}

/**
 * Choose the leftover team's opponent. Pure.
 *
 * `previousWeekScores` holds every team's completed score from the previous week (null when there is
 * no completed previous week). `standingsOrder` is roster ids best first; it breaks score ties.
 * `projections` is this week's projected score per team, for week 1. `rosterIds` is every team.
 */
export function pickExtraMatchupOpponent(input: {
  leagueId: string
  week: number
  leftoverRosterId: string
  rule: ExtraMatchupOpponentRule
  rosterIds: readonly string[]
  previousWeekScores: ReadonlyMap<string, number> | null
  standingsOrder: readonly string[]
  projections?: ReadonlyMap<string, number> | null
}): { opponentRosterId: string; reason: ExtraMatchupReason } | null {
  const candidates = [...new Set(input.rosterIds)].filter((id) => id !== input.leftoverRosterId)
  if (candidates.length === 0) return null
  const standingRank = new Map(input.standingsOrder.map((id, i) => [id, i]))
  const rankOf = (id: string) => standingRank.get(id) ?? Number.MAX_SAFE_INTEGER
  const byScoreThenStandings = (scores: ReadonlyMap<string, number>) => (a: string, b: string) =>
    (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || rankOf(a) - rankOf(b) || a.localeCompare(b)

  const scores = input.previousWeekScores
  if (scores && scores.size > 0) {
    // Every team that scored, leftover included: the median is the whole league's middle score.
    const ranked = [...new Set(input.rosterIds)].filter((id) => scores.has(id)).sort(byScoreThenStandings(scores))
    if (ranked.length > 0) {
      const start = input.rule === 'median' ? Math.floor((ranked.length - 1) / 2) : 0
      // "The next one down" when the rule lands on the leftover team itself.
      const pick = ranked.slice(start).find((id) => id !== input.leftoverRosterId)
        ?? ranked.slice(0, start).reverse().find((id) => id !== input.leftoverRosterId)
      if (pick) return { opponentRosterId: pick, reason: input.rule }
    }
  }

  const projections = input.projections
  if (projections && candidates.some((id) => projections.has(id))) {
    const pick = candidates.filter((id) => projections.has(id)).sort(byScoreThenStandings(projections))[0]!
    return { opponentRosterId: pick, reason: 'projected' }
  }

  const seed = `${input.leagueId}:${input.week}`
  const pick = [...candidates].sort((a, b) => coinFlipDraw(seed, b) - coinFlipDraw(seed, a) || a.localeCompare(b))[0]!
  return { opponentRosterId: pick, reason: 'seeded_draw' }
}

export type ExtraMatchupRow = {
  id?: string | null
  week: number
  homeRosterId: string
  awayRosterId: string | null
  homeScore: number | null
  awayScore: number | null
  status: string | null
  lineupSnapshots?: unknown
}

function complete(row: Pick<ExtraMatchupRow, 'status'>): boolean {
  return row.status === 'final' || row.status === 'completed'
}

export type ExtraMatchupResult = {
  week: number
  leftoverRosterId: string
  opponentRosterId: string
  leftoverScore: number
  opponentScore: number
  /** From the leftover team's side. */
  outcome: 'W' | 'L' | 'T'
  scoring: ExtraMatchupScoring
}

/**
 * Every decided extra game in `rows`: the leftover team's bye row carries a pick, both its own score
 * and the opponent's game are final. Pure; the standings engine applies the outcomes.
 */
export function extraMatchupResults(rows: readonly ExtraMatchupRow[]): ExtraMatchupResult[] {
  const out: ExtraMatchupResult[] = []
  for (const bye of rows) {
    if (bye.awayRosterId) continue
    const record = readExtraMatchupRecord(bye.lineupSnapshots)
    if (!record || !complete(bye)) continue
    const game = rows.find(
      (r) => r.week === bye.week && r.awayRosterId && (r.homeRosterId === record.opponentRosterId || r.awayRosterId === record.opponentRosterId),
    )
    if (!game || !complete(game)) continue
    const leftoverScore = Number(bye.homeScore ?? 0)
    const opponentScore = Number(game.homeRosterId === record.opponentRosterId ? game.homeScore ?? 0 : game.awayScore ?? 0)
    out.push({
      week: bye.week,
      leftoverRosterId: bye.homeRosterId,
      opponentRosterId: record.opponentRosterId,
      leftoverScore,
      opponentScore,
      outcome: leftoverScore > opponentScore ? 'W' : leftoverScore < opponentScore ? 'L' : 'T',
      scoring: record.scoring,
    })
  }
  return out
}

/** Every team's completed score in `week`: its own game, or its scored bye row. */
export function completedWeekScores(rows: readonly ExtraMatchupRow[], week: number): Map<string, number> | null {
  const weekRows = rows.filter((r) => r.week === week)
  const games = weekRows.filter((r) => r.awayRosterId)
  if (games.length === 0 || !games.every(complete)) return null
  const scores = new Map<string, number>()
  for (const g of games) {
    scores.set(g.homeRosterId, Number(g.homeScore ?? 0))
    scores.set(g.awayRosterId!, Number(g.awayScore ?? 0))
  }
  for (const bye of weekRows.filter((r) => !r.awayRosterId && complete(r))) {
    if (!scores.has(bye.homeRosterId)) scores.set(bye.homeRosterId, Number(bye.homeScore ?? 0))
  }
  return scores
}

/** "Extra matchup vs <team> (last week's top scorer)". */
export function describeExtraMatchupReason(reason: ExtraMatchupReason): string {
  switch (reason) {
    case 'top_scorer':
      return "last week's top scorer"
    case 'median':
      return "last week's median team"
    case 'projected':
      return "this week's highest projected team"
    case 'seeded_draw':
      return 'drawn for week 1'
  }
}

export type ExtraMatchupView = {
  /** `leftover`: you play the extra game. `opponent`: you were chosen to play it. */
  role: 'leftover' | 'opponent'
  /** The other team in the extra game. */
  otherRosterId: string
  teamName: string
  reason: ExtraMatchupReason
  /** Whether the extra game's result counts for YOU. */
  countsForYou: boolean
  /** Your score and theirs that week, from your perspective. Null before anything is scored. */
  yourScore: number | null
  theirScore: number | null
  /** Both sides' weeks are final. */
  final: boolean
  /** "Extra matchup vs <team> (last week's top scorer)" — or, for the chosen team, who plays it. */
  label: string
  /** The label with the score: "… · 112.4–98.0". */
  line: string
}

function scored(row: Pick<ExtraMatchupRow, 'status' | 'homeScore' | 'awayScore'> | undefined): boolean {
  if (!row) return false
  return complete(row) || row.status === 'active' || Number(row.homeScore ?? 0) !== 0 || Number(row.awayScore ?? 0) !== 0
}

export function extraMatchupLabel(role: 'leftover' | 'opponent', teamName: string, reason: ExtraMatchupReason, countsForYou: boolean): string {
  const why = describeExtraMatchupReason(reason)
  return role === 'leftover'
    ? `Extra matchup vs ${teamName} (${why})`
    : `Extra matchup: ${teamName} plays you this week (you were ${why})${countsForYou ? ' — it counts for you too' : ' — only your own game counts for you'}`
}

export function extraMatchupLine(label: string, yourScore: number | null, theirScore: number | null): string {
  return yourScore == null || theirScore == null ? label : `${label} · ${yourScore.toFixed(1)}–${theirScore.toFixed(1)}`
}

/**
 * The extra game `rosterId` is part of in `week`, from that week's rows (the bye row carries the pick;
 * the chosen team's score is its own game's). Pure — every surface that already holds the week's rows
 * uses this; `nameOf` turns a roster id into a team name. Null when the roster has no extra game.
 */
export function extraMatchupForRoster(
  rows: readonly ExtraMatchupRow[],
  week: number,
  rosterId: string,
  nameOf: (rosterId: string) => string | null | undefined,
): ExtraMatchupView | null {
  for (const bye of rows) {
    if (bye.week !== week || bye.awayRosterId) continue
    const record = readExtraMatchupRecord(bye.lineupSnapshots)
    if (!record) continue
    const role = bye.homeRosterId === rosterId ? 'leftover' : record.opponentRosterId === rosterId ? 'opponent' : null
    if (!role) continue
    const game = rows.find(
      (r) => r.week === week && r.awayRosterId && (r.homeRosterId === record.opponentRosterId || r.awayRosterId === record.opponentRosterId),
    )
    const leftoverScore = scored(bye) ? Number(bye.homeScore ?? 0) : null
    const opponentScore = scored(game)
      ? Number(game!.homeRosterId === record.opponentRosterId ? game!.homeScore ?? 0 : game!.awayScore ?? 0)
      : null
    const otherRosterId = role === 'leftover' ? record.opponentRosterId : bye.homeRosterId
    const teamName = nameOf(otherRosterId)?.trim() || 'another team'
    const countsForYou = role === 'leftover' || record.scoring === 'both'
    const yourScore = role === 'leftover' ? leftoverScore : opponentScore
    const theirScore = role === 'leftover' ? opponentScore : leftoverScore
    const label = extraMatchupLabel(role, teamName, record.reason, countsForYou)
    return {
      role,
      otherRosterId,
      teamName,
      reason: record.reason,
      countsForYou,
      yourScore,
      theirScore,
      final: complete(bye) && Boolean(game && complete(game)),
      label,
      line: extraMatchupLine(label, yourScore, theirScore),
    }
  }
  return null
}
