/** Synthetic lock evidence -> automatic forfeiture -> commissioner restore, on staging only. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import dotenv from 'dotenv'
import { PrismaClient, type Prisma } from '@prisma/client'
import type { PirateLineupEvidence } from '../lib/pirate/lineupEvidence'

const stage = dotenv.parse(fs.readFileSync(process.env.PIRATE_STAGING_ENV || 'G:/allfantasy-v2-main/.env.staging'))
const production = dotenv.parse(fs.readFileSync(process.env.PIRATE_PRODUCTION_ENV || 'G:/allfantasy-v2-main/.env'))
const host = new URL(stage.DATABASE_URL).hostname.replace('-pooler', '')
assert(host.includes('winter-salad') && host !== new URL(production.DATABASE_URL).hostname.replace('-pooler', ''), 'Verified separate staging required')
Object.assign(process.env, stage, { DATABASE_URL: stage.DATABASE_URL, DIRECT_URL: stage.DATABASE_URL, NODE_ENV: 'test' })
const RuntimeClient: typeof PrismaClient = process.env.PIRATE_PRISMA_CLIENT
  ? createRequire(`${process.cwd()}/package.json`)(process.env.PIRATE_PRISMA_CLIENT).PrismaClient : PrismaClient
const db = new RuntimeClient({ datasources: { db: { url: stage.DATABASE_URL } } })
const tag = `pirate-lineup-${randomUUID().slice(0, 8)}`
const leagueIds: string[] = [], userIds: string[] = [], scheduleIds: string[] = []
const results: Array<Record<string, unknown>> = []

async function main() {
  const service = await import('../lib/pirate/service')
  const { assessPirateLineupEvidence } = await import('../lib/pirate/lineupEvidence')
  const { easternDayKey } = await import('../lib/redraft/lineupLock')
  const event = new Date(Date.now() - 60 * 60 * 1000)
  for (let index = 0; index < 4; index++) {
    const user = await db.appUser.create({ data: { email: `${tag}-${index}@example.invalid`, username: `${tag}_${index}`, displayName: `Lineup QA ${index}` } })
    userIds.push(user.id)
  }
  for (const [sport, slot] of [['NFL', 'QB'], ['NBA', 'PG'], ['MLB', '1B'], ['NHL', 'C']] as const) {
    const league = await db.league.create({ data: { userId: userIds[0], platform: 'manual', platformLeagueId: `${tag}-${sport}`,
      name: `${tag} ${sport}`, sport, season: 2097, leagueType: 'pirate', leagueVariant: 'pirate', leagueSize: 4, rosterSize: 2,
      settings: { starter_slots: { [slot]: 1 }, bench_slots: 1 } } })
    leagueIds.push(league.id)
    const season = await db.redraftSeason.create({ data: { leagueId: league.id, sport, season: 2097, status: 'active', totalWeeks: 2, playoffStartWeek: 3, currentWeek: 1 } })
    const game = await db.gameSchedule.create({ data: { sportType: sport, season: 2097, weekOrRound: 1,
      externalId: `${tag}-${sport}`, startTime: event, status: 'final' } })
    scheduleIds.push(game.id)
    const rosters: Array<{ id: string; star: string; bench: string }> = []
    for (let index = 0; index < 4; index++) {
      const roster = await db.redraftRoster.create({ data: { leagueId: league.id, seasonId: season.id,
        ownerId: userIds[index], ownerName: `Lineup QA ${index}` } })
      const star = `${tag}-${sport}-${index}-star`, bench = `${tag}-${sport}-${index}-bench`
      await db.redraftRosterPlayer.createMany({ data: [
        { rosterId: roster.id, playerId: star, playerName: 'Inactive starter', position: slot, team: 'QA', sport, slotType: slot, injuryStatus: 'OUT' },
        { rosterId: roster.id, playerId: bench, playerName: 'Active replacement', position: slot, team: 'QA', sport, slotType: 'BENCH' },
      ] })
      const legacy = await db.roster.create({ data: { leagueId: league.id, platformUserId: userIds[index], redraftRosterId: roster.id,
        playerData: { players: [star, bench], starters: [star] } } })
      await db.afRosterLineupAssignment.createMany({ data: [
        { leagueId: league.id, rosterId: legacy.id, season: 2097, week: 1, playerId: star, section: 'starters', slotIndex: 0 },
        { leagueId: league.id, rosterId: legacy.id, season: 2097, week: 1, playerId: bench, section: 'bench', slotIndex: 0 },
      ] })
      rosters.push({ ...roster, star, bench })
    }
    for (const index of [1, 3]) await db.pirateProtectionSet.create({ data: { leagueId: league.id, seasonId: season.id,
      week: 1, rosterId: rosters[index].id, playerIds: [rosters[index].star], lockAt: event } })
    for (const index of [0, 2]) await db.redraftMatchup.create({ data: { leagueId: league.id, seasonId: season.id,
      week: 1, homeRosterId: rosters[index].id, awayRosterId: rosters[index + 1].id, homeScore: 100, awayScore: 80, status: 'final' } })
    const evidenceIds: string[] = []
    const captured: PirateLineupEvidence[] = []
    for (const phase of ['before', 'after'] as const) {
      const snapshot: PirateLineupEvidence = { version: 2, week: 1, sport, eventAt: event.toISOString(), scoringDay: null, phase,
        capturedAt: new Date(event.getTime() + (phase === 'before' ? -120000 : 120000)).toISOString(),
        mode: 'per_player_kickoff', terminalEvent: true, lineupCertified: true, starterSlots: [[slot, 1]], rulesHash: `${tag}-${sport}`,
        scheduleWarnings: [], injuryFeedFresh: true, injurySyncAt: new Date(event.getTime() - 180000).toISOString(), injuryReports: [],
        waiverPoolCertified: false, waiverState: { type: 'faab', nextRunAt: null, processingLocked: false }, waivers: [], players: [
          { playerId: rosters[1].star, playerName: 'Inactive starter', position: slot, slotType: slot, team: 'QA',
            kickoffAt: event.toISOString(), injuryStatus: 'OUT', availabilityKnown: true, starterSlotIndex: 0, addableBeforeLock: true, lockedAtSnapshot: phase === 'after' },
          { playerId: rosters[1].bench, playerName: 'Active replacement', position: slot, slotType: 'BENCH', team: 'QA',
            kickoffAt: event.toISOString(), injuryStatus: null, availabilityKnown: true, addableBeforeLock: true, lockedAtSnapshot: phase === 'after' },
        ] }
      const row = await db.redraftLeagueTransaction.create({ data: { leagueId: league.id, seasonId: season.id,
        rosterId: rosters[1].id, type: 'pirate_lineup_evidence', metadata: snapshot as unknown as Prisma.InputJsonValue } })
      evidenceIds.push(row.id)
      captured.push(snapshot)
    }
    assert.equal(await service.seedPirateClaims(league.id, db), 2)
    const automatic = await db.pirateProtectionSet.findFirstOrThrow({ where: { leagueId: league.id, rosterId: rosters[1].id } })
    assert.equal(automatic.status, 'void')
    assert.equal(automatic.voidReason, 'illegal_lineup')
    assert.deepEqual(automatic.playerIds, [rosters[1].star])
    assert.equal((await db.pirateProtectionSet.findFirstOrThrow({ where: { leagueId: league.id, rosterId: rosters[3].id } })).status, 'active')
    const audit = await db.redraftLeagueTransaction.findFirstOrThrow({ where: { leagueId: league.id, type: 'pirate_lineup_ruling' } })
    const metadata = audit.metadata as Record<string, unknown>
    assert.equal(metadata.source, 'automatic')
    assert.deepEqual(new Set(metadata.evidenceIds as string[]), new Set(evidenceIds))
    const claim = await db.pirateClaim.findFirstOrThrow({ where: { leagueId: league.id, loserRosterId: rosters[1].id } })
    await service.selectPirateClaim({ claimId: claim.id, actorUserId: userIds[0], playerId: rosters[1].star }, db)
    const ruling = await service.commissionerRulePirateLineup({ leagueId: league.id, claimId: claim.id, actorUserId: userIds[0],
      decision: 'excused', reason: 'Synthetic staging override: commissioner verified the exception applies.' }, db)
    assert.equal(ruling.reopenedSelection, true)
    await service.seedPirateClaims(league.id, db)
    assert.equal((await db.pirateProtectionSet.findUniqueOrThrow({ where: { id: automatic.id } })).status, 'active')
    const reopened = await db.pirateClaim.findUniqueOrThrow({ where: { id: claim.id } })
    assert.equal(reopened.status, 'awaiting_selection')
    assert.equal(reopened.playerId, null)
    assert(reopened.selectionDeadlineAt && reopened.selectionDeadlineAt > new Date())
    assert.equal(await db.redraftLeagueTransaction.count({ where: { leagueId: league.id, type: 'pirate_lineup_ruling' } }), 2)
    const benchPosition = { NFL: 'WR', NBA: 'C', MLB: 'C', NHL: 'G' }[sport]
    await db.redraftRosterPlayer.updateMany({ where: { rosterId: rosters[3].id, playerId: rosters[3].bench }, data: { position: benchPosition } })
    const dropEvidenceIds: string[] = []
    for (const original of captured) {
      const snapshot: PirateLineupEvidence = { ...original, players: original.players.map(p => ({ ...p,
        playerId: p.playerId === rosters[1].star ? rosters[3].star : rosters[3].bench,
        ...(p.slotType === 'BENCH' ? { position: benchPosition, playerName: 'Legal bench drop' } : {}),
      })), waivers: [{ playerId: `${tag}-${sport}-free`, playerName: 'Verified waiver replacement', position: slot,
        slotType: 'WAIVER', team: 'QA', kickoffAt: event.toISOString(), availabilityKnown: true, injuryStatus: null,
        addableBeforeLock: true, dropPlayerId: rosters[3].bench, certifiedEventAt: event.toISOString(),
        checkedAt: new Date(event.getTime() - 120000).toISOString() }] }
      const row = await db.redraftLeagueTransaction.create({ data: { leagueId: league.id, seasonId: season.id,
        rosterId: rosters[3].id, type: 'pirate_lineup_evidence', metadata: snapshot as unknown as Prisma.InputJsonValue } })
      dropEvidenceIds.push(row.id)
    }
    await service.seedPirateClaims(league.id, db)
    assert.equal((await db.pirateProtectionSet.findFirstOrThrow({ where: { leagueId: league.id, rosterId: rosters[3].id } })).voidReason, 'illegal_lineup')
    const dropAudit = await db.redraftLeagueTransaction.findFirstOrThrow({ where: { leagueId: league.id,
      rosterId: rosters[3].id, type: 'pirate_lineup_ruling' } })
    assert.deepEqual(new Set((dropAudit.metadata as Record<string, unknown>).evidenceIds as string[]), new Set(dropEvidenceIds))
    assert.equal(await db.redraftRosterPlayer.count({ where: { rosterId: rosters[3].id, droppedAt: null } }), 2)
    // These are explicitly synthetic proof records, not provider observations.
    // Exercise persisted v3 assessment and daily final-lineup reads without
    // touching the separate live-game fixture or moving anyone's players.
    const target = rosters[3]
    await db.redraftRosterPlayer.updateMany({ where: { rosterId: target.id, playerId: target.bench }, data: { position: slot, slotType: 'IR' } })
    await db.afRosterLineupAssignment.updateMany({ where: { rosterId: (await db.roster.findFirstOrThrow({
      where: { redraftRosterId: target.id } })).id, playerId: target.bench }, data: { section: 'ir' } })
    const reservePair = captured.map((original): PirateLineupEvidence => ({ ...original, version: 3,
      players: original.players.map(p => ({ ...p, playerId: p.slotType === 'BENCH' ? target.bench : target.star,
        ...(p.slotType === 'BENCH' ? { slotType: 'IR', position: slot, addableBeforeLock: false, activationBeforeLock: true } : {}),
      })), plans: [{ eventAt: event.toISOString(), checkedAt: new Date(event.getTime() - 120000).toISOString(),
        steps: [{ kind: 'activate', playerId: target.bench, fromSlot: 'IR' }],
        assignment: [{ playerId: target.bench, slotType: slot, slotIndex: 0 }] }] }))
    const persistPair = async (pair: PirateLineupEvidence[]) => {
      for (const snapshot of pair) await db.redraftLeagueTransaction.create({ data: { leagueId: league.id, seasonId: season.id,
        rosterId: target.id, type: 'pirate_lineup_evidence', metadata: snapshot as unknown as Prisma.InputJsonValue } })
    }
    const assess = () => assessPirateLineupEvidence({ leagueId: league.id, seasonId: season.id, rosterId: target.id, week: 1 }, db)
    await persistPair(reservePair)
    assert.equal((await assess())?.decision, 'forfeit')
    let dailySavedDayVerified: boolean | null = null, dailyMissingDayKeptLocks: boolean | null = null
    if (sport !== 'NFL') {
      const scoringDay = easternDayKey(event)!
      const day = new Date(`${scoringDay}T00:00:00Z`)
      await db.redraftDailyLineup.createMany({ data: [
        { leagueId: league.id, rosterId: target.id, season: 2097, week: 1, scoringDay: day, playerId: target.star, slotType: slot },
        { leagueId: league.id, rosterId: target.id, season: 2097, week: 1, scoringDay: day, playerId: target.bench, slotType: 'IR' },
      ] })
      const dailyPair = reservePair.map(e => ({ ...e, mode: 'daily', scoringDay,
        players: e.players.map(p => ({ ...p, hasGameOnScoringDay: true })) }))
      await persistPair(dailyPair)
      assert.equal((await assess())?.decision, 'forfeit'); dailySavedDayVerified = true
      await db.redraftDailyLineup.deleteMany({ where: { rosterId: target.id, scoringDay: day } })
      assert.equal((await assess())?.decision, 'review'); dailyMissingDayKeptLocks = true
    }
    const legacy = await db.roster.findFirstOrThrow({ where: { redraftRosterId: target.id } })
    const drops = [`${tag}-${sport}-drop-a`, `${tag}-${sport}-drop-b`]
    await db.redraftRosterPlayer.createMany({ data: drops.map(playerId => ({ rosterId: target.id, playerId,
      playerName: 'Joint-plan bench drop', position: benchPosition, team: 'QA', sport, slotType: 'BENCH' })) })
    await db.roster.update({ where: { id: legacy.id }, data: { playerData: { players: [target.star, target.bench, ...drops], starters: [target.star] } } })
    await db.afRosterLineupAssignment.createMany({ data: drops.map((playerId, index) => ({ leagueId: league.id,
      rosterId: legacy.id, season: 2097, week: 1, playerId, section: 'bench', slotIndex: index })) })
    const jointPair = reservePair.map((e): PirateLineupEvidence => {
      const waivers = ['a', 'b'].map(suffix => ({ ...e.players[1], playerId: `${tag}-${sport}-add-${suffix}`, slotType: 'WAIVER',
        addableBeforeLock: true, lockedAtSnapshot: false, activationBeforeLock: false, jointPlanOnly: true, certifiedEventAt: e.eventAt,
        checkedAt: new Date(event.getTime() - 120000).toISOString() }))
      return { ...e, starterSlots: [[slot, 2]], players: [e.players[0], e.players[1], ...drops.map(playerId => ({ ...e.players[1],
        playerId, position: benchPosition, slotType: 'BENCH', addableBeforeLock: true, activationBeforeLock: false }))], waivers,
        plans: [{ eventAt: e.eventAt, checkedAt: new Date(event.getTime() - 120000).toISOString(),
          steps: waivers.map((p, i) => ({ kind: 'pickup', playerId: p.playerId, dropPlayerId: drops[i] })),
          assignment: waivers.map((p, i) => ({ playerId: p.playerId, slotType: slot, slotIndex: i })) }] }
    })
    await persistPair(jointPair)
    assert.equal((await assess())?.decision, 'forfeit')
    await persistPair(jointPair.map(e => ({ ...e, plans: [] })))
    assert.equal((await assess())?.decision, 'review')
    assert.equal(await db.redraftRosterPlayer.count({ where: { rosterId: target.id, droppedAt: null } }), 4)
    results.push({ sport, automaticForfeit: true, originalLocksRetained: true, missingEvidenceKeptLocks: true,
      evidenceAuditLinked: true, commissionerRestored: true, winnerSelectionReopened: true, repeatedTickHonoredOverride: true,
      singleDropForfeit: true, dropEvidenceAuditLinked: true, noRosterMoveMade: true,
      reservePlanAssessment: true, dailySavedDayVerified, dailyMissingDayKeptLocks,
      jointAcquisitionAssessment: true, missingJointProofKeptLocks: true })
    console.log(`${sport}: automatic lineup evidence lifecycle passed`)
  }
  fs.writeFileSync('docs/pirate-validation/lineup-evidence-staging.json', JSON.stringify({ tag, runAt: new Date().toISOString(),
    scope: 'Synthetic lock snapshots on isolated staging; fixture leagues and users removed after validation.', results }, null, 2))
}

main().catch((error) => { console.error('Pirate lineup staging validation failed:', error.code === 'ERR_ASSERTION' ? error.stack : error.code || error.message); process.exitCode = 1 })
  .finally(async () => {
    try {
      await db.league.deleteMany({ where: { id: { in: leagueIds } } })
      await db.gameSchedule.deleteMany({ where: { id: { in: scheduleIds } } })
      await db.appUser.deleteMany({ where: { id: { in: userIds } } })
    } finally { await db.$disconnect() }
  })
