/**
 * Multi-sport matchup scoring: compute roster fantasy points from player game stats and league scoring rules.
 * Used by live scoring and matchup engine; compatible with WeeklyMatchup and TeamPerformance.
 */
import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveScoringRulesForLeague, type LeagueSettingsForScoring } from './MultiSportScoringResolver'
import { computeFantasyPoints } from '@/lib/scoring-defaults/FantasyPointCalculator'
import type { PlayerStatsRecord } from '@/lib/scoring-defaults/types'
import type { ScoringRuleDto } from './ScoringTemplateResolver'

export interface RosterScoreInput {
  leagueId: string
  leagueSport: LeagueSport
  season: number
  weekOrRound: number
  /** Player IDs that are in the roster lineup (starters + bench; only starters count if you pass starterIds). */
  rosterPlayerIds: string[]
  /** If set, only sum points for these IDs (e.g. starters only). Otherwise sum all rosterPlayerIds. */
  starterPlayerIds?: string[]
  formatType?: string
  /** Optional league settings (e.g. from getLeagueSettingsForScoring) for IDP scoring preset resolution. */
  leagueSettings?: LeagueSettingsForScoring | null
}

export type RosterScoreStatus = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE'

export interface RosterScoreResult {
  /**
   * UNAVAILABLE — the week cannot be scored from `player_game_stats` (see
   * weekKeyedStatsUnavailableReason, or no scored player has a stat row). `totalPoints` is 0 BY
   * CONVENTION ONLY and must never be stored as a score: a caller checks `status` first.
   * PARTIAL — some scored players have no row (a bye, a DNP, or missing data; this table cannot
   * tell which). AVAILABLE — every scored player has a row.
   */
  status: RosterScoreStatus
  unavailableReason: string | null
  totalPoints: number
  byPlayerId: Record<string, number>
  usedPlayerIds: string[]
  missingPlayerIds: string[]
}

/**
 * The sports whose `player_game_stats` rows carry a real `weekOrRound`. An ALLOW-list on purpose:
 * a sport missing from it — including one added later — is refused, never guessed at.
 */
export const WEEK_KEYED_STAT_SPORTS: readonly string[] = ['NFL', 'NCAAF']

/**
 * Why a `weekOrRound` query against `player_game_stats` cannot score this sport/week, or null.
 *
 * 🛑 THE DAILY SPORTS ARE NOT WEEK-KEYED. `weekOrRound` is 0 on every MLB and SOCCER row (measured
 * on production, 66,525 and 3,322 rows) and on the Rolling Insights NBA/NHL/NCAAB ingest, so
 * `weekOrRound: N` matches nothing — the roster scores 0 with no error — and `weekOrRound: 0`
 * matches the WHOLE SEASON. Their rows are also keyed on PlayerIdentityMap.id while a roster
 * holds the Rolling Insights id, and their stat maps are raw vendor keys that the templates here
 * cannot read. A daily sport's week is an Eastern date window and is scored by the weekly sync
 * (lib/redraft/playerWeeklyScoreService.ts), which handles all three; this scorer does not.
 */
export function weekKeyedStatsUnavailableReason(sport: string, weekOrRound: number): string | null {
  const key = String(sport ?? '').trim().toUpperCase()
  if (!WEEK_KEYED_STAT_SPORTS.includes(key)) {
    return (
      `${key || 'unknown sport'} game stats are not keyed by week (weekOrRound is 0 on its rows); ` +
      'its weeks are date windows scored by the weekly sync, not by this scorer.'
    )
  }
  if (!Number.isInteger(weekOrRound) || weekOrRound < 1) {
    return `week ${weekOrRound} is not a scoring week (weeks start at 1).`
  }
  return null
}

function unavailable(reason: string, missingPlayerIds: string[] = []): RosterScoreResult {
  return {
    status: 'UNAVAILABLE',
    unavailableReason: reason,
    totalPoints: 0,
    byPlayerId: {},
    usedPlayerIds: [],
    missingPlayerIds,
  }
}

/**
 * Compute fantasy points for a roster for a given week from PlayerGameStat.
 * Uses league scoring rules (template + overrides).
 *
 * Fails CLOSED: a sport or week this table cannot answer, or a lineup with no stat row at all,
 * is UNAVAILABLE rather than a score of 0 — an empty result is indistinguishable from a team that
 * did not play, and storing it as one fails silently and looks correct.
 */
export async function computeRosterScoreForWeek(
  input: RosterScoreInput
): Promise<RosterScoreResult> {
  const refused = weekKeyedStatsUnavailableReason(input.leagueSport, input.weekOrRound)
  if (refused) return unavailable(refused)

  const rules = await resolveScoringRulesForLeague(
    input.leagueId,
    input.leagueSport,
    input.formatType,
    input.leagueSettings
  )
  const idsToScore = input.starterPlayerIds ?? input.rosterPlayerIds
  if (idsToScore.length === 0) {
    return unavailable('The lineup is empty; there is nothing to score.')
  }

  const stats = await prisma.playerGameStat.findMany({
    where: {
      sportType: input.leagueSport,
      season: input.season,
      weekOrRound: input.weekOrRound,
      playerId: { in: idsToScore },
    },
    select: { playerId: true, normalizedStatMap: true, fantasyPoints: true },
  })

  if (stats.length === 0) {
    return unavailable(
      `No player game statistics exist for any of the ${idsToScore.length} scored player(s) ` +
        `(${input.leagueSport} ${input.season} week ${input.weekOrRound}).`,
      [...idsToScore],
    )
  }

  const byPlayerId: Record<string, number> = {}
  let totalPoints = 0
  for (const row of stats) {
    const raw = row.normalizedStatMap as Record<string, number> | null
    // Always prefer league-rule recalculation so overrides/custom templates are respected.
    const points =
      raw && Object.keys(raw).length > 0
        ? computeFantasyPoints(raw as PlayerStatsRecord, rules as ScoringRuleDto[])
        : (row.fantasyPoints ?? 0)
    byPlayerId[row.playerId] = Math.round(points * 100) / 100
    totalPoints += byPlayerId[row.playerId]
  }

  const found = new Set(stats.map((s) => s.playerId))
  const missingPlayerIds = idsToScore.filter((id) => !found.has(id))
  return {
    status: missingPlayerIds.length > 0 ? 'PARTIAL' : 'AVAILABLE',
    unavailableReason: null,
    totalPoints: Math.round(totalPoints * 100) / 100,
    byPlayerId,
    usedPlayerIds: stats.map((s) => s.playerId),
    missingPlayerIds,
  }
}

/**
 * Compute fantasy points for a single player's stats using league scoring rules.
 * Useful when you have stats in memory (e.g. from feed) and want to score them.
 */
export async function computePlayerFantasyPoints(
  leagueId: string,
  leagueSport: LeagueSport,
  stats: PlayerStatsRecord,
  formatType?: string
): Promise<number> {
  const rules = await resolveScoringRulesForLeague(leagueId, leagueSport, formatType)
  return computeFantasyPoints(stats, rules as ScoringRuleDto[])
}
