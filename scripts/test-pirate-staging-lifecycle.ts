/** Isolated four-sport Pirate lifecycle exercise on the verified staging database. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import dotenv from 'dotenv'
import { PrismaClient, type League, type PirateClaim, type RedraftMatchup, type RedraftRoster } from '@prisma/client'

const stage = dotenv.parse(fs.readFileSync(process.env.PIRATE_STAGING_ENV || '.env.staging'))
const production = dotenv.parse(fs.readFileSync(process.env.PIRATE_PRODUCTION_ENV || '.env'))
const stageHost = new URL(stage.DATABASE_URL).hostname.replace('-pooler', '')
const productionHost = new URL(production.DATABASE_URL).hostname.replace('-pooler', '')
assert(stageHost.includes('winter-salad') && stageHost !== productionHost, 'Verified separate staging required')
Object.assign(process.env, stage, { DATABASE_URL: stage.DATABASE_URL, DIRECT_URL: stage.DATABASE_URL, NODE_ENV: 'test' })
const db = new PrismaClient({ datasources: { db: { url: stage.DATABASE_URL } } })
const tag = `pirate-stage-${randomUUID().slice(0, 8)}`
const now = new Date()
const futureLock = new Date(now.getTime() + 6 * 60 * 60 * 1000)
const results: Array<Record<string, unknown>> = []

async function main() {
  const service = await import('../lib/pirate/service')
  const { assertPirateAcquisitionCapacity } = await import('../lib/pirate/rosterCapacity')
  const users = []
  for (let i = 0; i < 4; i++) users.push(await db.appUser.create({ data: {
    id: `${tag}-owner-${i}`, email: `${tag}-${i}@example.invalid`, username: `${tag}_${i}`,
    displayName: `Pirate QA ${i}`,
  } }))
  for (const sport of ['NFL', 'NBA', 'MLB', 'NHL'] as const) {
    const league: League = await db.league.create({ data: {
      userId: users[0].id, platform: 'manual', platformLeagueId: `${tag}-${sport}`,
      name: `${tag} ${sport}`, sport, season: 2026, leagueType: 'pirate', leagueVariant: 'pirate',
      leagueSize: 4, rosterSize: 2, playoffStartWeek: 89,
      settings: { conceptRules: { extensions: { pirate: {
        protectionLimit: 3, claimHours: 24, selectionHours: 24, overflowGraceHours: 24, playoffClaims: false,
      } } } },
    } })
    const season = await db.redraftSeason.create({ data: {
      leagueId: league.id, sport, season: 2026, status: 'active', totalWeeks: 90, playoffStartWeek: 89, currentWeek: 88,
    } })
    await db.gameSchedule.create({ data: {
      sportType: sport, season: 2026, weekOrRound: 88, externalId: `${tag}-${sport}`,
      startTime: futureLock, status: 'scheduled',
    } })
    const rosters: RedraftRoster[] = []
    const players: string[][] = []
    for (let i = 0; i < 4; i++) {
      const roster: RedraftRoster = await db.redraftRoster.create({ data: {
        leagueId: league.id, seasonId: season.id, ownerId: users[i].id,
        ownerName: users[i].displayName!, teamName: `Pirate QA ${i}`,
      } })
      const ids = [`${tag}-${sport}-${i}-a`, `${tag}-${sport}-${i}-b`]
      for (const [j, playerId] of ids.entries()) await db.redraftRosterPlayer.create({ data: {
        rosterId: roster.id, playerId, playerName: `QA ${sport} ${i}-${j}`,
        position: sport === 'NFL' ? 'WR' : sport === 'NBA' ? 'PG' : sport === 'MLB' ? '1B' : 'C',
        team: 'QA', sport, slotType: j ? 'BENCH' : 'STARTER',
      } })
      await db.roster.create({ data: { leagueId: league.id, platformUserId: users[i].id,
        redraftRosterId: roster.id, playerData: { players: ids, starters: [ids[0]] } } })
      rosters.push(roster)
      players.push(ids)
    }
    const matchupA: RedraftMatchup = await db.redraftMatchup.create({ data: {
      leagueId: league.id, seasonId: season.id, week: 88, homeRosterId: rosters[0].id,
      awayRosterId: rosters[1].id, homeScore: 120, awayScore: 90, status: 'scheduled',
    } })
    const matchupB: RedraftMatchup = await db.redraftMatchup.create({ data: {
      leagueId: league.id, seasonId: season.id, week: 88, homeRosterId: rosters[2].id,
      awayRosterId: rosters[3].id, homeScore: 110, awayScore: 80, status: 'scheduled',
    } })
    await service.savePirateProtections({ leagueId: league.id, actorUserId: users[1].id,
      rosterId: rosters[1].id, week: 88, playerIds: [players[1][0]], now }, db)
    await service.savePirateProtections({ leagueId: league.id, actorUserId: users[3].id,
      rosterId: rosters[3].id, week: 88, playerIds: [players[3][0]], now }, db)
    await service.queuePirateProtectionReminders(league.id, db)
    assert.equal(await db.notificationOutbox.count({ where: { leagueId: league.id, eventType: 'pirate_protection_reminder' } }), 8)
    await db.redraftMatchup.updateMany({ where: { id: { in: [matchupA.id, matchupB.id] } }, data: { status: 'final' } })
    assert.equal(await service.seedPirateClaims(league.id, db), 2)
    const claims = await db.pirateClaim.findMany({ where: { leagueId: league.id }, orderBy: { matchupId: 'asc' } })
    const claimA: PirateClaim = claims.find((claim) => claim.matchupId === matchupA.id)!
    const claimB: PirateClaim = claims.find((claim) => claim.matchupId === matchupB.id)!
    assert(claimA.selectionDeadlineAt && claimB.selectionDeadlineAt)
    await service.selectPirateClaim({ claimId: claimA.id, actorUserId: users[0].id,
      playerId: players[1][1], offeredPlayerId: players[0][0], now }, db)
    await service.respondToPirateClaim({ claimId: claimA.id, actorUserId: users[1].id,
      action: 'counter', counterPlayerId: players[0][1], now }, db)
    await service.respondToPirateClaim({ claimId: claimA.id, actorUserId: users[0].id,
      action: 'accept_counter', now }, db)
    assert.equal((await db.pirateClaim.findUniqueOrThrow({ where: { id: claimA.id } })).settledReturnPlayerId, players[0][1])
    await service.selectPirateClaim({ claimId: claimB.id, actorUserId: users[2].id, playerId: players[3][1], now }, db)
    const elapsed = new Date(now.getTime() + 25 * 60 * 60 * 1000)
    const settled = await service.maintainPirateClaims({ leagueId: league.id, now: elapsed }, db)
    assert.equal(settled.transferred, 1)
    const autoClaim = await db.pirateClaim.findUniqueOrThrow({ where: { id: claimB.id } })
    assert(autoClaim.overflowGraceUntil && autoClaim.status === 'transferred')
    await assert.rejects(() => db.$transaction((tx) => assertPirateAcquisitionCapacity(tx, league.id, rosters[2].id)), /Drop a player/)
    await db.redraftMatchup.update({ where: { id: matchupA.id }, data: { homeScore: 85, awayScore: 100 } })
    await service.commissionerReversePirateClaim({ leagueId: league.id, claimId: claimA.id,
      actorUserId: users[0].id, reason: 'Staging score correction changed the winner', now: elapsed }, db)
    assert.equal((await db.pirateClaim.findUniqueOrThrow({ where: { id: claimA.id } })).status, 'reversed')
    const corrected: PirateClaim = await db.pirateClaim.findFirstOrThrow({ where: {
      matchupId: matchupA.id, winnerRosterId: rosters[1].id, status: 'awaiting_selection',
    } })
    assert(corrected.selectionDeadlineAt)
    await service.maintainPirateClaims({ leagueId: league.id, now: new Date(corrected.selectionDeadlineAt.getTime() + 1000) }, db)
    assert.equal((await db.pirateClaim.findUniqueOrThrow({ where: { id: corrected.id } })).status, 'selection_expired')
    assert.equal(await service.seedPirateClaims(league.id, db), 0, 'Expired selection must not recreate the same claim')
    await service.commissionerSelectPirateClaim({ leagueId: league.id, claimId: corrected.id,
      actorUserId: users[0].id, playerId: players[0][0], now: elapsed }, db)
    await service.settlePirateClaim({ claimId: corrected.id, note: 'Commissioner confirmed corrected winner', now: elapsed }, db)
    await db.redraftMatchup.update({ where: { id: matchupA.id }, data: { homeScore: 121, awayScore: 100 } })
    await service.commissionerReversePirateClaim({ leagueId: league.id, claimId: corrected.id,
      actorUserId: users[0].id, reason: 'Second staging score correction restored the original winner', now: elapsed }, db)
    const third = await db.pirateClaim.findFirstOrThrow({ where: {
      matchupId: matchupA.id, winnerRosterId: rosters[0].id, status: 'awaiting_selection',
    } })
    assert.equal(third.claimCycle, 2)
    await db.league.update({ where: { id: league.id }, data: { settings: { conceptRules: { extensions: { pirate: {
      protectionLimit: 3, claimHours: 24, selectionHours: 24, overflowGraceHours: 24, playoffClaims: true,
    } } } } } })
    const round = await db.redraftPlayoffRound.create({ data: {
      id: `${tag}-${sport}-playoff-round`, seasonId: season.id, roundNumber: 1, status: 'completed',
    } })
    const playoffMatchup = await db.redraftPlayoffMatchup.create({ data: {
      id: `${tag}-${sport}-playoff-matchup`, seasonId: season.id, roundId: round.id, matchupNumber: 1,
      homeRosterId: rosters[0].id, awayRosterId: rosters[1].id, homeScore: 60, awayScore: 40,
      winnerRosterId: rosters[0].id, status: 'final',
    } })
    assert.equal(await service.seedPirateClaims(league.id, db), 1, 'Final playoff matchup creates one claim')
    const playoffClaim = await db.pirateClaim.findFirstOrThrow({ where: { playoffMatchupId: playoffMatchup.id } })
    assert.equal(playoffClaim.matchupId, null)
    assert.equal(playoffClaim.week, 89)
    await db.redraftPlayoffMatchup.update({ where: { id: playoffMatchup.id }, data: {
      homeScore: 35, awayScore: 45, winnerRosterId: rosters[1].id,
    } })
    await service.maintainPirateClaims({ leagueId: league.id, now }, db)
    assert.equal((await db.pirateClaim.findUniqueOrThrow({ where: { id: playoffClaim.id } })).status, 'score_corrected')
    assert(await db.pirateClaim.findFirst({ where: {
      playoffMatchupId: playoffMatchup.id, winnerRosterId: rosters[1].id, status: 'awaiting_selection',
    } }), 'Corrected playoff winner receives a new claim')
    results.push({ sport, leagueId: league.id, protectionsLocked: 2, claimsCreated: 2,
      counterSettled: true, unansweredAutoTransferred: true, overflowGraceRecorded: true,
      correctedStealReversed: true, correctedWinnerClaimCreated: true, selectionExpired: true, repeatedCorrectionRecovered: true, playoffClaimCreated: true, playoffCorrectionRecovered: true })
    console.log(`${sport}: Pirate lifecycle passed`)
  }
  fs.mkdirSync('docs/pirate-validation', { recursive: true })
  fs.writeFileSync('docs/pirate-validation/staging-lifecycle.json', JSON.stringify({
    tag, databaseHost: new URL(stage.DATABASE_URL).hostname, runAt: new Date().toISOString(), results,
  }, null, 2))
}
main().catch((error) => { console.error('Pirate staging lifecycle failed:', error.code || error.message); process.exitCode = 1 })
  .finally(() => db.$disconnect())
