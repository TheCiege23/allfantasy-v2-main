import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { assertSafeSeedTarget } from './_assert-safe-seed-target'

const prisma = new PrismaClient()

export const GUILLOTINE_WAR_ROOM_RUNTIME_SEED = {
  leagueId: 'gwr-runtime-nfl-guillotine-league',
  guillotineSeasonId: 'gwr-runtime-nfl-guillotine-season',
  memberUserId: 'gwr-runtime-member-user',
  commissionerUserId: 'gwr-runtime-commissioner-user',
  outsiderUserId: 'gwr-runtime-outsider-user',
  memberRosterId: 'gwr-runtime-member-roster',
  opponentRosterId: 'gwr-runtime-commish-roster',
  eliminatedRosterId: 'gwr-runtime-elim-roster',
  password: 'Password123!',
  memberLogin: 'gwr_runtime_member',
  commissionerLogin: 'gwr_runtime_commish',
  outsiderLogin: 'gwr_runtime_outsider',
  droppedPlayerId: 'gwr-drop-rb-1',
  season: 2026,
  teamCount: 12,
  currentWeek: 5,
} as const

const now = new Date()
const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

type SeedPlayer = {
  playerId: string
  playerName: string
  position: string
  team: string
  slotType: string
  adp: number
  projection?: number
  injuryStatus?: string
}

// Member roster — designed to surface real survival/roster risk: thin QB, an injured RB
// starter, and a low-floor TE. Lowest cumulative score → chop_zone (critical).
const memberPlayers: SeedPlayer[] = [
  { playerId: 'gwr-mem-qb-1', playerName: 'Guillo Member QB', position: 'QB', team: 'BUF', slotType: 'starter', adp: 30, projection: 18 },
  { playerId: 'gwr-mem-rb-1', playerName: 'Guillo Member RB1', position: 'RB', team: 'ATL', slotType: 'starter', adp: 12, projection: 15, injuryStatus: 'Out' },
  { playerId: 'gwr-mem-rb-2', playerName: 'Guillo Member RB2', position: 'RB', team: 'DET', slotType: 'starter', adp: 40, projection: 11 },
  { playerId: 'gwr-mem-wr-1', playerName: 'Guillo Member WR1', position: 'WR', team: 'MIN', slotType: 'starter', adp: 8, projection: 16 },
  { playerId: 'gwr-mem-wr-2', playerName: 'Guillo Member WR2', position: 'WR', team: 'DAL', slotType: 'starter', adp: 24, projection: 12 },
  { playerId: 'gwr-mem-wr-3', playerName: 'Guillo Member WR3', position: 'WR', team: 'LAC', slotType: 'starter', adp: 60, projection: 9 },
  { playerId: 'gwr-mem-te-1', playerName: 'Guillo Member TE', position: 'TE', team: 'KC', slotType: 'starter', adp: 70, projection: 6 },
  { playerId: 'gwr-mem-bench-1', playerName: 'Guillo Member Bench WR', position: 'WR', team: 'CIN', slotType: 'bench', adp: 90, projection: 19 },
  { playerId: 'gwr-mem-bench-2', playerName: 'Guillo Member Bench RB', position: 'RB', team: 'SEA', slotType: 'bench', adp: 120, projection: 8 },
]

// Eliminated team's released players → the dropped-player pool (real waiver value).
const droppedPlayers: SeedPlayer[] = [
  { playerId: 'gwr-drop-rb-1', playerName: 'Guillo Dropped RB', position: 'RB', team: 'GB', slotType: 'free_agent', adp: 35 },
  { playerId: 'gwr-drop-qb-1', playerName: 'Guillo Dropped QB', position: 'QB', team: 'PHI', slotType: 'free_agent', adp: 28 },
  { playerId: 'gwr-drop-wr-1', playerName: 'Guillo Dropped WR', position: 'WR', team: 'HOU', slotType: 'free_agent', adp: 50 },
]

const allWithAdp = [...memberPlayers, ...droppedPlayers]

// Six teams: member (chop_zone), 3 mid (danger), commissioner (safe), 1 eliminated.
const fillerUserIds = ['gwr-runtime-g3-user', 'gwr-runtime-g4-user', 'gwr-runtime-g5-user']
const fillerRosterIds = ['gwr-runtime-g3-roster', 'gwr-runtime-g4-roster', 'gwr-runtime-g5-roster']

function playerKey(name: string, position: string): string {
  return `${name.trim().toLowerCase()}|${position.trim().toLowerCase()}`
}

function buildPlayerData(players: SeedPlayer[]) {
  const entries = players.map((p) => ({ id: p.playerId, name: p.playerName, position: p.position, team: p.team }))
  const starters = entries.filter((_, i) => players[i].slotType === 'starter')
  const bench = entries.filter((_, i) => players[i].slotType !== 'starter')
  return { seed: 'guillotine-war-room-runtime', lineup_sections: { starters, bench, ir: [], taxi: [], devy: [] } }
}

async function upsertUser(input: { id: string; email: string; username: string; displayName: string; passwordHash: string }) {
  await prisma.appUser.upsert({
    where: { id: input.id },
    create: { id: input.id, email: input.email, username: input.username, displayName: input.displayName, passwordHash: input.passwordHash, emailVerified: now },
    update: { email: input.email, username: input.username, displayName: input.displayName, passwordHash: input.passwordHash, emailVerified: now },
  })
}

async function seedUsersAndEntitlement() {
  const passwordHash = await bcrypt.hash(GUILLOTINE_WAR_ROOM_RUNTIME_SEED.password, 10)
  await upsertUser({ id: GUILLOTINE_WAR_ROOM_RUNTIME_SEED.memberUserId, email: 'gwr-member@example.com', username: GUILLOTINE_WAR_ROOM_RUNTIME_SEED.memberLogin, displayName: 'Guillo Seed Member', passwordHash })
  await upsertUser({ id: GUILLOTINE_WAR_ROOM_RUNTIME_SEED.commissionerUserId, email: 'gwr-commish@example.com', username: GUILLOTINE_WAR_ROOM_RUNTIME_SEED.commissionerLogin, displayName: 'Guillo Seed Commissioner', passwordHash })
  await upsertUser({ id: GUILLOTINE_WAR_ROOM_RUNTIME_SEED.outsiderUserId, email: 'gwr-outsider@example.com', username: GUILLOTINE_WAR_ROOM_RUNTIME_SEED.outsiderLogin, displayName: 'Guillo Seed Outsider', passwordHash })
  for (let i = 0; i < fillerUserIds.length; i++) {
    await upsertUser({ id: fillerUserIds[i], email: `gwr-g${i + 3}@example.com`, username: `gwr_runtime_g${i + 3}`, displayName: `Guillo Team ${i + 3}`, passwordHash })
  }
  await upsertUser({ id: 'gwr-runtime-elim-user', email: 'gwr-elim@example.com', username: 'gwr_runtime_elim', displayName: 'Guillo Chopped Team', passwordHash })

  const plan = await prisma.subscriptionPlan.upsert({
    where: { code: 'af_war_room' },
    create: { code: 'af_war_room', name: 'AF War Room', description: 'Runtime seed entitlement for Guillotine War Room QA.', isBundle: false, isActive: true, metadata: { seed: 'guillotine-war-room-runtime' } },
    update: { name: 'AF War Room', isActive: true },
  })
  await prisma.userSubscription.upsert({
    where: { id: 'gwr-runtime-commissioner-subscription' },
    create: {
      id: 'gwr-runtime-commissioner-subscription',
      userId: GUILLOTINE_WAR_ROOM_RUNTIME_SEED.commissionerUserId,
      subscriptionPlanId: plan.id,
      status: 'active', source: 'runtime-seed', sku: 'af_war_room_runtime_seed',
      currentPeriodStart: now, currentPeriodEnd: nextMonth, expiresAt: nextMonth,
      metadata: { seed: 'guillotine-war-room-runtime', synthetic: true },
    },
    update: { subscriptionPlanId: plan.id, status: 'active', currentPeriodStart: now, currentPeriodEnd: nextMonth, expiresAt: nextMonth, canceledAt: null },
  })
}

async function seedAdpAndProjections() {
  const season = String(GUILLOTINE_WAR_ROOM_RUNTIME_SEED.season)
  await prisma.allFantasyAdpSnapshot.deleteMany({ where: { sport: 'NFL', leagueType: 'redraft', season, draftMode: 'test', contextHash: 'gwr-runtime-ctx' } })
  await prisma.allFantasyAdpSnapshot.createMany({
    data: allWithAdp.map((p) => ({
      playerKey: playerKey(p.playerName, p.position), playerName: p.playerName,
      sport: 'NFL', leagueType: 'redraft', draftType: 'snake', scoringFormat: 'ppr', rosterFormat: 'standard',
      teamCount: GUILLOTINE_WAR_ROOM_RUNTIME_SEED.teamCount, season, draftMode: 'test', sampleSize: 10,
      averageOverallPick: p.adp, averageRound: Math.ceil(p.adp / 12), averagePickInRound: ((p.adp - 1) % 12) + 1,
      minOverallPick: Math.max(1, p.adp - 5), maxOverallPick: p.adp + 5, contextHash: 'gwr-runtime-ctx',
    })),
    skipDuplicates: true,
  })
  await prisma.fantasyProjection.deleteMany({ where: { playerId: { in: memberPlayers.map((p) => p.playerId) } } })
  await prisma.fantasyProjection.createMany({
    data: memberPlayers.filter((p) => p.projection != null).map((p) => ({
      playerId: p.playerId, sport: 'NFL', season, week: GUILLOTINE_WAR_ROOM_RUNTIME_SEED.currentWeek, scoringPresetId: 'ppr',
      projectedPoints: p.projection!, stats: { seed: 'guillotine-war-room-runtime' }, source: 'runtime-seed', fetchedAt: now, expiresAt: nextMonth,
    })),
  })
}

async function seedLeague() {
  const { leagueId, memberUserId, commissionerUserId, memberRosterId, opponentRosterId, eliminatedRosterId, currentWeek, season } = GUILLOTINE_WAR_ROOM_RUNTIME_SEED
  // Clean prior guillotine state for idempotency.
  await prisma.guillotineWaiverRelease.deleteMany({ where: { leagueId } }).catch(() => undefined)
  await prisma.guillotineSeason.deleteMany({ where: { leagueId } }).catch(() => undefined)
  await prisma.guillotinePeriodScore.deleteMany({ where: { leagueId } }).catch(() => undefined)
  await prisma.guillotineRosterState.deleteMany({ where: { leagueId } }).catch(() => undefined)
  await prisma.guillotineLeagueConfig.deleteMany({ where: { leagueId } }).catch(() => undefined)
  await prisma.roster.deleteMany({ where: { leagueId } })
  await prisma.leagueTeam.deleteMany({ where: { leagueId } })

  const settings = {
    seed: 'guillotine-war-room-runtime',
    leagueVariant: 'guillotine',
    scoringSettings: { preset: 'PPR', ppr: 1, scoringFormat: 'ppr' },
    tradesEnabled: false,
    rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'BN', 'BN'],
    nfl_roster_config: { slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, BN: 6 } },
  }

  await prisma.league.upsert({
    where: { id: leagueId },
    create: {
      id: leagueId, userId: commissionerUserId, platform: 'allfantasy', platformLeagueId: leagueId,
      name: 'Runtime Seed NFL Guillotine War Room', sport: 'NFL', season,
      leagueSize: GUILLOTINE_WAR_ROOM_RUNTIME_SEED.teamCount, scoring: 'PPR', scoringPresetId: 'ppr',
      isDynasty: false, rosterSize: 12, leagueType: 'redraft', leagueVariant: 'guillotine', guillotineMode: true,
      status: 'active', lifecycleState: 'in_season', waiverType: 'faab', waiverBudget: 100, settingsSnapshotVersion: 1,
      settings, starters: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1 },
    },
    update: {
      userId: commissionerUserId, name: 'Runtime Seed NFL Guillotine War Room', sport: 'NFL', season,
      isDynasty: false, leagueVariant: 'guillotine', guillotineMode: true, status: 'active', lifecycleState: 'in_season',
      settings, starters: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1 },
    },
  })

  await prisma.guillotineLeagueConfig.create({
    data: {
      leagueId, eliminationStartWeek: 1, eliminationEndWeek: 17, teamsPerChop: 1,
      correctionWindow: 'after_stat_corrections', dangerMarginPoints: 10, rosterReleaseTiming: 'next_waiver_run', commissionerOverride: true,
    },
  })

  // Legacy Roster rows (rosters + membership + danger-engine player mapping).
  await prisma.roster.createMany({
    data: [
      { id: memberRosterId, leagueId, platformUserId: memberUserId, playerData: buildPlayerData(memberPlayers), faabRemaining: 80 },
      { id: opponentRosterId, leagueId, platformUserId: commissionerUserId, playerData: { seed: 'guillotine-war-room-runtime' }, faabRemaining: 95 },
      { id: eliminatedRosterId, leagueId, platformUserId: 'gwr-runtime-elim-user', playerData: { seed: 'guillotine-war-room-runtime' }, faabRemaining: 0 },
      ...fillerRosterIds.map((id, i) => ({ id, leagueId, platformUserId: fillerUserIds[i], playerData: { seed: 'guillotine-war-room-runtime' }, faabRemaining: 50 + i * 10 })),
    ],
  })

  await prisma.leagueTeam.createMany({
    data: [
      { id: 'gwr-runtime-member-team', leagueId, externalId: 'gwr-member-team', ownerName: 'Guillo Seed Member', teamName: 'Guillo Member FC', platformUserId: memberUserId, claimedByUserId: memberUserId, role: 'member' },
      { id: 'gwr-runtime-commish-team', leagueId, externalId: 'gwr-commish-team', ownerName: 'Guillo Seed Commissioner', teamName: 'Guillo Commish FC', platformUserId: commissionerUserId, claimedByUserId: commissionerUserId, role: 'commissioner', isCommissioner: true },
      { id: 'gwr-runtime-elim-team', leagueId, externalId: 'gwr-elim-team', ownerName: 'Guillo Chopped Team', teamName: 'Chopped FC', platformUserId: 'gwr-runtime-elim-user', role: 'member' },
      ...fillerRosterIds.map((_, i) => ({ id: `gwr-runtime-g${i + 3}-team`, leagueId, externalId: `gwr-g${i + 3}-team`, ownerName: `Guillo Team ${i + 3}`, teamName: `Team ${i + 3} FC`, platformUserId: fillerUserIds[i], role: 'member' })),
    ],
  })

  // Eliminated roster state (one chopped team).
  await prisma.guillotineRosterState.create({
    data: { leagueId, rosterId: eliminatedRosterId, choppedAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), choppedInPeriod: 4, choppedReason: 'lowest_score' },
  })

  // Period scores (week 5) — member lowest (chop zone), commissioner highest (safe).
  const periodScores: Array<{ rosterId: string; periodPoints: number; seasonPointsCumul: number }> = [
    { rosterId: memberRosterId, periodPoints: 70, seasonPointsCumul: 410 },
    { rosterId: fillerRosterIds[0], periodPoints: 76, seasonPointsCumul: 460 },
    { rosterId: fillerRosterIds[1], periodPoints: 82, seasonPointsCumul: 500 },
    { rosterId: fillerRosterIds[2], periodPoints: 88, seasonPointsCumul: 540 },
    { rosterId: opponentRosterId, periodPoints: 96, seasonPointsCumul: 600 },
  ]
  await prisma.guillotinePeriodScore.createMany({
    data: periodScores.map((s) => ({ leagueId, rosterId: s.rosterId, weekOrPeriod: currentWeek, season, periodPoints: s.periodPoints, seasonPointsCumul: s.seasonPointsCumul })),
    skipDuplicates: true,
  })

  // Guillotine season + dropped-player pool (released from the eliminated team).
  const gSeason = await prisma.guillotineSeason.create({
    data: { id: GUILLOTINE_WAR_ROOM_RUNTIME_SEED.guillotineSeasonId, leagueId, sport: 'NFL', season, status: 'active', totalTeamsStarted: 6, currentTeamsActive: 5, currentScoringPeriod: currentWeek },
  })
  await prisma.guillotineWaiverRelease.createMany({
    data: droppedPlayers.map((p) => ({
      seasonId: gSeason.id, leagueId, eliminatedRosterId, scoringPeriod: 4,
      playerId: p.playerId, playerName: p.playerName, position: p.position, team: p.team, sport: 'NFL',
      releaseStatus: 'available', availableAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
    })),
    skipDuplicates: true,
  })
}

async function connectWithRetry(attempts = 5): Promise<void> {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await prisma.$queryRaw`SELECT 1`
      return
    } catch (error) {
      if (i === attempts) throw error
      await new Promise((resolve) => setTimeout(resolve, 1500 * i))
    }
  }
}

export async function seedGuillotineWarRoomRuntime() {
  await connectWithRetry()
  await seedUsersAndEntitlement()
  await seedAdpAndProjections()
  await seedLeague()
  return { ...GUILLOTINE_WAR_ROOM_RUNTIME_SEED }
}

export async function disconnectGuillotineWarRoomRuntimeSeed() {
  await prisma.$disconnect()
}

async function main() {
  // Fail closed before the first write: these fixtures create login accounts whose password
  // is hardcoded in this public repo, so seeding a real environment publishes credentials.
  assertSafeSeedTarget('seed-guillotine-war-room-runtime')

  const result = await seedGuillotineWarRoomRuntime()
  console.log(JSON.stringify(result, null, 2))
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
    .finally(async () => {
      await prisma.$disconnect()
    })
}
