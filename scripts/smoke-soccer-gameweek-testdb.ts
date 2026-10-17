/**
 * Soccer gameweeks, end to end on the known test database: schedule sync -> weekly score sync ->
 * week finalizer, for a synthetic four-team European soccer league.
 *
 *   1. The REAL `syncRiSeasonSchedule` runs over the committed EPL / La Liga / Serie A schedule
 *      fixtures through an injected fetch — a placeholder token, no network, nothing leaves.
 *   2. Every starter gets one stored Rolling Insights box line in gameweek 5 (11–17 Sep 2026), in
 *      the shape production stores, keyed on a `PlayerIdentityMap` row the roster id bridges to.
 *   3. The real weekly sync scores them against the league's scoring panel, and the real finalizer
 *      seals gameweek 5 from the three-league schedule — with La Liga's postponed fixture in it.
 *   4. Gameweek 7 is the one AFTER the international break: it must refuse as "games not final"
 *      (its games are on 9–15 Oct), never "no games on slate" — the empty 25 Sep – 8 Oct windows
 *      belong to no gameweek.
 *
 * Never accepts a production host. Run with DATABASE_URL naming the test DB and shared Redis
 * explicitly empty. Every row it creates is removed, and it refuses to run over schedule rows it did
 * not write.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { prisma } from '../lib/prisma'
import { validateCreatePayload } from '../lib/league-creation/canonical/validateCreateLeague'
import { runPresetEngine } from '../lib/league-creation/preset-engine/runPresetEngine'
import { createCanonicalLeagueInTransaction } from '../lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { createDefaultLeagueRosterConfig } from '../lib/roster-engine/UnifiedRosterConfigService'
import { syncCompletedDraftToRedraftSeason } from '../lib/redraft/finalizeDraftToRedraftSeason'
import { syncPlayerWeeklyScoresForRedraftSeason } from '../lib/redraft/playerWeeklyScoreService'
import { finalizeRedraftWeek } from '../lib/redraft/weekFinalizer'
import { scheduleKeyPrefix, syncRiSeasonSchedule } from '../lib/sports-data/riSeasonSchedule'
import { resolveDailySportWeekWindow } from '../lib/season-week/dailySportSeasonStarts'
import { configureEventInfrastructure, InMemoryOutboxStore } from '../lib/events'

const check = (ok: unknown, label: string) => { if (!ok) throw new Error(label) }
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

const SEASON = 2026
const GAMEWEEK = 5
const LEAGUES = ['EPL', 'LALIGA', 'SERIEA'] as const
const PREFIX = scheduleKeyPrefix('SOCCER', SEASON)

const fixture = (league: string) =>
  JSON.parse(readFileSync(path.join(process.cwd(), 'contracts/rolling-insights/fixtures', `schedule-season.SOCCER.${league}.json`), 'utf8'))

/** The four starter lines whose points are asserted, on the AF default panel. */
const LINES = {
  // goal 6 + assist 3 + 2 on target x0.5 + 4 shots x0.2 + 90 min x0.02 + yellow -1
  striker: { group: 'fielders', position: 'Forward', stats: { goals: 1, assists: 1, shots_attempted: 4, shots_on_goal: 2, minutes_played: 90, yellow_cards: 1 }, points: 6 + 3 + 1 + 0.8 + 1.8 - 1 },
  // clean sheet 4 + 4 saves x0.5 + 90 min x0.02
  keeper: { group: 'goalkeepers', position: 'Goalkeeper', stats: { clean_sheets: 1, saves: 4, goals_conceded: 0, penalties_faced: 0, penalties_saved: 0, minutes_played: 90 }, points: 4 + 2 + 1.8 },
  // clean sheet 4 + 90 min x0.02
  defender90: { group: 'fielders', position: 'Defender', stats: { clean_sheets: 1, minutes_played: 90 }, points: 4 + 1.8 },
  // the vendor flags his clean sheet too; he played 12 minutes, so it does not count: 12 x0.02
  defender12: { group: 'fielders', position: 'Defender', stats: { clean_sheets: 1, minutes_played: 12 }, points: 0.24 },
} as const
const ZEROES = { goals: 0, assists: 0, red_cards: 0, fouls_drawn: 0, yellow_cards: 0, shots_on_goal: 0, free_kicks_won: 0, fouls_committed: 0, shots_attempted: 0, penalties_scored: 0, penalty_attempts: 0 }

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? '').hostname
  check(host.startsWith('ep-muddy-leaf-') && host.endsWith('.neon.tech'), 'KNOWN_TEST_DATABASE_REQUIRED')
  check(!process.env.UPSTASH_REDIS_REST_URL && !process.env.UPSTASH_REDIS_REST_TOKEN, 'SHARED_REDIS_MUST_BE_DISABLED')
  configureEventInfrastructure({ outboxStore: new InMemoryOutboxStore() })
  // A placeholder for the injected fetch below; a real token is never read or sent.
  process.env.ROLLING_INSIGHTS_RSC_TOKEN = ''
  process.env.ROLLING_INSIGHTS_RSC_TOKEN2 = 'smoke-placeholder-not-a-token'

  const preexisting = await prisma.sportsDataCache.count({ where: { cacheKey: { startsWith: PREFIX } } })
  check(preexisting === 0, 'SOCCER_SCHEDULE_ALREADY_PRESENT:' + preexisting)

  const marker = 'soccergw-' + randomUUID().slice(0, 8)
  const users: string[] = []
  const leagues: string[] = []
  const identityIds: string[] = []
  const startedAt = new Date()
  const report: Record<string, unknown> = {}
  let gameStatIds: string[] = []
  const fetchedLeagues: string[] = []

  try {
    // ── 1. The real schedule sync, fed the committed fixtures ───────────────────────────────────
    const fetchImpl = (async (input: string | URL) => {
      const url = new URL(String(input))
      const league = url.searchParams.get('league') ?? ''
      check(url.hostname.endsWith('rolling-insights.com') && (LEAGUES as readonly string[]).includes(league), 'UNEXPECTED_FETCH')
      fetchedLeagues.push(league)
      return new Response(JSON.stringify(fixture(league)), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    const sync = await syncRiSeasonSchedule({ sport: 'SOCCER', season: SEASON, db: prisma as never, fetchImpl })
    check(sync.fetched && sync.error == null, 'SCHEDULE_SYNC:' + JSON.stringify(sync))
    check(fetchedLeagues.join(',') === 'EPL,LALIGA,SERIEA', 'LEAGUES_FETCHED:' + fetchedLeagues.join(','))
    report.scheduleSync = { games: sync.games, days: sync.days, statusCounts: sync.statusCounts }

    const window = resolveDailySportWeekWindow('SOCCER', SEASON, GAMEWEEK)!
    const gwGames = LEAGUES.flatMap((l) => (fixture(l).data[l] as Array<{ game_ID: string; status: string }>))
      .filter((g) => g.game_ID.slice(0, 8) >= '20260911' && g.game_ID.slice(0, 8) < '20260918')
    const completed = gwGames.filter((g) => g.status === 'completed')
    check(gwGames.some((g) => g.status === 'postponed'), 'GW5_HOLDS_THE_POSTPONED_FIXTURE')

    // ── 2. League, draft, finalization ──────────────────────────────────────────────────────────
    for (let i = 0; i < 4; i++) users.push((await prisma.appUser.create({ data: { username: `${marker}-${i}`, email: `${marker}-${i}@example.invalid` } })).id)
    const v = validateCreatePayload({ concept: 'redraft', sport: 'SOCCER', soccerPipeline: 'euro', teamCount: 4, draftType: 'snake', scoringPreset: 'af_default', leagueName: marker, timezone: 'America/New_York', conceptSetup: {} })
    if (!v.ok) throw new Error('CREATION_' + v.error)
    const leagueId = (await prisma.$transaction((tx) => createCanonicalLeagueInTransaction(tx, users[0]!, v.data, runPresetEngine({ ...v.data, commissionerId: users[0]! })), { timeout: 120000 })).leagueId
    leagues.push(leagueId)
    await createDefaultLeagueRosterConfig(leagueId, 'SOCCER', 'redraft')
    const generic = (await prisma.roster.findMany({ where: { leagueId }, orderBy: { id: 'asc' } }))
      .sort((a, b) => Number(b.platformUserId === users[0]) - Number(a.platformUserId === users[0]))
    for (let i = 0; i < 4; i++) {
      await prisma.leagueTeam.updateMany({ where: { leagueId, platformUserId: generic[i]!.platformUserId }, data: { platformUserId: users[i], claimedByUserId: users[i] } })
      await prisma.roster.update({ where: { id: generic[i]!.id }, data: { platformUserId: users[i] } })
    }

    // Eleven starters a team (GK, 4 DEF, 4 MID, 2 FWD), each a numeric Rolling Insights id.
    const STARTING = ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD'] as const
    const draft = await prisma.draftSession.findFirstOrThrow({ where: { leagueId } })
    const base = 800000000 + Math.floor(Math.random() * 90000000)
    const riIdFor = (overall: number) => String(base + overall)
    const starterOf = new Map<string, { owner: number; slot: string; idx: number }>()
    const picks = Array.from({ length: draft.rounds * 4 }, (_, i) => {
      const round = Math.floor(i / 4), slot = i % 4, owner = round % 2 === 0 ? slot : 3 - slot
      const position = STARTING[round] ?? 'MID'
      const playerId = riIdFor(i + 1)
      if (round < STARTING.length) starterOf.set(playerId, { owner, slot: position, idx: round })
      return { sessionId: draft.id, overall: i + 1, round: round + 1, slot: owner + 1, rosterId: generic[owner]!.id, playerId, playerName: playerId, position, sportType: 'SOCCER', source: 'simulation_fixture' }
    })
    await prisma.draftPick.createMany({ data: picks })
    await prisma.draftSession.update({ where: { id: draft.id }, data: { status: 'completed' } })
    await syncCompletedDraftToRedraftSeason(leagueId)
    const season = await prisma.redraftSeason.findFirstOrThrow({ where: { leagueId } })
    report.season = { sport: season.sport, season: season.season }
    check(season.season === SEASON, 'SEASON_YEAR:' + season.season)

    // Starters: the draft sync benches hand-written picks (see smoke-ncaaf-weekly-scoring-testdb.ts).
    for (const [playerId, s] of starterOf) {
      await prisma.redraftRosterPlayer.updateMany({ where: { roster: { seasonId: season.id }, playerId }, data: { slotType: s.slot } })
    }
    await prisma.redraftRosterPlayer.updateMany({ where: { roster: { seasonId: season.id }, playerId: { notIn: [...starterOf.keys()] } }, data: { slotType: 'bench' } })

    // ── 3. One stored box line per starter in gameweek 5, keyed as the ingest keys them ────────
    const named = new Map<string, keyof typeof LINES>()
    const team0 = [...starterOf.entries()].filter(([, s]) => s.owner === 0)
    named.set(team0.find(([, s]) => s.slot === 'FWD')![0], 'striker')
    named.set(team0.find(([, s]) => s.slot === 'GK')![0], 'keeper')
    const defs = team0.filter(([, s]) => s.slot === 'DEF').map(([id]) => id)
    named.set(defs[0]!, 'defender90')
    named.set(defs[1]!, 'defender12')
    const rows = [] as Parameters<typeof prisma.playerGameStat.createMany>[0]['data'] & unknown[]
    let n = 0
    for (const [riId, s] of starterOf) {
      const identity = await prisma.playerIdentityMap.create({
        data: { canonicalName: `${marker} ${riId}`, normalizedName: `${marker} ${riId}`, sport: 'SOCCER', rollingInsightsId: riId, position: s.slot },
      })
      identityIds.push(identity.id)
      const game = completed[n++ % completed.length]!
      const key = named.get(riId)
      const line = key
        ? LINES[key]
        : s.slot === 'GK'
          ? { group: 'goalkeepers', position: 'Goalkeeper', stats: { minutes_played: 90, saves: 1, goals_conceded: 1, clean_sheets: 0 } }
          : { group: 'fielders', position: s.slot === 'DEF' ? 'Defender' : s.slot === 'MID' ? 'Midfielder' : 'Forward', stats: { minutes_played: 70 } }
      const stats = { ...ZEROES, ...line.stats, player_id: Number(riId) }
      ;(rows as unknown[]).push({
        playerId: identity.id, sportType: 'SOCCER', gameId: `${game.game_ID}:${line.group}`, season: SEASON, weekOrRound: 0,
        providerPlayerId: riId, providerGameId: game.game_ID, source: 'rolling_insights',
        statPayload: stats, normalizedStatMap: { group: line.group, position: line.position, positionCategory: null, scored: false, status: null, stats },
        gameDate: new Date(`${game.game_ID.slice(0, 4)}-${game.game_ID.slice(4, 6)}-${game.game_ID.slice(6, 8)}T00:00:00.000Z`),
      })
    }
    await prisma.playerGameStat.createMany({ data: rows as never })
    gameStatIds = (await prisma.playerGameStat.findMany({ where: { playerId: { in: identityIds } }, select: { id: true } })).map((r) => r.id)
    check(gameStatIds.length === starterOf.size, 'STAT_ROWS:' + gameStatIds.length)

    // ── 4. The code under test: weekly sync, then the finalizer ────────────────────────────────
    const summary = await syncPlayerWeeklyScoresForRedraftSeason({ seasonId: season.id, week: GAMEWEEK, actorId: 'system:soccer-smoke' })
    const scores = await prisma.playerWeeklyScore.findMany({ where: { playerId: { in: [...starterOf.keys()] }, season: SEASON, week: GAMEWEEK } })
    const byId = new Map(scores.map((s) => [s.playerId, s.fantasyPts]))
    const missing = [...starterOf.keys()].filter((id) => !byId.has(id))
    check(missing.length === 0, 'UNSCORED_STARTERS:' + JSON.stringify({
      missing: missing.map((id) => ({ id, ...starterOf.get(id), named: named.get(id) ?? null })),
      summary: { scoresUpserted: summary.scoresUpserted, missing: (summary as { missingStatPlayerIds?: string[] }).missingStatPlayerIds?.length, warnings: summary.warnings?.slice(0, 4) },
    }))
    const asserted: Record<string, number | undefined> = {}
    for (const [riId, key] of named) {
      asserted[key] = byId.get(riId)
      check(byId.has(riId) && near(byId.get(riId)!, LINES[key].points), `POINTS_${key}:${byId.get(riId)} expected ${LINES[key].points}`)
    }
    check(scores.length === starterOf.size, `ALL_STARTERS_SCORED:${scores.length}/${starterOf.size}`)
    check(scores.every((s) => s.sport === season.sport), 'STORED_UNDER_SEASON_SPORT_KEY')

    const sealed = await finalizeRedraftWeek({ seasonId: season.id, week: GAMEWEEK })
    check(sealed.refusal == null && sealed.finalized, 'GW5_SEAL:' + JSON.stringify({ refusal: sealed.refusal, slate: sealed.slate, coverage: sealed.coverage }))
    check(sealed.slate?.source === 'rolling_insights_schedule', 'SLATE_FROM_RI_SCHEDULE:' + sealed.slate?.source)
    check(sealed.slate?.games === gwGames.length && sealed.slate?.unfinished === 0, 'GW5_SLATE:' + JSON.stringify(sealed.slate))
    check(sealed.slate?.final === completed.length, 'GW5_FINALS:' + sealed.slate?.final)

    // Gameweek 7 follows the international break: its games are scheduled, so it waits — it is not empty.
    const afterBreak = await finalizeRedraftWeek({ seasonId: season.id, week: 7, dryRun: true })
    check(afterBreak.refusal === 'games_not_final', 'GW7_REFUSAL:' + afterBreak.refusal)
    const gw7 = resolveDailySportWeekWindow('SOCCER', SEASON, 7)!

    Object.assign(report, {
      gameweek5: { window: [window.start.toISOString().slice(0, 10), window.end.toISOString().slice(0, 10)], slate: sealed.slate, coverage: sealed.coverage, finalized: sealed.finalized },
      assertedPoints: asserted,
      starters: starterOf.size,
      syncSummary: { scoresUpserted: summary.scoresUpserted, cacheRowsRead: summary.cacheRowsRead, warnings: summary.warnings?.slice(0, 3) },
      gameweek7: { window: [gw7.start.toISOString().slice(0, 10), gw7.end.toISOString().slice(0, 10)], refusal: afterBreak.refusal, slate: afterBreak.slate },
    })
  } finally {
    await prisma.playerWeeklyScore.deleteMany({ where: { season: SEASON, sport: 'SOCCER', week: { in: [GAMEWEEK, 7] }, updatedAt: { gte: startedAt } } })
    if (identityIds.length) await prisma.playerGameStat.deleteMany({ where: { playerId: { in: identityIds } } })
    if (identityIds.length) await prisma.playerIdentityMap.deleteMany({ where: { id: { in: identityIds } } })
    await prisma.sportsDataCache.deleteMany({ where: { cacheKey: { startsWith: PREFIX }, createdAt: { gte: startedAt } } }).catch(() =>
      prisma.sportsDataCache.deleteMany({ where: { cacheKey: { startsWith: PREFIX } } }),
    )
    await prisma.league.deleteMany({ where: { id: { in: leagues } } })
    await prisma.appUser.deleteMany({ where: { id: { in: users } } })
    const cleanup = {
      weeklyScores: await prisma.playerWeeklyScore.count({ where: { season: SEASON, sport: 'SOCCER', week: { in: [GAMEWEEK, 7] }, updatedAt: { gte: startedAt } } }),
      gameStats: identityIds.length ? await prisma.playerGameStat.count({ where: { playerId: { in: identityIds } } }) : 0,
      identities: identityIds.length ? await prisma.playerIdentityMap.count({ where: { id: { in: identityIds } } }) : 0,
      schedule: await prisma.sportsDataCache.count({ where: { cacheKey: { startsWith: PREFIX } } }),
      leagues: await prisma.league.count({ where: { id: { in: leagues } } }),
      users: await prisma.appUser.count({ where: { id: { in: users } } }),
    }
    check(Object.values(cleanup).every((c) => c === 0), 'CLEANUP:' + JSON.stringify(cleanup))
    console.log(JSON.stringify({ target: 'known test DB', report, cleanup }, null, 2))
    await prisma.$disconnect()
  }
}
main().catch((e) => { console.error('Soccer gameweek smoke failed:', e.code ?? e.message); process.exitCode = 1 })
