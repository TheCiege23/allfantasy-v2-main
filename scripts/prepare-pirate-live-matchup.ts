/** Opt-in persistent QA league: real provider players/calendar, synthetic managers only. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'

assert.equal(process.env.PIRATE_LIVE_REHEARSAL_CREATE, '1', 'Explicit opt-in required')
const stage = dotenv.parse(fs.readFileSync(process.env.PIRATE_STAGING_ENV || 'G:/allfantasy-v2-main/.env.staging'))
assert(new URL(stage.DATABASE_URL).hostname.replace('-pooler', '').includes('winter-salad'), 'Isolated staging required')
Object.assign(process.env, stage, { DATABASE_URL: stage.DATABASE_URL, DIRECT_URL: stage.DATABASE_URL, NODE_ENV: 'test' })
const RuntimeClient: typeof PrismaClient = process.env.PIRATE_PRISMA_CLIENT
  ? createRequire(`${process.cwd()}/package.json`)(process.env.PIRATE_PRISMA_CLIENT).PrismaClient : PrismaClient
const db = new RuntimeClient({ datasources: { db: { url: stage.DATABASE_URL } } })
;(globalThis as unknown as { prisma: PrismaClient }).prisma = db
const tag = `pirate-capture-live-${randomUUID().slice(0, 8)}`
const users: string[] = []
let leagueId: string | undefined
let complete = false
async function run() {
  const games = await db.sportsGame.findMany({ where: { sport: 'NFL', season: 2026, seasonType: 'regular',
    startTime: { gt: new Date(), lt: new Date(Date.now() + 8 * 86400000) }, week: { not: null } }, orderBy: { startTime: 'asc' } })
  assert(games.length > 0 && games[0].week && games[0].startTime, 'A real upcoming NFL slate is required')
  const week = games[0].week
  const firstLock = games[0].startTime
  assert(firstLock.getTime() - Date.now() > 15 * 60000, 'Must prepare before the evidence window')
  const { getAllPlayers } = await import('../lib/sleeper-client')
  const payload = await getAllPlayers()
  assert(Object.keys(payload).length > 0, 'Canonical player ingestion client must return identities')
  const names = ['Jordan Love', 'Bryce Young', 'Josh Allen', 'Lamar Jackson', 'Joe Burrow', 'Bo Nix', 'Justin Herbert', 'Jalen Hurts']
  const players = names.map(name => {
    const matches = Object.values(payload).filter(p => p.full_name === name && p.position === 'QB' && p.team)
    assert.equal(matches.length, 1, `Unambiguous current identity required for ${name}`)
    return matches[0]
  })
  // Persist genuine provider records only. No injury status or game outcome is manufactured.
  for (const player of players) await db.sportsPlayer.upsert({
    where: { sport_externalId_source: { sport: 'NFL', externalId: `sleeper:${player.player_id}`, source: 'sleeper' } },
    create: { sport: 'NFL', externalId: `sleeper:${player.player_id}`, sleeperId: player.player_id, source: 'sleeper',
      name: player.full_name, position: 'QB', team: player.team, status: player.status ?? null, fetchedAt: new Date(), expiresAt: new Date(Date.now() + 10 * 86400000) },
    update: { sleeperId: player.player_id, name: player.full_name, position: 'QB', team: player.team,
      status: player.status ?? null, fetchedAt: new Date(), expiresAt: new Date(Date.now() + 10 * 86400000) },
  })
  const [{ createActorContext }, { createStagingLeagueFixture }] = await Promise.all([
    import('../lib/domain/actorContext'), import('../lib/domain/stagingLeagueFixture'),
  ])
  for (let i = 0; i < 4; i++) users.push((await db.appUser.create({ data: {
    email: `${tag}-${i}@example.invalid`, username: `${tag}_${i}`, displayName: `Live QA ${i + 1}`,
  } })).id)
  const actor = createActorContext({ userId: users[0], tenantId: tag, actorLabel: 'Pirate real-game rehearsal' })
  assert(actor.ok)
  const league = await createStagingLeagueFixture(db, actor.value, { name: 'Pirate real-game QA — synthetic managers',
    platform: 'manual', platformLeagueId: tag, sport: 'NFL', season: 2026, leagueType: 'pirate', leagueVariant: 'pirate',
    leagueSize: 4, rosterSize: 3, lifecycleState: 'in_season',
    settings: { pirate_live_rehearsal: true, starter_slots: { QB: 1, BN: 2 }, nfl_roster_config: { slots: { QB: 1, BN: 2 } },
      sportConfig: { lineupLockType: 'per_player_kickoff' }, pirate: { protectionLimit: 3, claimHours: 24, selectionHours: 24, overflowGraceHours: 24 } } })
  leagueId = league.id
  const season = await db.redraftSeason.create({ data: { leagueId, sport: 'NFL', season: 2026, status: 'active',
    currentWeek: week, totalWeeks: 14, playoffStartWeek: 15 } })
  const rosters: string[] = []
  for (let i = 0; i < 4; i++) {
    const pair = players.slice(i * 2, i * 2 + 2)
    const emptyStarter = i === 3
    const roster = await db.redraftRoster.create({ data: { leagueId, seasonId: season.id, ownerId: users[i], ownerName: `Live QA ${i + 1}` } })
    rosters.push(roster.id)
    for (let j = 0; j < pair.length; j++) await db.redraftRosterPlayer.create({ data: {
      rosterId: roster.id, playerId: pair[j].player_id, playerName: pair[j].full_name, position: 'QB',
      team: pair[j].team, sport: 'NFL', slotType: j === 0 && !emptyStarter ? 'QB' : 'BENCH',
    } })
    const starters = emptyStarter ? [] : [pair[0].player_id]
    const bench = emptyStarter ? pair : pair.slice(1)
    const legacy = await db.roster.create({ data: { leagueId, platformUserId: users[i], redraftRosterId: roster.id,
      playerData: { players: pair.map(p => p.player_id), starters, lineup_sections: {
        starters: starters.map(id => ({ id, position: 'QB', slotIndex: 0 })), bench: bench.map(p => ({ id: p.player_id, position: 'QB' })),
      } } } })
    await db.afRosterLineupAssignment.createMany({ data: [
      ...starters.map(playerId => ({ leagueId: leagueId!, rosterId: legacy.id, season: 2026, week, playerId, section: 'starters', slotIndex: 0 })),
      ...bench.map((p, index) => ({ leagueId: leagueId!, rosterId: legacy.id, season: 2026, week, playerId: p.player_id, section: 'bench', slotIndex: index })),
    ] })
    await db.pirateProtectionSet.create({ data: { leagueId, seasonId: season.id, week, rosterId: roster.id,
      playerIds: [pair[1].player_id], lockAt: firstLock } })
  }
  for (const i of [0, 2]) await db.redraftMatchup.create({ data: { leagueId, seasonId: season.id, week,
    homeRosterId: rosters[i], awayRosterId: rosters[i + 1], status: 'scheduled' } })
  const report = { preparedAt: new Date().toISOString(), leagueId, seasonId: season.id, tenantId: tag, week,
    firstGameAt: firstLock.toISOString(), lastGameAt: games.filter(g => g.week === week).at(-1)?.startTime?.toISOString(),
    realPlayers: players.map(p => ({ id: p.player_id, name: p.full_name, team: p.team })),
    managers: 'Four uncontactable QA accounts, no human participants',
    cases: ['Legal lineups control matchup', 'Empty QB slot with two bench QBs; penalty depends on captured real availability and a final loss'],
    status: 'prepared; real scoring period has not completed', expiresAt: '2026-11-07T12:00:00Z' }
  fs.writeFileSync(process.env.PIRATE_LIVE_REHEARSAL_REPORT || 'docs/pirate-validation/live-matchup-staging.json', JSON.stringify(report, null, 2))
  complete = true
  console.log(JSON.stringify(report, null, 2))
}
run().catch(error => { console.error('Live matchup preparation failed:', error.name === 'AssertionError' ? error.message : error.code || error.name); process.exitCode = 1 })
  .finally(async () => {
    if (!complete) {
      if (leagueId) await db.league.deleteMany({ where: { id: leagueId, tenantId: tag } })
      await db.appUser.deleteMany({ where: { id: { in: users } } })
      await db.tenant.deleteMany({ where: { id: tag } })
    }
    await db.$disconnect()
  })
