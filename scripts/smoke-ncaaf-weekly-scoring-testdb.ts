/**
 * NCAAF weekly scoring, end to end on the known test database.
 *
 * The committed CFBD `/games/players` fixture (week 3, 2026) is written into `player_game_stats`
 * through the REAL scheduled-ingest call (`ingestSportStats`, exactly as `cfbdGameLogs.ts` flushes
 * it). A synthetic four-team NCAAF redraft league then drafts three real CFBD athletes, each reaching
 * its game log a different way:
 *
 *   QB  Jared Curtis    roster id = CFBD id, via a `SportsPlayer` row with source 'cfbd'
 *   RB  Arnold Barnes   roster id = a Rolling Insights id, via `PlayerIdentityMap.cfbdId`
 *   WR  Jaxton Santiago roster id = his bare CFBD id with NO provenance row — must NOT be scored
 *
 * and the real weekly sync and roster scorer run over it. Never accepts a production host. Run with
 * DATABASE_URL naming the test DB and shared Redis explicitly empty. Every row it creates is removed.
 */
import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { validateCreatePayload } from '../lib/league-creation/canonical/validateCreateLeague'
import { runPresetEngine } from '../lib/league-creation/preset-engine/runPresetEngine'
import { createCanonicalLeagueInTransaction } from '../lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { createDefaultLeagueRosterConfig } from '../lib/roster-engine/UnifiedRosterConfigService'
import { syncCompletedDraftToRedraftSeason } from '../lib/redraft/finalizeDraftToRedraftSeason'
import { syncPlayerWeeklyScoresForRedraftSeason } from '../lib/redraft/playerWeeklyScoreService'
import { scoreRosterForWeek } from '../lib/redraft/scoringEngine'
import { ingestSportStats } from '../lib/schedule-stats'
import { parseCfbdGamePlayers, CFBD_GAME_LOG_SOURCE } from '../lib/stats/cfbdGameLogs'
import { configureEventInfrastructure, InMemoryOutboxStore } from '../lib/events'
import fixture from '../__tests__/fixtures/cfbd/games-players.2026-w3.sample.json'

const check = (ok: unknown, label: string) => { if (!ok) throw new Error(label) }
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

const SEASON = 2026
const WEEK = 3
const QB = '5158948' // Jared Curtis: 277 pass yds, 3 TD, 2 INT, 64 rush yds, 1 fumble lost -> 23.48
const RB_CFBD = '5110516' // Arnold Barnes: 63 rush yds, 2 TD -> 18.3
const WR = '5147449' // Jaxton Santiago: 12-234-2 receiving; unlinked, so unscored

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? '').hostname
  check(host.startsWith('ep-muddy-leaf-') && host.endsWith('.neon.tech'), 'KNOWN_TEST_DATABASE_REQUIRED')
  check(!process.env.UPSTASH_REDIS_REST_URL && !process.env.UPSTASH_REDIS_REST_TOKEN, 'SHARED_REDIS_MUST_BE_DISABLED')
  configureEventInfrastructure({ outboxStore: new InMemoryOutboxStore() })

  const marker = 'ncaafws-' + randomUUID().slice(0, 8)
  const riId = String(900000000 + Math.floor(Math.random() * 99999999))
  const parsed = parseCfbdGamePlayers(fixture)
  const gameIds = [...new Set(parsed.map((r) => r.gameId))]
  const users: string[] = []
  const leagues: string[] = []
  const createdPoolIds: string[] = []
  let identityId: string | null = null
  const startedAt = new Date()
  const report: Record<string, unknown> = {}

  // Refuse to touch CFBD game rows this run did not write.
  const preexisting = await prisma.playerGameStat.count({ where: { sportType: 'NCAAF', gameId: { in: gameIds } } })
  check(preexisting === 0, 'FIXTURE_GAMES_ALREADY_PRESENT:' + preexisting)
  try {
    // ── The scheduled ingest's own call, on the vendor fixture ───────────────────────────────
    await ingestSportStats({
      sportType: 'NCAAF',
      season: SEASON,
      weekOrRound: WEEK,
      source: CFBD_GAME_LOG_SOURCE,
      playerStats: parsed.map((r) => ({ playerId: r.playerId, gameId: r.gameId, statPayload: r.statPayload as Record<string, number>, gameDate: null })),
    })
    const written = await prisma.playerGameStat.count({ where: { sportType: 'NCAAF', gameId: { in: gameIds } } })
    check(written === parsed.length, `INGESTED:${written}/${parsed.length}`)

    // ── Provenance rows: Curtis is a CFBD pool player; Barnes is an RI player linked by identity ─
    const existingQbPool = await prisma.sportsPlayer.findFirst({ where: { sport: 'NCAAF', externalId: QB, source: 'cfbd' }, select: { id: true } })
    if (!existingQbPool) {
      createdPoolIds.push((await prisma.sportsPlayer.create({ data: { sport: 'NCAAF', externalId: QB, source: 'cfbd', name: 'Jared Curtis', position: 'QB', team: 'Vanderbilt', expiresAt: new Date(Date.now() + 86400000) } })).id)
    }
    const wrLinked = await prisma.sportsPlayer.count({ where: { sport: 'NCAAF', externalId: WR, source: 'cfbd' } })
      + await prisma.playerIdentityMap.count({ where: { sport: { in: ['NCAAF', 'NCAAFB'] }, OR: [{ rollingInsightsId: WR }, { cfbdId: WR }] } })
    check(wrLinked === 0, 'WR_CONTROL_ALREADY_LINKED') // the negative control only means something if he is unlinked
    identityId = (await prisma.playerIdentityMap.create({
      data: { canonicalName: `${marker} Arnold Barnes`, normalizedName: `${marker} arnold barnes`, sport: 'NCAAF', rollingInsightsId: riId, cfbdId: RB_CFBD, position: 'RB' },
    })).id

    // ── League, draft, finalization ──────────────────────────────────────────────────────────
    for (let i = 0; i < 4; i++) users.push((await prisma.appUser.create({ data: { username: `${marker}-${i}`, email: `${marker}-${i}@example.invalid` } })).id)
    const v = validateCreatePayload({ concept: 'redraft', sport: 'NCAAF', teamCount: 4, draftType: 'snake', scoringPreset: 'ncaaf_ppr', leagueName: marker, timezone: 'America/Chicago', conceptSetup: {} })
    if (!v.ok) throw new Error('CREATION_' + v.error)
    const leagueId = (await prisma.$transaction((tx) => createCanonicalLeagueInTransaction(tx, users[0]!, v.data, runPresetEngine({ ...v.data, commissionerId: users[0]! })), { timeout: 120000 })).leagueId
    leagues.push(leagueId)
    await createDefaultLeagueRosterConfig(leagueId, 'NCAAF', 'redraft')
    const generic = (await prisma.roster.findMany({ where: { leagueId }, orderBy: { id: 'asc' } }))
      .sort((a, b) => Number(b.platformUserId === users[0]) - Number(a.platformUserId === users[0]))
    for (let i = 0; i < 4; i++) {
      await prisma.leagueTeam.updateMany({ where: { leagueId, platformUserId: generic[i]!.platformUserId }, data: { platformUserId: users[i], claimedByUserId: users[i] } })
      await prisma.roster.update({ where: { id: generic[i]!.id }, data: { platformUserId: users[i] } })
    }
    const draft = await prisma.draftSession.findFirstOrThrow({ where: { leagueId } })
    const positions = ['QB', 'RB', 'WR', 'WR', 'TE', 'RB', 'WR', 'K', 'QB', 'RB', 'WR', 'TE', 'RB', 'WR', 'RB', 'WR', 'QB', 'TE']
    const special: Record<string, { playerId: string; position: string }> = {
      '0:0': { playerId: QB, position: 'QB' }, // team 0, round 1
      '1:0': { playerId: riId, position: 'RB' }, // team 0, round 2
      '0:1': { playerId: WR, position: 'WR' }, // team 1, round 1
    }
    const picks = Array.from({ length: draft.rounds * 4 }, (_, i) => {
      const round = Math.floor(i / 4), slot = i % 4, owner = round % 2 === 0 ? slot : 3 - slot
      const s = special[`${round}:${owner}`]
      const playerId = s?.playerId ?? `${marker}-p-${i}`
      return { sessionId: draft.id, overall: i + 1, round: round + 1, slot: owner + 1, rosterId: generic[owner]!.id, playerId, playerName: playerId, position: s?.position ?? positions[round % positions.length]!, sportType: 'NCAAF', source: 'simulation_fixture' }
    })
    await prisma.draftPick.createMany({ data: picks })
    await prisma.draftSession.update({ where: { id: draft.id }, data: { status: 'completed' } })
    await syncCompletedDraftToRedraftSeason(leagueId)
    const season = await prisma.redraftSeason.findFirstOrThrow({ where: { leagueId } })
    report.seasonSport = season.sport

    // ── The change under test ────────────────────────────────────────────────────────────────
    const summary = await syncPlayerWeeklyScoresForRedraftSeason({ seasonId: season.id, week: WEEK, actorId: 'system:ncaaf-smoke' })
    const scores = await prisma.playerWeeklyScore.findMany({ where: { playerId: { in: [QB, riId, WR] }, season: SEASON, week: WEEK } })
    const byId = new Map(scores.map((s) => [s.playerId, s]))
    const qb = byId.get(QB), rb = byId.get(riId)
    check(qb && near(qb.fantasyPts, 277 * 0.04 + 3 * 4 + 2 * -2 + 64 * 0.1 + 1 * -2), 'QB_POINTS:' + qb?.fantasyPts)
    check(rb && near(rb.fantasyPts, 63 * 0.1 + 2 * 6), 'RB_VIA_IDENTITY_POINTS:' + rb?.fantasyPts)
    check(qb!.sport === season.sport && rb!.sport === season.sport, 'STORED_UNDER_SEASON_SPORT_KEY')
    check(!byId.has(WR), 'UNLINKED_WR_MUST_NOT_SCORE')
    check(summary.unresolvedCfbdPlayerIds?.includes(WR), 'UNLINKED_WR_REPORTED')

    /*
     * The roster scorer reads what the sync wrote. The picks above were hand-written, so the generic
     * roster carries no `playerData.starters` and finalization benched everyone (the real draft flow
     * fills it — see smoke-guillotine-season-end-testdb.ts). Starting the two scored players is the
     * fixture's job, not the code under test; the assertion is mandatory, not skipped when they sit.
     */
    const team0 = await prisma.redraftRoster.findFirstOrThrow({ where: { seasonId: season.id, ownerId: users[0]! } })
    await prisma.redraftRosterPlayer.updateMany({ where: { rosterId: team0.id }, data: { slotType: 'bench' } })
    await prisma.redraftRosterPlayer.updateMany({ where: { rosterId: team0.id, playerId: QB }, data: { slotType: 'QB' } })
    await prisma.redraftRosterPlayer.updateMany({ where: { rosterId: team0.id, playerId: riId }, data: { slotType: 'RB' } })
    const slots = await prisma.redraftRosterPlayer.findMany({ where: { rosterId: team0.id, playerId: { in: [QB, riId] } }, select: { playerId: true, slotType: true } })
    const rosterScore = await scoreRosterForWeek({ leagueId, rosterId: team0.id, week: WEEK, seasonYear: SEASON })
    check(near(rosterScore.points, qb!.fantasyPts + rb!.fantasyPts), `ROSTER_SCORE:${rosterScore.points}`)
    const bothStart = true

    Object.assign(report, {
      ingestedRows: written,
      qbPoints: qb!.fantasyPts,
      rbViaIdentityPoints: rb!.fantasyPts,
      unlinkedWrScored: false,
      syncSummary: { scoresUpserted: summary.scoresUpserted, cfbdIdsResolved: summary.cfbdIdsResolved, unresolved: summary.unresolvedCfbdPlayerIds?.length, cacheRowsRead: summary.cacheRowsRead },
      team0Slots: slots,
      team0RosterScore: rosterScore.points,
      rosterScoreChecked: bothStart,
    })
  } finally {
    await prisma.playerWeeklyScore.deleteMany({ where: { season: SEASON, week: WEEK, playerId: { in: [QB, WR, riId] }, updatedAt: { gte: startedAt } } })
    await prisma.playerGameStat.deleteMany({ where: { sportType: 'NCAAF', gameId: { in: gameIds } } })
    await prisma.statIngestionJob.deleteMany({ where: { sportType: 'NCAAF', season: SEASON, weekOrRound: WEEK, source: CFBD_GAME_LOG_SOURCE, startedAt: { gte: startedAt } } })
    if (identityId) await prisma.playerIdentityMap.deleteMany({ where: { id: identityId } })
    if (createdPoolIds.length) await prisma.sportsPlayer.deleteMany({ where: { id: { in: createdPoolIds } } })
    await prisma.league.deleteMany({ where: { id: { in: leagues } } })
    await prisma.appUser.deleteMany({ where: { id: { in: users } } })
    const cleanup = {
      gameStats: await prisma.playerGameStat.count({ where: { sportType: 'NCAAF', gameId: { in: gameIds } } }),
      weeklyScores: await prisma.playerWeeklyScore.count({ where: { season: SEASON, week: WEEK, playerId: { in: [QB, WR, riId] }, updatedAt: { gte: startedAt } } }),
      ingestionJobs: await prisma.statIngestionJob.count({ where: { sportType: 'NCAAF', season: SEASON, weekOrRound: WEEK, source: CFBD_GAME_LOG_SOURCE, startedAt: { gte: startedAt } } }),
      identity: identityId ? await prisma.playerIdentityMap.count({ where: { id: identityId } }) : 0,
      pool: createdPoolIds.length ? await prisma.sportsPlayer.count({ where: { id: { in: createdPoolIds } } }) : 0,
      leagues: await prisma.league.count({ where: { id: { in: leagues } } }),
      users: await prisma.appUser.count({ where: { id: { in: users } } }),
    }
    check(Object.values(cleanup).every((n) => n === 0), 'CLEANUP:' + JSON.stringify(cleanup))
    console.log(JSON.stringify({ target: 'known test DB', report, cleanup }, null, 2))
    await prisma.$disconnect()
  }
}
main().catch((e) => { console.error('NCAAF weekly scoring smoke failed:', e.code ?? e.message); process.exitCode = 1 })
