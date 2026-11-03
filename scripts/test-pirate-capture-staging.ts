/** Actual wall-clock capture/claim pipeline on isolated staging with synthetic NFL games and rosters. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'

const stage = dotenv.parse(fs.readFileSync(process.env.PIRATE_STAGING_ENV || 'G:/allfantasy-v2-main/.env.staging'))
const main = dotenv.parse(fs.readFileSync(process.env.PIRATE_PRODUCTION_ENV || 'G:/allfantasy-v2-main/.env'))
const host = new URL(stage.DATABASE_URL).hostname.replace('-pooler', '')
assert(host.includes('winter-salad') && host !== new URL(main.DATABASE_URL).hostname.replace('-pooler', ''), 'Verified separate staging required')
Object.assign(process.env, stage, { DATABASE_URL: stage.DATABASE_URL, DIRECT_URL: stage.DATABASE_URL, NODE_ENV: 'test' })
const RuntimeClient: typeof PrismaClient = process.env.PIRATE_PRISMA_CLIENT
  ? createRequire(`${process.cwd()}/package.json`)(process.env.PIRATE_PRISMA_CLIENT).PrismaClient : PrismaClient
const db = new RuntimeClient({ datasources: { db: { url: stage.DATABASE_URL } } })
;(globalThis as unknown as { prisma: PrismaClient }).prisma = db
const tag = `pirate-capture-${randomUUID().slice(0, 8)}`
const ids = { leagues: [] as string[], users: [] as string[], games: [] as string[], schedules: [] as string[], players: [] as string[], injuries: [] as string[] }

async function run() {
  const coverage = await db.providerSyncState.findFirst({ where: {
    provider: 'injuries-cron', entityType: 'injuries', sport: 'NFL', key: 'lineup-evidence-v2',
  } })
  assert(coverage?.lastSuccessAt && Date.now() - coverage.lastSuccessAt.getTime() < 25 * 60000 &&
    (!coverage.lastErrorAt || coverage.lastErrorAt <= coverage.lastSuccessAt), 'Fresh real NFL provider coverage required; never fabricate a feed attestation')
  const { capturePirateLineupEvidence } = await import('../lib/pirate/lineupEvidence')
  const { seedPirateClaims } = await import('../lib/pirate/service')
  const { createActorContext } = await import('../lib/domain/actorContext')
  const { createStagingLeagueFixture } = await import('../lib/domain/stagingLeagueFixture')
  for (let i = 0; i < 4; i++) {
    const user = await db.appUser.create({ data: { email: `${tag}-${i}@example.invalid`, username: `${tag}_${i}`, displayName: `Capture QA ${i}` } })
    ids.users.push(user.id)
  }
  const actor = createActorContext({ userId: ids.users[0], tenantId: tag, actorLabel: 'Pirate staging capture rehearsal' })
  assert(actor.ok, 'Valid fixture actor required')
  const league = await createStagingLeagueFixture(db, actor.value, { platform: 'manual', platformLeagueId: tag,
    name: tag, sport: 'NFL', season: 2097, leagueType: 'pirate', leagueVariant: 'pirate', leagueSize: 4, rosterSize: 2,
    settings: { starter_slots: { QB: 1, BN: 1 }, nfl_roster_config: { slots: { QB: 1, BN: 1 } } } })
  ids.leagues.push(league.id)
  const season = await db.redraftSeason.create({ data: { leagueId: league.id, sport: 'NFL', season: 2097,
    status: 'active', totalWeeks: 2, playoffStartWeek: 3, currentWeek: 1 } })
  const rosters: Array<{ id: string; star: string; bench: string }> = []
  for (let i = 0; i < 4; i++) {
    const roster = await db.redraftRoster.create({ data: { leagueId: league.id, seasonId: season.id, ownerId: ids.users[i], ownerName: `Capture QA ${i}` } })
    const playerIds: string[] = []
    for (const kind of ['star', 'bench']) {
      const sid = `98${Date.now()}${i}${kind === 'star' ? 1 : 2}`
      playerIds.push(sid)
      const name = `${tag} ${kind} ${i}`
      const player = await db.sportsPlayer.create({ data: { sport: 'NFL', externalId: `sleeper:${sid}`, sleeperId: sid,
        source: 'sleeper', name, position: 'QB', team: 'Kansas City Chiefs', status: 'Active', expiresAt: new Date(Date.now() + 86400000) } })
      ids.players.push(player.id)
      await db.redraftRosterPlayer.create({ data: { rosterId: roster.id, playerId: sid, playerName: name,
        position: 'QB', team: 'KC', sport: 'NFL', slotType: kind === 'star' ? 'QB' : 'BENCH' } })
      if (kind === 'star' || i === 3) {
        const injury = await db.sportsInjury.create({ data: { sport: 'NFL', externalId: `${tag}-${i}-${kind}`, source: 'pirate-rehearsal-fixture',
          playerId: sid, playerName: name, position: 'QB', team: 'KC', status: kind === 'star' ? 'OUT' : null,
          season: 2097, week: kind === 'star' ? 1 : 99, date: new Date(), expiresAt: new Date(Date.now() + 86400000) } })
        ids.injuries.push(injury.id)
      }
    }
    const [star, bench] = playerIds
    const legacy = await db.roster.create({ data: { leagueId: league.id, platformUserId: ids.users[i], redraftRosterId: roster.id,
      playerData: { players: [star, bench], starters: [star], lineup_sections: {
        starters: [{ id: star, position: 'QB', slotIndex: 0 }], bench: [{ id: bench, position: 'QB' }],
      } } } })
    await db.afRosterLineupAssignment.createMany({ data: [
      { leagueId: league.id, rosterId: legacy.id, season: 2097, week: 1, playerId: star, section: 'starters', slotIndex: 0 },
      { leagueId: league.id, rosterId: legacy.id, season: 2097, week: 1, playerId: bench, section: 'bench', slotIndex: 0 },
    ] })
    rosters.push({ id: roster.id, star, bench })
  }
  const event = new Date(Date.now() + 90000)
  const game = await db.sportsGame.create({ data: { sport: 'NFL', externalId: tag, source: 'pirate-rehearsal-fixture',
    season: 2097, week: 1, seasonType: 'regular', homeTeam: 'KC', awayTeam: 'LV', startTime: event, status: 'scheduled', expiresAt: new Date(Date.now() + 86400000) } })
  ids.games.push(game.id)
  const schedule = await db.gameSchedule.create({ data: { sportType: 'NFL', season: 2097, weekOrRound: 1,
    externalId: tag, homeTeam: 'KC', awayTeam: 'LV', startTime: event, status: 'scheduled' } })
  ids.schedules.push(schedule.id)
  for (const index of [1, 3]) await db.pirateProtectionSet.create({ data: { leagueId: league.id, seasonId: season.id,
    week: 1, rosterId: rosters[index].id, playerIds: [rosters[index].star], lockAt: event } })
  const input = { leagueId: league.id, seasonId: season.id, season: 2097, week: 1 }
  assert.equal(await capturePirateLineupEvidence(input, db), 4)
  assert.equal(await capturePirateLineupEvidence(input, db), 0)
  const before = await db.redraftLeagueTransaction.findMany({ where: { leagueId: league.id, type: 'pirate_lineup_evidence' } })
  const known = before.find(row => row.rosterId === rosters[1].id)?.metadata as Record<string, unknown>
  assert.equal(known.version, 2)
  assert.equal(known.lineupCertified, true)
  assert.equal(known.injuryFeedFresh, true)
  assert((known.players as Array<{ availabilityKnown: boolean }>).every(player => player.availabilityKnown))
  console.log('Before-lock capture passed; waiting for the synthetic game’s real clock boundary.')
  while (Date.now() < event.getTime() + 1000) await new Promise(resolve => setTimeout(resolve, Math.min(10000, event.getTime() + 1000 - Date.now())))
  assert.equal(await capturePirateLineupEvidence(input, db), 4)
  assert.equal(await capturePirateLineupEvidence(input, db), 0)
  for (const index of [0, 2]) await db.redraftMatchup.create({ data: { leagueId: league.id, seasonId: season.id, week: 1,
    homeRosterId: rosters[index].id, awayRosterId: rosters[index + 1].id, homeScore: 100, awayScore: 80, status: 'final' } })
  await db.gameSchedule.update({ where: { id: schedule.id }, data: { status: 'final' } })
  await db.sportsGame.update({ where: { id: game.id }, data: { status: 'final' } })
  assert.equal(await seedPirateClaims(league.id, db), 2)
  const proven = await db.pirateProtectionSet.findFirstOrThrow({ where: { leagueId: league.id, rosterId: rosters[1].id } })
  assert.equal(proven.voidReason, 'illegal_lineup')
  assert.deepEqual(proven.playerIds, [rosters[1].star])
  assert.equal((await db.pirateProtectionSet.findFirstOrThrow({ where: { leagueId: league.id, rosterId: rosters[3].id } })).status, 'active')
  assert.equal(await db.redraftLeagueTransaction.count({ where: { leagueId: league.id, type: 'pirate_lineup_evidence' } }), 8)
  const report = { checkedAt: new Date().toISOString(), scope: 'Synthetic NFL matchups and rosters on actual staging DB, actual wall-clock lock boundary, real provider coverage marker. This is not a live NFL scoring period.',
    realCapturePipeline: true, beforeAfterSnapshots: 8, repeatedTicksDeduplicated: true, automaticForfeit: true,
    originalLocksRetained: true, uncertainRosterKeptLocks: true, returnWeekReportNotDiscarded: true,
    tenantScopedFixture: true, fixturesRemoved: false }
  return report
}
let report: Awaited<ReturnType<typeof run>> | undefined
run().then(value => { report = value }).catch(error => {
  console.error('Capture rehearsal failed:', error.code || (error.name === 'AssertionError' ? error.message : 'operation failed'))
  process.exitCode = 1
}).finally(async () => {
  try {
    await db.league.deleteMany({ where: { id: { in: ids.leagues } } })
    await db.sportsGame.deleteMany({ where: { id: { in: ids.games } } })
    await db.gameSchedule.deleteMany({ where: { id: { in: ids.schedules } } })
    await db.sportsPlayer.deleteMany({ where: { id: { in: ids.players } } })
    await db.sportsInjury.deleteMany({ where: { id: { in: ids.injuries } } })
    await db.appUser.deleteMany({ where: { id: { in: ids.users } } })
    await db.tenant.deleteMany({ where: { id: tag } })
    if (report) {
      report.fixturesRemoved = true
      fs.writeFileSync('docs/pirate-validation/capture-rehearsal-staging.json', JSON.stringify(report, null, 2))
      console.log(JSON.stringify(report, null, 2))
    }
  } finally { await db.$disconnect() }
})
