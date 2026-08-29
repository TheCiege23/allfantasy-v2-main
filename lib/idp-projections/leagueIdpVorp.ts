/**
 * Assemble a league's IDP value-over-replacement, ready to hand to the valuation map.
 *
 * This is the seam between the pure modules and the product: it reads the league's own
 * scoring and roster, projects every rostered defender, prices him under those rules, and
 * returns points over replacement per Sleeper id.
 *
 * ⚠ RETURNS AN EMPTY MAP RATHER THAN THROWING, AND THAT IS THE CONTRACT. Callers use the
 * result to REPLACE a popularity ranking; an empty map means "keep what you had", which is a
 * safe and honest degradation. A league that does not score IDP, has no readable settings, or
 * whose defenders cannot be projected all land there, and none of them is an error.
 *
 * Reads Postgres only — no provider calls.
 */

import type { PrismaClient } from '@prisma/client'

import { hasIdpScoring, isIdpPosition } from '@/lib/core-app/scoringNotes'
import { idpValueForRank } from '@/lib/idp-kicker-values'
import { computeLeagueProjectedPoints, extractScoringSettings } from '@/lib/projections/leagueScoring'
import { buildIdpValuations } from './idpValuation'
import { loadIdpProjections } from './loadIdpProjections'

export interface LoadLeagueIdpVorpArgs {
  prisma: PrismaClient
  /** Dynasty and redraft decay differently in the tail; the curve differs accordingly. */
  isDynasty?: boolean
  /**
   * Either id space.
   *
   * ⚠ THIS REPO HAS TWO AND THEY LOOK ALIKE. `League.id` is an AllFantasy uuid;
   * `platformLeagueId` is Sleeper's own numeric string, and the rankings engine passes the
   * latter because it also feeds the Sleeper client with it. Resolving only by uuid would
   * return null for every real caller, and this function's contract — an empty map means
   * "keep what you had" — would turn that into a silent no-op that looks like it works.
   */
  leagueId: string
  /** `roster_positions` as the platform stated them. */
  rosterPositions: readonly string[] | null | undefined
  /** Every rostered player in the league, in Sleeper-id space. */
  rosterPlayerIds: readonly string[]
  numTeams: number
}

export interface LeagueIdpVorpResult {
  /** Points over replacement by Sleeper id. Null for a player replacement could not price. */
  vorpBySleeperId: Map<string, number | null>
  /** Rank within his own position group, by this league's projections. */
  positionRankBySleeperId: Map<string, number>
  /**
   * The rank placed on the market-shaped IDP curve, in the same 0–10000 convention the trade
   * engine speaks. Present only for players the league could actually rank.
   */
  valueBySleeperId: Map<string, number>
  /** Why the map is empty, when it is. Null when the valuation ran. */
  skipped:
    | null
    | 'no_scoring_settings'
    | 'not_an_idp_league'
    | 'no_rostered_defenders'
    | 'no_projection_history'
    | 'valuation_refused'
  /** Rendered coverage, so a surface can say how much of the board it actually priced. */
  coverage: { defenders: number; projected: number; priced: number }
  /**
   * The league-scored projection behind each rank, in points.
   *
   * Returned rather than left for the caller to recompute: this function already scores every
   * defender against the league's own settings to build the board, and a surface that scored
   * them a second time could disagree with the ranks sitting next to it on the same screen.
   * Null for a defender the scoring could not price — never zero.
   */
  projectionBySleeperId: Map<string, number | null>
  /**
   * The season and week the projection is FOR, resolved from the data rather than a clock.
   * A surface that renders a number this specific has to be able to say which week it is.
   */
  projectedFor: { season: number; week: number } | null
}

const EMPTY = (
  skipped: LeagueIdpVorpResult['skipped'],
  coverage = { defenders: 0, projected: 0, priced: 0 },
): LeagueIdpVorpResult => ({
  vorpBySleeperId: new Map(),
  positionRankBySleeperId: new Map(),
  valueBySleeperId: new Map(),
  skipped,
  coverage,
  projectionBySleeperId: new Map(),
  projectedFor: null,
})

/**
 * Does this league genuinely score IDP?
 *
 * Exported so a caller can ask BEFORE assembling the expensive inputs. `loadLeagueIdpVorp`
 * needs every rostered player id, and gathering those costs a provider round trip — which
 * would be paid by the ~100 of 110 leagues that answer `false` here. One indexed read
 * settles it first.
 *
 * Returns the scoring settings on success so the caller need not re-resolve them, and the
 * refusal reason otherwise. This is the single authority for the question; the strict
 * predicate matters (see `hasIdpScoring`) because the bare `sack`/`int`/`ff` keys are the
 * team-defence block that EVERY Sleeper league ships.
 */
export async function resolveLeagueIdpScoring(
  prisma: PrismaClient,
  leagueId: string,
): Promise<
  | { ok: true; scoring: NonNullable<ReturnType<typeof extractScoringSettings>> }
  | { ok: false; reason: 'no_scoring_settings' | 'not_an_idp_league' }
> {
  const league =
    (await prisma.league
      .findUnique({ where: { id: leagueId }, select: { settings: true } })
      .catch(() => null)) ??
    (await prisma.league
      .findFirst({
        where: { platformLeagueId: leagueId },
        orderBy: { updatedAt: 'desc' },
        select: { settings: true },
      })
      .catch(() => null))

  const scoring = extractScoringSettings(league?.settings)
  if (!scoring) return { ok: false, reason: 'no_scoring_settings' }
  if (!hasIdpScoring(scoring)) return { ok: false, reason: 'not_an_idp_league' }
  return { ok: true, scoring }
}

export async function loadLeagueIdpVorp(
  args: LoadLeagueIdpVorpArgs,
): Promise<LeagueIdpVorpResult> {
  const resolved = await resolveLeagueIdpScoring(args.prisma, args.leagueId)
  if (!resolved.ok) return EMPTY(resolved.reason)
  const scoring = resolved.scoring

  const ids = [...new Set(args.rosterPlayerIds.filter((id) => typeof id === 'string' && id))]
  if (ids.length === 0) return EMPTY('no_rostered_defenders')

  const rows = await args.prisma.sportsPlayer
    .findMany({
      where: { sleeperId: { in: ids } },
      select: { sleeperId: true, position: true },
    })
    .catch(() => [] as Array<{ sleeperId: string | null; position: string | null }>)

  /* `SportsPlayer` carries duplicate rows per Sleeper id, so dedupe or every count downstream
   * is inflated — measured at 571 rostered ids resolving to 1,329 rows. */
  const seen = new Set<string>()
  const defenders: Array<{ sleeperId: string; position: string | null }> = []
  for (const r of rows) {
    if (!r.sleeperId || seen.has(r.sleeperId) || !isIdpPosition(r.position)) continue
    seen.add(r.sleeperId)
    defenders.push({ sleeperId: r.sleeperId, position: r.position })
  }
  if (defenders.length === 0) return EMPTY('no_rostered_defenders')

  /*
   * The week to project is the one after the newest on file, resolved from the DATA rather
   * than a clock — the ingest runs on its own schedule and the offseason stalls it entirely.
   */
  const newest = await args.prisma.playerGameStat
    .aggregate({ where: { sportType: 'NFL' }, _max: { season: true } })
    .catch(() => null)
  const season = newest?._max.season
  if (season == null) return EMPTY('no_projection_history')

  const newestWeek = await args.prisma.playerGameStat
    .aggregate({ where: { sportType: 'NFL', season }, _max: { weekOrRound: true } })
    .catch(() => null)
  const week = (newestWeek?._max.weekOrRound ?? 0) + 1

  const { bySleeperId } = await loadIdpProjections({
    prisma: args.prisma,
    season,
    week,
    players: defenders,
  })

  let projected = 0
  const valuationInput = defenders.map((d) => {
    const outcome = bySleeperId.get(d.sleeperId)
    const points = outcome?.ok
      ? computeLeagueProjectedPoints(outcome.statLine, scoring)?.points ?? null
      : null
    if (points != null) projected++
    return { playerId: d.sleeperId, position: d.position, projectedPoints: points }
  })

  const valuation = buildIdpValuations({
    players: valuationInput,
    rosterSlots: args.rosterPositions,
    numTeams: args.numTeams,
  })
  if (!valuation.ok) {
    return EMPTY('valuation_refused', { defenders: defenders.length, projected, priced: 0 })
  }

  const vorpBySleeperId = new Map<string, number | null>()
  const positionRankBySleeperId = new Map<string, number>()
  const valueBySleeperId = new Map<string, number>()
  let priced = 0
  for (const p of valuation.players) {
    vorpBySleeperId.set(p.playerId, p.vorp)
    positionRankBySleeperId.set(p.playerId, p.positionRank)
    if (p.vorp != null) priced++
  }

  /*
   * ⚠ THE CURVE IS APPLIED TO ONE COMBINED BOARD, NOT THREE POSITION BOARDS. Pricing by rank
   * WITHIN a group hands the ceiling to the best linebacker, the best lineman AND the best
   * defensive back, which asserts the three are equally valuable. Measured on production that
   * is exactly what happened — Blake Cashman, Myles Garrett and Nick Emmanwori all came out at
   * 5,500 in the same league — and it is the same flatness the tier ladder had, moved sideways.
   *
   * Value over replacement is already measured against each position's OWN replacement level,
   * which is precisely what makes it comparable across positions. So the groups are merged and
   * ranked once. `positionRank` is still reported, because "LB4 in your league" is what a
   * manager wants to read; it is just not what sets the price.
   *
   * A player whose replacement level could not be established carries a null VORP and gets NO
   * value rather than a rank at the bottom of the board — pricing a data gap as the least
   * valuable defender in the league is the failure this whole module keeps refusing.
   */
  const rankable = valuation.players
    .filter((p): p is typeof p & { vorp: number } => p.vorp != null)
    .sort((a, b) => b.vorp - a.vorp)
  rankable.forEach((p, i) => {
    valueBySleeperId.set(p.playerId, idpValueForRank(i + 1, args.isDynasty ?? true))
  })

  const projectionBySleeperId = new Map<string, number | null>()
  for (const p of valuationInput) projectionBySleeperId.set(p.playerId, p.projectedPoints)

  return {
    vorpBySleeperId,
    positionRankBySleeperId,
    valueBySleeperId,
    skipped: null,
    coverage: { defenders: defenders.length, projected, priced },
    projectionBySleeperId,
    projectedFor: { season, week },
  }
}
