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
import { computeLeagueProjectedPoints, extractScoringSettings } from '@/lib/projections/leagueScoring'
import { buildIdpValuations } from './idpValuation'
import { loadIdpProjections } from './loadIdpProjections'

export interface LoadLeagueIdpVorpArgs {
  prisma: PrismaClient
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
}

const EMPTY = (
  skipped: LeagueIdpVorpResult['skipped'],
  coverage = { defenders: 0, projected: 0, priced: 0 },
): LeagueIdpVorpResult => ({ vorpBySleeperId: new Map(), skipped, coverage })

export async function loadLeagueIdpVorp(
  args: LoadLeagueIdpVorpArgs,
): Promise<LeagueIdpVorpResult> {
  const league =
    (await args.prisma.league
      .findUnique({ where: { id: args.leagueId }, select: { settings: true } })
      .catch(() => null)) ??
    (await args.prisma.league
      .findFirst({
        where: { platformLeagueId: args.leagueId },
        orderBy: { updatedAt: 'desc' },
        select: { settings: true },
      })
      .catch(() => null))

  const scoring = extractScoringSettings(league?.settings)
  if (!scoring) return EMPTY('no_scoring_settings')
  /*
   * The strict predicate, not the loose one. Bare `sack`/`int`/`ff` are the team-defence block
   * every Sleeper league ships; treating them as IDP would run this whole path for ~64 of 110
   * leagues instead of the 10 that actually roster defenders.
   */
  if (!hasIdpScoring(scoring)) return EMPTY('not_an_idp_league')

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
  let priced = 0
  for (const p of valuation.players) {
    vorpBySleeperId.set(p.playerId, p.vorp)
    if (p.vorp != null) priced++
  }

  return {
    vorpBySleeperId,
    skipped: null,
    coverage: { defenders: defenders.length, projected, priced },
  }
}
