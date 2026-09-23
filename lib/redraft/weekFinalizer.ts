import type { PrismaClient } from '@prisma/client'

import { prisma as defaultPrisma } from '@/lib/prisma'
import { LIVE_SCORE_SOURCES, pickFreshestSourceRows } from '@/lib/scores/liveSourceSelection'
import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import { isScoringStarterSlot, recalculateMatchupsForSeasonWeek } from './scoringEngine'

/**
 * CLOSE A WEEK, SO THE SEASON CAN MOVE.
 *
 * 🛑 THE GAP THIS FILLS. A matchup becomes `final` only when every starter has a
 * `PlayerWeeklyScore` row AND every one of those rows carries `isFinalized`
 * (`scoringEngine.ts`, `scoreRosterStarters` → `updateMatchupScores`). Nothing on a
 * schedule ever set that flag: `syncPlayerWeeklyScoresForRedraftSeason` and the live
 * tick both write `isFinalized: false`, and the only other writers were the
 * commissioner's manual stat correction and the E2E seeds. So no matchup ever went
 * final, `advance_week` refused every hour with INCOMPLETE_WEEK, and every native
 * league sat at week 1 — measured in production 2026-09-22: 0 finalized native
 * matchups in season 2026, `currentWeek` = 1, in NFL week 3.
 *
 * This module is the missing step: once the week's games are genuinely over, it
 * finalizes that week's scores and re-scores its matchups.
 *
 * 🛑 THE DANGEROUS HALF IS THE ZERO. Finalizing means asserting "this is what the
 * player scored", and a starter with no stat row scores 0. That is TRUE for a bye,
 * an inactive, or a player nobody's box score mentions — and FALSE, in the worst
 * possible way, when our own ingest missed the week. Writing zeros during a stat
 * outage would silently settle every matchup in the league on fabricated data. So
 * the finalizer REFUSES unless it can show the week is done and the data is there:
 *
 *   1. every game on the slate is FINAL (an `unknown` status is never read as
 *      finished — see `lib/sports/gameStatus.ts`, sixteen vocabularies in one column);
 *   2. a grace period has passed since the last kickoff, so stat corrections land
 *      before the week is sealed;
 *   3. stat COVERAGE across the league's own starters clears a floor.
 *
 * Every refusal is named and returned, never swallowed — a week that cannot be
 * closed says why, which is the diagnostic the stuck-at-week-1 state never had.
 *
 * ⚠ A CORRECTION RE-OPENS THE WEEK ON PURPOSE. `syncPlayerWeeklyScoresForRedraftSeason`
 * upserts with `isFinalized: false`, so a later stat correction un-finalizes that row,
 * the matchup drops back to `active`, and the next sweep re-finalizes it with the
 * corrected number. That is the intended cycle, not a bug to design around.
 */

/** Hours after the last kickoff of the week before the week may be sealed. */
export const WEEK_FINALIZE_GRACE_MS = 12 * 60 * 60 * 1000

/**
 * Share of the league's starters that must already hold a stat row.
 *
 * ⚠ THIS IS THE FAKE-ZERO GUARD, AND THE NUMBER IS DELIBERATELY NOT 1.0. Real weeks
 * always leave a few starters with no row — byes, inactives, a defense whose game was
 * cancelled — so demanding every starter would mean never finalizing. 0.8 clears those
 * while still refusing the failure that matters: production week 2 of 2026 held rows
 * for team defenses ONLY (8 rows, no offensive players at all), which lands near 0.06
 * and is refused outright.
 */
export const WEEK_FINALIZE_COVERAGE_FLOOR = 0.8

/** How many completed weeks behind the current one a sweep will try to close. */
export const WEEK_FINALIZE_LOOKBACK_WEEKS = 3

/**
 * Sports whose `SportsGame.week` identifies a slate.
 *
 * ⚠ NBA AND NHL ARE ABSENT BECAUSE THEIR ROWS DO NOT CARRY A USABLE WEEK — measured on
 * the schedule feed, NBA writes 0 and NHL writes 500 (`lib/season-week/sportWeekSignal.ts`),
 * and every daily-sport `player_game_stats` row is `weekOrRound = 0`. A daily sport's week
 * is a DATE WINDOW, so its slate check is a different query, not a different constant —
 * until that is written, those sports are refused by name rather than finalized on a
 * column that means nothing.
 */
export const WEEK_KEYED_SPORTS: readonly string[] = ['NFL', 'NCAAF']

export type WeekFinalizeRefusal =
  | 'finalizer_disabled'
  | 'season_not_found'
  | 'sport_not_week_keyed'
  | 'no_games_on_slate'
  | 'games_not_final'
  | 'within_grace_period'
  | 'no_starters'
  | 'stat_coverage_below_floor'

export type WeekSlateSummary = {
  games: number
  final: number
  unfinished: number
  /** Cancelled games never get played, so they do not hold the week open. */
  cancelled: number
  lastStartTime: string | null
  /** Which feed answered, after ranked selection — the diagnostic for a stuck week. */
  source: string | null
}

export type WeekFinalizeResult = {
  seasonId: string
  leagueId: string
  sport: string
  season: number
  week: number
  finalized: boolean
  /** True when the week was already closed and nothing needed doing. */
  alreadyFinal: boolean
  refusal: WeekFinalizeRefusal | null
  slate: WeekSlateSummary | null
  starters: number
  startersWithStats: number
  coverage: number | null
  rowsFinalized: number
  zeroRowsWritten: number
  /** Who was sealed at zero — the audit trail for the paragraph above. */
  zeroedPlayerIds: string[]
  matchupsFinal: number
  matchupsConsidered: number
}

export type WeekFinalizerDeps = {
  prisma?: PrismaClient
  now?: () => Date
  recalculateMatchups?: typeof recalculateMatchupsForSeasonWeek
}

export type FinalizeRedraftWeekParams = {
  seasonId: string
  week: number
  /** Regular-season slates include rows written before `seasonType` existed; postseason does not. */
  seasonType?: 'regular' | 'postseason'
  graceMs?: number
  coverageFloor?: number
  /** Measure and report without writing. */
  dryRun?: boolean
}

function emptyResult(
  base: Pick<WeekFinalizeResult, 'seasonId' | 'leagueId' | 'sport' | 'season' | 'week'>,
  refusal: WeekFinalizeRefusal | null,
  extra: Partial<WeekFinalizeResult> = {},
): WeekFinalizeResult {
  return {
    ...base,
    finalized: false,
    alreadyFinal: false,
    refusal,
    slate: null,
    starters: 0,
    startersWithStats: 0,
    coverage: null,
    rowsFinalized: 0,
    zeroRowsWritten: 0,
    zeroedPlayerIds: [],
    matchupsFinal: 0,
    matchupsConsidered: 0,
    ...extra,
  }
}

/**
 * Explicit opt-OUT, not opt-in.
 *
 * ⚠ A DEFAULT-OFF FLAG WOULD REPEAT A MISTAKE THIS REPO HAS ALREADY PAID FOR TWICE
 * (`ingestCFBDStats` had no scheduled caller for months; `DRAFT_TICK_CRON_ENABLED`
 * defaults off and nobody can tell from the code whether autopick runs). A job that
 * exists to unstick seasons must run by default; the escape hatch is for turning it
 * OFF in an incident, which is a deliberate act someone takes and then reverses.
 */
export function isWeekFinalizerDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.REDRAFT_WEEK_FINALIZER_DISABLED ?? '').trim() === '1'
}

/**
 * Read the week's slate and say whether it is over.
 *
 * 🛑 ONE FIXTURE IS SEVERAL ROWS, AND READING THEM ALL GETS THE ANSWER WRONG IN BOTH
 * DIRECTIONS. `SportsGame` is unique on `[sport, externalId, source]`, so every feed holds
 * its own copy of the same game. Measured on production 2026-09-22, NFL 2026:
 *
 *   week 2 — espn 32/32 final (fresh) · espn_live 14/16 final, last fetched a day earlier
 *   week 3 — NOT YET PLAYED: rolling_insights, thesportsdb and api_sports all 0/16 final,
 *            while espn_live holds 16 rows marked FINAL from a fetch on 2026-08-24
 *
 * Counting every row would therefore have blocked week 2 forever on a stale feed's two
 * unfinished rows, and — far worse — judged the UNPLAYED week 3 complete off a month-old
 * feed, sealing a whole league's matchups at zero.
 *
 * So the slate goes through `pickFreshestSourceRows`, the same ranked selection every other
 * live-score read uses (fresh feeds outrank stale ones, a feed silent for six hours is dead),
 * and only the winning feed's rows are counted. Writing a second dedupe rule here is exactly
 * what that module exists to prevent.
 */
export async function readWeekSlate(
  prisma: PrismaClient,
  args: {
    sport: string
    season: number
    week: number
    seasonType: 'regular' | 'postseason'
    now?: Date
  },
): Promise<WeekSlateSummary> {
  const rawRows = await prisma.sportsGame.findMany({
    where: {
      sport: args.sport,
      season: args.season,
      week: args.week,
      // Only ranked feeds may answer: an unranked one (cfbd donates kickoff times and has no
      // live status at all) would contribute permanent "unfinished" rows.
      source: { in: [...LIVE_SCORE_SOURCES] },
      /*
       * Same discriminator the live provider uses: preseason week 1 and regular week 1
       * share a number, and rows predating the column are overwhelmingly regular season,
       * so NULL joins the regular slate and never the postseason one.
       */
      ...(args.seasonType === 'regular'
        ? { OR: [{ seasonType: 'regular' }, { seasonType: null }] }
        : { seasonType: args.seasonType }),
    },
    select: { status: true, startTime: true, source: true, fetchedAt: true, season: true, week: true },
  })

  const rows = pickFreshestSourceRows(rawRows, (args.now ?? new Date()).getTime())

  let final = 0
  let cancelled = 0
  let unfinished = 0
  let lastStart: Date | null = null

  for (const row of rows) {
    const status = normalizeGameStatus(row.status)
    if (status === 'final') final += 1
    else if (status === 'cancelled') cancelled += 1
    else unfinished += 1

    if (row.startTime && (lastStart == null || row.startTime > lastStart)) lastStart = row.startTime
  }

  return {
    games: rows.length,
    final,
    unfinished,
    cancelled,
    lastStartTime: lastStart ? lastStart.toISOString() : null,
    source: rows[0]?.source ?? null,
  }
}

/**
 * Finalize one week of one season, or say why it cannot be.
 */
export async function finalizeRedraftWeek(
  params: FinalizeRedraftWeekParams,
  deps: WeekFinalizerDeps = {},
): Promise<WeekFinalizeResult> {
  const prisma = deps.prisma ?? (defaultPrisma as unknown as PrismaClient)
  const now = deps.now?.() ?? new Date()
  const recalc = deps.recalculateMatchups ?? recalculateMatchupsForSeasonWeek
  const graceMs = params.graceMs ?? WEEK_FINALIZE_GRACE_MS
  const coverageFloor = params.coverageFloor ?? WEEK_FINALIZE_COVERAGE_FLOOR
  const seasonType = params.seasonType ?? 'regular'

  const season = await prisma.redraftSeason.findFirst({
    where: { id: params.seasonId },
    select: { id: true, leagueId: true, sport: true, season: true },
  })
  if (!season) {
    return emptyResult(
      { seasonId: params.seasonId, leagueId: '', sport: '', season: 0, week: params.week },
      'season_not_found',
    )
  }

  const sport = String(season.sport ?? 'NFL').toUpperCase()
  const base = {
    seasonId: season.id,
    leagueId: season.leagueId,
    sport,
    season: season.season,
    week: params.week,
  }

  if (isWeekFinalizerDisabled()) return emptyResult(base, 'finalizer_disabled')
  if (!WEEK_KEYED_SPORTS.includes(sport)) return emptyResult(base, 'sport_not_week_keyed')

  const matchups = await prisma.redraftMatchup.findMany({
    where: { seasonId: season.id, week: params.week },
    select: { id: true, status: true },
  })
  const matchupsConsidered = matchups.length
  if (matchupsConsidered > 0 && matchups.every((m) => m.status === 'final')) {
    return emptyResult(base, null, {
      alreadyFinal: true,
      matchupsConsidered,
      matchupsFinal: matchupsConsidered,
    })
  }

  const slate = await readWeekSlate(prisma, {
    sport,
    season: season.season,
    week: params.week,
    seasonType,
    now,
  })
  if (slate.games === 0) return emptyResult(base, 'no_games_on_slate', { slate, matchupsConsidered })
  if (slate.unfinished > 0) return emptyResult(base, 'games_not_final', { slate, matchupsConsidered })

  const lastStart = slate.lastStartTime ? new Date(slate.lastStartTime) : null
  if (lastStart && now.getTime() < lastStart.getTime() + graceMs) {
    return emptyResult(base, 'within_grace_period', { slate, matchupsConsidered })
  }

  const rosters = await prisma.redraftRoster.findMany({
    where: { seasonId: season.id },
    select: { id: true },
  })
  const rosterIds = rosters.map((r) => r.id)
  const rosterPlayers = rosterIds.length
    ? await prisma.redraftRosterPlayer.findMany({
        where: { rosterId: { in: rosterIds }, droppedAt: null },
        select: { playerId: true, sport: true, slotType: true },
      })
    : []

  /*
   * One row per (playerId, sport): the score table is keyed that way, and two managers
   * starting the same player must not be counted as two starters to cover.
   */
  const starters = new Map<string, { playerId: string; sport: string }>()
  for (const p of rosterPlayers) {
    if (!isScoringStarterSlot(p.slotType)) continue
    starters.set(`${p.sport}::${p.playerId}`, { playerId: p.playerId, sport: p.sport })
  }
  if (starters.size === 0) {
    return emptyResult(base, 'no_starters', { slate, matchupsConsidered })
  }

  const bySport = new Map<string, string[]>()
  for (const s of starters.values()) {
    const list = bySport.get(s.sport) ?? []
    list.push(s.playerId)
    bySport.set(s.sport, list)
  }

  const existing = new Set<string>()
  for (const [playerSport, playerIds] of bySport) {
    const rows = await prisma.playerWeeklyScore.findMany({
      where: {
        week: params.week,
        season: season.season,
        sport: playerSport,
        playerId: { in: playerIds },
      },
      select: { playerId: true, sport: true },
    })
    for (const row of rows) existing.add(`${row.sport}::${row.playerId}`)
  }

  const startersWithStats = existing.size
  const coverage = startersWithStats / starters.size
  if (coverage < coverageFloor) {
    return emptyResult(base, 'stat_coverage_below_floor', {
      slate,
      matchupsConsidered,
      starters: starters.size,
      startersWithStats,
      coverage,
    })
  }

  const missing = [...starters.values()].filter((s) => !existing.has(`${s.sport}::${s.playerId}`))

  if (params.dryRun) {
    return {
      ...base,
      finalized: false,
      alreadyFinal: false,
      refusal: null,
      slate,
      starters: starters.size,
      startersWithStats,
      coverage,
      rowsFinalized: 0,
      zeroRowsWritten: 0,
      zeroedPlayerIds: missing.map((m) => m.playerId),
      matchupsFinal: 0,
      matchupsConsidered,
    }
  }

  /*
   * The zero row is written EMPTY (`stats: {}`), not as a fabricated stat line: it records
   * "the week closed and this starter has no box score", which scores 0 through the same
   * engine every other row goes through. An empty map is also how a human tells a sealed
   * non-appearance apart from a real 0.0 performance later.
   */
  let zeroRowsWritten = 0
  if (missing.length > 0) {
    const created = await prisma.playerWeeklyScore.createMany({
      data: missing.map((m) => ({
        playerId: m.playerId,
        sport: m.sport,
        week: params.week,
        season: season.season,
        stats: {},
        fantasyPts: 0,
        isFinalized: true,
      })),
      skipDuplicates: true,
    })
    zeroRowsWritten = created.count
  }

  let rowsFinalized = 0
  for (const [playerSport, playerIds] of bySport) {
    const updated = await prisma.playerWeeklyScore.updateMany({
      where: {
        week: params.week,
        season: season.season,
        sport: playerSport,
        playerId: { in: playerIds },
        isFinalized: false,
      },
      data: { isFinalized: true },
    })
    rowsFinalized += updated.count
  }

  await recalc(season.id, params.week)

  const after = await prisma.redraftMatchup.findMany({
    where: { seasonId: season.id, week: params.week },
    select: { status: true },
  })
  const matchupsFinal = after.filter((m) => m.status === 'final').length

  return {
    ...base,
    finalized: true,
    alreadyFinal: false,
    refusal: null,
    slate,
    starters: starters.size,
    startersWithStats,
    coverage,
    rowsFinalized,
    zeroRowsWritten,
    zeroedPlayerIds: missing.map((m) => m.playerId),
    matchupsFinal,
    matchupsConsidered: after.length,
  }
}

export type FinalizeCompletedWeeksParams = {
  seasonId: string
  /** The week the schedule says is current; weeks at or before it are candidates. */
  throughWeek: number
  lookbackWeeks?: number
  seasonType?: 'regular' | 'postseason'
  graceMs?: number
  coverageFloor?: number
  dryRun?: boolean
}

/**
 * Sweep the weeks that should already be closed.
 *
 * ⚠ IT LOOKS BACKWARD ON PURPOSE. Score-sync only ever reconciles the week the schedule
 * calls current, so a week that missed its window stayed open forever — and one open week
 * blocks `advance_week` for the rest of the season. The lookback is bounded so a long-dead
 * league cannot turn one tick into a full-season replay.
 */
export async function finalizeCompletedWeeksForSeason(
  params: FinalizeCompletedWeeksParams,
  deps: WeekFinalizerDeps = {},
): Promise<{ results: WeekFinalizeResult[]; finalized: number; refusals: Record<string, number> }> {
  const prisma = deps.prisma ?? (defaultPrisma as unknown as PrismaClient)
  const lookback = params.lookbackWeeks ?? WEEK_FINALIZE_LOOKBACK_WEEKS
  const earliest = Math.max(1, params.throughWeek - lookback)

  const open = await prisma.redraftMatchup.findMany({
    where: {
      seasonId: params.seasonId,
      week: { gte: earliest, lte: params.throughWeek },
      status: { not: 'final' },
    },
    select: { week: true },
  })

  const weeks = [...new Set(open.map((m) => m.week))].sort((a, b) => a - b)

  const results: WeekFinalizeResult[] = []
  const refusals: Record<string, number> = {}
  let finalized = 0

  for (const week of weeks) {
    const result = await finalizeRedraftWeek(
      {
        seasonId: params.seasonId,
        week,
        seasonType: params.seasonType,
        graceMs: params.graceMs,
        coverageFloor: params.coverageFloor,
        dryRun: params.dryRun,
      },
      deps,
    )
    results.push(result)
    if (result.finalized) finalized += 1
    if (result.refusal) refusals[result.refusal] = (refusals[result.refusal] ?? 0) + 1
  }

  return { results, finalized, refusals }
}
