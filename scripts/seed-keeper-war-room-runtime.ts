import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { assertSafeSeedTarget } from './_assert-safe-seed-target'

const prisma = new PrismaClient()

export const KEEPER_WAR_ROOM_RUNTIME_SEED = {
  leagueId: 'kwr-runtime-nfl-keeper-league',
  seasonId: 'kwr-runtime-nfl-keeper-season',
  memberUserId: 'kwr-runtime-member-user',
  commissionerUserId: 'kwr-runtime-commissioner-user',
  outsiderUserId: 'kwr-runtime-outsider-user',
  memberRosterId: 'kwr-runtime-member-roster',
  opponentRosterId: 'kwr-runtime-opponent-roster',
  password: 'Password123!',
  memberLogin: 'kwr_runtime_member',
  commissionerLogin: 'kwr_runtime_commish',
  outsiderLogin: 'kwr_runtime_outsider',
  opponentIncomingPlayerId: 'kwr-opp-wr-steal',
  season: 2026,
  teamCount: 12,
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
  /** Projected keeper cost round (round_based). undefined → no eligibility/cost row. */
  costRound?: number
  eligible?: boolean
  ineligibleReason?: string
  isKept?: boolean
  injuryStatus?: string
  projection?: number
  actual?: number
}

// Member: a mix of elite-value, fair, negative, ineligible, and no-cost keeper candidates.
const memberPlayers: SeedPlayer[] = [
  { playerId: 'kwr-mem-wr-steal', playerName: 'Keeper Seed WR Steal', position: 'WR', team: 'MIN', slotType: 'WR', adp: 20, costRound: 8, projection: 17.2, actual: 16.4 },
  { playerId: 'kwr-mem-rb-good', playerName: 'Keeper Seed RB Good', position: 'RB', team: 'ATL', slotType: 'RB', adp: 32, costRound: 5, projection: 15.1, actual: 14.0 },
  { playerId: 'kwr-mem-rb-fair', playerName: 'Keeper Seed RB Fair', position: 'RB', team: 'DET', slotType: 'RB', adp: 44, costRound: 4, projection: 12.4, actual: 11.6 },
  { playerId: 'kwr-mem-qb-pricey', playerName: 'Keeper Seed QB Pricey', position: 'QB', team: 'BUF', slotType: 'QB', adp: 18, costRound: 1, projection: 21.0, actual: 20.2, isKept: true },
  { playerId: 'kwr-mem-te-maxed', playerName: 'Keeper Seed TE Maxed', position: 'TE', team: 'KC', slotType: 'TE', adp: 30, costRound: 6, eligible: false, ineligibleReason: 'max_years_reached', projection: 11.0, actual: 10.1 },
  { playerId: 'kwr-mem-wr-nocost', playerName: 'Keeper Seed WR NoCost', position: 'WR', team: 'DAL', slotType: 'WR', adp: 70, projection: 9.4, actual: 8.7 },
  { playerId: 'kwr-mem-wr-3', playerName: 'Keeper Seed WR3', position: 'WR', team: 'LAC', slotType: 'FLEX', adp: 85, projection: 8.1, actual: 7.5, injuryStatus: 'Questionable' },
  { playerId: 'kwr-mem-k-1', playerName: 'Keeper Seed K', position: 'K', team: 'BAL', slotType: 'K', adp: 150, projection: 8.0, actual: 7.8 },
  { playerId: 'kwr-mem-dst-1', playerName: 'Keeper Seed DST', position: 'DST', team: 'NYJ', slotType: 'DST', adp: 160, projection: 7.2, actual: 6.6 },
]

// Opponent/commissioner: holds a strong keeper (steal) the member can target in a trade.
const opponentPlayers: SeedPlayer[] = [
  { playerId: 'kwr-opp-wr-steal', playerName: 'Keeper Opp WR Steal', position: 'WR', team: 'CIN', slotType: 'WR', adp: 15, costRound: 9, projection: 18.0, actual: 17.1 },
  { playerId: 'kwr-opp-qb-1', playerName: 'Keeper Opp QB', position: 'QB', team: 'PHI', slotType: 'QB', adp: 22, costRound: 3, projection: 20.0, actual: 19.0 },
  { playerId: 'kwr-opp-rb-1', playerName: 'Keeper Opp RB', position: 'RB', team: 'MIA', slotType: 'RB', adp: 40, costRound: 6, projection: 13.0, actual: 12.2 },
  { playerId: 'kwr-opp-te-1', playerName: 'Keeper Opp TE', position: 'TE', team: 'LV', slotType: 'TE', adp: 90, projection: 7.5, actual: 7.0 },
]

const freeAgents: SeedPlayer[] = [
  { playerId: 'kwr-fa-wr-1', playerName: 'Keeper FA WR1', position: 'WR', team: 'PHI', slotType: 'free_agent', adp: 55 },
  { playerId: 'kwr-fa-rb-1', playerName: 'Keeper FA RB1', position: 'RB', team: 'CAR', slotType: 'free_agent', adp: 58 },
  { playerId: 'kwr-fa-te-1', playerName: 'Keeper FA TE1', position: 'TE', team: 'NE', slotType: 'free_agent', adp: 75 },
  { playerId: 'kwr-fa-qb-1', playerName: 'Keeper FA QB1', position: 'QB', team: 'IND', slotType: 'free_agent', adp: 88 },
]

const allRostered = [...memberPlayers, ...opponentPlayers]
const allWithFa = [...allRostered, ...freeAgents]

function playerKey(name: string, position: string): string {
  return `${name.trim().toLowerCase()}|${position.trim().toLowerCase()}`
}

async function upsertUser(input: { id: string; email: string; username: string; displayName: string; passwordHash: string }) {
  await prisma.appUser.upsert({
    where: { id: input.id },
    create: { id: input.id, email: input.email, username: input.username, displayName: input.displayName, passwordHash: input.passwordHash, emailVerified: now },
    update: { email: input.email, username: input.username, displayName: input.displayName, passwordHash: input.passwordHash, emailVerified: now },
  })
}

async function seedUsersAndEntitlement() {
  const passwordHash = await bcrypt.hash(KEEPER_WAR_ROOM_RUNTIME_SEED.password, 10)
  await upsertUser({ id: KEEPER_WAR_ROOM_RUNTIME_SEED.memberUserId, email: 'kwr-member@example.com', username: KEEPER_WAR_ROOM_RUNTIME_SEED.memberLogin, displayName: 'Keeper Seed Member', passwordHash })
  await upsertUser({ id: KEEPER_WAR_ROOM_RUNTIME_SEED.commissionerUserId, email: 'kwr-commish@example.com', username: KEEPER_WAR_ROOM_RUNTIME_SEED.commissionerLogin, displayName: 'Keeper Seed Commissioner', passwordHash })
  await upsertUser({ id: KEEPER_WAR_ROOM_RUNTIME_SEED.outsiderUserId, email: 'kwr-outsider@example.com', username: KEEPER_WAR_ROOM_RUNTIME_SEED.outsiderLogin, displayName: 'Keeper Seed Outsider', passwordHash })

  const plan = await prisma.subscriptionPlan.upsert({
    where: { code: 'af_war_room' },
    create: { code: 'af_war_room', name: 'AF War Room', description: 'Runtime seed entitlement for Keeper War Room QA.', isBundle: false, isActive: true, metadata: { seed: 'keeper-war-room-runtime' } },
    update: { name: 'AF War Room', isActive: true },
  })
  await prisma.userSubscription.upsert({
    where: { id: 'kwr-runtime-commissioner-subscription' },
    create: {
      id: 'kwr-runtime-commissioner-subscription',
      userId: KEEPER_WAR_ROOM_RUNTIME_SEED.commissionerUserId,
      subscriptionPlanId: plan.id,
      status: 'active', source: 'runtime-seed', sku: 'af_war_room_runtime_seed',
      currentPeriodStart: now, currentPeriodEnd: nextMonth, expiresAt: nextMonth,
      metadata: { seed: 'keeper-war-room-runtime', synthetic: true },
    },
    update: { subscriptionPlanId: plan.id, status: 'active', currentPeriodStart: now, currentPeriodEnd: nextMonth, expiresAt: nextMonth, canceledAt: null },
  })
}

async function seedAdp() {
  const season = String(KEEPER_WAR_ROOM_RUNTIME_SEED.season)
  await prisma.allFantasyAdpSnapshot.deleteMany({ where: { sport: 'NFL', leagueType: 'redraft', season, draftMode: 'test', contextHash: 'kwr-runtime-ctx' } })
  await prisma.allFantasyAdpSnapshot.createMany({
    data: allWithFa.map((p) => ({
      playerKey: playerKey(p.playerName, p.position),
      playerName: p.playerName,
      sport: 'NFL', leagueType: 'redraft', draftType: 'snake', scoringFormat: 'ppr', rosterFormat: 'standard',
      teamCount: KEEPER_WAR_ROOM_RUNTIME_SEED.teamCount, season, draftMode: 'test', sampleSize: 10,
      averageOverallPick: p.adp, averageRound: Math.ceil(p.adp / 12), averagePickInRound: ((p.adp - 1) % 12) + 1,
      minOverallPick: Math.max(1, p.adp - 5), maxOverallPick: p.adp + 5, contextHash: 'kwr-runtime-ctx',
    })),
    skipDuplicates: true,
  })
}

async function seedLeagueAndSeason() {
  const { leagueId, seasonId, memberUserId, commissionerUserId } = KEEPER_WAR_ROOM_RUNTIME_SEED
  await prisma.keeperEligibility.deleteMany({ where: { leagueId } }).catch(() => undefined)
  await prisma.redraftSeason.deleteMany({ where: { leagueId } })
  await prisma.roster.deleteMany({ where: { leagueId } })
  await prisma.leagueTeam.deleteMany({ where: { leagueId } })
  await prisma.fantasyProjection.deleteMany({ where: { playerId: { in: allRostered.map((p) => p.playerId) } } })
  await prisma.playerWeeklyScore.deleteMany({ where: { playerId: { in: allRostered.map((p) => p.playerId) } } })

  const settings = {
    seed: 'keeper-war-room-runtime',
    isKeeper: true,
    leagueType: 'keeper',
    league_type: 'keeper',
    roster_mode: 'keeper',
    sportConfig: { scoringPreset: 'PPR', categoryPoints: { rec: 1 } },
    scoringSettings: { preset: 'PPR', ppr: 1, scoringFormat: 'ppr' },
    keeperPolicy: { maxKeepers: 3, maxYears: 3, costSystem: 'round_based', roundPenalty: 1, auctionPctIncrease: 0.2, waiverAllowed: true },
    rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DST', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'IR'],
    nfl_roster_config: { slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6, IR: 1 } },
  }

  await prisma.league.upsert({
    where: { id: leagueId },
    create: {
      id: leagueId, userId: commissionerUserId, platform: 'allfantasy', platformLeagueId: leagueId,
      name: 'Runtime Seed NFL Keeper War Room', sport: 'NFL', season: KEEPER_WAR_ROOM_RUNTIME_SEED.season,
      leagueSize: KEEPER_WAR_ROOM_RUNTIME_SEED.teamCount, scoring: 'PPR', scoringPresetId: 'ppr',
      isDynasty: false, rosterSize: 16, leagueType: 'keeper', leagueVariant: null,
      status: 'active', lifecycleState: 'in_season', waiverType: 'faab', waiverBudget: 100, settingsSnapshotVersion: 1,
      keeperCount: 3, keeperCostSystem: 'round_based', keeperRoundPenalty: 1, keeperMaxYears: 3, keeperWaiverAllowed: true, keeperPhaseActive: true,
      settings, starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 },
    },
    update: {
      userId: commissionerUserId, name: 'Runtime Seed NFL Keeper War Room', sport: 'NFL', season: KEEPER_WAR_ROOM_RUNTIME_SEED.season,
      isDynasty: false, leagueType: 'keeper', leagueVariant: null, status: 'active', lifecycleState: 'in_season',
      keeperCount: 3, keeperCostSystem: 'round_based', keeperRoundPenalty: 1, keeperMaxYears: 3, keeperWaiverAllowed: true, keeperPhaseActive: true,
      settings, starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 },
    },
  })

  // Legacy Roster rows — required for membership resolution (resolveLeagueAccess
  // checks prisma.roster.platformUserId). The keeper War Room reads rosters from
  // RedraftRoster; these legacy rows exist only to grant league membership.
  await prisma.roster.createMany({
    data: [
      { id: 'kwr-runtime-member-legacy-roster', leagueId, platformUserId: memberUserId, playerData: { seed: 'keeper-war-room-runtime' }, faabRemaining: 70, waiverPriority: 6 },
      { id: 'kwr-runtime-commish-legacy-roster', leagueId, platformUserId: commissionerUserId, playerData: { seed: 'keeper-war-room-runtime' }, faabRemaining: 85, waiverPriority: 2 },
    ],
  })

  // LeagueTeam rows (for claimedByUserId membership resolution).
  await prisma.leagueTeam.createMany({
    data: [
      { id: 'kwr-runtime-member-team', leagueId, externalId: 'kwr-member-team', ownerName: 'Keeper Seed Member', teamName: 'Keeper Member FC', wins: 4, losses: 2, pointsFor: 720, pointsAgainst: 690, claimedByUserId: memberUserId, platformUserId: memberUserId, role: 'member' },
      { id: 'kwr-runtime-commish-team', leagueId, externalId: 'kwr-commish-team', ownerName: 'Keeper Seed Commissioner', teamName: 'Keeper Commish FC', wins: 5, losses: 1, pointsFor: 760, pointsAgainst: 650, claimedByUserId: commissionerUserId, platformUserId: commissionerUserId, role: 'commissioner', isCommissioner: true },
    ],
  })

  await prisma.redraftSeason.create({
    data: { id: seasonId, leagueId, sport: 'NFL', season: KEEPER_WAR_ROOM_RUNTIME_SEED.season, status: 'active', totalWeeks: 17, playoffStartWeek: 15, currentWeek: 5 },
  })

  await prisma.redraftRoster.create({
    data: {
      id: KEEPER_WAR_ROOM_RUNTIME_SEED.memberRosterId, seasonId, leagueId, ownerId: memberUserId, ownerName: 'Keeper Seed Member', teamName: 'Keeper Member FC',
      wins: 4, losses: 2, pointsFor: 720, pointsAgainst: 690, streak: 'W1', playoffSeed: 4, faabBalance: 70, waiverPriority: 6,
      players: { create: memberPlayers.map((p) => ({ playerId: p.playerId, playerName: p.playerName, position: p.position, team: p.team, sport: 'NFL', slotType: p.slotType, injuryStatus: p.injuryStatus ?? null, isKept: p.isKept ?? false, acquisitionType: 'drafted' })) },
    },
  })
  await prisma.redraftRoster.create({
    data: {
      id: KEEPER_WAR_ROOM_RUNTIME_SEED.opponentRosterId, seasonId, leagueId, ownerId: commissionerUserId, ownerName: 'Keeper Seed Commissioner', teamName: 'Keeper Commish FC',
      wins: 5, losses: 1, pointsFor: 760, pointsAgainst: 650, streak: 'W3', playoffSeed: 1, faabBalance: 85, waiverPriority: 2,
      players: { create: opponentPlayers.map((p) => ({ playerId: p.playerId, playerName: p.playerName, position: p.position, team: p.team, sport: 'NFL', slotType: p.slotType, isKept: false, acquisitionType: 'drafted' })) },
    },
  })

  await prisma.redraftMatchup.createMany({
    data: [
      { id: 'kwr-runtime-week-5', seasonId, leagueId, week: 5, homeRosterId: KEEPER_WAR_ROOM_RUNTIME_SEED.memberRosterId, awayRosterId: KEEPER_WAR_ROOM_RUNTIME_SEED.opponentRosterId, homeScore: 0, awayScore: 0, homeProjected: 118, awayProjected: 121, status: 'scheduled' },
    ],
  })

  await prisma.fantasyProjection.createMany({
    data: allRostered.filter((p) => p.projection != null).map((p) => ({ playerId: p.playerId, sport: 'NFL', season: String(KEEPER_WAR_ROOM_RUNTIME_SEED.season), week: 5, scoringPresetId: 'ppr', projectedPoints: p.projection!, stats: { seed: 'keeper-war-room-runtime' }, source: 'runtime-seed', fetchedAt: now, expiresAt: nextMonth })),
  })
  await prisma.playerWeeklyScore.createMany({
    data: allRostered.filter((p) => p.actual != null).map((p) => ({ playerId: p.playerId, sport: 'NFL', week: 4, season: KEEPER_WAR_ROOM_RUNTIME_SEED.season, stats: { seed: 'keeper-war-room-runtime' }, fantasyPts: p.actual!, isFinalized: true })),
  })

  // KeeperEligibility — the REAL per-player cost source. Member players only.
  await prisma.keeperEligibility.createMany({
    data: memberPlayers
      .filter((p) => p.costRound != null || p.eligible === false)
      .map((p) => ({
        leagueId, seasonId, rosterId: KEEPER_WAR_ROOM_RUNTIME_SEED.memberRosterId, playerId: p.playerId,
        isEligible: p.eligible !== false,
        ineligibleReason: p.eligible === false ? (p.ineligibleReason ?? 'ineligible') : null,
        yearsKept: p.eligible === false ? 3 : 1,
        projectedCost: p.costRound != null ? `Round ${p.costRound}` : null,
        projectedCostRound: p.costRound ?? null,
        projectedCostAuction: null,
      })),
    skipDuplicates: true,
  }).catch(() => undefined)
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

export async function seedKeeperWarRoomRuntime() {
  await connectWithRetry()
  await seedUsersAndEntitlement()
  await seedAdp()
  await seedLeagueAndSeason()
  return { ...KEEPER_WAR_ROOM_RUNTIME_SEED }
}

export async function disconnectKeeperWarRoomRuntimeSeed() {
  await prisma.$disconnect()
}

async function main() {
  // Fail closed before the first write: these fixtures create login accounts whose password
  // is hardcoded in this public repo, so seeding a real environment publishes credentials.
  assertSafeSeedTarget('seed-keeper-war-room-runtime')

  const result = await seedKeeperWarRoomRuntime()
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
