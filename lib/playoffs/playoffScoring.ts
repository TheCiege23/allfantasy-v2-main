import type { PlayoffPickView, PlayoffRoundKey, PlayoffSeriesView, PlayoffSport } from "./types"

export type PlayoffEntryScore = {
  totalScore: number
  correctPicks: number
  resolvedPicks: number
}

export type PlayoffPickResultStatus = "correct" | "wrong" | "pending" | "no_pick"

export type PlayoffPickResult = {
  status: PlayoffPickResultStatus
  points: number
  pickTeamName: string | null
  winnerTeamName: string | null
  seriesSummary: string | null
}

/**
 * What a correct pick is worth, per round.
 *
 * 🛑 MLB ONLY, AND THE NARROWNESS IS THE POINT. Every pick in every sport used
 * to score a flat 1, so calling the World Series counted the same as calling a
 * Wild Card game. The MLB bracket UI puts 5 / 10 / 18 / 30 on the screen, and a
 * tile that states a number the scorer does not honour is worse than no tile.
 *
 * ⚠ IT IS NOT APPLIED TO NBA OR NHL, DELIBERATELY. Twenty-six of those pools
 * are live with 123 picks already made; weighting them now would silently
 * restate standings under people who are mid-competition. A sport joins this
 * map when someone decides its existing pools can be re-scored — never as a
 * side effect of adding a bracket.
 *
 * ⚠ AND AN UNKNOWN ROUND SCORES 1, NOT 0. A round key that is not listed means
 * this table is out of date, and the honest failure there is "scored like it
 * always was", not "your correct pick was worth nothing".
 */
const ROUND_POINTS_BY_SPORT: Partial<Record<PlayoffSport, Partial<Record<PlayoffRoundKey, number>>>> = {
  mlb: {
    wild_card: 5,
    division_series: 10,
    league_championship: 18,
    world_series: 30,
  },
}

const FLAT_POINTS = 1

/**
 * Points a correct pick in this series is worth. `sport` is optional so every
 * existing caller keeps flat scoring without being touched.
 */
export function pointsForSeries(
  series: Pick<PlayoffSeriesView, "round">,
  sport?: PlayoffSport | string | null,
): number {
  const key = String(sport ?? "").toLowerCase() as PlayoffSport
  const table = ROUND_POINTS_BY_SPORT[key]
  if (!table) return FLAT_POINTS
  return table[series.round as PlayoffRoundKey] ?? FLAT_POINTS
}

/** The scoring table a UI should display, so the tiles cannot drift from the scorer. */
export function roundPointsTable(sport: PlayoffSport | string | null | undefined): Array<{
  round: PlayoffRoundKey
  points: number
}> {
  const key = String(sport ?? "").toLowerCase() as PlayoffSport
  const table = ROUND_POINTS_BY_SPORT[key]
  if (!table) return []
  return Object.entries(table).map(([round, points]) => ({
    round: round as PlayoffRoundKey,
    points: points as number,
  }))
}

export function getPlayoffPickResult(
  series: Pick<PlayoffSeriesView, "winnerTeamName" | "seriesSummary" | "round">,
  pick: Pick<PlayoffPickView, "pickTeamName"> | null | undefined,
  sport?: PlayoffSport | string | null,
): PlayoffPickResult {
  const pickTeamName = pick?.pickTeamName?.trim() || null
  const winnerTeamName = series.winnerTeamName?.trim() || null
  const seriesSummary = series.seriesSummary?.trim() || null

  if (!pickTeamName) {
    return { status: "no_pick", points: 0, pickTeamName: null, winnerTeamName, seriesSummary }
  }
  if (!winnerTeamName) {
    return { status: "pending", points: 0, pickTeamName, winnerTeamName: null, seriesSummary }
  }
  if (pickTeamName === winnerTeamName) {
    return {
      status: "correct",
      points: pointsForSeries(series, sport),
      pickTeamName,
      winnerTeamName,
      seriesSummary,
    }
  }
  return { status: "wrong", points: 0, pickTeamName, winnerTeamName, seriesSummary }
}

export function scorePlayoffEntryPicks(
  series: Array<Pick<PlayoffSeriesView, "id" | "winnerTeamName" | "round">>,
  picks: Array<Pick<PlayoffPickView, "seriesId" | "pickTeamName">>,
  sport?: PlayoffSport | string | null,
): PlayoffEntryScore {
  /*
   * Keyed by series id so points and winner come from the SAME row — looking
   * the round up separately would let a stale id award the wrong weight.
   */
  const resolved = new Map<string, { winner: string; points: number }>()
  for (const item of series) {
    const winner = typeof item.winnerTeamName === "string" ? item.winnerTeamName.trim() : ""
    if (!winner) continue
    resolved.set(item.id, { winner, points: pointsForSeries(item, sport) })
  }

  let totalScore = 0
  let correctPicks = 0
  let resolvedPicks = 0

  for (const pick of picks) {
    const hit = resolved.get(pick.seriesId)
    if (!hit) continue
    resolvedPicks += 1
    if (pick.pickTeamName === hit.winner) {
      correctPicks += 1
      totalScore += hit.points
    }
  }

  return { totalScore, correctPicks, resolvedPicks }
}
