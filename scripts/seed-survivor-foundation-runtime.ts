import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import {
  buildSurvivorLeagueColumnPatch,
  buildSurvivorSettingsSnapshotPatch,
  normalizeSurvivorFoundationSettings,
} from '../lib/survivor/normalizeSurvivorSettings'
import { assertSafeSeedTarget } from './_assert-safe-seed-target'

const prisma = new PrismaClient()

export const SURVIVOR_FOUNDATION_RUNTIME_SEED = {
  hostLeagueId: 'survivor-foundation-runtime-host-league',
  playerLeagueId: 'survivor-foundation-runtime-player-league',
  commissionerUserId: 'survivor-foundation-runtime-commissioner',
  memberUserId: 'survivor-foundation-runtime-member',
  outsiderUserId: 'survivor-foundation-runtime-outsider',
  commissionerLogin: 'survivor_foundation_commish',
  memberLogin: 'survivor_foundation_member',
  outsiderLogin: 'survivor_foundation_outsider',
  password: 'Password123!',
  season: 2026,
  teamCount: 20,
  tribeCount: 4,
} as const

type SeedUser = { id: string; username: string; email: string; displayName: string }

const coreUsers: SeedUser[] = [
  {
    id: SURVIVOR_FOUNDATION_RUNTIME_SEED.commissionerUserId,
    username: SURVIVOR_FOUNDATION_RUNTIME_SEED.commissionerLogin,
    email: 'survivor-foundation-commish@example.com',
    displayName: 'Foundation Commissioner',
  },
  {
    id: SURVIVOR_FOUNDATION_RUNTIME_SEED.memberUserId,
    username: SURVIVOR_FOUNDATION_RUNTIME_SEED.memberLogin,
    email: 'survivor-foundation-member@example.com',
    displayName: 'Foundation Member',
  },
  {
    id: SURVIVOR_FOUNDATION_RUNTIME_SEED.outsiderUserId,
    username: SURVIVOR_FOUNDATION_RUNTIME_SEED.outsiderLogin,
    email: 'survivor-foundation-outsider@example.com',
    displayName: 'Foundation Outsider',
  },
]

function generatedUsers(prefix: string, count: number): SeedUser[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1
    return {
      id: `${prefix}-user-${String(n).padStart(2, '0')}`,
      username: `${prefix}_user_${String(n).padStart(2, '0')}`,
      email: `${prefix}-user-${String(n).padStart(2, '0')}@example.com`,
      displayName: `Foundation Player ${n}`,
    }
  })
}

async function upsertUser(user: SeedUser, passwordHash: string) {
  await prisma.appUser.upsert({
    where: { id: user.id },
    create: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      passwordHash,
      emailVerified: new Date(),
    },
    update: {
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      passwordHash,
      emailVerified: new Date(),
    },
  })
}

async function clearSurvivorRows(leagueId: string) {
  await prisma.survivorVote.deleteMany({ where: { leagueId } })
  await prisma.survivorTribalCouncil.deleteMany({ where: { leagueId } })
  await prisma.survivorIdol.deleteMany({ where: { leagueId } })
  await prisma.survivorChatChannel.deleteMany({ where: { leagueId } })
  await prisma.survivorTribeMember.deleteMany({ where: { tribe: { leagueId } } })
  await prisma.survivorPlayer.deleteMany({ where: { leagueId } })
  await prisma.survivorTribe.deleteMany({ where: { leagueId } })
  await prisma.survivorGameState.deleteMany({ where: { leagueId } })
  await prisma.survivorAuditEntry.deleteMany({ where: { leagueId } })
  await prisma.survivorAuditLog.deleteMany({ where: { leagueId } })
  await prisma.survivorLeagueConfig.deleteMany({ where: { leagueId } })
  await prisma.roster.deleteMany({ where: { leagueId } })
  await prisma.leagueTeam.deleteMany({ where: { leagueId } })
}

async function seedLeague(input: {
  leagueId: string
  name: string
  commissionerParticipates: boolean
  generatedPrefix: string
}) {
  const settings = normalizeSurvivorFoundationSettings({
    commissionerParticipationMode: input.commissionerParticipates ? 'participating_player' : 'non_participating_host',
  })
  const settingsSnapshot = buildSurvivorSettingsSnapshotPatch(settings)
  const columnPatch = buildSurvivorLeagueColumnPatch(settings)

  await clearSurvivorRows(input.leagueId)

  await prisma.league.upsert({
    where: { id: input.leagueId },
    create: {
      id: input.leagueId,
      userId: SURVIVOR_FOUNDATION_RUNTIME_SEED.commissionerUserId,
      platform: 'allfantasy',
      platformLeagueId: input.leagueId,
      name: input.name,
      sport: 'NFL',
      season: SURVIVOR_FOUNDATION_RUNTIME_SEED.season,
      leagueSize: SURVIVOR_FOUNDATION_RUNTIME_SEED.teamCount,
      scoring: 'HALF_PPR',
      isDynasty: false,
      rosterSize: 12,
      leagueType: 'survivor',
      leagueVariant: 'survivor',
      status: 'active',
      lifecycleState: 'in_season',
      settingsSnapshotVersion: 1,
      settings: {
        seed: 'survivor-foundation-runtime',
        ...settingsSnapshot,
      },
      ...columnPatch,
    },
    update: {
      userId: SURVIVOR_FOUNDATION_RUNTIME_SEED.commissionerUserId,
      name: input.name,
      sport: 'NFL',
      season: SURVIVOR_FOUNDATION_RUNTIME_SEED.season,
      leagueType: 'survivor',
      leagueVariant: 'survivor',
      status: 'active',
      lifecycleState: 'in_season',
      settings: {
        seed: 'survivor-foundation-runtime',
        ...settingsSnapshot,
      },
      ...columnPatch,
    },
  })

  const config = await prisma.survivorLeagueConfig.create({
    data: {
      leagueId: input.leagueId,
      tribeCount: 4,
      tribeSize: 5,
      tribeFormation: 'random',
      mergeTrigger: 'player_count',
      mergePlayerCount: 10,
      mergeWeek: 7,
      idolCount: 24,
      selfVoteDisallowed: true,
      challengesSystemRun: false,
    },
  })

  await prisma.survivorGameState.create({
    data: {
      leagueId: input.leagueId,
      phase: 'pre_merge',
      currentWeek: 3,
      activeTribeCount: 4,
      activePlayerCount: 20,
      activeCouncilId: `${input.leagueId}-council-1`,
      needsTribalLock: true,
    },
  })

  const tribeRows = await Promise.all(
    Array.from({ length: 4 }, async (_, index) => {
      const tribeNumber = index + 1
      return prisma.survivorTribe.create({
        data: {
          id: `${input.leagueId}-tribe-${tribeNumber}`,
          leagueId: input.leagueId,
          configId: config.id,
          name: `Foundation Tribe ${tribeNumber}`,
          slotIndex: index,
          colorHex: ['#38bdf8', '#f97316', '#22c55e', '#a855f7'][index],
        },
      })
    }),
  )

  const playerPool = generatedUsers(input.generatedPrefix, input.commissionerParticipates ? 19 : 20)
  const users = input.commissionerParticipates
    ? [coreUsers[0], coreUsers[1], ...playerPool.slice(0, 18)]
    : [coreUsers[1], ...playerPool.slice(0, 19)]

  for (let index = 0; index < users.length; index += 1) {
    const user = users[index]
    const rosterId = `${input.leagueId}-roster-${String(index + 1).padStart(2, '0')}`
    await prisma.roster.create({
      data: {
        id: rosterId,
        leagueId: input.leagueId,
        platformUserId: user.id,
        playerData: { seed: 'survivor-foundation-runtime', players: [] },
      },
    })
    await prisma.survivorPlayer.create({
      data: {
        leagueId: input.leagueId,
        userId: user.id,
        displayName: user.displayName,
        playerState: 'active',
        redraftRosterId: rosterId,
        tribeId: `${input.leagueId}-tribe-${Math.floor(index / 5) + 1}`,
      },
    })
  }

  await prisma.leagueTeam.create({
    data: {
      id: `${input.leagueId}-commish-team`,
      leagueId: input.leagueId,
      externalId: `${input.leagueId}-commish-team`,
      ownerName: 'Foundation Commissioner',
      teamName: 'Foundation Host',
      claimedByUserId: SURVIVOR_FOUNDATION_RUNTIME_SEED.commissionerUserId,
      platformUserId: SURVIVOR_FOUNDATION_RUNTIME_SEED.commissionerUserId,
      role: 'commissioner',
      isCommissioner: true,
    },
  })

  const survivorPlayers = await prisma.survivorPlayer.findMany({ where: { leagueId: input.leagueId } })
  for (const player of survivorPlayers) {
    if (!player.tribeId || !player.redraftRosterId) continue
    await prisma.survivorTribeMember.create({
      data: {
        tribeId: player.tribeId,
        rosterId: player.redraftRosterId,
      },
    })
  }

  for (const tribe of tribeRows) {
    const members = survivorPlayers.filter((player) => player.tribeId === tribe.id)
    await prisma.survivorChatChannel.create({
      data: {
        leagueId: input.leagueId,
        name: `${tribe.name} Chat`,
        channelType: 'tribe',
        tribeId: tribe.id,
        memberUserIds: members.map((player) => player.userId),
      },
    })
  }
  await prisma.survivorChatChannel.create({
    data: {
      leagueId: input.leagueId,
      name: 'Main Island',
      channelType: 'league',
      memberUserIds: survivorPlayers.map((player) => player.userId),
    },
  })

  const firstTribe = tribeRows[0]
  const firstTwo = survivorPlayers.filter((player) => player.tribeId === firstTribe.id).slice(0, 2)
  const council = await prisma.survivorTribalCouncil.create({
    data: {
      id: `${input.leagueId}-council-1`,
      leagueId: input.leagueId,
      configId: config.id,
      week: 3,
      phase: 'pre_merge',
      attendingTribeId: firstTribe.id,
      voteDeadlineAt: new Date('2026-09-15T20:00:00.000Z'),
      votingOpensAt: new Date('2026-09-14T20:00:00.000Z'),
      votingDeadline: new Date('2026-09-15T20:00:00.000Z'),
      status: 'voting_open',
      isRevealed: false,
    },
  })

  if (firstTwo[0]?.redraftRosterId && firstTwo[1]?.redraftRosterId) {
    await prisma.survivorVote.create({
      data: {
        councilId: council.id,
        leagueId: input.leagueId,
        voterRosterId: firstTwo[0].redraftRosterId,
        targetRosterId: firstTwo[1].redraftRosterId,
        voterUserId: firstTwo[0].userId,
        targetUserId: firstTwo[1].userId,
        voterName: firstTwo[0].displayName,
        targetName: firstTwo[1].displayName,
      },
    })
  }

  const owner = survivorPlayers[0]
  if (owner?.redraftRosterId) {
    await prisma.survivorIdol.create({
      data: {
        leagueId: input.leagueId,
        configId: config.id,
        rosterId: owner.redraftRosterId,
        playerId: 'survivor-foundation-runtime-player-card',
        currentOwnerUserId: owner.userId,
        originalOwnerUserId: owner.userId,
        powerType: 'vote_shield',
        status: 'hidden',
        expiresAtWeek: 5,
        isPubliclyKnown: false,
        powerLabel: 'Vote Shield',
      },
    })
  }

  await prisma.survivorAuditEntry.create({
    data: {
      leagueId: input.leagueId,
      week: 3,
      category: 'foundation',
      action: 'seeded',
      actorUserId: SURVIVOR_FOUNDATION_RUNTIME_SEED.commissionerUserId,
      data: { seed: 'survivor-foundation-runtime', noFakeGameplayState: true },
      isVisibleToCommissioner: true,
      isVisibleToPublic: false,
    },
  })
}

async function main() {
  // Fail closed before the first write: these fixtures create login accounts whose password
  // is hardcoded in this public repo, so seeding a real environment publishes credentials.
  assertSafeSeedTarget('seed-survivor-foundation-runtime')

  const passwordHash = await bcrypt.hash(SURVIVOR_FOUNDATION_RUNTIME_SEED.password, 10)
  const generated = [...generatedUsers('sf-host', 20), ...generatedUsers('sf-player', 20)]
  for (const user of [...coreUsers, ...generated]) {
    await upsertUser(user, passwordHash)
  }
  await seedLeague({
    leagueId: SURVIVOR_FOUNDATION_RUNTIME_SEED.hostLeagueId,
    name: 'Runtime Survivor Foundation Host',
    commissionerParticipates: false,
    generatedPrefix: 'sf-host',
  })
  await seedLeague({
    leagueId: SURVIVOR_FOUNDATION_RUNTIME_SEED.playerLeagueId,
    name: 'Runtime Survivor Foundation Player Commissioner',
    commissionerParticipates: true,
    generatedPrefix: 'sf-player',
  })
  console.log(JSON.stringify(SURVIVOR_FOUNDATION_RUNTIME_SEED, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
