import { prisma } from '@/lib/prisma'
import { calculateScoreFromSportConfig } from './scoringEngine'
import { pickFreshestSourceRows } from '@/lib/sports-live-scores-service'
import {
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
  resolveDailySportSeasonStart,
} from '@/lib/season-week/dailySportSeasonStarts'
import { resolveStoredSeasonType } from '@/lib/sports-data/riSeasonType'
import { bridgeRosterIdsToGameLogIds } from '@/lib/redraft/rosterGameLogIdBridge'

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
  scoresUpserted: number
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
  if (sport !== 'NFL' && !isDailySport) {
    throw new Error(`Weekly stat sync is wired for NFL, NBA and NHL; ${sport} is not available yet.`)
  }

  const rosters = await prisma.redraftRoster.findMany({
    where: { seasonId: season.id, leagueId: season.leagueId },
    select: { id: true },
  })
  const rosterIds = rosters.map((r) => r.id)
  const rosterPlayers = rosterIds.length
    ? await prisma.redraftRosterPlayer.findMany({
        where: { rosterId: { in: rosterIds }, droppedAt: null },
        select: { playerId: true, sport: true, position: true, team: true },
      })
    : []

  const playerIds: string[] = Array.from(new Set(rosterPlayers.map((p: { playerId: string }) => p.playerId).filter(Boolean)))
  const summary: WeeklyScoreSyncSummary = {
    leagueId: season.leagueId,
    seasonId: season.id,
    sport,
    season: seasonYear,
    week,
    rosteredPlayers: playerIds.length,
    cacheRowsRead: 0,
    scoresUpserted: 0,
    missingCachePlayerIds: [],
    missingWeekPlayerIds: [],
    missingStatPlayerIds: [],
    weekStatsFromProvider: 0,
    warnings: [],
  }

  if (!playerIds.length) {
    summary.warnings.push('No rostered players found for this redraft season.')
    await recordScoreSyncAudit(summary, params.actorId ?? 'system')
    return summary
  }

  const cachedRows = isDailySport
    ? []
    : await prisma.playerGameLogCache.findMany({
        where: {
          playerId: { in: playerIds },
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
    const seasonStartUtc = params.seasonStartUtc ?? resolveDailySportSeasonStart(sport, seasonYear)
    const window = weekWindowFromSeasonStart(seasonStartUtc, week)
    if (!window) {
      // Decline rather than run a query that cannot be right. Inventing a start
      // date would silently mis-assign every game to the wrong week, which is
      // worse than scoring nothing and saying so.
      const known = knownDailySportSeasons(sport)
      summary.warnings.push(
        `${sport} is a daily sport: a week is a date range, and scoring one needs the regular-season ` +
          `start date. None was supplied and none is recorded for season ${seasonYear}` +
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
    const bridge = await bridgeRosterIdsToGameLogIds(prisma, candidateSportKeys(sport), playerIds)
    summary.gameLogIdsBridged = bridge.bridged
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
      select: { playerId: true, normalizedStatMap: true, sportType: true, season: true, gameDate: true },
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
    }
    summary.cacheRowsRead = gameRows.length
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
  const teamDefensePlayerIds = playerIds.filter((id) => isTeamDefenseRow(id, positionByPlayer.get(id) ?? null))
  const gameByTeam = new Map<string, { homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null }>()
  if (teamDefensePlayerIds.length > 0) {
    const rawGames = await prisma.sportsGame.findMany({
      where: { sport: { in: candidateSportKeys(sport) }, season: seasonYear, week },
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
        !isTeamDefenseRow(id, positionByPlayer.get(id) ?? null) &&
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

    if (isTeamDefenseRow(playerId, position)) {
      const cached = cacheByPlayer.get(playerId)
      const weekPayload = cached ? findCachedWeekPayload(cached.payload, week) : null
      const stats: Record<string, number> = weekPayload ? normalizeNflTeamDefenseWeeklyStats(weekPayload) : {}

      // Derive points allowed from the game result when the box-score feed did
      // not already provide it.
      if (stats.def_points_allowed === undefined) {
        const team = teamAbbrevFromDefPlayerId(playerId) ?? String(teamByPlayer.get(playerId) ?? '').trim().toUpperCase()
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
