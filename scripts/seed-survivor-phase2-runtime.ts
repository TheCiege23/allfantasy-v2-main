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
 * Phase 2 runtime seed. Unlike the foundation seed, this leaves the league UN-initialized:
 * active SurvivorPlayers + rosters exist, but NO tribes, chats, idols, or councils. The Phase 2
 * route actions (assign-tribes / create-tribe-chats / seed-idols / post-intro / initialize-survivor)
 * are what create those — so the runtime spec proves the flow is real, idempotent, and private.
 *
 * rosterSize = 15 and tribeCount = 4 → idol count must seed to 15 + 4 = 19 Vote Shield idols.
 */
export const SURVIVOR_PHASE2_RUNTIME_SEED = {
  hostLeagueId: 'survivor-phase2-runtime-host-league',
  playerLeagueId: 'survivor-phase2-runtime-player-league',
  commissionerUserId: 'survivor-phase2-runtime-commissioner',
  memberUserId: 'survivor-phase2-runtime-member',
  commissionerLogin: 'survivor_phase2_commish',
  memberLogin: 'survivor_phase2_member',
  password: 'Password123!',
  season: 2026,
  castSize: 16,
  rosterSize: 15,
  tribeCount: 4,
  expectedIdolCount: 19,
} as const

type SeedUser = { id: string; username: string; email: string; displayName: string }

const coreUsers: SeedUser[] = [
  {
    id: SURVIVOR_PHASE2_RUNTIME_SEED.commissionerUserId,
    username: SURVIVOR_PHASE2_RUNTIME_SEED.commissionerLogin,
    email: 'survivor-phase2-commish@example.com',
    displayName: 'Phase2 Commissioner',
  },
  {
    id: SURVIVOR_PHASE2_RUNTIME_SEED.memberUserId,
    username: SURVIVOR_PHASE2_RUNTIME_SEED.memberLogin,
    email: 'survivor-phase2-member@example.com',
    displayName: 'Phase2 Member',
  },
]

function generatedUsers(prefix: string, count: number): SeedUser[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1
    return {
      id: `${prefix}-user-${String(n).padStart(2, '0')}`,
      username: `${prefix}_user_${String(n).padStart(2, '0')}`,
      email: `${prefix}-user-${String(n).padStart(2, '0')}@example.com`,
      displayName: `Phase2 Player ${n}`,
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
  await prisma.survivorAuditLog.deleteMany({ where: { leagueId } }).catch(() => undefined)
  await prisma.survivorLeagueConfig.deleteMany({ where: { leagueId } })
  await prisma.roster.deleteMany({ where: { leagueId } })
  await prisma.leagueTeam.deleteMany({ where: { leagueId } })
}

async function seedLeague(input: { leagueId: string; name: string; commissionerParticipates: boolean; generatedPrefix: string }) {
  const settings = normalizeSurvivorFoundationSettings({
    commissionerParticipationMode: input.commissionerParticipates ? 'participating_player' : 'non_participating_host',
    defaultTeamCount: SURVIVOR_PHASE2_RUNTIME_SEED.castSize,
    tribeCount: SURVIVOR_PHASE2_RUNTIME_SEED.tribeCount,
  })
  const settingsSnapshot = buildSurvivorSettingsSnapshotPatch(settings)
  const columnPatch = buildSurvivorLeagueColumnPatch(settings)

  await clearSurvivorRows(input.leagueId)

  await prisma.league.upsert({
    where: { id: input.leagueId },
    create: {
      id: input.leagueId,
      userId: SURVIVOR_PHASE2_RUNTIME_SEED.commissionerUserId,
      platform: 'allfantasy',
      platformLeagueId: input.leagueId,
      name: input.name,
      sport: 'NFL',
      season: SURVIVOR_PHASE2_RUNTIME_SEED.season,
      leagueSize: SURVIVOR_PHASE2_RUNTIME_SEED.castSize,
      scoring: 'HALF_PPR',
      isDynasty: false,
      rosterSize: SURVIVOR_PHASE2_RUNTIME_SEED.rosterSize,
      leagueType: 'survivor',
      leagueVariant: 'survivor',
      status: 'active',
      lifecycleState: 'in_season',
      settingsSnapshotVersion: 1,
      settings: { seed: 'survivor-phase2-runtime', ...settingsSnapshot },
      ...columnPatch,
    },
    update: {
      userId: SURVIVOR_PHASE2_RUNTIME_SEED.commissionerUserId,
      name: input.name,
      rosterSize: SURVIVOR_PHASE2_RUNTIME_SEED.rosterSize,
      leagueType: 'survivor',
      leagueVariant: 'survivor',
      status: 'active',
      lifecycleState: 'in_season',
      settings: { seed: 'survivor-phase2-runtime', ...settingsSnapshot },
      ...columnPatch,
    },
  })

  const playerPool = generatedUsers(input.generatedPrefix, SURVIVOR_PHASE2_RUNTIME_SEED.castSize)
  // Member user is always a non-commissioner participant for the 403 check.
  const participants: SeedUser[] = input.commissionerParticipates
    ? [coreUsers[0], coreUsers[1], ...playerPool.slice(0, SURVIVOR_PHASE2_RUNTIME_SEED.castSize - 2)]
    : [coreUsers[1], ...playerPool.slice(0, SURVIVOR_PHASE2_RUNTIME_SEED.castSize - 1)]

  for (let index = 0; index < participants.length; index += 1) {
    const user = participants[index]
    const rosterId = `${input.leagueId}-roster-${String(index + 1).padStart(2, '0')}`
    await prisma.roster.create({
      data: { id: rosterId, leagueId: input.leagueId, platformUserId: user.id, playerData: { seed: 'survivor-phase2-runtime', players: [] } },
    })
    await prisma.survivorPlayer.create({
      data: {
        leagueId: input.leagueId,
        userId: user.id,
        displayName: user.displayName,
        playerState: 'active',
        redraftRosterId: rosterId,
        // NO tribeId — Phase 2 assignment sets it.
      },
    })
  }

  await prisma.leagueTeam.create({
    data: {
      id: `${input.leagueId}-commish-team`,
      leagueId: input.leagueId,
      externalId: `${input.leagueId}-commish-team`,
      ownerName: 'Phase2 Commissioner',
      teamName: 'Phase2 Host',
      claimedByUserId: SURVIVOR_PHASE2_RUNTIME_SEED.commissionerUserId,
      platformUserId: SURVIVOR_PHASE2_RUNTIME_SEED.commissionerUserId,
      role: 'commissioner',
      isCommissioner: true,
    },
  })
}

async function main() {
  // Fail closed before the first write: these fixtures create login accounts whose password
  // is hardcoded in this public repo, so seeding a real environment publishes credentials.
  assertSafeSeedTarget('seed-survivor-phase2-runtime')

  const passwordHash = await bcrypt.hash(SURVIVOR_PHASE2_RUNTIME_SEED.password, 10)
  const generated = [...generatedUsers('sp2-host', SURVIVOR_PHASE2_RUNTIME_SEED.castSize), ...generatedUsers('sp2-player', SURVIVOR_PHASE2_RUNTIME_SEED.castSize)]
  for (const user of [...coreUsers, ...generated]) await upsertUser(user, passwordHash)
  await seedLeague({ leagueId: SURVIVOR_PHASE2_RUNTIME_SEED.hostLeagueId, name: 'Runtime Survivor Phase 2 Host', commissionerParticipates: false, generatedPrefix: 'sp2-host' })
  await seedLeague({ leagueId: SURVIVOR_PHASE2_RUNTIME_SEED.playerLeagueId, name: 'Runtime Survivor Phase 2 Player Commissioner', commissionerParticipates: true, generatedPrefix: 'sp2-player' })
  console.log(JSON.stringify(SURVIVOR_PHASE2_RUNTIME_SEED, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
