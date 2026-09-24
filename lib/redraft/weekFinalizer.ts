import type { PrismaClient } from '@prisma/client'

import { prisma as defaultPrisma } from '@/lib/prisma'
import { LIVE_SCORE_SOURCES, pickFreshestSourceRows } from '@/lib/scores/liveSourceSelection'
import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import { weekWindowFromSeasonStart } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { resolveDailySportSeasonStart } from '@/lib/season-week/dailySportSeasonStarts'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
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
 * ⚠ NBA AND NHL ARE ABSENT BECAUSE THEIR ROWS DO NOT CARRY A USABLE WEEK — measured again on
 * production 2026-09-24: NHL season 2026 holds 1,373 `thesportsdb` rows carrying 29 distinct
 * "weeks" ranging 1..500. That is not a week, it is a column the feed fills arbitrarily.
 * They are finalized through {@link DATE_WINDOWED_SPORTS} instead.
 */
export const WEEK_KEYED_SPORTS: readonly string[] = ['NFL', 'NCAAF']

/**
 * Sports whose week is a DATE WINDOW, closed by the same seven days the stat sync aggregates.
 *
 * 🛑 THE WINDOW COMES FROM A RECORDED SEASON OPENER, NEVER A GUESS. `resolveDailySportSeasonStart`
 * returns null for a season nobody has written down, and this refuses with
 * `season_start_unknown` rather than anchoring on January 1 — a guessed anchor does not fail
 * loudly, it assigns every game to the wrong week and seals confidently wrong scores.
 *
 * ⚠ NBA IS ABSENT ON PURPOSE AND IS ONE LINE AWAY. The mechanism below is sport-agnostic and
 * NBA's opener is already recorded (2026-10-20), but its season has not started, so no NBA
 * slate or stat row has been checked against this path. Adding it is a measurement, not an
 * edit — the same standard `SEASON_CAPABLE_SPORTS` sets.
 */
export const DATE_WINDOWED_SPORTS: readonly string[] = ['NHL']

export type WeekFinalizeRefusal =
  | 'finalizer_disabled'
  | 'season_not_found'
  | 'sport_not_week_keyed'
  | 'no_games_on_slate'
  | 'games_not_final'
  | 'within_grace_period'
  | 'no_starters'
  | 'stat_coverage_below_floor'
  /**
   * A daily sport whose season opener is not recorded, so its week has no date window.
   *
   * ⚠ DISTINCT FROM `sport_not_week_keyed` BECAUSE THEY MEAN OPPOSITE THINGS. That one says
   * the finalizer does not handle this sport at all; this one says it does, and is missing
   * one dated fact — `REGULAR_SEASON_START_UTC` in `dailySportSeasonStarts.ts`, one line.
   * Collapsing them would send the reader to rewrite a subsystem when the fix is a date.
   */
  | 'season_start_unknown'
  /**
   * The backfill could not run because the provider's quota was spent.
   *
   * 🛑 WITHOUT THIS, THE SAME STATE REPORTS AS `stat_coverage_below_floor` — TRUE ABOUT THE
   * NUMBER AND WRONG ABOUT THE CAUSE. A rate-limited Sleeper call returns an EMPTY map
   * (`nflLiveStatsProvider.ts`, `if (!canCall) return out`), the sync reads that as "these
   * players have no stats", and the coverage figure that results points the next reader at the
   * roster. Measured 2026-09-24: week 1 refused at 0.721 while 19 of its 24 unscored starters
   * had real lines sitting in Sleeper's payload, unreachable only because the team-defense
   * fetch had already spent the hour's budget.
   */
  | 'provider_rate_limited'

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
  /**
   * Fill a PAST week's stat rows, so the sweep below can attempt it a second time.
   *
   * 🛑 WITHOUT THIS THE SWEEP RE-ATTEMPTS WEEKS IT CAN NEVER SATISFY. Score-sync reconciles
   * exactly one week — `resolveSeasonWeekForRedraftSeason`'s current one — so a week that
   * missed its window has whatever coverage it had then, forever, and the sweep refuses it
   * every five minutes on data nothing is refreshing.
   *
   * Injected rather than imported because `playerWeeklyScoreService` is what would fill them
   * and it already reaches this module's normalizers; a direct import would close the cycle.
   */
  syncWeekStats?: (args: {
    seasonId: string
    week: number
  }) => Promise<{ rateLimited?: boolean } | void>
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
    /**
     * A daily sport's slate, selected by DATE instead of by `week`.
     *
     * 🛑 `SportsGame.week` IS NOISE FOR NHL AND NBA, NOT A WEEK. Measured on production
     * 2026-09-24: NHL season 2026 holds 1,373 `thesportsdb` rows carrying 29 distinct
     * "weeks" ranging 1..500. The sport has no week, so the feed writes whatever it likes,
     * and querying `week: N` against that picks an arbitrary handful of games and calls it
     * a slate.
     *
     * A daily sport's week IS a date window — the same one
     * `syncPlayerWeeklyScoresForRedraftSeason` already aggregates its stats over, from the
     * same `weekWindowFromSeasonStart` anchor. Passing it keeps both halves reading the
     * same seven days.
     */
    dateWindow?: { start: Date; end: Date } | null
  },
): Promise<WeekSlateSummary> {
  const windowed = args.dateWindow ?? null
  /*
   * 🛑 THE WINDOW IS EASTERN DAYS, AND `startTime` IS A UTC INSTANT — SELECTING ON THE INSTANT
   * PUTS A THIRD OF THE SEASON IN THE WRONG WEEK.
   *
   * `player_game_stats.game_date` stores the EASTERN calendar day a game was played (#1194),
   * and the stat sync buckets by it. A slate that filtered `startTime` against the same bounds
   * would bucket by UTC instead, and the two halves would disagree about which games belong to
   * the week. Measured on production 2026-09-24: 954 of 1,409 NHL 2026 games — 67.7% — start
   * after UTC midnight, because a 7-10pm Eastern puck drop is the NEXT UTC day. Week 1 alone
   * holds 42 games by UTC instant against 39 by Eastern day.
   *
   * So the query over-selects by six hours and the exact membership test happens below, on
   * `easternCalendarDay` — the same helper, and therefore the same DST handling, that wrote
   * those `game_date` values.
   */
  const EASTERN_OVERSELECT_MS = 6 * 60 * 60 * 1000
  const rawRows = await prisma.sportsGame.findMany({
    where: {
      sport: args.sport,
      season: args.season,
      ...(windowed
        ? { startTime: { gte: windowed.start, lt: new Date(windowed.end.getTime() + EASTERN_OVERSELECT_MS) } }
        : { week: args.week }),
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

  /*
   * ⚠ A WINDOWED READ MUST DROP `week` BEFORE SELECTION, OR THE NOISE BECOMES THE GROUPING.
   * `pickFreshestSourceRows` slices on `season:week` and picks one source PER SLICE. NHL rows
   * inside one seven-day window carry several of those junk week values, so the selection
   * would split the window into arbitrary groups. Rows with a null week share a single slice —
   * which that module documents as the original whole-call behaviour, and is exactly right for
   * a caller that did not group by week in the first place.
   */
  const inWindow = windowed
    ? rawRows.filter((row) => {
        const day = easternCalendarDay(row.startTime)
        return day != null && day >= windowed.start && day < windowed.end
      })
    : rawRows
  const selectable = windowed ? inWindow.map((row) => ({ ...row, week: null })) : inWindow
  const rows = pickFreshestSourceRows(selectable, (args.now ?? new Date()).getTime())

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

  const isDateWindowed = DATE_WINDOWED_SPORTS.includes(sport)
  if (!WEEK_KEYED_SPORTS.includes(sport) && !isDateWindowed) {
    return emptyResult(base, 'sport_not_week_keyed')
  }

  /*
   * A daily sport's week is seven days from its recorded opener — the SAME anchor and helper
   * the stat sync uses, so the slate and the stats cover the same dates. Resolved before the
   * already-final short circuit so a season with no recorded opener says which fact is
   * missing instead of silently reading an empty slate.
   */
  let dateWindow: { start: Date; end: Date } | null = null
  if (isDateWindowed) {
    const seasonStart = resolveDailySportSeasonStart(sport, season.season)
    const window = seasonStart ? weekWindowFromSeasonStart(seasonStart, params.week) : null
    if (!window) return emptyResult(base, 'season_start_unknown')
    dateWindow = { start: new Date(window.start), end: new Date(window.end) }
  }

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
    dateWindow,
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
    const attempt = () =>
      finalizeRedraftWeek(
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

    let result = await attempt()

    /*
     * 🛑 ONE RETRY, AND ONLY FOR THE ONE REFUSAL A BACKFILL CAN ANSWER.
     *
     * `stat_coverage_below_floor` on a PAST week is the signature of stats nobody has
     * fetched, not of a week that should stay open — score-sync only ever reconciles the
     * current week, so an older one keeps whatever coverage it had when it was current.
     * Measured in production 2026-09-24 on the one native league that has played: week 2
     * sat at 86/90 (95.6%) while week 1 sat at 62/90 (69%), and because the roller advances
     * from `currentWeek`, that week 1 held the whole season on week 1.
     *
     * ⚠ FETCHING FIRST AND ASKING AFTERWARDS WOULD BE THE EXPENSIVE VERSION. The other
     * refusals — unfinished slate, inside the grace period, no starters — are not about
     * missing rows, and a week that seals on the first attempt costs nothing extra. A week
     * that can never reach the floor costs one backfill per tick until it falls out of the
     * lookback window, which is what bounds this.
     */
    if (result.refusal === 'stat_coverage_below_floor' && deps.syncWeekStats && !params.dryRun) {
      try {
        const backfill = await deps.syncWeekStats({ seasonId: params.seasonId, week })
        result = await attempt()
        /*
         * ⚠ REPORT THE CAUSE THAT IS TRUE. A spent quota makes the provider hand back an empty
         * payload, so the retry's coverage is the same number for a completely different
         * reason — and `stat_coverage_below_floor` sends the next reader to the roster. Only
         * relabel when the week is still refusing for coverage: a week that sealed anyway, or
         * one blocked on its slate, is not a quota story.
         */
        if (backfill?.rateLimited && result.refusal === 'stat_coverage_below_floor') {
          result = { ...result, refusal: 'provider_rate_limited' }
        }
      } catch {
        // A provider gap leaves the original refusal standing rather than inventing coverage.
      }
    }

    results.push(result)
    if (result.finalized) finalized += 1
    if (result.refusal) refusals[result.refusal] = (refusals[result.refusal] ?? 0) + 1
  }

  return { results, finalized, refusals }
}
