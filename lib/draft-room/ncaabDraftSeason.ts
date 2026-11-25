import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import type { NcaabSeasonBox } from '@/lib/sport-teams/ncaabSeasonBoxes'

export { loadNcaabSeasonBoxes, type NcaabSeasonBox, type NcaabSeasonBoxes } from '@/lib/sport-teams/ncaabSeasonBoxes'

/**
 * College basketball season lines for the draft pool, from our own stored box scores.
 *
 * 🛑 NCAAB HAD NO STATS, NO PROJECTION AND NO RANKING IN THE DRAFT ROOM. `player_season_stats` holds
 * no NCAAB rows, `storedDraftSeasonStats.ts` reads NBA / NHL / MLB only, and no ADP context matches a
 * native college league — so every stat column was a dash and both the board and autopick fell to
 * ALPHABETICAL order (measured on production 2026-11-25: a 54-team startup's pool opened on
 * "A.C. Kelly", "A.J. Banks", and a full-auto draft would have taken 918 players in that order).
 * The box scores were there the whole time: `player_game_stats` carries every game, keyed by the
 * Rolling Insights player id the pool row already holds.
 *
 * Joined by Rolling Insights id only (`provider_player_id`) — never by name.
 */

const SPORT = 'NCAAB'

export type NcaabDraftSeasonLine = {
  nbaDraftStats: {
    gamesPlayed: number
    pointsPerGame: number | null
    reboundsPerGame: number | null
    minutesPerGame: number | null
    assistsPerGame: number | null
    stealsPerGame: number | null
    blocksPerGame: number | null
    threePointersMadePerGame: number | null
    fieldGoalPercentage: number | null
    freeThrowPercentage: number | null
  }
  /** "2026–27": the season the line is from, shown beside it. */
  statSeason: string
  /** The line is the season before the newest one: he has no game in the current season yet. */
  statSeasonIsPrevious: boolean
  /** Fantasy points per game under THIS league's scoring, or null for a league that is not scored in points. */
  projectedPointsPerGame: number | null
}

const round1 = (value: number | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value * 10) / 10 : null

const ratio = (made: number | undefined, attempted: number | undefined): number | null =>
  typeof made === 'number' && typeof attempted === 'number' && attempted > 0 && made >= 0 && made <= attempted
    ? made / attempted
    : null

/** "2026–27" for a season keyed 2026. */
export function ncaabSeasonLabel(season: number): string {
  return `${season}–${String((season + 1) % 100).padStart(2, '0')}`
}

/**
 * The line a draft board shows for one player: this season's once he has played in it, otherwise
 * last season's. A player in his first weeks at a new school still has a real line to read, and the
 * season label says which one it is.
 */
export function pickNcaabDraftBox(boxes: { current?: NcaabSeasonBox; previous?: NcaabSeasonBox } | undefined): NcaabSeasonBox | null {
  if (!boxes) return null
  if (boxes.current && boxes.current.games > 0) return boxes.current
  if (boxes.previous && boxes.previous.games > 0) return boxes.previous
  return null
}

export type NcaabLeagueScorer = (rates: Record<string, number>, position: string | null | undefined) => number | null

/**
 * League scoring applied to a per-game line, the way `af-projections/leaguePlayerMetrics.ts` prices
 * college basketball everywhere else in the app. Null when the league has no points scoring to apply.
 *
 * ⚠ Double-double and triple-double bonuses are never scored on an average: 11 points and 10
 * rebounds a game is not a double-double every night. The college normalizer derives neither
 * today; the keys are removed anyway, as `leaguePlayerMetrics.ts` does, so that stays true if it
 * ever does.
 */
export function buildNcaabLeagueScorer(league: { sport?: string | null; settings?: unknown } | null | undefined): NcaabLeagueScorer | null {
  const normalize = getDailySportNormalizer(SPORT)
  const score = league ? buildLeagueStatScorer({ sport: SPORT, settings: league.settings } as Parameters<typeof buildLeagueStatScorer>[0]) : null
  if (!normalize || !score) return null
  return (rates, position) => {
    const { stats } = normalize(rates)
    if (Object.keys(stats).length === 0) return null
    delete stats.dbl_dbl
    delete stats.trpl_dbl
    const points = score(stats, position)
    return Number.isFinite(points) ? Math.round(points * 100) / 100 : null
  }
}

export function buildNcaabDraftSeasonLine(
  box: NcaabSeasonBox,
  position: string | null | undefined,
  scorer: NcaabLeagueScorer | null,
  /** The newest season the store holds (`NcaabSeasonBoxes.season`); a line from before it is tagged as last season's. */
  newestSeason?: number | null,
): NcaabDraftSeasonLine {
  const r = box.rates
  const projected = scorer ? scorer(r, position) : null
  return {
    nbaDraftStats: {
      gamesPlayed: box.games,
      pointsPerGame: round1(r.points),
      reboundsPerGame: round1(r.total_rebounds),
      minutesPerGame: round1(r.minutes),
      assistsPerGame: round1(r.assists),
      stealsPerGame: round1(r.steals),
      blocksPerGame: round1(r.blocks),
      threePointersMadePerGame: round1(r.three_points_made),
      fieldGoalPercentage: ratio(r.field_goals_made, r.field_goals_attempted),
      freeThrowPercentage: ratio(r.free_throws_made, r.free_throws_attempted),
    },
    statSeason: ncaabSeasonLabel(box.season),
    statSeasonIsPrevious: newestSeason != null && box.season < newestSeason,
    projectedPointsPerGame: projected != null && projected > 0 ? projected : null,
  }
}
