/** Opt-in integration proof. Creates unique fixtures on a recognized test DB and cleans up only those fixtures. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { prisma } from '../lib/prisma'
import { assertSafeSeedTarget } from './_assert-safe-seed-target'
import { buildSurvivorSettingsSnapshotPatch, normalizeSurvivorFoundationSettings } from '../lib/survivor/normalizeSurvivorSettings'
import { runSurvivorPostDraftBootstrap } from '../lib/survivor/SurvivorDraftBootstrapService'
import { initializeSurvivorPhase2 } from '../lib/survivor/survivorPhase2Init'
import { withSurvivorSetupTransaction } from '../lib/survivor/survivorSetupTransaction'
import { prepareSurvivorDraftParticipants } from '../lib/survivor/survivorDraftParticipants'
import { assignSurvivorTribes } from '../lib/survivor/survivorTribeProvisioning'
import { provisionSurvivorChats } from '../lib/survivor/survivorTribeChatProvisioning'
import { seedSurvivorIdols } from '../lib/survivor/survivorIdolProvisioning'
import { postSurvivorIntroAnnouncement } from '../lib/survivor/survivorAnnouncementService'

const prefix = `sds-${randomUUID().slice(0, 8)}`
const leagues: string[] = []
const users = Array.from({ length: 17 }, (_, i) => `${prefix}-u${i}`)
type Fixture = Awaited<ReturnType<typeof fixture>>
async function fixture(label: string, options: Record<string, unknown> = {}) {
  const id = `${prefix}-${label}`
  const settings = normalizeSurvivorFoundationSettings({ defaultTeamCount: 16, tribeCount: 4, commissionerParticipationMode: 'participating_player', ...options })
  const snapshot = buildSurvivorSettingsSnapshotPatch(settings)
  await prisma.league.create({ data: {
    id, userId: users[0], platform: 'allfantasy', platformLeagueId: id, name: 'Survivor draft setup verification',
    sport: 'NFL', season: 2026, leagueSize: 16, rosterSize: 15, survivorMode: true, leagueVariant: 'survivor',
    survivorPhase: 'pre_draft', settings: snapshot,
  }, select: { id: true } })
  leagues.push(id)
  const participants = settings.commissionerParticipationMode === 'non_participating_host' ? users.slice(1) : users.slice(0, 16)
  const rosters = participants.map((userId, i) => ({ id: `${id}-r${i}`, leagueId: id, platformUserId: userId, playerData: { players: [] } }))
  await prisma.roster.createMany({ data: rosters })
  // Reproduce creation-time cast followed by later joins; reconciliation must replace unused seats.
  await prisma.survivorPlayer.createMany({ data: rosters.map((r, i) => ({
    leagueId: id, userId: i === 0 ? r.platformUserId : `open-slot-${id}-${i}`,
    displayName: `Manager ${i}`, playerState: 'active',
  })) })
  await prisma.survivorGameState.create({ data: { leagueId: id, phase: 'pre_draft', currentWeek: 0, activePlayerCount: 16 }, select: { id: true } })
  const draftId = `${id}-draft`
  await prisma.draftSession.create({ data: {
    id: draftId, leagueId: id, status: 'completed', sessionKind: 'live', teamCount: 16, rounds: 1,
    startedAt: new Date(), completedAt: new Date(),
    slotOrder: rosters.map((r, i) => ({ slot: i + 1, rosterId: r.id, displayName: `Manager ${i}` })).reverse(),
  }, select: { id: true } })
  return { id, draftId, rosters, participants, settings }
}

async function counts(f: Fixture) {
  const [tribes, members, players, channels, idols, intro, ready, initialized] = await Promise.all([
    prisma.survivorTribe.count({ where: { leagueId: f.id } }),
    prisma.survivorTribeMember.count({ where: { tribe: { leagueId: f.id } } }),
    prisma.survivorPlayer.count({ where: { leagueId: f.id } }),
    prisma.survivorChatChannel.count({ where: { leagueId: f.id } }),
    prisma.survivorIdol.count({ where: { leagueId: f.id } }),
    prisma.survivorChatMessage.count({ where: { leagueId: f.id, contentType: 'survivor_intro' } }),
    prisma.survivorAuditEntry.count({ where: { leagueId: f.id, action: 'draft_setup_ready' } }),
    prisma.survivorAuditEntry.count({ where: { leagueId: f.id, action: 'phase_2_initialized' } }),
  ])
  return { tribes, members, players, channels, idols, intro, ready, initialized }
}

async function verifyMembership(f: Fixture, host = false) {
  const cast = await prisma.survivorPlayer.findMany({ where: { leagueId: f.id }, select: { userId: true, redraftRosterId: true, tribeId: true, idolIds: true } })
  assert.equal(cast.length, 16)
  for (const r of f.rosters) assert.equal(cast.find((p) => p.userId === r.platformUserId)?.redraftRosterId, r.id)
  const channels = await prisma.survivorChatChannel.findMany({ where: { leagueId: f.id }, select: { channelType: true, tribeId: true, memberUserIds: true } })
  for (const c of channels.filter((c) => c.channelType === 'tribe')) {
    assert.deepEqual([...c.memberUserIds].sort(), [...cast.filter((p) => p.tribeId === c.tribeId).map((p) => p.userId), ...(host ? [users[0]] : [])].sort())
  }
  const idols = await prisma.survivorIdol.findMany({ where: { leagueId: f.id }, select: { id: true, currentOwnerUserId: true, rosterId: true, isSecret: true, isPubliclyKnown: true } })
  for (const idol of idols) {
    assert.equal(idol.isSecret, true); assert.equal(idol.isPubliclyKnown, false)
    const owner = cast.find((p) => p.userId === idol.currentOwnerUserId)
    assert.equal(owner?.redraftRosterId, idol.rosterId)
    assert.ok(owner?.idolIds.includes(idol.id))
  }
}

async function cleanup() {
  // Never enumerate or delete pre-existing rows; all IDs were created by this process.
  for (const leagueId of leagues) {
    await prisma.survivorIdolLedgerEntry.deleteMany({ where: { leagueId } })
    await prisma.survivorIdol.deleteMany({ where: { leagueId } })
    await prisma.survivorChatMessage.deleteMany({ where: { leagueId } })
    await prisma.survivorChatChannel.deleteMany({ where: { leagueId } })
    await prisma.survivorTribeMember.deleteMany({ where: { tribe: { leagueId } } })
    await prisma.survivorPlayer.deleteMany({ where: { leagueId } })
    await prisma.survivorTribe.deleteMany({ where: { leagueId } })
    await prisma.survivorGameState.deleteMany({ where: { leagueId } })
    await prisma.survivorAuditEntry.deleteMany({ where: { leagueId } })
    await prisma.survivorLeagueConfig.deleteMany({ where: { leagueId } })
    await prisma.league.delete({ where: { id: leagueId } })
  }
  await prisma.appUser.deleteMany({ where: { id: { in: users } } })
}

async function main() {
  if (!process.argv.includes('--db')) { console.log('Opt in with --db and an existing recognized test DATABASE_URL.'); return }
  // This proof does not permit the production seed override.
  const identity = createRequire(import.meta.url)('./db-target-identity.cjs')
  assert.equal(identity.identifyTarget(process.env.DATABASE_URL).kind, 'safe', 'A recognized non-production DATABASE_URL is required')
  assertSafeSeedTarget('verify-survivor-draft-setup')
  await prisma.appUser.createMany({ data: users.map((id, i) => ({ id, email: `${id}@example.invalid`, username: id, displayName: `Test manager ${i}` })) })
  try {
    const concurrent = await fixture('concurrent')
    const results = await Promise.all([runSurvivorPostDraftBootstrap(concurrent.id), runSurvivorPostDraftBootstrap(concurrent.id)])
    assert.ok(results.every((r) => r.setupComplete))
    const expected = { tribes: 4, members: 16, players: 16, channels: 5, idols: 19, intro: 1, ready: 1, initialized: 1 }
    assert.deepEqual(await counts(concurrent), expected)
    await verifyMembership(concurrent)
    const before = await prisma.survivorGameState.findUnique({ where: { leagueId: concurrent.id } })
    assert.equal(before?.phase, 'pre_merge')
    assert.equal((await initializeSurvivorPhase2(concurrent.id, { mode: 'random' })).complete, true)
    assert.deepEqual(await counts(concurrent), expected)
    const after = await prisma.survivorGameState.findUnique({ where: { leagueId: concurrent.id } })
    assert.equal(after?.preMergeStartedAt?.getTime(), before?.preMergeStartedAt?.getTime())
    console.log('PASS concurrent setup, actual roster links, hidden inventory, private membership, repeat intro/timestamps')

    const host = await fixture('host', { commissionerParticipationMode: 'non_participating_host' })
    assert.equal((await runSurvivorPostDraftBootstrap(host.id)).setupComplete, true)
    await verifyMembership(host, true)
    console.log('PASS non-participating host excluded from cast and included in oversight chats')

    const optional = await fixture('optional', { idolsEnabled: false, tribeChatsEnabled: false, exileEnabled: false })
    assert.equal((await runSurvivorPostDraftBootstrap(optional.id)).setupComplete, true)
    assert.deepEqual(await counts(optional), { ...expected, idols: 0, channels: 1 })
    assert.equal(await prisma.survivorLeagueConfig.count({ where: { leagueId: { in: leagues }, exileLeague: { isNot: null } } }), 0)
    console.log('PASS optional idols/chats and no automatic Exile side league')

    const pattern = await fixture('pattern', { tribeAssignmentMode: 'draft_pattern' })
    assert.equal((await runSurvivorPostDraftBootstrap(pattern.id)).setupComplete, true)
    const patternTribes = await prisma.survivorTribe.findMany({ where: { leagueId: pattern.id }, select: { slotIndex: true, members: { select: { rosterId: true } } } })
    for (const tribe of patternTribes) assert.deepEqual(tribe.members.map((m) => m.rosterId).sort(), pattern.rosters.filter((_, i) => i % 4 === tribe.slotIndex).map((r) => r.id).sort())
    console.log('PASS draft-pattern tribes derive from ordered roster slots')

    const manual = await fixture('manual', { tribeAssignmentMode: 'commissioner_manual' })
    assert.equal((await runSurvivorPostDraftBootstrap(manual.id)).setupComplete, false)
    assert.equal((await counts(manual)).tribes, 0)
    const mapping = Object.fromEntries(manual.participants.map((u, i) => [u, i % 4]))
    assert.equal((await initializeSurvivorPhase2(manual.id, { manualMapping: mapping })).complete, true)
    assert.equal((await counts(manual)).ready, 1)
    console.log('PASS manual assignment stays pending until a complete balanced mapping is supplied')

    const seat = await fixture('seat')
    await prisma.roster.update({ where: { id: seat.rosters[15].id }, data: { platformUserId: `open-slot-${seat.id}-15` }, select: { id: true } })
    assert.equal((await runSurvivorPostDraftBootstrap(seat.id)).setupComplete, false)
    assert.equal((await counts(seat)).tribes, 0)
    assert.equal(await prisma.survivorPlayer.count({ where: { leagueId: seat.id, userId: { startsWith: 'open-slot-' } } }), 15)
    await prisma.roster.update({ where: { id: seat.rosters[15].id }, data: { platformUserId: seat.participants[15] }, select: { id: true } })
    assert.equal((await runSurvivorPostDraftBootstrap(seat.id)).setupComplete, true)
    await verifyMembership(seat)
    console.log('PASS unclaimed seat preserves setup then recovers after ownership is resolved')

    const hostMismatch = await fixture('host-mismatch')
    await prisma.league.update({ where: { id: hostMismatch.id }, data: { settings: buildSurvivorSettingsSnapshotPatch(normalizeSurvivorFoundationSettings({ ...hostMismatch.settings, commissionerParticipationMode: 'non_participating_host' })) }, select: { id: true } })
    assert.equal((await runSurvivorPostDraftBootstrap(hostMismatch.id)).setupComplete, false)
    assert.equal((await counts(hostMismatch)).tribes, 0)
    await prisma.league.update({ where: { id: hostMismatch.id }, data: { settings: buildSurvivorSettingsSnapshotPatch(hostMismatch.settings) }, select: { id: true } })
    assert.equal((await runSurvivorPostDraftBootstrap(hostMismatch.id)).setupComplete, true)
    console.log('PASS commissioner ownership mismatch blocks setup and recovers without deleting the commissioner')

    const unfinished = await fixture('unfinished')
    await prisma.draftSession.update({ where: { id: unfinished.draftId }, data: { status: 'in_progress' }, select: { id: true } })
    assert.equal((await initializeSurvivorPhase2(unfinished.id)).complete, false)
    assert.equal((await runSurvivorPostDraftBootstrap(unfinished.id)).setupComplete, false)
    assert.equal((await counts(unfinished)).tribes, 0)
    await prisma.draftSession.update({ where: { id: unfinished.draftId }, data: { status: 'completed', sessionKind: 'mock' }, select: { id: true } })
    assert.equal((await runSurvivorPostDraftBootstrap(unfinished.id)).setupComplete, false)
    await prisma.league.update({ where: { id: unfinished.id }, data: { platform: 'sleeper' }, select: { id: true } })
    assert.equal((await runSurvivorPostDraftBootstrap(unfinished.id, { canonicalOnly: true })).setupComplete, undefined)
    assert.equal((await counts(unfinished)).channels, 0)
    console.log('PASS incomplete/mock drafts and provider-imported repair polls make no setup changes')

    const rollback = await fixture('rollback')
    await assert.rejects(withSurvivorSetupTransaction(rollback.id, async (db) => {
      assert.equal((await prepareSurvivorDraftParticipants(rollback.id, rollback.draftId, db)).ok, true)
      assert.equal((await assignSurvivorTribes(rollback.id, { seed: 1, db })).ok, true)
      await provisionSurvivorChats(rollback.id, { db })
      assert.equal((await seedSurvivorIdols(rollback.id, { seed: 1, db })).ok, true)
      await postSurvivorIntroAnnouncement(rollback.id, { db })
      throw new Error('injected failure before commit')
    }), /injected failure/)
    assert.deepEqual(await counts(rollback), { tribes: 0, members: 0, players: 16, channels: 0, idols: 0, intro: 0, ready: 0, initialized: 0 })
    assert.equal(await prisma.survivorLeagueConfig.count({ where: { leagueId: rollback.id } }), 0)
    assert.equal((await runSurvivorPostDraftBootstrap(rollback.id)).setupComplete, true)
    console.log('PASS transaction rollback restores placeholders/config/tribes/chats/idols/intro; subsequent retry succeeds')

    const progressed = await fixture('progressed')
    await prisma.survivorGameState.update({ where: { leagueId: progressed.id }, data: { phase: 'merge', currentWeek: 8 }, select: { id: true } })
    assert.equal((await runSurvivorPostDraftBootstrap(progressed.id)).setupComplete, true)
    assert.equal((await counts(progressed)).tribes, 0)
    assert.equal((await prisma.survivorGameState.findUnique({ where: { leagueId: progressed.id } }))?.phase, 'merge')
    console.log('PASS progressed gameplay is preserved')
  } finally { await cleanup(); console.log('Cleaned up all fixtures created by this run.') }
}

main().catch((error) => {
  console.error(String(error?.stack ?? error).replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[redacted]'))
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
