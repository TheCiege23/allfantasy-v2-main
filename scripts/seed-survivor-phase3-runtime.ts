import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import {
  buildSurvivorLeagueColumnPatch,
  buildSurvivorSettingsSnapshotPatch,
  normalizeSurvivorFoundationSettings,
} from '../lib/survivor/normalizeSurvivorSettings'
import { assertSafeSeedTarget } from './_assert-safe-seed-target'

const prisma = new PrismaClient()

/**
 * Phase 3 runtime seed. Sets up a FULLY initialized Survivor league (tribes + chats + the 19
 * Phase 2 Vote Shield idols + one Extra Vote + one Skip Tribal) and an OPEN Tribal Council for the
 * first tribe, so the runtime spec can drive the real voting/idol/tally/reveal/elimination flow.
 *
 * The first (attending) tribe has known-login members so the spec can act as several players:
 *   member  → holds a Vote Shield   (votes p01, then plays the shield to protect self)
 *   p01     → holds an Extra Vote    (votes member, plays extra at p02)
 *   p02     → holds a Skip Tribal    (plays skip → safe target)
 *   p03     → (no power)             (votes member → blocked by member's shield at tally)
 */
export const SURVIVOR_PHASE3_RUNTIME_SEED = {
  hostLeagueId: 'survivor-phase3-runtime-host-league',
  playerLeagueId: 'survivor-phase3-runtime-player-league',
  commissionerUserId: 'survivor-phase3-runtime-commissioner',
  commissionerLogin: 'survivor_phase3_commish',
  password: 'Password123!',
  season: 2026,
  castSize: 16,
  rosterSize: 15,
  tribeCount: 4,
  voteShieldCount: 19,
  attendingTribeIndex: 0,
  // Known attending-tribe member logins (host league).
  members: {
    member: { id: 'sp3-host-m0', login: 'survivor_phase3_member', power: 'vote_shield' },
    p01: { id: 'sp3-host-m4', login: 'survivor_phase3_p01', power: 'extra_vote' },
    p02: { id: 'sp3-host-m8', login: 'survivor_phase3_p02', power: 'skip_tribal' },
    p03: { id: 'sp3-host-m12', login: 'survivor_phase3_p03', power: 'none' },
  },
} as const

type SeedUser = { id: string; username: string; email: string; displayName: string }

function generatedUsers(prefix: string, count: number): SeedUser[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1
    return {
      id: `${prefix}-user-${String(n).padStart(2, '0')}`,
      username: `${prefix}_user_${String(n).padStart(2, '0')}`,
      email: `${prefix}-user-${String(n).padStart(2, '0')}@example.com`,
      displayName: `Phase3 ${prefix} Player ${n}`,
    }
  })
}

async function upsertUser(user: SeedUser, passwordHash: string) {
  await prisma.appUser.upsert({
    where: { id: user.id },
    create: { id: user.id, email: user.email, username: user.username, displayName: user.displayName, passwordHash, emailVerified: new Date() },
    update: { email: user.email, username: user.username, displayName: user.displayName, passwordHash, emailVerified: new Date() },
  })
}

async function clearSurvivorRows(leagueId: string) {
  await prisma.survivorIdolLedgerEntry.deleteMany({ where: { idol: { leagueId } } }).catch(() => undefined)
  await prisma.survivorVote.deleteMany({ where: { leagueId } })
  await prisma.survivorTribalCouncil.deleteMany({ where: { leagueId } })
  await prisma.survivorIdol.deleteMany({ where: { leagueId } })
  await prisma.survivorChatMessage.deleteMany({ where: { leagueId } }).catch(() => undefined)
  await prisma.survivorChatChannel.deleteMany({ where: { leagueId } })
  await prisma.survivorTribeMember.deleteMany({ where: { tribe: { leagueId } } })
  await prisma.survivorPlayer.deleteMany({ where: { leagueId } })
  await prisma.survivorTribe.deleteMany({ where: { leagueId } })
  await prisma.survivorGameState.deleteMany({ where: { leagueId } })
  await prisma.survivorAuditEntry.deleteMany({ where: { leagueId } })
  await prisma.survivorLeagueConfig.deleteMany({ where: { leagueId } })
  await prisma.roster.deleteMany({ where: { leagueId } })
  await prisma.leagueTeam.deleteMany({ where: { leagueId } })
}

const COMMISSIONER: SeedUser = {
  id: SURVIVOR_PHASE3_RUNTIME_SEED.commissionerUserId,
  username: SURVIVOR_PHASE3_RUNTIME_SEED.commissionerLogin,
  email: 'survivor-phase3-commish@example.com',
  displayName: 'Phase3 Commissioner',
}

async function seedLeague(input: { leagueId: string; name: string; commissionerParticipates: boolean; prefix: string }) {
  const S = SURVIVOR_PHASE3_RUNTIME_SEED
  const settings = normalizeSurvivorFoundationSettings({
    commissionerParticipationMode: input.commissionerParticipates ? 'participating_player' : 'non_participating_host',
    defaultTeamCount: S.castSize,
    tribeCount: S.tribeCount,
  })
  const settingsSnapshot = buildSurvivorSettingsSnapshotPatch(settings)
  const columnPatch = buildSurvivorLeagueColumnPatch(settings)

  await clearSurvivorRows(input.leagueId)

  await prisma.league.upsert({
    where: { id: input.leagueId },
    create: {
      id: input.leagueId,
      userId: S.commissionerUserId,
      platform: 'allfantasy',
      platformLeagueId: input.leagueId,
      name: input.name,
      sport: 'NFL',
      season: S.season,
      leagueSize: S.castSize,
      scoring: 'HALF_PPR',
      isDynasty: false,
      rosterSize: S.rosterSize,
      leagueType: 'survivor',
      leagueVariant: 'survivor',
      status: 'active',
      lifecycleState: 'in_season',
      settingsSnapshotVersion: 1,
      settings: { seed: 'survivor-phase3-runtime', ...settingsSnapshot },
      ...columnPatch,
    },
    update: {
      userId: S.commissionerUserId,
      name: input.name,
      rosterSize: S.rosterSize,
      leagueType: 'survivor',
      leagueVariant: 'survivor',
      status: 'active',
      lifecycleState: 'in_season',
      settings: { seed: 'survivor-phase3-runtime', ...settingsSnapshot },
      ...columnPatch,
    },
  })

  const config = await prisma.survivorLeagueConfig.create({
    data: { leagueId: input.leagueId, tribeCount: S.tribeCount, tribeSize: 4, tribeFormation: 'random', mergePlayerCount: settings.mergeActivePlayerCount, selfVoteDisallowed: !settings.selfVotesAllowed },
  })

  // Tribes.
  const tribes = await Promise.all(
    Array.from({ length: S.tribeCount }, (_, i) =>
      prisma.survivorTribe.create({
        data: { id: `${input.leagueId}-tribe-${i}`, leagueId: input.leagueId, configId: config.id, name: `Tribe ${i + 1}`, slotIndex: i, colorHex: ['#ef4444', '#3b82f6', '#22c55e', '#eab308'][i] },
      }),
    ),
  )

  // Participants. Host league: 16 non-commissioner players. Player league: commissioner is a player.
  const pool = generatedUsers(input.prefix, S.castSize)
  const participants: SeedUser[] = input.commissionerParticipates ? [COMMISSIONER, ...pool.slice(0, S.castSize - 1)] : pool

  // Map known attending-tribe logins onto the players that land in tribe 0 under the
  // round-robin (tribeId = index % tribeCount), i.e. indices 0, 4, 8, 12 — so member/p01/p02/p03
  // all share the attending tribe.
  if (!input.commissionerParticipates && input.prefix === 'sp3-host') {
    const tc = S.tribeCount
    participants[0] = { id: S.members.member.id, username: S.members.member.login, email: `${S.members.member.id}@example.com`, displayName: 'Phase3 Member' }
    participants[tc] = { id: S.members.p01.id, username: S.members.p01.login, email: `${S.members.p01.id}@example.com`, displayName: 'Phase3 P01' }
    participants[tc * 2] = { id: S.members.p02.id, username: S.members.p02.login, email: `${S.members.p02.id}@example.com`, displayName: 'Phase3 P02' }
    participants[tc * 3] = { id: S.members.p03.id, username: S.members.p03.login, email: `${S.members.p03.id}@example.com`, displayName: 'Phase3 P03' }
  }

  const passwordHash = await bcrypt.hash(S.password, 10)
  const playerRecords: Array<{ userId: string; rosterId: string; tribeId: string }> = []
  for (let i = 0; i < participants.length; i += 1) {
    const user = participants[i]
    await upsertUser(user, passwordHash)
    const rosterId = `${input.leagueId}-roster-${String(i + 1).padStart(2, '0')}`
    const tribeId = `${input.leagueId}-tribe-${i % S.tribeCount}`
    await prisma.roster.create({ data: { id: rosterId, leagueId: input.leagueId, platformUserId: user.id, playerData: { seed: 'survivor-phase3-runtime', players: [] } } })
    await prisma.survivorPlayer.create({
      data: { leagueId: input.leagueId, userId: user.id, displayName: user.displayName, playerState: 'active', redraftRosterId: rosterId, tribeId, canAccessTribeChat: true },
    })
    await prisma.survivorTribeMember.create({ data: { tribeId, rosterId } })
    playerRecords.push({ userId: user.id, rosterId, tribeId })
  }

  // Commissioner LeagueTeam (host).
  await prisma.leagueTeam.create({
    data: { id: `${input.leagueId}-commish-team`, leagueId: input.leagueId, externalId: `${input.leagueId}-commish-team`, ownerName: 'Phase3 Commissioner', teamName: 'Phase3 Host', claimedByUserId: S.commissionerUserId, platformUserId: S.commissionerUserId, role: 'commissioner', isCommissioner: true },
  })

  // Chats: league + per-tribe (members + non-participating host).
  const hostIds = input.commissionerParticipates ? [] : [S.commissionerUserId]
  await prisma.survivorChatChannel.create({ data: { leagueId: input.leagueId, name: 'Island', channelType: 'league', memberUserIds: [...participants.map((p) => p.id), ...hostIds] } })
  for (const tribe of tribes) {
    const members = playerRecords.filter((p) => p.tribeId === tribe.id).map((p) => p.userId)
    const ch = await prisma.survivorChatChannel.create({ data: { leagueId: input.leagueId, name: `${tribe.name} Tribe`, channelType: 'tribe', tribeId: tribe.id, memberUserIds: [...members, ...hostIds] } })
    await prisma.survivorTribe.update({ where: { id: tribe.id }, data: { chatChannelId: ch.id } })
  }

  // Idols: 19 Vote Shield + 1 Extra Vote + 1 Skip Tribal. Known holders in the attending tribe.
  async function createIdol(ownerUserId: string, rosterId: string, powerType: string, label: string) {
    const idol = await prisma.survivorIdol.create({
      data: {
        leagueId: input.leagueId,
        configId: config.id,
        rosterId,
        playerId: rosterId,
        powerType,
        powerLabel: label,
        powerCategory: powerType === 'vote_shield' ? 'protection' : 'voting',
        status: 'hidden',
        isSecret: true,
        isPubliclyKnown: false,
        currentOwnerUserId: ownerUserId,
        originalOwnerUserId: ownerUserId,
        expiresAtMerge: false,
        validUntilPhase: 'final_5',
        auditLog: { assignedSource: 'phase3_seed' },
      },
      select: { id: true },
    })
    await prisma.survivorIdolLedgerEntry.create({ data: { leagueId: input.leagueId, idolId: idol.id, eventType: 'assigned', toRosterId: rosterId, metadata: { source: 'phase3_seed', powerType } } })
  }

  const byUser = new Map(playerRecords.map((p) => [p.userId, p]))
  // Distribute 19 vote shields round-robin across all players.
  for (let i = 0; i < S.voteShieldCount; i += 1) {
    const p = playerRecords[i % playerRecords.length]
    await createIdol(p.userId, p.rosterId, 'vote_shield', 'Vote Shield Idol')
  }
  if (!input.commissionerParticipates && input.prefix === 'sp3-host') {
    // Guarantee the known holders own the powers the spec exercises.
    const member = byUser.get(S.members.member.id)!
    const p01 = byUser.get(S.members.p01.id)!
    const p02 = byUser.get(S.members.p02.id)!
    // Ensure member holds at least one vote_shield (round-robin gave index 0 a shield already).
    await createIdol(p01.userId, p01.rosterId, 'extra_vote', 'Extra Vote')
    await createIdol(p02.userId, p02.rosterId, 'skip_tribal', 'Skip Tribal')
  } else {
    // Player league still gets an extra vote + skip tribal for completeness.
    await createIdol(playerRecords[1].userId, playerRecords[1].rosterId, 'extra_vote', 'Extra Vote')
    await createIdol(playerRecords[2].userId, playerRecords[2].rosterId, 'skip_tribal', 'Skip Tribal')
  }

  // Game state: pre-merge, week 3.
  await prisma.survivorGameState.create({
    data: { leagueId: input.leagueId, phase: 'pre_merge', currentWeek: 3, activeTribeCount: S.tribeCount, activePlayerCount: participants.length, preMergeStartedAt: new Date() },
  })

  // Open Tribal Council for the attending tribe (window open, deadline in the future).
  const attendingTribeId = `${input.leagueId}-tribe-${S.attendingTribeIndex}`
  const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const council = await prisma.survivorTribalCouncil.create({
    data: {
      leagueId: input.leagueId,
      configId: config.id,
      week: 3,
      councilNumber: 1,
      phase: 'pre_merge',
      attendingTribeId,
      status: 'voting_open',
      votingOpensAt: new Date(),
      votingDeadline: deadline,
      voteDeadlineAt: deadline,
      isRevealed: false,
      auditLog: { seededOpen: true },
    },
    select: { id: true },
  })
  await prisma.survivorGameState.update({ where: { leagueId: input.leagueId }, data: { activeCouncilId: council.id, tribalOpenedAt: new Date(), tribalDeadline: deadline, needsTribalLock: true } })
}

/** Free the known logins if a stale run left them attached to a different user id. */
async function reconcileKnownLogins() {
  const S = SURVIVOR_PHASE3_RUNTIME_SEED
  const known: Array<{ id: string; login: string }> = [
    { id: S.commissionerUserId, login: S.commissionerLogin },
    { id: S.members.member.id, login: S.members.member.login },
    { id: S.members.p01.id, login: S.members.p01.login },
    { id: S.members.p02.id, login: S.members.p02.login },
    { id: S.members.p03.id, login: S.members.p03.login },
  ]
  for (const k of known) {
    const holder = await prisma.appUser.findUnique({ where: { username: k.login }, select: { id: true } })
    if (holder && holder.id !== k.id) {
      await prisma.appUser.update({ where: { id: holder.id }, data: { username: `stale-${holder.id}-${Date.now()}` } })
    }
  }
}

async function main() {
  // Fail closed before the first write: these fixtures create login accounts whose password
  // is hardcoded in this public repo, so seeding a real environment publishes credentials.
  assertSafeSeedTarget('seed-survivor-phase3-runtime')

  await reconcileKnownLogins()
  await upsertUser(COMMISSIONER, await bcrypt.hash(SURVIVOR_PHASE3_RUNTIME_SEED.password, 10))
  await seedLeague({ leagueId: SURVIVOR_PHASE3_RUNTIME_SEED.hostLeagueId, name: 'Runtime Survivor Phase 3 Host', commissionerParticipates: false, prefix: 'sp3-host' })
  await seedLeague({ leagueId: SURVIVOR_PHASE3_RUNTIME_SEED.playerLeagueId, name: 'Runtime Survivor Phase 3 Player Commissioner', commissionerParticipates: true, prefix: 'sp3-player' })
  console.log(JSON.stringify(SURVIVOR_PHASE3_RUNTIME_SEED, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
