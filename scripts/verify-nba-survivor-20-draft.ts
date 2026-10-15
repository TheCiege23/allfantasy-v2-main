/** Opt-in 20-seat native NBA Survivor draft proof. Writes only to an allowlisted test DB. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { prisma } from '../lib/prisma'
import { validateCreatePayload } from '../lib/league-creation/canonical/validateCreateLeague'
import { runPresetEngine } from '../lib/league-creation/preset-engine/runPresetEngine'
import { createCanonicalLeagueInTransaction } from '../lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { buildSessionSnapshot, pauseDraftSession, resumeDraftSession, startDraftSession } from '../lib/live-draft-engine/DraftSessionService'
import { submitPick } from '../lib/live-draft-engine/PickSubmissionService'
import { processExpiredDraftPickForLeague } from '../lib/live-draft-engine/expired-picks/processExpiredDraftPicks'
import { loadNbaSurvivorRosterEligibility } from '../lib/draft-room/nbaSurvivorRosterEligibility'
import { canonicalName } from '../lib/draft-room/player-canonical-identity'
import { configureEventInfrastructure, InMemoryOutboxStore } from '../lib/events'

const marker = `nba20-${randomUUID().slice(0, 8)}`
const userIds = Array.from({ length: 20 }, (_, i) => `${marker}-u${i + 1}`)
const positions = ['PG', 'SG', 'SF', 'PF', 'C', 'PG', 'SG', 'SF', 'PF', 'C', 'SG', 'SF']
let leagueId: string | null = null

async function main() {
  assert.ok(process.argv.includes('--db'), 'Opt in with --db on a recognized test database')
  const identity = createRequire(import.meta.url)('./db-target-identity.cjs')
  assert.equal(identity.identifyTarget(process.env.DATABASE_URL).kind, 'safe', 'A recognized non-production database is required')
  assert.ok(!process.env.UPSTASH_REDIS_REST_URL && !process.env.UPSTASH_REDIS_REST_TOKEN, 'Shared Redis must be disabled')
  configureEventInfrastructure({ outboxStore: new InMemoryOutboxStore() })

  await prisma.appUser.createMany({ data: userIds.map((id, i) => ({
    id, username: id, email: `${id}@example.invalid`, displayName: `Draft Test Manager ${i + 1}`,
  })) })
  try {
    const body = {
      concept: 'survivor', sport: 'NBA', teamCount: 20, draftType: 'snake',
      scoringPreset: 'nba_points', leagueName: `${marker} Survivor draft`, timezone: 'America/New_York',
      conceptSetup: { commissionerParticipationMode: 'participating_player', survivorTribeCount: 4 },
    }
    const validated = validateCreatePayload(body)
    assert.ok(validated.ok, 'NBA Survivor creation input must remain valid')
    const engine = runPresetEngine({ ...validated.data, commissionerId: userIds[0] })
    leagueId = (await prisma.$transaction(tx => createCanonicalLeagueInTransaction(tx, userIds[0], validated.data, engine), { timeout: 120_000 })).leagueId
    const rosters = await prisma.roster.findMany({ where: { leagueId }, orderBy: { id: 'asc' } })
    assert.equal(rosters.length, 20)
    rosters.sort((a, b) => Number(b.platformUserId === userIds[0]) - Number(a.platformUserId === userIds[0]))
    for (let i = 0; i < 20; i++) {
      await prisma.roster.update({ where: { id: rosters[i].id }, data: { platformUserId: userIds[i] } })
      await prisma.leagueTeam.updateMany({ where: { leagueId, externalId: rosters[i].id }, data: {
        platformUserId: userIds[i], claimedByUserId: userIds[i], isOrphan: false,
        ownerName: `Draft Test Manager ${i + 1}`, teamName: `Test Team ${i + 1}`,
      } })
    }
    const draft = await prisma.draftSession.findFirstOrThrow({ where: { leagueId } })
    assert.equal(draft.rounds, 12)
    const slotOrder = rosters.map((r, i) => ({ slot: i + 1, rosterId: r.id, displayName: `Test Team ${i + 1}` }))
    const tradedPicks = [
      { round: 2, originalRosterId: rosters[0].id, previousOwnerName: 'Test Team 1', newRosterId: rosters[1].id, newOwnerName: 'Test Team 2' },
      { round: 3, originalRosterId: rosters[1].id, previousOwnerName: 'Test Team 2', newRosterId: rosters[0].id, newOwnerName: 'Test Team 1' },
    ]
    await prisma.draftSession.update({ where: { id: draft.id }, data: { slotOrder, tradedPicks, timerSeconds: 90 } })
    await prisma.leagueSettings.update({ where: { leagueId }, data: { draftOrderLocked: true } })

    const eligibility = await loadNbaSurvivorRosterEligibility(240)
    assert.ok(eligibility.ready, eligibility.reason ?? 'Current NBA roster unavailable')
    const allPlayers = await prisma.sportsPlayer.findMany({ where: {
      sport: 'NBA', source: 'thesportsdb', status: 'Active',
      fetchedAt: { gte: new Date(Date.now() - 72 * 60 * 60 * 1000) }, expiresAt: { gt: new Date() },
      team: { not: null }, position: { in: ['PG', 'SG', 'SF', 'PF', 'C'] },
    }, orderBy: { name: 'asc' } })
    const seen = new Set<string>()
    const buckets = new Map<string, typeof allPlayers>()
    for (const row of allPlayers) {
      const name = canonicalName(row.name)
      if (seen.has(name) || !eligibility.eligibleNames.has(name)) continue
      seen.add(name)
      buckets.set(row.position!, [...(buckets.get(row.position!) ?? []), row])
    }
    for (const [position, required] of [['PG', 40], ['SG', 60], ['SF', 60], ['PF', 40], ['C', 40]] as const) {
      assert.ok((buckets.get(position)?.length ?? 0) >= required, `Insufficient verified ${position} players`)
    }
    assert.deepEqual(await startDraftSession(leagueId), { ok: true })
    let session = await prisma.draftSession.findUniqueOrThrow({ where: { id: draft.id } })
    assert.equal(session.status, 'in_progress')
    assert.ok(session.timerEndAt && session.timerEndAt > new Date())
    assert.equal(await pauseDraftSession(leagueId, userIds[0]), true)
    session = await prisma.draftSession.findUniqueOrThrow({ where: { id: draft.id } })
    assert.equal(session.status, 'paused')
    assert.equal(session.timerEndAt, null)
    assert.ok(session.pausedRemainingSeconds && session.pausedRemainingSeconds > 0)
    assert.equal(await resumeDraftSession(leagueId), true)
    session = await prisma.draftSession.findUniqueOrThrow({ where: { id: draft.id } })
    assert.equal(session.status, 'in_progress')

    const first = buckets.get('PG')![0]
    await prisma.draftQueue.create({ data: { sessionId: draft.id, userId: userIds[0], order: [{ playerName: first.name, position: 'PG', team: first.team, playerId: first.id }] } })
    await prisma.draftSession.update({ where: { id: draft.id }, data: { timerEndAt: new Date(Date.now() - 2_000) } })
    const auto = await processExpiredDraftPickForLeague(leagueId)
    assert.equal(auto.outcome, 'processed_queue', JSON.stringify(auto))
    const autopick = await prisma.draftPick.findFirstOrThrow({ where: { sessionId: draft.id, overall: 1 } })
    assert.equal(autopick.playerId, first.id)
    assert.equal(autopick.source, 'auto')
    console.log('PASS start, pause/resume, expiry and queue-first pick 1')

    const nextByPosition = new Map<string, number>([['PG', 1], ['SG', 0], ['SF', 0], ['PF', 0], ['C', 0]])
    for (let overall = 2; overall <= 240; overall++) {
      const snapshot = await buildSessionSnapshot(leagueId)
      assert.equal(snapshot?.currentPick?.overall, overall)
      const round = Math.ceil(overall / 20)
      const position = positions[round - 1]
      const index = nextByPosition.get(position) ?? 0
      const player = buckets.get(position)![index]
      assert.ok(player, `No ${position} player at ${overall}`)
      nextByPosition.set(position, index + 1)
      const slot = snapshot.currentPick.slot
      const ownerIndex = (round === 2 && slot === 1) ? 1 : (round === 3 && slot === 2) ? 0 : slot - 1
      assert.equal(snapshot.currentPick.rosterId, rosters[ownerIndex].id, `Owner mismatch at pick ${overall}`)
      const result = await submitPick({
        leagueId, playerId: player.id, playerName: player.name, position,
        team: player.team, rosterId: rosters[ownerIndex].id, madeByUserId: userIds[ownerIndex],
        source: 'user', expectedOverall: overall,
      })
      assert.ok(result.success, `Pick ${overall}: ${result.code ?? result.error}`)
      if (overall % 20 === 0) console.log(`PASS round ${round} of 12`)
    }
    session = await prisma.draftSession.findUniqueOrThrow({ where: { id: draft.id } })
    assert.equal(session.status, 'completed')
    assert.equal(await prisma.draftPick.count({ where: { sessionId: draft.id } }), 240)
    const pick = await prisma.draftPick.findFirstOrThrow({ where: { sessionId: draft.id, round: 2, slot: 1 } })
    assert.equal(pick.rosterId, rosters[1].id)
    assert.ok(pick.tradedPickMeta, 'Traded-pick metadata must be saved on the pick')
    const season = await prisma.redraftSeason.findFirstOrThrow({ where: { leagueId } })
    const seasonRosters = await prisma.redraftRoster.findMany({ where: { seasonId: season.id } })
    assert.equal(seasonRosters.length, 20)
    assert.equal(await prisma.redraftRosterPlayer.count({ where: { rosterId: { in: seasonRosters.map(r => r.id) }, droppedAt: null } }), 240)
    const cast = await prisma.survivorPlayer.findMany({ where: { leagueId } })
    assert.equal(cast.length, 20)
    assert.equal(await prisma.survivorTribe.count({ where: { leagueId } }), 4)
    const idols = await prisma.survivorIdol.findMany({ where: { leagueId } })
    assert.equal(idols.length, 7)
    assert.ok(idols.every(idol => idol.isSecret && !idol.isPubliclyKnown && idol.playerId && idol.currentOwnerUserId))
    const notices = await prisma.leagueChatMessage.findMany({ where: { leagueId, messageSubtype: 'chimmy_private' } })
    assert.equal(notices.filter(n => (n.metadata as Record<string, unknown> | null)?.survivorIdolReveal === true).length, 7)
    assert.ok(notices.every(n => n.isPrivate && n.visibleToUserId))
    let chatCount = 0
    for (let attempt = 0; attempt < 20; attempt++) {
      chatCount = await prisma.leagueChatMessage.count({ where: { leagueId, source: 'draft', type: 'draft_pick' } })
      if (chatCount === 240) break
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    assert.equal(chatCount, 240, 'Every pick must appear in draft chat')
    const tradedChat = await prisma.leagueChatMessage.findFirst({ where: { leagueId, source: 'draft', type: 'draft_pick', metadata: { path: ['overall'], equals: pick.overall } } })
    assert.ok(tradedChat?.message.includes('Test Team 2'), 'Traded pick must name its current owner in chat')
    console.log('PASS 240 picks and draft-chat cards, traded history, 20 season rosters, four tribes and seven private idol notices')
  } finally {
    // The branch expires automatically. Only rows created by this run are removed.
    if (leagueId) {
      await prisma.analyticsEvent.deleteMany({ where: { OR: [{ meta: { path: ['leagueId'], equals: leagueId } }, { userId: { in: userIds } }] } })
      await prisma.automationLock.deleteMany({ where: { lockKey: `draft:${leagueId}:pick` } })
      await prisma.league.deleteMany({ where: { id: leagueId } })
    }
    await prisma.appUser.deleteMany({ where: { id: { in: userIds } } })
    console.log('Cleaned up this rehearsal league and test managers.')
  }
}

main().catch(error => {
  console.error(String(error?.stack ?? error).replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[redacted]'))
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
