import { prisma } from '@/lib/prisma'
import { calculateScoreFromSportConfig } from './scoringEngine'
import { pickFreshestSourceRows } from '@/lib/sports-live-scores-service'
import {
  canonicalTeamDefenseId,
  findCachedWeekPayload,
  isTeamDefenseRow,
  normalizeNflTeamDefenseWeeklyStats,
  normalizeNflWeeklyStats,
  pointsAllowedFromGame,
  teamAbbrevFromDefPlayerId,
} from '@/lib/scoring-runtime/nflStatNormalization'
export {
  findCachedWeekPayload,
  isTeamDefenseRow,
  normalizeNflTeamDefenseWeeklyStats,
  normalizeNflWeeklyStats,
  pointsAllowedFromGame,
  teamAbbrevFromDefPlayerId,
} from '@/lib/scoring-runtime/nflStatNormalization'
import {
  aggregateWeeklyStats,
  getDailySportNormalizer,
  isDailyStatSport,
  weekWindowFromSeasonStart,
} from '@/lib/scoring-runtime/dailySportStatNormalization'
import {
  knownDailySportSeasons,
  resolveDailySportWeekWindow,
} from '@/lib/season-week/dailySportSeasonStarts'
import { ensureDailySportSeasonStart } from '@/lib/season-week/deriveDailySportSeasonStart'
import { resolveStoredSeasonType } from '@/lib/sports-data/riSeasonType'
import { bridgeRosterIdsToGameLogIds } from '@/lib/redraft/rosterGameLogIdBridge'
import { bridgeNcaafRosterIdsToCfbdIds } from '@/lib/redraft/ncaafGameLogIdBridge'
import {
  DAILY_NO_ROW_VERDICT_SPORTS,
  DAILY_ZERO_VERDICTS,
  loadDailyWindowParticipation,
  type DailyNoRowVerdict,
} from '@/lib/redraft/dailySportParticipation'
import { loadNcaafWeekParticipation, NCAAF_ZERO_VERDICTS, type NcaafNoRowVerdict } from '@/lib/redraft/ncaafWeekParticipation'
import { ncaafReserveAvailability, type NcaafReserveAvailability } from '@/lib/player-identity/verifiedNcaafReserves'
import { aggregateNcaafWeek, isNcaafSport } from '@/lib/scoring-runtime/ncaafStatNormalization'
import { crosswalkToSleeperIds, sleeperLookupId, withTeamDefenseIds } from '@/lib/core-app/rosterIdCrosswalk'
import { teamDefenseSleeperId } from '@/lib/core-app/teamDefenseCrosswalk'
import { rosterIdSpaceOf } from '@/lib/core-app/rosterIdSpace'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { readExileRoster } from '@/lib/survivor/exileRosterRules'
import { isDailyLineupScoringEnabled } from '@/lib/redraft/dailyLineups'
import { addDatedGameRow, buildPlayerDailyStatLines, type DatedGameRows } from '@/lib/redraft/playerDailyStatLines'
import { gamesCountActive } from '@/lib/redraft/gamesCount'
import {
  gamesCountDb,
  gamesCountTablesExist,
  warnGamesCountStorageMissing,
  writePlayerWeekGameScores,
} from '@/lib/redraft/gamesCountStore'
import { readRiScheduleWindow } from '@/lib/sports-data/riScheduleCache'

export type WeeklyScoreSyncSummary = {
  leagueId: string
  seasonId: string
  sport: string
  season: number
  week: number
  rosteredPlayers: number
  cacheRowsRead: number
  /** Daily-sport game rows in the window that were PRESEASON games, and so not scored. */
  preseasonRowsSkipped?: number
  /** Daily sports: roster ids translated to game-log (PlayerIdentityMap) ids — see rosterGameLogIdBridge.ts. */
  gameLogIdsBridged?: number
  /** Of those, `tsdb_…` roster ids matched by name to one identity. */
  gameLogIdsBridgedByName?: number
  /** NFL, foreign platform: roster ids translated to a Sleeper id through the crosswalk before any read or write. */
  foreignIdsTranslated?: number
  /** NFL, foreign platform: roster ids with no one-to-one Sleeper id — skipped, never read or written under. */
  untranslatedForeignPlayerIds?: string[]
  /** NCAAF: roster ids resolved to a CFBD athlete id (see ncaafGameLogIdBridge.ts), and those that could not be. */
  cfbdIdsResolved?: number
  unresolvedCfbdPlayerIds?: string[]
  /**
   * NCAAF starters with no CFBD row who scored a real 0 — a bye, or a final, ingested game in which
   * they recorded nothing (see ncaafWeekParticipation.ts) — and why the rest with no row stayed missing.
   */
  ncaafZeroScored?: Array<{ playerId: string; reason: 'bye' | 'no_stat' }>
  /** NBA / NHL / MLB: players with no row written as a real 0, and why (dailySportParticipation.ts). */
  dailyZeroScored?: Array<{ playerId: string; reason: 'inactive' | 'no_stat' }>
  /** NBA / NHL / MLB: players with no row left missing, by verdict. */
  dailyMissingByReason?: Partial<Record<DailyNoRowVerdict, number>>
  ncaafMissingByReason?: Partial<Record<'pending' | 'not_ingested' | 'unmatched' | 'no_team' | NcaafReserveAvailability, number>>
  ncaafSeasonAvailability?: Array<{ playerId: string; status: NcaafReserveAvailability; reason: string; evidenceUrl: string }>
  scoresUpserted: number
  /** Daily-lineup leagues only: per-day rows written to `player_daily_scores` (see lib/redraft/dailyLineups.ts). */
  dailyScoresUpserted?: number
  /** Games-count leagues only: `player_week_game_scores` rows written (lib/redraft/gamesCount.ts). */
  weekGameScoresUpserted?: number
  missingCachePlayerIds: string[]
  missingWeekPlayerIds: string[]
  missingStatPlayerIds: string[]
  /** Rostered NFL players scored from the week-wide provider payload rather than the cache. */
  weekStatsFromProvider: number
  warnings: string[]
}

/** Week-wide NFL stat lines for the rostered ids, already normalized. */
export type NflWeekStatsFetcher = (args: {
  season: number
  week: number
  playerIds: readonly string[]
}) => Promise<Map<string, Record<string, number>>>

/**
 * 🛑 THE NFL OFFENSIVE PATH READ A TABLE NOTHING FILLS, AND SAID NOTHING.
 *
 * This service's NFL branch scores an offensive player from `playerGameLogCache`, whose only
 * writer is `PlayerGameLogImportService` — admin routes only, no scheduled caller. Production
 * holds 15 rows in it. So every rostered offensive player fell into `missingCachePlayerIds`
 * and simply got no `PlayerWeeklyScore` row, while team defenses scored fine (they are derived
 * from `SportsGame`). Measured 2026-09-22: of the 90 starters in the one native league that has
 * played, 56 had a week-1 row — every one written by the live tick DURING games — and 6 had a
 * week-2 row. That gap is what holds stat coverage under the week finalizer's floor.
 *
 * ⚠ AND THE OBVIOUS REPLACEMENT IS WORSE, WHICH IS WHY IT IS NOT USED HERE. `PlayerGameStat`
 * is the table the scheduled multi-sport ingest writes, and it is the right source for the
 * daily sports — but for NFL it held 147 players in week 1, covering exactly ONE of those 90
 * starters. Pointing this branch at it would have lowered coverage while looking like a fix.
 *
 * The source that actually has the week is Sleeper's week-wide stats endpoint — the same call
 * the live tick already makes, which is why those 56 rows exist at all. Reusing the live
 * provider rather than adding a second Sleeper URL keeps one fetcher, one normalizer and one
 * id-space assumption. It is imported lazily because that provider imports this module for its
 * normalizers, and a static import would close the cycle.
 */
const fetchNflWeekStatsFromLiveProvider: NflWeekStatsFetcher = async ({ season, week, playerIds }) => {
  try {
    const { NflLiveStatsProvider } = await import('@/lib/live-scoring/nflLiveStatsProvider')
    const provider = new NflLiveStatsProvider(prisma as never)
    return await provider.fetchPlayerStatsForGames({
      sport: 'NFL',
      season,
      week,
      // The week-wide payload is keyed by player, not by game: the endpoint needs no slate, and
      // passing none is what lets this reconcile a week whose games are long finished.
      games: [],
      playerIds,
    })
  } catch {
    // No fabrication on a provider failure — those players stay unscored and are reported.
    return new Map()
  }
}

/**
 * Team-Defense / Special-Teams (DST) stat normalizer. Kept SEPARATE from
 * `normalizeNflWeeklyStats` because several DST keys collide with offensive
 * keys under the same name from the provider (`sack`, `int`, `fum_rec` mean
 * sacks/INTs/fumbles *by the defense* for a DST row, but the opposite for a QB).
 * The score-sync chooses this normalizer only for team-defense roster rows, so
 * offensive players never pick up def_* keys. Emits the canonical `def_*` keys
 * the NFL `team_def` scoring categories read.
 */
/** True for a roster row that represents a team defense (DEF/DST slot). */

/** Parse the team abbreviation from a synthetic team-defense player id (`nfl:def:KC` → `KC`). */

/**
 * Points allowed by a team's defense in a game = the opponent's final score.
 * Pure so it is unit-testable; returns null when the team is not in the game or
 * the score is not yet final/available.
 */

function candidateSportKeys(sport: string): string[] {
  const upper = sport.toUpperCase()
  const lower = sport.toLowerCase()
  return upper === lower ? [upper] : [upper, lower]
}

async function recordScoreSyncAudit(summary: WeeklyScoreSyncSummary, actorId: string) {
  try {
    await (prisma as any).adminAuditLog?.create({
      data: {
        adminUserId: actorId,
        action: 'redraft_score_sync',
        targetType: 'redraft_season',
        targetId: summary.seasonId,
        details: summary,
      },
    })
  } catch {
    // Audit is best-effort; the sync result remains the source of truth for callers.
  }
}

export async function syncPlayerWeeklyScoresForRedraftSeason(params: {
  seasonId?: string
  leagueId?: string
  week?: number
  actorId?: string
  /**
   * The UTC day week 1 of the regular season begins on. Required for the DAILY
   * sports (NBA/NHL), whose week is a date range rather than a feed-reported
   * number; ignored for NFL, which carries a real week.
   *
   * There is no table to read this from yet — `season_calendars` is empty in
   * production and models months, not days — so it is supplied by the caller
   * and the sync declines without it.
   */
  seasonStartUtc?: Date | string | null
  /** Injectable for tests; defaults to the live provider's week-wide Sleeper payload. */
  fetchNflWeekStats?: NflWeekStatsFetcher
}): Promise<WeeklyScoreSyncSummary> {
  const season = await prisma.redraftSeason.findFirst({
    where: params.seasonId ? { id: params.seasonId } : { leagueId: params.leagueId },
    orderBy: params.seasonId ? undefined : { createdAt: 'desc' },
  })

  if (!season) {
    throw new Error('Redraft season not found')
  }

  const week = Math.max(1, Number(params.week ?? season.currentWeek ?? 1) || 1)
  const sport = String(season.sport || 'NFL').toUpperCase()
  const seasonYear = Number(season.season)

  /**
   * NBA and NHL play several times a week, so their stats are aggregated across
   * every cached game in the week rather than read from a single row. See
   * `lib/scoring-runtime/dailySportStatNormalization.ts`.
   *
   * ⚠ This opening the door is NOT the same as declaring the sport
   * season-capable. That claim is `SEASON_CAPABLE_SPORTS` in lib/sport-scope.ts,
   * which carries its own per-sport evidence (NHL, NCAAB, and NBA ahead of its
   * 2026-10-20 opener); the provider keys were verified by GAPS.md G-01.
   *
   * Running this for a daily sport is safe in the meantime: if the alias tables
   * are wrong, every player falls through to `missingStatPlayerIds` and the
   * unmapped keys are reported. No row is written, so a bad mapping cannot
   * quietly persist zero scores.
   */
  const isDailySport = isDailyStatSport(sport)
  // `RedraftSeason.sport` stores `NCAAFB`, so this must not be a string compare against 'NCAAF'.
  const isNcaaf = isNcaafSport(sport)
  if (sport !== 'NFL' && !isDailySport && !isNcaaf) {
    throw new Error(`Weekly stat sync is wired for NFL, NCAAF, NBA, NHL and NCAAB; ${sport} is not available yet.`)
  }

  const rosters = await prisma.redraftRoster.findMany({
    where: { seasonId: season.id, leagueId: season.leagueId },
    select: { id: true },
  })
  const rosterIds = rosters.map((r) => r.id)
  const ordinaryRosterPlayers = rosterIds.length
    ? await prisma.redraftRosterPlayer.findMany({
        where: { rosterId: { in: rosterIds }, droppedAt: null },
        select: { playerId: true, playerName: true, sport: true, position: true, team: true },
      })
    : []
  // Exile lineups are separate from RedraftRosterPlayer. Score their saved weekly
  // roster in the same ID space as native draft players, even after the manager
  // has released the team for the following week.
  const survivorLeague = await prisma.league.findUnique({
    where: { id: season.leagueId },
    select: { platform: true, survivorMode: true, settings: true },
  })
  // A daily-lineup league is scored per day, so its sync also keeps each player's per-day stats.
  const dailyLineupScoring = isDailySport && isDailyLineupScoringEnabled(survivorLeague?.settings ?? null, sport)
  // A league that counts only some games (best-N / lock-in, lib/redraft/gamesCount.ts) is scored per
  // GAME, so its sync also keeps each player's per-game stats. Off for every other league.
  let gamesCountScoring = isDailySport && gamesCountActive(survivorLeague?.settings ?? null, sport)
  // Fail safe: without its tables the league is synced (and scored) as every game, never P2021.
  if (gamesCountScoring && !(await gamesCountTablesExist(prisma))) {
    warnGamesCountStorageMissing('stat sync', season.leagueId)
    gamesCountScoring = false
  }
  const exileEntries = survivorLeague?.survivorMode && isNativePlatform(survivorLeague.platform)
    ? await prisma.exileWeeklyEntry.findMany({
        where: { leagueId: season.leagueId, week },
        select: { submittedLineup: true },
      })
    : []
  const exileRosterPlayers = exileEntries.flatMap(entry =>
    (readExileRoster(entry.submittedLineup)?.players ?? []).map(player => ({
      playerId: player.id, sport, position: player.position, team: player.team,
    })),
  )
  const storedRosterPlayers = [...ordinaryRosterPlayers, ...exileRosterPlayers]
  const storedIds = Array.from(new Set(storedRosterPlayers.map((p: { playerId: string }) => p.playerId).filter(Boolean)))

  /*
   * 🛑 THE NFL BRANCH READS AND WRITES IN SLEEPER'S ID SPACE, AND AN IMPORTED ROSTER IS NOT IN IT.
   * `playerGameLogCache`, Sleeper's week payload and `player_weekly_scores` (unique on playerId + week +
   * season + sport, shared by every league) are all Sleeper-keyed. An ESPN / Fleaflicker roster holds that
   * platform's ids, and the same digits are a different man: Fleaflicker 13761 (Josh Allen, QB) is a
   * Sleeper DL, 12159 (Dak Prescott) is Hogan Hatten — so a sync would score the stranger's week and WRITE
   * it under his id, over his own row. The cron is gated to native leagues; POST /api/redraft/score-sync
   * with a leagueId is not. Each foreign id is translated through the crosswalk (as matchupProjections
   * does) and everything below runs on the Sleeper id; one with no one-to-one Sleeper id is skipped and
   * counted, never read or written under. Measured on production 2026-10-12: 456 of 541 distinct ESPN /
   * Fleaflicker roster ids translate one-to-one, none ambiguously.
   *
   * NCAAF and the daily sports carry their own id bridges (see below) and are not touched here.
   */
  let rosterPlayers = storedRosterPlayers
  let foreignIdsTranslated: number | undefined
  let untranslatedForeignPlayerIds: string[] | undefined
  if (!isDailySport && !isNcaaf) {
    const sourceLeague = await prisma.league.findUnique({ where: { id: season.leagueId }, select: { platform: true } })
    const platform = sourceLeague?.platform ?? null
    if (rosterIdSpaceOf(platform) !== 'sleeper') {
      /*
       * A team defence has no player-crosswalk row, so it maps to Sleeper's team code from its row
       * (teamDefenseCrosswalk.ts) — and is scored as one: `DEF` routes it to the team-defence branch below
       * (an imported row reads `D/ST`, or `UNK`), and the club code is what points-allowed is matched on
       * (a Fleaflicker row's team is the nickname, "Chiefs").
       */
      const crosswalk = withTeamDefenseIds(
        platform,
        await crosswalkToSleeperIds(String(platform ?? ''), sport, storedIds),
        storedRosterPlayers,
      )
      untranslatedForeignPlayerIds = storedIds.filter((id) => sleeperLookupId(platform, id, crosswalk) == null)
      foreignIdsTranslated = storedIds.length - untranslatedForeignPlayerIds.length
      rosterPlayers = storedRosterPlayers.flatMap((p) => {
        const sleeperId = sleeperLookupId(platform, p.playerId, crosswalk)
        if (!sleeperId) return []
        if (teamDefenseSleeperId(platform, p) === sleeperId) return [{ ...p, playerId: sleeperId, position: 'DEF', team: sleeperId }]
        return [{ ...p, playerId: sleeperId }]
      })
    }
  }

  const playerIds: string[] = Array.from(new Set(rosterPlayers.map((p: { playerId: string }) => p.playerId).filter(Boolean)))
  const summary: WeeklyScoreSyncSummary = {
    leagueId: season.leagueId,
    seasonId: season.id,
    sport,
    season: seasonYear,
    week,
    rosteredPlayers: storedIds.length,
    ...(foreignIdsTranslated !== undefined ? { foreignIdsTranslated } : {}),
    ...(untranslatedForeignPlayerIds ? { untranslatedForeignPlayerIds } : {}),
    cacheRowsRead: 0,
    scoresUpserted: 0,
    missingCachePlayerIds: [],
    missingWeekPlayerIds: [],
    missingStatPlayerIds: [],
    weekStatsFromProvider: 0,
    warnings: [],
  }

  if (untranslatedForeignPlayerIds?.length) {
    summary.warnings.push(
      `${untranslatedForeignPlayerIds.length} roster id(s) are this league's platform ids with no one-to-one Sleeper id; ` +
        `they were NOT scored rather than risk scoring, and writing over, whoever holds those digits in Sleeper's space: ` +
        `${untranslatedForeignPlayerIds.slice(0, 5).join(', ')}.`,
    )
  }

  if (!playerIds.length) {
    if (!storedIds.length) summary.warnings.push('No rostered players found for this redraft season.')
    await recordScoreSyncAudit(summary, params.actorId ?? 'system')
    return summary
  }

  /*
   * A team defence's box score is cached under `nfl:def:<ABBR>` whichever id the roster holds — Sleeper's
   * bare `KC` included (see `canonicalTeamDefenseId`). Read by the roster id alone, a Sleeper-format
   * defence found no cache row and scored points-allowed only: its sacks, interceptions, fumbles and TDs
   * were silently dropped. Both keys are asked for; the DEF branch below reads ONE of them, so a defence
   * cached under both can never be counted twice.
   */
  const defenceCacheIdByPlayer = new Map<string, string>()
  if (!isDailySport && !isNcaaf) {
    for (const p of rosterPlayers as Array<{ playerId: string; position: string | null }>) {
      const canonical = canonicalTeamDefenseId(p.playerId, p.position)
      if (canonical) defenceCacheIdByPlayer.set(p.playerId, canonical)
    }
  }
  const cachedRows = isDailySport || isNcaaf
    ? []
    : await prisma.playerGameLogCache.findMany({
        where: {
          playerId: { in: Array.from(new Set([...playerIds, ...defenceCacheIdByPlayer.values()])) },
          season: String(seasonYear),
          seasonType: 'regular',
          sport: { in: candidateSportKeys(sport) },
        },
      })
  summary.cacheRowsRead = cachedRows.length

  /**
   * One row per GAME, from the scheduled multi-sport ingest
   * (`lib/sports-data/rollingInsightsGameLogs.ts` →
   * `/api/cron/import-player-game-stats?multiSport=1`). A daily sport's week is
   * several of these, which is why they are grouped rather than keyed 1:1.
   *
   * `normalizedStatMap` carries `{ stats: { <provider key>: number } }` — every
   * numeric field under its ORIGINAL vendor name, because that ingest
   * deliberately guesses nothing. That is exactly the input the alias tables
   * expect, and it is also how the unmapped-key report names real vendor fields
   * rather than invented ones.
   */
  const dailyRowsByPlayer = new Map<string, unknown[]>()
  /** Daily-lineup leagues only: the same rows, keyed by their Eastern game day. */
  const datedRowsByPlayer = new Map<string, DatedGameRows>()
  /** Games-count leagues only: the same rows, keyed by the provider game id (one real game). */
  const gameRowsByPlayer = new Map<string, Map<string, { day: Date; rows: unknown[] }>>()
  /** Schedule start instants by game id, read once and only for a games-count league. */
  let scheduleStartByGame: Map<string, string | null> | null = null
  let dailyWindow: { start: Date; end: Date } | null = null
  /** NBA / NHL / MLB: why a player with no row this week has none (see dailySportParticipation.ts). */
  let dailyVerdictFor: ((identityId: string | null | undefined) => DailyNoRowVerdict) | null = null
  const identityIdByRosterId = new Map<string, string>()
  if (isDailySport) {
    /**
     * 🛑 SELECTED BY DATE WINDOW, NOT BY `weekOrRound` — AND AN EARLIER VERSION
     * OF THIS CODE GOT THAT WRONG.
     *
     * `weekOrRound` is 0 for every daily-sport row (measured on production:
     * all 66,525 MLB rows and all 3,322 SOCCER rows), so filtering on it
     * matched nothing and would have left every NBA/NHL league permanently at
     * "no stats yet" with no error anywhere.
     *
     * `season` is dropped from the filter for the same reason: NBA/NHL games
     * are split across `season` 2026 and 2027 for one real-world season, so it
     * is not a dependable narrowing either. The date window is exact and does
     * both jobs at once — it also excludes preseason, because a window anchored
     * on the regular-season start cannot contain a game played before it.
     */
    // An explicit anchor from the caller wins; otherwise fall back to the
    // recorded regular-season openers. Anchoring on the OPENER rather than the
    // first game is what keeps preseason out: NHL preseason ran 19-27 Sep 2026
    // and those games are ingested like any other.
    // Without an explicit anchor, the shared resolver — which is where a gameweek sport (soccer)
    // differs from seven-day arithmetic. The finalizer reads the same function.
    // A season past the curated table (dynasty year 2+) is primed from the labelled schedule first.
    if (!params.seasonStartUtc) await ensureDailySportSeasonStart(sport, seasonYear, { db: prisma as never })
    const window = params.seasonStartUtc && sport !== 'SOCCER'
      ? weekWindowFromSeasonStart(params.seasonStartUtc, week)
      : resolveDailySportWeekWindow(sport, seasonYear, week)
    if (!window) {
      // Decline rather than run a query that cannot be right. Inventing a start
      // date would silently mis-assign every game to the wrong week, which is
      // worse than scoring nothing and saying so.
      const known = knownDailySportSeasons(sport)
      summary.warnings.push(
        `${sport} is a daily sport: a week is a date range, and scoring one needs the regular-season ` +
          `start date. None was supplied, none is recorded and none could be derived from the stored ` +
          `schedule for season ${seasonYear}` +
          `${known.length ? ` (recorded: ${known.join(', ')})` : ''}. ` +
          'Add it to `lib/season-week/dailySportSeasonStarts.ts`. No scores were written.',
      )
      await recordScoreSyncAudit(summary, params.actorId ?? 'system')
      return summary
    }

    /*
     * 🛑 ROSTER IDS ARE NOT GAME-LOG IDS FOR THE DAILY SPORTS. A drafted player carries the pool's
     * Rolling Insights id; player_game_stats is keyed on PlayerIdentityMap.id. Queried directly,
     * every NHL/NCAAB starter found ZERO rows (measured 2026-09-24) — see rosterGameLogIdBridge.ts.
     */
    // A `tsdb_…` id (an older draft pool) is bridged by its roster row's name — see the bridge.
    const namesById = new Map(
      ordinaryRosterPlayers.map((p: { playerId: string; playerName?: string | null }) => [p.playerId, p.playerName ?? null]),
    )
    const bridge = await bridgeRosterIdsToGameLogIds(prisma, candidateSportKeys(sport), playerIds, namesById)
    summary.gameLogIdsBridged = bridge.bridged
    if (bridge.bridgedByName) summary.gameLogIdsBridgedByName = bridge.bridgedByName
    if (bridge.nameRefused.length) {
      summary.warnings.push(
        `${bridge.nameRefused.length} TheSportsDB roster id(s) name a player this league already rosters under another id, ` +
          `or more than one ${sport} player; they were NOT matched to game logs rather than score one man for two teams: ` +
          `${bridge.nameRefused.slice(0, 5).join(', ')}.`,
      )
    }
    if (bridge.ambiguous.length) {
      summary.warnings.push(
        `${bridge.ambiguous.length} roster id(s) are both a Rolling Insights id and another player's Sleeper id in ${sport}; ` +
          `they were NOT matched to game logs rather than risk scoring the wrong player: ${bridge.ambiguous.slice(0, 5).join(', ')}.`,
      )
    }
    const gameRows = await prisma.playerGameStat.findMany({
      where: {
        playerId: { in: bridge.gameLogIds },
        sportType: { in: candidateSportKeys(sport) },
        gameDate: { gte: window.start, lt: window.end },
      },
      select: {
        playerId: true,
        normalizedStatMap: true,
        sportType: true,
        season: true,
        gameDate: true,
        ...(gamesCountScoring ? { gameId: true, providerGameId: true } : {}),
      },
    })
    for (const row of gameRows) {
      // A preseason game inside the window is not a fantasy game. `/live` returns them beside the
      // regular season and nothing marked them until riSeasonType.ts (NHL preseason, 2026-09-21..).
      if (
        resolveStoredSeasonType({
          normalizedStatMap: row.normalizedStatMap,
          sport: row.sportType,
          season: row.season,
          gameDate: row.gameDate,
        }) === 'pre'
      ) {
        summary.preseasonRowsSkipped = (summary.preseasonRowsSkipped ?? 0) + 1
        continue
      }
      // Credit the row to the ROSTER player it belongs to, not the id it is stored under.
      const rosterId = bridge.rosterIdFor(row.playerId)
      if (!rosterId) continue
      const rows = dailyRowsByPlayer.get(rosterId) ?? []
      rows.push(row.normalizedStatMap)
      dailyRowsByPlayer.set(rosterId, rows)
      if (dailyLineupScoring && row.gameDate) {
        const byDay: DatedGameRows = datedRowsByPlayer.get(rosterId) ?? new Map()
        addDatedGameRow(byDay, row.gameDate, row.normalizedStatMap)
        datedRowsByPlayer.set(rosterId, byDay)
      }
      if (gamesCountScoring && row.gameDate) {
        // An MLB two-way player's batting and pitching lines are two rows (`<game>:batting`,
        // `<game>:pitching`) of ONE game; the provider game id groups them back together.
        const r = row as { gameId?: string | null; providerGameId?: string | null }
        const gameKey = r.providerGameId || String(r.gameId ?? '').split(':')[0]
        if (gameKey) {
          const byGame = gameRowsByPlayer.get(rosterId) ?? new Map<string, { day: Date; rows: unknown[] }>()
          const entry = byGame.get(gameKey) ?? { day: row.gameDate, rows: [] }
          entry.rows.push(row.normalizedStatMap)
          byGame.set(gameKey, entry)
          gameRowsByPlayer.set(rosterId, byGame)
        }
      }
    }
    dailyWindow = window
    summary.cacheRowsRead = gameRows.length

    // A player with no row is judged once, here, for the zero-or-missing decision in the loop below.
    const noRow = playerIds.filter((id) => !dailyRowsByPlayer.has(id))
    if (noRow.length > 0 && DAILY_NO_ROW_VERDICT_SPORTS.includes(sport)) {
      // Roster id -> its identity: the bridged id where there is one, else the roster id itself.
      for (const gameLogId of bridge.gameLogIds) {
        const rosterId = bridge.rosterIdFor(gameLogId)
        if (rosterId && (gameLogId !== rosterId || !identityIdByRosterId.has(rosterId))) identityIdByRosterId.set(rosterId, gameLogId)
      }
      dailyVerdictFor = await loadDailyWindowParticipation(prisma as never, {
        sport,
        sportKeys: candidateSportKeys(sport),
        season: seasonYear,
        week,
        window,
        identityIds: [...new Set(noRow.map((id) => identityIdByRosterId.get(id) ?? id))],
      })
    }
  }

  /**
   * NCAAF: one `player_game_stats` row per player per game from the scheduled CFBD ingest
   * (`import-stat-lines` -> `cfbdGameLogs.ts`), keyed on the CFBD athlete id, `sportType: 'NCAAF'`,
   * `weekOrRound` = the real CFBD week. Selected BY WEEK, unlike the daily sports — college football
   * carries a real week number, and `gameDate` is null whenever the CFBD schedule row is missing.
   */
  const ncaafRowsByPlayer = new Map<string, unknown[]>()
  const ncaafResolvedRosterIds = new Set<string>()
  let ncaafImported = false
  let ncaafVerdictFor: ((team: string | null | undefined) => NcaafNoRowVerdict) | null = null
  if (isNcaaf) {
    const sourceLeague = await prisma.league.findUnique({ where: { id: season.leagueId }, select: { platform: true } })
    ncaafImported = String(sourceLeague?.platform ?? '').toLowerCase() === 'fantrax'
    const namespace = ncaafImported ? 'fantrax' : 'pool'
    const bridge = await bridgeNcaafRosterIdsToCfbdIds(prisma as never, playerIds, namespace)
    summary.cfbdIdsResolved = bridge.cfbdIds.length
    summary.unresolvedCfbdPlayerIds = bridge.unresolved
    if (bridge.ambiguous.length) {
      summary.warnings.push(
        `${bridge.ambiguous.length} NCAAF roster id(s) resolve to more than one CFBD athlete, or share one with another ` +
          `rostered player; they were NOT scored rather than risk crediting the wrong player: ${bridge.ambiguous.slice(0, 5).join(', ')}.`,
      )
    }
    if (bridge.unresolved.length) {
      summary.warnings.push(
        `${bridge.unresolved.length} NCAAF roster id(s) have no CFBD athlete link (not a CFBD pool player, and no ` +
          `PlayerIdentityMap.cfbdId): ${bridge.unresolved.slice(0, 5).join(', ')}.`,
      )
    }
    const gameRows = bridge.cfbdIds.length
      ? await prisma.playerGameStat.findMany({
          where: {
            playerId: { in: bridge.cfbdIds },
            sportType: { in: ['NCAAF', 'ncaaf'] },
            season: seasonYear,
            weekOrRound: week,
          },
          select: { playerId: true, normalizedStatMap: true },
        })
      : []
    for (const row of gameRows) {
      const rosterId = bridge.rosterIdFor(row.playerId)
      if (!rosterId) continue
      const rows = ncaafRowsByPlayer.get(rosterId) ?? []
      rows.push(row.normalizedStatMap)
      ncaafRowsByPlayer.set(rosterId, rows)
    }
    summary.cacheRowsRead = gameRows.length
    // Only a roster id the bridge RESOLVED can be judged: an unlinked id is not known to be him.
    for (const cfbdId of bridge.cfbdIds) {
      const rosterId = bridge.rosterIdFor(cfbdId)
      if (rosterId) ncaafResolvedRosterIds.add(rosterId)
    }
    if (playerIds.some((id) => ncaafResolvedRosterIds.has(id) && !ncaafRowsByPlayer.has(id))) {
      ncaafVerdictFor = await loadNcaafWeekParticipation(prisma as never, { season: seasonYear, week })
    }
  }

  const cacheByPlayer = new Map<string, { payload: unknown }>(
    cachedRows.map((row: { playerId: string; payload: unknown }) => [row.playerId, row]),
  )
  const sportByPlayer = new Map(rosterPlayers.map((p) => [p.playerId, String(p.sport || sport).toUpperCase()]))
  const positionByPlayer = new Map(
    rosterPlayers.map((p: { playerId: string; position: string | null }) => [p.playerId, p.position ?? null]),
  )
  const teamByPlayer = new Map(
    rosterPlayers.map((p: { playerId: string; team: string | null }) => [p.playerId, p.team ?? null]),
  )

  // Team-defense points-allowed is derivable from the real game result we
  // already ingest (`SportsGame`): a defense's points-allowed = the opponent's
  // final score. Pre-load this week's finished games keyed by team abbrev so a
  // DEF starter scores from data we have, even without a per-team box-score
  // provider feed. (Sacks/INT/etc. still require the box-score feed — see G8.)
  /*
   * 🛑 ONLY NFL-SHAPED FOOTBALL HAS A TEAM DEFENSE. `isTeamDefenseRow` keys on the position `DEF`, and
   * a soccer defender's position IS `DEF` — so every soccer defender was routed here, looked up as a
   * team score, and scored nothing (found 2026-09-28 by scripts/smoke-soccer-gameweek-testdb.ts: 16 of
   * 16 defenders unscored while keepers, midfielders and forwards scored). A daily sport is scored
   * from its own box lines, player by player, whatever the position is called. NCAAF has no
   * team-defense stat line either, and takes its own branch below.
   */
  const isTeamDefense = (id: string) =>
    !isDailySport && !isNcaaf && isTeamDefenseRow(id, positionByPlayer.get(id) ?? null)
  const teamDefensePlayerIds = playerIds.filter(isTeamDefense)
  const gameByTeam = new Map<string, { homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null }>()
  if (teamDefensePlayerIds.length > 0) {
    const rawGames = await prisma.sportsGame.findMany({
      /*
       * ⚠ REGULAR SEASON ONLY. `week` alone is ambiguous: production holds 2026 NFL preseason weeks
       * 1-4 with final scores beside regular weeks 1-4, so an August exhibition's score could become a
       * September defence's points allowed. The schedule resolver treats NFL season type as required
       * for the same reason (`requiresExplicitSeasonType`).
       */
      where: { sport: { in: candidateSportKeys(sport) }, season: seasonYear, week, seasonType: 'regular' },
      select: { homeTeam: true, awayTeam: true, homeScore: true, awayScore: true, source: true, fetchedAt: true },
    })
    // A fixture can carry 3-4 rows here, one per provider feed. Without
    // dedup, whichever row `findMany` happened to return last for a team wins
    // — possibly a stale or still-scoreless duplicate from a different
    // source than the one that actually has the final score. Same fix as
    // `lib/live/liveScoresPage.ts`: trust one source for the whole batch.
    const games = pickFreshestSourceRows(rawGames)
    for (const g of games) {
      const home = String(g.homeTeam ?? '').trim().toUpperCase()
      const away = String(g.awayTeam ?? '').trim().toUpperCase()
      if (home) gameByTeam.set(home, g)
      if (away) gameByTeam.set(away, g)
    }
  }
  /*
   * 🛑 THE STORED LINE OUTRANKS A WEAKER REBUILD. A defence's full box score can reach
   * `player_weekly_scores` without ever being cached — the live tick writes the provider's line
   * straight there — and this branch rebuilt the row from the cache alone, so a week the cache
   * did not hold became points-allowed only and REPLACED the box score. Measured on production
   * 2026-10-13: week 2 of 2026 kept full lines for 24 clubs (live tick, 09-24 01:21Z) and points
   * allowed alone for the 8 a native league rostered (this sync, 23:41Z; 6 already finalized).
   * So with no cached week, the stored line is kept and only its points allowed is refreshed.
   */
  const storedDefenceStatsByPlayer = new Map<string, Record<string, number>>()
  if (teamDefensePlayerIds.length > 0) {
    const storedRows = await prisma.playerWeeklyScore.findMany({
      where: { playerId: { in: teamDefensePlayerIds }, week, season: seasonYear, sport: { in: candidateSportKeys(sport) } },
      select: { playerId: true, stats: true },
    })
    for (const row of storedRows as Array<{ playerId: string; stats: unknown }>) {
      storedDefenceStatsByPlayer.set(row.playerId, normalizeNflTeamDefenseWeeklyStats(row.stats))
    }
  }

  /**
   * The stats `playerGameLogCache` can answer with for THIS week — `{}` when it cannot.
   *
   * 🛑 A CACHE *ROW* IS NOT A CACHE *HIT*, AND CONFLATING THEM SILENTLY DISABLES THE
   * PROVIDER FALLBACK BELOW. The cache is per-player and season-wide, so a row can exist
   * while holding nothing for the week being reconciled. Measured 2026-09-23 on a freshly
   * drafted league: A.J. Brown and Ja'Marr Chase both had rows synced in May/June with no
   * week-1 entry, so a `cacheByPlayer.has(id)` filter dropped them from the fetch and they
   * were reported `missingWeek` while Sleeper held their week-1 lines. Two of 26 starters —
   * the difference between 77% and 85% coverage, i.e. between a week that seals and a week
   * that never does. Nothing failed; the sync reported itself healthy.
   *
   * The fetch filter and the scoring loop below BOTH read this, so the question "can the
   * cache answer for this week" has one implementation. Asking it twice is what let the
   * two drift apart in the first place.
   */
  const cachedWeekStatsFor = (playerId: string): Record<string, number> => {
    const cached = cacheByPlayer.get(playerId)
    const weekPayload = cached ? findCachedWeekPayload(cached.payload, week) : null
    return weekPayload ? normalizeNflWeeklyStats(weekPayload) : {}
  }

  /*
   * The week-wide NFL payload, fetched ONCE for the rostered offensive players the cache
   * cannot answer for (see `fetchNflWeekStatsFromLiveProvider` above for why the cache
   * cannot). Nothing is fetched when the cache already covers everyone, so a league whose
   * cache is populated costs no provider call at all.
   */
  const weekStatsByPlayer = new Map<string, Record<string, number>>()
  if (!isDailySport && candidateSportKeys(sport).includes('NFL')) {
    const uncachedOffensiveIds = playerIds.filter(
      (id) =>
        !isTeamDefense(id) &&
        Object.keys(cachedWeekStatsFor(id)).length === 0,
    )
    if (uncachedOffensiveIds.length > 0) {
      const fetcher = params.fetchNflWeekStats ?? fetchNflWeekStatsFromLiveProvider
      const fetched = await fetcher({ season: seasonYear, week, playerIds: uncachedOffensiveIds })
      for (const [id, stats] of fetched) {
        if (stats && Object.keys(stats).length > 0) weekStatsByPlayer.set(id, stats)
      }
    }
  }

  // Provider stat keys no alias claimed. Collected across the whole run so a
  // wrong alias table for a daily sport is reported once, loudly, instead of
  // looking like a quiet week in which nobody scored.
  const unmappedStatKeys = new Set<string>()

  for (const playerId of playerIds) {
    const position = positionByPlayer.get(playerId) ?? null
    const playerSport = sportByPlayer.get(playerId) ?? sport

    /**
     * NCAAF runs BEFORE the NFL team-defense branch: a college `DEF` slot has no team stat line in
     * any feed we ingest, so it is reported unscored here rather than sent looking for NFL box scores.
     *
     * A player who appeared and produced nothing scores a real 0 — `gamesCounted` counts appearances,
     * not stat lines — so a quiet game is never confused with "no data".
     */
    if (isNcaaf) {
      const rows = ncaafRowsByPlayer.get(playerId) ?? []
      const reserve = ncaafImported ? ncaafReserveAvailability(playerId, seasonYear) : undefined
      if (reserve && (rows.length === 0 || reserve.availability !== 'needs_verification')) {
        // Current-season primary evidence takes priority over an old school/provider roster.
        const byReason = (summary.ncaafMissingByReason ??= {})
        byReason[reserve.availability] = (byReason[reserve.availability] ?? 0) + 1
        ;(summary.ncaafSeasonAvailability ??= []).push({ playerId, status: reserve.availability, reason: reserve.reason, evidenceUrl: reserve.evidenceUrl })
        if (rows.length) summary.warnings.push(`NCAAF season evidence conflicts with game rows for ${playerId}; scoring withheld pending review.`)
        summary.missingCachePlayerIds.push(playerId)
        continue
      }
      if (rows.length === 0) {
        /*
         * No CFBD row is not "no data": CFBD lists only players who recorded a stat. A resolved player
         * whose school had a bye, or played a final game the ingest DID bring in, scored a real 0 —
         * written, so the finalizer counts him as covered. Only a game that is unfinished, or final
         * with no rows (a data gap), or a school we cannot place, leaves him missing.
         */
        const team = teamByPlayer.get(playerId) ?? null
        const verdict = ncaafResolvedRosterIds.has(playerId) && ncaafVerdictFor && team ? ncaafVerdictFor(team) : null
        if (verdict && NCAAF_ZERO_VERDICTS.has(verdict)) {
          await prisma.playerWeeklyScore.upsert({
            where: { playerId_week_season_sport: { playerId, week, season: seasonYear, sport: playerSport } },
            update: { stats: {}, fantasyPts: 0, isFinalized: false },
            create: { playerId, week, season: seasonYear, sport: playerSport, stats: {}, fantasyPts: 0, isFinalized: false },
          })
          summary.scoresUpserted += 1
          ;(summary.ncaafZeroScored ??= []).push({ playerId, reason: verdict as 'bye' | 'no_stat' })
          continue
        }
        if (ncaafResolvedRosterIds.has(playerId)) {
          const reason = !team ? 'no_team' : ((verdict ?? 'unmatched') as 'pending' | 'not_ingested' | 'unmatched')
          const byReason = (summary.ncaafMissingByReason ??= {})
          byReason[reason] = (byReason[reason] ?? 0) + 1
        }
        summary.missingCachePlayerIds.push(playerId)
        continue
      }
      const aggregate = aggregateNcaafWeek(rows)
      for (const key of aggregate.unmappedKeys) unmappedStatKeys.add(key)
      if (aggregate.gamesCounted === 0) {
        summary.missingStatPlayerIds.push(playerId)
        continue
      }
      const ncaafPts = await calculateScoreFromSportConfig(season.leagueId, playerId, week, aggregate.stats, position)
      await prisma.playerWeeklyScore.upsert({
        where: { playerId_week_season_sport: { playerId, week, season: seasonYear, sport: playerSport } },
        update: { stats: aggregate.stats, fantasyPts: ncaafPts, isFinalized: false },
        create: { playerId, week, season: seasonYear, sport: playerSport, stats: aggregate.stats, fantasyPts: ncaafPts, isFinalized: false },
      })
      summary.scoresUpserted += 1
      continue
    }

    if (isTeamDefense(playerId)) {
      const defenceCacheId = defenceCacheIdByPlayer.get(playerId)
      // The canonical key first; the roster's own id only for a defence with no canonical form.
      const cached = (defenceCacheId ? cacheByPlayer.get(defenceCacheId) : undefined) ?? cacheByPlayer.get(playerId)
      const weekPayload = cached ? findCachedWeekPayload(cached.payload, week) : null
      const stored = storedDefenceStatsByPlayer.get(playerId)
      // A stored line with more than points allowed is a box score, and nothing below may shrink it.
      const keepStored = !weekPayload && !!stored && Object.keys(stored).some((key) => key !== 'def_points_allowed')
      const stats: Record<string, number> = weekPayload
        ? normalizeNflTeamDefenseWeeklyStats(weekPayload)
        : keepStored
          ? { ...stored }
          : {}

      // Derive points allowed from the game result when the box-score feed did not provide it —
      // and, on a kept stored line, refresh it: that is the one number this branch can improve.
      if (stats.def_points_allowed === undefined || keepStored) {
        // From the canonical id: a Sleeper DEF row's team can read "Arizona Cardinals", which matches no game.
        const team = teamAbbrevFromDefPlayerId(defenceCacheId ?? playerId) ?? String(teamByPlayer.get(playerId) ?? '').trim().toUpperCase()
        const game = team ? gameByTeam.get(team) : undefined
        if (game) {
          const pa = pointsAllowedFromGame(game, team)
          if (pa !== null) stats.def_points_allowed = pa
        }
      }

      if (!Object.keys(stats).length) {
        // No box score and no finished game yet — nothing to score this week.
        if (!cached) summary.missingCachePlayerIds.push(playerId)
        else summary.missingWeekPlayerIds.push(playerId)
        continue
      }

      const fantasyPts = await calculateScoreFromSportConfig(season.leagueId, playerId, week, stats, position)
      await prisma.playerWeeklyScore.upsert({
        where: { playerId_week_season_sport: { playerId, week, season: seasonYear, sport: playerSport } },
        update: { stats, fantasyPts, isFinalized: false },
        create: { playerId, week, season: seasonYear, sport: playerSport, stats, fantasyPts, isFinalized: false },
      })
      summary.scoresUpserted += 1
      continue
    }

    /**
     * 🛑 THE DAILY BRANCH READS A DIFFERENT TABLE, AND MUST RUN BEFORE THE
     * `playerGameLogCache` GUARD BELOW.
     *
     * `playerGameLogCache` is written only by `PlayerGameLogImportService`,
     * which has no scheduled caller — admin routes only. What IS scheduled for
     * NBA/NHL is `/api/cron/import-player-game-stats?multiSport=1`, and that
     * writes `playerGameStat` instead. Sourcing the daily sports from the cache
     * would point them at a table nothing refreshes: it would fail silently and
     * look correct, which is the worse of the two failures.
     *
     * The query has already narrowed to this week, so the rows are aggregated
     * directly rather than searched for in a payload.
     */
    if (isDailySport) {
      const dailyRows = dailyRowsByPlayer.get(playerId) ?? []
      if (dailyRows.length === 0) {
        /*
         * No row is not "no data" when there is EVIDENCE he did not play: an inactive identity, or his
         * team's games all final with their rows ingested. That is a real 0, written like NCAAF's, so
         * the scorer and the finalizer's coverage both count him. Without evidence he stays missing.
         * No daily row is written: a day with no row already scores 0 in a daily-lineup league.
         */
        const verdict = dailyVerdictFor ? dailyVerdictFor(identityIdByRosterId.get(playerId) ?? playerId) : null
        if (verdict && DAILY_ZERO_VERDICTS.has(verdict)) {
          await prisma.playerWeeklyScore.upsert({
            where: { playerId_week_season_sport: { playerId, week, season: seasonYear, sport: playerSport } },
            update: { stats: {}, fantasyPts: 0, isFinalized: false },
            create: { playerId, week, season: seasonYear, sport: playerSport, stats: {}, fantasyPts: 0, isFinalized: false },
          })
          summary.scoresUpserted += 1
          ;(summary.dailyZeroScored ??= []).push({ playerId, reason: verdict as 'inactive' | 'no_stat' })
          continue
        }
        if (verdict) {
          const byReason = (summary.dailyMissingByReason ??= {})
          byReason[verdict] = (byReason[verdict] ?? 0) + 1
        }
        summary.missingCachePlayerIds.push(playerId)
        continue
      }

      const normalizer = getDailySportNormalizer(sport)
      const aggregate = normalizer
        ? aggregateWeeklyStats(dailyRows, normalizer)
        : { stats: {}, gamesCounted: 0, unmappedKeys: [] }
      for (const key of aggregate.unmappedKeys) unmappedStatKeys.add(key)

      if (aggregate.gamesCounted === 0) {
        summary.missingWeekPlayerIds.push(playerId)
        continue
      }
      if (!Object.keys(aggregate.stats).length) {
        summary.missingStatPlayerIds.push(playerId)
        continue
      }

      const dailyPts = await calculateScoreFromSportConfig(
        season.leagueId,
        playerId,
        week,
        aggregate.stats,
        position,
      )
      await prisma.playerWeeklyScore.upsert({
        where: { playerId_week_season_sport: { playerId, week, season: seasonYear, sport: playerSport } },
        update: { stats: aggregate.stats, fantasyPts: dailyPts, isFinalized: false },
        create: {
          playerId,
          week,
          season: seasonYear,
          sport: playerSport,
          stats: aggregate.stats,
          fantasyPts: dailyPts,
          isFinalized: false,
        },
      })
      summary.scoresUpserted += 1
      if (dailyLineupScoring && dailyWindow && normalizer) {
        summary.dailyScoresUpserted =
          (summary.dailyScoresUpserted ?? 0) +
          (await writePlayerDailyScores({
            playerId,
            sport: playerSport,
            season: seasonYear,
            week,
            window: dailyWindow,
            byDay: datedRowsByPlayer.get(playerId) ?? new Map(),
            normalizer,
          }))
      }
      if (gamesCountScoring && dailyWindow && normalizer) {
        if (!scheduleStartByGame) {
          const schedule = await readRiScheduleWindow(prisma as never, { sport, season: seasonYear, window: dailyWindow })
          scheduleStartByGame = new Map((schedule ?? []).map((g) => [g.gameId, g.startTime]))
        }
        const games: Array<{ gameId: string; gameDay: Date; startTime: Date | null; stats: Record<string, number> }> = []
        for (const [gameId, { day, rows }] of gameRowsByPlayer.get(playerId) ?? new Map()) {
          const aggregate = aggregateWeeklyStats(rows, normalizer)
          if (aggregate.gamesCounted === 0 || !Object.keys(aggregate.stats).length) continue
          const start = scheduleStartByGame.get(gameId)
          const startTime = start ? new Date(start) : null
          games.push({ gameId, gameDay: day, startTime: startTime && !Number.isNaN(startTime.getTime()) ? startTime : null, stats: aggregate.stats })
        }
        summary.weekGameScoresUpserted =
          (summary.weekGameScoresUpserted ?? 0) +
          (await writePlayerWeekGameScores(gamesCountDb(prisma), { playerId, sport: playerSport, season: seasonYear, week, games }))
      }
      continue
    }

    /*
     * The cache first — it is per-player and season-wide, so it answers historical weeks the
     * live endpoint has aged out — then the week-wide provider payload. The miss is still
     * classified by WHY the cache could not answer, so the existing telemetry keeps meaning
     * what it meant; only the outcome changes, from "unscored" to "scored from the week feed".
     */
    const cached = cacheByPlayer.get(playerId)
    // `cached` and `weekPayload` survive only to classify a MISS; what the cache can
    // actually answer with comes from the one helper the fetch filter also used.
    const weekPayload = cached ? findCachedWeekPayload(cached.payload, week) : null
    const cachedStats = cachedWeekStatsFor(playerId)
    const providerStats = weekStatsByPlayer.get(playerId) ?? {}
    const usedProvider = Object.keys(cachedStats).length === 0 && Object.keys(providerStats).length > 0
    const stats = Object.keys(cachedStats).length > 0 ? cachedStats : providerStats

    if (!Object.keys(stats).length) {
      if (!cached) summary.missingCachePlayerIds.push(playerId)
      else if (!weekPayload) summary.missingWeekPlayerIds.push(playerId)
      else summary.missingStatPlayerIds.push(playerId)
      continue
    }
    if (usedProvider) summary.weekStatsFromProvider += 1
    const fantasyPts = await calculateScoreFromSportConfig(season.leagueId, playerId, week, stats, positionByPlayer.get(playerId) ?? null)

    await prisma.playerWeeklyScore.upsert({
      where: {
        playerId_week_season_sport: {
          playerId,
          week,
          season: seasonYear,
          sport: playerSport,
        },
      },
      update: {
        stats,
        fantasyPts,
        isFinalized: false,
      },
      create: {
        playerId,
        week,
        season: seasonYear,
        sport: playerSport,
        stats,
        fantasyPts,
        isFinalized: false,
      },
    })
    summary.scoresUpserted += 1
  }

  if (summary.missingCachePlayerIds.length) {
    summary.warnings.push('Some rostered players do not have cached game logs. Run the provider/cache job before score sync.')
  }
  if (summary.missingWeekPlayerIds.length) {
    summary.warnings.push(`Some cached players do not have week ${week} rows yet.`)
  }
  if (summary.missingStatPlayerIds.length) {
    summary.warnings.push(`Some cached week rows did not contain recognized ${sport} stat keys.`)
  }
  // 🛑 The loud half of the unverified-alias design. NBA/NHL provider field
  // names are not yet confirmed against a captured payload (GAPS.md G-01), so
  // the run reports exactly which keys it could not place. A run that scores
  // nobody AND lists unmapped keys is an alias problem, not an empty week —
  // without this they are indistinguishable.
  if (unmappedStatKeys.size) {
    summary.warnings.push(
      `Unrecognized ${sport} provider stat keys (alias table may be wrong): ${[...unmappedStatKeys].sort().join(', ')}`,
    )
  }

  await recordScoreSyncAudit(summary, params.actorId ?? 'system')
  return summary
}

/**
 * Daily-lineup leagues: one `player_daily_scores` row per day the player played this week, summed by
 * the same normalizer as the weekly roll-up. Days with no game have no row and score 0. Rows for days
 * that no longer have a game (a stat correction, a game re-dated) are removed, so a stale day cannot
 * keep scoring. See lib/redraft/dailyLineups.ts.
 */
async function writePlayerDailyScores(args: {
  playerId: string
  sport: string
  season: number
  week: number
  window: { start: Date; end: Date }
  byDay: DatedGameRows
  normalizer: NonNullable<ReturnType<typeof getDailySportNormalizer>>
}): Promise<number> {
  const keep: Date[] = []
  let written = 0
  // The per-day lines come from the shared builder the admin re-ingest preview also uses.
  for (const { day, stats, gamesPlayed } of buildPlayerDailyStatLines(args.byDay, args.normalizer)) {
    keep.push(day)
    await prisma.playerDailyScore.upsert({
      where: {
        playerId_sport_season_scoringDay: { playerId: args.playerId, sport: args.sport, season: args.season, scoringDay: day },
      },
      update: { week: args.week, stats, gamesPlayed, isFinalized: false },
      create: {
        playerId: args.playerId,
        sport: args.sport,
        season: args.season,
        week: args.week,
        scoringDay: day,
        stats,
        gamesPlayed,
        isFinalized: false,
      },
    })
    written += 1
  }
  await prisma.playerDailyScore.deleteMany({
    where: {
      playerId: args.playerId,
      sport: args.sport,
      season: args.season,
      scoringDay: { gte: args.window.start, lt: args.window.end, notIn: keep },
    },
  })
  return written
}
