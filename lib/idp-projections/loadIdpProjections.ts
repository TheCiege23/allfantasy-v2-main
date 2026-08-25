/**
 * IDP projections — database assembly.
 *
 * Reads Postgres only. No provider is called from here: per CLAUDE.md the application side
 * reads the database and ingestion modules own the vendors, and `check-db-first-api-boundary`
 * enforces it.
 *
 * WHAT THIS DOES AND DELIBERATELY DOES NOT DO. It gathers the inputs the pure projector needs
 * — prior-game logs, position-cohort priors, opponent pace — and runs it. It does NOT resolve
 * which opponent a player faces this week. That is a `SportsGame` join with real traps in it
 * (four rows per fixture, display names against abbreviations, and `season + week` colliding
 * between preseason and regular week 1 unless `seasonType` is filtered), and the surfaces that
 * need it already resolve their own schedule. Passing the opponent in keeps one correct
 * schedule join in the caller rather than a second, differently-wrong one here.
 */

import type { PrismaClient } from '@prisma/client'

import { deriveCohortPriors, type CohortMember } from './cohortPriors'
import { projectIdpStatLine } from './projectIdpStatLine'
import type { CohortPriors, IdpGameObservation, IdpProjectionOutcome } from './types'

export interface LoadIdpProjectionsArgs {
  prisma: Pick<PrismaClient, 'playerGameStat' | 'teamTendencySeason'>
  sport?: string
  /** Season whose game logs form the history. */
  season: number
  /**
   * Week being projected. Only STRICTLY EARLIER games are used.
   *
   * ⚠ Including the target week would leak the result into its own projection — the model
   * would look extraordinarily accurate in backtests and be useless on Sunday morning.
   */
  week: number
  /** Players to project, in Sleeper-id space — the same space `PlayerGameStat.playerId` uses. */
  players: ReadonlyArray<{ sleeperId: string; position: string | null; team?: string | null }>
  /** Opponent team abbreviation for the target week, by Sleeper id. Optional. */
  opponentBySleeperId?: ReadonlyMap<string, string | null>
  /** Depth-chart ordinal by Sleeper id, when the caller already has it. Optional. */
  depthOrdinalBySleeperId?: ReadonlyMap<string, number | null>
  /** Injury designation by Sleeper id. Reported on the projection, never applied. Optional. */
  injuryBySleeperId?: ReadonlyMap<string, string | null>
}

export interface IdpProjectionCoverageReport {
  requested: number
  projected: number
  refused: number
  /** Refusal reasons and their counts — counted, never swallowed. */
  refusalsByReason: Record<string, number>
  /** Positions for which a cohort prior could be derived, and the games behind each. */
  priorsByPosition: Record<string, number>
  /** True when opponent pace was available for at least one player. */
  paceAvailable: boolean
  /**
   * Refusal share. The caller should FAIL rather than publish when this is high — a sudden
   * jump means an upstream input vanished, and a thin partial write reads as healthy.
   */
  refusalRate: number
}

export interface LoadIdpProjectionsResult {
  bySleeperId: Map<string, IdpProjectionOutcome>
  coverage: IdpProjectionCoverageReport
}

/** Seconds per play, by team, plus the season's own mean. */
async function loadPace(
  prisma: LoadIdpProjectionsArgs['prisma'],
  season: number,
): Promise<{ byTeam: Map<string, number>; mean: number | null }> {
  const rows = await prisma.teamTendencySeason
    .findMany({ where: { season }, select: { teamId: true, secPerPlay: true } })
    .catch(() => [] as Array<{ teamId: string; secPerPlay: number | null }>)

  const byTeam = new Map<string, number>()
  for (const r of rows) {
    if (typeof r.secPerPlay === 'number' && Number.isFinite(r.secPerPlay) && r.secPerPlay > 0) {
      byTeam.set(r.teamId.toUpperCase(), r.secPerPlay)
    }
  }
  /*
   * The mean is computed from THIS season's rows, not carried as a constant. League-wide tempo
   * drifts year to year, so a fixed normaliser would quietly encode one season's pace forever
   * and mislabel every team as fast or slow in the others.
   */
  const values = [...byTeam.values()]
  const mean = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null
  return { byTeam, mean }
}

export async function loadIdpProjections(
  args: LoadIdpProjectionsArgs,
): Promise<LoadIdpProjectionsResult> {
  const sport = args.sport ?? 'NFL'
  const ids = [...new Set(args.players.map((p) => p.sleeperId).filter(Boolean))]

  if (ids.length === 0) {
    return {
      bySleeperId: new Map(),
      coverage: {
        requested: 0,
        projected: 0,
        refused: 0,
        refusalsByReason: {},
        priorsByPosition: {},
        paceAvailable: false,
        refusalRate: 0,
      },
    }
  }

  const games = await loadPriorGames(args, sport, ids)

  const historyBySleeperId = new Map<string, IdpGameObservation[]>()
  for (const g of games) {
    const statMap = g.normalizedStatMap as Record<string, unknown> | null
    if (!statMap || typeof statMap !== 'object') continue
    const arr = historyBySleeperId.get(g.playerId) ?? []
    arr.push({
      season: g.season,
      week: g.weekOrRound,
      opponent: g.opponent ?? null,
      statMap,
    })
    historyBySleeperId.set(g.playerId, arr)
  }

  // --- cohort priors, derived from the same pool being projected ----------------------
  const members: CohortMember[] = args.players.map((p) => ({
    position: p.position,
    history: historyBySleeperId.get(p.sleeperId) ?? [],
  }))
  const positions = [...new Set(args.players.map((p) => (p.position ?? '').trim().toUpperCase()))]
  const priorsByPosition = new Map<string, CohortPriors>()
  for (const position of positions) {
    if (!position) continue
    const priors = deriveCohortPriors(position, members)
    if (priors) priorsByPosition.set(position, priors)
  }

  const { byTeam: paceByTeam, mean: leagueMeanSecPerPlay } = await loadPace(args.prisma, args.season)

  // --- project ------------------------------------------------------------------------
  const bySleeperId = new Map<string, IdpProjectionOutcome>()
  const refusalsByReason: Record<string, number> = {}
  let projected = 0
  let refused = 0
  let paceAvailable = false

  for (const p of args.players) {
    const position = (p.position ?? '').trim().toUpperCase()
    const opponent = args.opponentBySleeperId?.get(p.sleeperId) ?? null
    const opponentSecPerPlay = opponent ? paceByTeam.get(opponent.toUpperCase()) : undefined

    const opponentPace =
      opponentSecPerPlay != null && leagueMeanSecPerPlay != null
        ? { secPerPlay: opponentSecPerPlay, leagueMeanSecPerPlay }
        : null
    if (opponentPace) paceAvailable = true

    const outcome = projectIdpStatLine({
      position,
      history: historyBySleeperId.get(p.sleeperId) ?? [],
      opponentPace,
      priors: priorsByPosition.get(position) ?? null,
      depthOrdinal: args.depthOrdinalBySleeperId?.get(p.sleeperId) ?? null,
      injuryStatus: args.injuryBySleeperId?.get(p.sleeperId) ?? null,
    })

    bySleeperId.set(p.sleeperId, outcome)
    if (outcome.ok) {
      projected++
    } else {
      refused++
      refusalsByReason[outcome.reason] = (refusalsByReason[outcome.reason] ?? 0) + 1
    }
  }

  const considered = projected + refused
  return {
    bySleeperId,
    coverage: {
      requested: args.players.length,
      projected,
      refused,
      refusalsByReason,
      priorsByPosition: Object.fromEntries(
        [...priorsByPosition].map(([pos, pr]) => [pos, pr.sampleGames]),
      ),
      paceAvailable,
      refusalRate: considered > 0 ? Math.round((refused / considered) * 1000) / 1000 : 1,
    },
  }
}

/**
 * Prior-week game logs for the requested players.
 *
 * Split out purely so the week-exclusion rule above has one place to live and one place to be
 * read; inlining it made the `lt` easy to miss in review.
 */
function loadPriorGames(
  args: LoadIdpProjectionsArgs,
  sport: string,
  ids: string[],
): Promise<
  Array<{
    playerId: string
    season: number
    weekOrRound: number
    opponent: string | null
    normalizedStatMap: unknown
  }>
> {
  return args.prisma.playerGameStat
    .findMany({
      where: {
        sportType: sport,
        playerId: { in: ids },
        season: args.season,
        // ⚠ STRICTLY EARLIER. See the note on `week` above — including the target week
        // leaks the answer into its own projection.
        weekOrRound: { lt: args.week },
      },
      select: {
        playerId: true,
        season: true,
        weekOrRound: true,
        opponent: true,
        normalizedStatMap: true,
      },
      orderBy: { weekOrRound: 'asc' },
    })
    .catch(() => [])
}
