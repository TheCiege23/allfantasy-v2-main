import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { assertSafeSeedTarget } from './_assert-safe-seed-target'

const prisma = new PrismaClient()

export const BEST_BALL_WAR_ROOM_RUNTIME_SEED = {
  leagueId: 'bbwr-runtime-nfl-best-ball-league',
  memberUserId: 'bbwr-runtime-member-user',
  commissionerUserId: 'bbwr-runtime-commissioner-user',
  outsiderUserId: 'bbwr-runtime-outsider-user',
  memberRosterId: 'bbwr-runtime-member-roster',
  opponentRosterId: 'bbwr-runtime-opponent-roster',
  password: 'Password123!',
  memberLogin: 'bbwr_runtime_member',
  commissionerLogin: 'bbwr_runtime_commish',
  outsiderLogin: 'bbwr_runtime_outsider',
  opponentIncomingPlayerId: 'bbwr-opp-qb-1',
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
  byeWeek: number
  adp: number
  /** Per-week points (drives spike-week ceiling). */
  weekly: number[]
}

// Member: thin QB/TE, HEAVY WR, with a BUF QB+WR stack and a W7 bye cluster.
const memberPlayers: SeedPlayer[] = [
  { playerId: 'bbwr-mem-qb-1', playerName: 'BB Member QB', position: 'QB', team: 'BUF', byeWeek: 7, adp: 30, weekly: [18, 24, 12, 31] },
  { playerId: 'bbwr-mem-rb-1', playerName: 'BB Member RB1', position: 'RB', team: 'ATL', byeWeek: 7, adp: 8, weekly: [22, 14, 28, 9] },
  { playerId: 'bbwr-mem-rb-2', playerName: 'BB Member RB2', position: 'RB', team: 'DET', byeWeek: 9, adp: 40, weekly: [10, 16, 8, 19] },
  { playerId: 'bbwr-mem-wr-1', playerName: 'BB Member WR1', position: 'WR', team: 'BUF', byeWeek: 7, adp: 12, weekly: [26, 11, 30, 14] },
  { playerId: 'bbwr-mem-wr-2', playerName: 'BB Member WR2', position: 'WR', team: 'MIN', byeWeek: 7, adp: 24, weekly: [14, 22, 9, 25] },
  { playerId: 'bbwr-mem-wr-3', playerName: 'BB Member WR3', position: 'WR', team: 'DAL', byeWeek: 7, adp: 36, weekly: [12, 18, 16, 8] },
  { playerId: 'bbwr-mem-wr-4', playerName: 'BB Member WR4', position: 'WR', team: 'LAC', byeWeek: 5, adp: 60, weekly: [9, 13, 20, 7] },
  { playerId: 'bbwr-mem-wr-5', playerName: 'BB Member WR5', position: 'WR', team: 'CIN', byeWeek: 12, adp: 80, weekly: [7, 10, 6, 15] },
  { playerId: 'bbwr-mem-wr-6', playerName: 'BB Member WR6', position: 'WR', team: 'SEA', byeWeek: 10, adp: 100, weekly: [5, 8, 11, 4] },
  { playerId: 'bbwr-mem-te-1', playerName: 'BB Member TE', position: 'TE', team: 'KC', byeWeek: 6, adp: 35, weekly: [11, 7, 19, 9] },
  { playerId: 'bbwr-mem-rb-3', playerName: 'BB Member RB3', position: 'RB', team: 'GB', byeWeek: 5, adp: 95, weekly: [8, 12, 6, 14] },
  { playerId: 'bbwr-mem-k-1', playerName: 'BB Member K', position: 'K', team: 'BAL', byeWeek: 13, adp: 150, weekly: [8, 9, 7, 10] },
  { playerId: 'bbwr-mem-te-2', playerName: 'BB Member TE2', position: 'TE', team: 'SF', byeWeek: 9, adp: 130, weekly: [5, 6, 8, 4] },
]

const opponentPlayers: SeedPlayer[] = [
  { playerId: 'bbwr-opp-qb-1', playerName: 'BB Opp QB', position: 'QB', team: 'PHI', byeWeek: 9, adp: 22, weekly: [20, 25, 18, 28] },
  { playerId: 'bbwr-opp-rb-1', playerName: 'BB Opp RB1', position: 'RB', team: 'MIA', byeWeek: 6, adp: 15, weekly: [18, 12, 22, 10] },
  { playerId: 'bbwr-opp-rb-2', playerName: 'BB Opp RB2', position: 'RB', team: 'CHI', byeWeek: 7, adp: 38, weekly: [11, 14, 9, 16] },
  { playerId: 'bbwr-opp-wr-1', playerName: 'BB Opp WR1', position: 'WR', team: 'HOU', byeWeek: 14, adp: 18, weekly: [16, 21, 13, 24] },
  { playerId: 'bbwr-opp-wr-2', playerName: 'BB Opp WR2', position: 'WR', team: 'ARI', byeWeek: 11, adp: 44, weekly: [12, 9, 17, 8] },
  { playerId: 'bbwr-opp-te-1', playerName: 'BB Opp TE1', position: 'TE', team: 'LV', byeWeek: 10, adp: 50, weekly: [9, 13, 7, 11] },
  { playerId: 'bbwr-opp-te-2', playerName: 'BB Opp TE2', position: 'TE', team: 'NYG', byeWeek: 11, adp: 120, weekly: [6, 8, 5, 9] },
  { playerId: 'bbwr-opp-wr-3', playerName: 'BB Opp WR3', position: 'WR', team: 'TB', byeWeek: 11, adp: 70, weekly: [10, 7, 14, 6] },
  { playerId: 'bbwr-opp-qb-2', playerName: 'BB Opp QB2', position: 'QB', team: 'NO', byeWeek: 12, adp: 110, weekly: [12, 9, 15, 8] },
  { playerId: 'bbwr-opp-rb-3', playerName: 'BB Opp RB3', position: 'RB', team: 'TEN', byeWeek: 5, adp: 90, weekly: [8, 11, 6, 13] },
  { playerId: 'bbwr-opp-wr-4', playerName: 'BB Opp WR4', position: 'WR', team: 'NE', byeWeek: 14, adp: 140, weekly: [5, 7, 9, 4] },
  { playerId: 'bbwr-opp-k-1', playerName: 'BB Opp K', position: 'K', team: 'PIT', byeWeek: 9, adp: 155, weekly: [7, 8, 9, 6] },
  { playerId: 'bbwr-opp-rb-4', playerName: 'BB Opp RB4', position: 'RB', team: 'CLE', byeWeek: 10, adp: 160, weekly: [6, 9, 5, 10] },
]

const allRostered = [...memberPlayers, ...opponentPlayers]

function playerKey(name: string, position: string): string {
  return `${name.trim().toLowerCase()}|${position.trim().toLowerCase()}`
}

function buildPlayerData(players: SeedPlayer[]) {
  const entries = players.map((p) => ({ id: p.playerId, name: p.playerName, position: p.position, team: p.team, byeWeek: p.byeWeek }))
  return {
    seed: 'best-ball-war-room-runtime',
    // Provide both shapes the readers may expect.
    players: entries,
    lineup_sections: { starters: entries, bench: [], ir: [], taxi: [], devy: [] },
  }
}

async function upsertUser(input: { id: string; email: string; username: string; displayName: string; passwordHash: string }) {
  await prisma.appUser.upsert({
    where: { id: input.id },
    create: { id: input.id, email: input.email, username: input.username, displayName: input.displayName, passwordHash: input.passwordHash, emailVerified: now },
    update: { email: input.email, username: input.username, displayName: input.displayName, passwordHash: input.passwordHash, emailVerified: now },
  })
}

async function seedUsersAndEntitlement() {
  const passwordHash = await bcrypt.hash(BEST_BALL_WAR_ROOM_RUNTIME_SEED.password, 10)
  await upsertUser({ id: BEST_BALL_WAR_ROOM_RUNTIME_SEED.memberUserId, email: 'bbwr-member@example.com', username: BEST_BALL_WAR_ROOM_RUNTIME_SEED.memberLogin, displayName: 'BB Seed Member', passwordHash })
  await upsertUser({ id: BEST_BALL_WAR_ROOM_RUNTIME_SEED.commissionerUserId, email: 'bbwr-commish@example.com', username: BEST_BALL_WAR_ROOM_RUNTIME_SEED.commissionerLogin, displayName: 'BB Seed Commissioner', passwordHash })
  await upsertUser({ id: BEST_BALL_WAR_ROOM_RUNTIME_SEED.outsiderUserId, email: 'bbwr-outsider@example.com', username: BEST_BALL_WAR_ROOM_RUNTIME_SEED.outsiderLogin, displayName: 'BB Seed Outsider', passwordHash })

  const plan = await prisma.subscriptionPlan.upsert({
    where: { code: 'af_war_room' },
    create: { code: 'af_war_room', name: 'AF War Room', description: 'Runtime seed entitlement for Best Ball War Room QA.', isBundle: false, isActive: true, metadata: { seed: 'best-ball-war-room-runtime' } },
    update: { name: 'AF War Room', isActive: true },
  })
  await prisma.userSubscription.upsert({
    where: { id: 'bbwr-runtime-commissioner-subscription' },
    create: {
      id: 'bbwr-runtime-commissioner-subscription', userId: BEST_BALL_WAR_ROOM_RUNTIME_SEED.commissionerUserId, subscriptionPlanId: plan.id,
      status: 'active', source: 'runtime-seed', sku: 'af_war_room_runtime_seed', currentPeriodStart: now, currentPeriodEnd: nextMonth, expiresAt: nextMonth,
      metadata: { seed: 'best-ball-war-room-runtime', synthetic: true },
    },
    update: { subscriptionPlanId: plan.id, status: 'active', currentPeriodStart: now, currentPeriodEnd: nextMonth, expiresAt: nextMonth, canceledAt: null },
  })
}

async function seedSportsPlayers() {
  for (const p of allRostered) {
    await prisma.sportsPlayer.upsert({
      where: { sport_externalId_source: { sport: 'NFL', externalId: p.playerId, source: 'best-ball-war-room-runtime' } },
      create: { id: p.playerId, sport: 'NFL', externalId: p.playerId, name: p.playerName, position: p.position, team: p.team, source: 'best-ball-war-room-runtime', expiresAt: nextMonth },
      update: { name: p.playerName, position: p.position, team: p.team, expiresAt: nextMonth },
    }).catch(async () => {
      // id may collide if re-run with a different source; fall back to a plain upsert by id.
      await prisma.sportsPlayer.upsert({
        where: { id: p.playerId },
        create: { id: p.playerId, sport: 'NFL', externalId: p.playerId, name: p.playerName, position: p.position, team: p.team, source: 'best-ball-war-room-runtime', expiresAt: nextMonth },
        update: { name: p.playerName, position: p.position, team: p.team },
      })
    })
  }
}

async function seedAdp() {
  const season = String(BEST_BALL_WAR_ROOM_RUNTIME_SEED.season)
  await prisma.allFantasyAdpSnapshot.deleteMany({ where: { sport: 'NFL', leagueType: 'redraft', season, draftMode: 'test', contextHash: 'bbwr-runtime-ctx' } })
  await prisma.allFantasyAdpSnapshot.createMany({
    data: allRostered.map((p) => ({
      playerKey: playerKey(p.playerName, p.position), playerName: p.playerName,
      sport: 'NFL', leagueType: 'redraft', draftType: 'snake', scoringFormat: 'ppr', rosterFormat: 'best_ball',
      teamCount: BEST_BALL_WAR_ROOM_RUNTIME_SEED.teamCount, season, draftMode: 'test', sampleSize: 10,
      averageOverallPick: p.adp, averageRound: Math.ceil(p.adp / 12), averagePickInRound: ((p.adp - 1) % 12) + 1,
      minOverallPick: Math.max(1, p.adp - 5), maxOverallPick: p.adp + 5, contextHash: 'bbwr-runtime-ctx',
    })),
    skipDuplicates: true,
  })
}

async function seedLeague() {
  const { leagueId, memberUserId, commissionerUserId, memberRosterId, opponentRosterId } = BEST_BALL_WAR_ROOM_RUNTIME_SEED
  await prisma.weeklyScore.deleteMany({ where: { leagueId } }).catch(() => undefined)
  await prisma.roster.deleteMany({ where: { leagueId } })
  await prisma.leagueTeam.deleteMany({ where: { leagueId } })

  const settings = {
    seed: 'best-ball-war-room-runtime',
    bestBallMode: true,
    leagueType: 'best_ball',
    best_ball_settings: { mode: 'standard', draftMode: 'snake', waiversEnabled: false, tradesEnabled: false, substitutionsEnabled: false, regularSeasonLength: 14 },
    scoringSettings: { preset: 'PPR', ppr: 1, scoringFormat: 'ppr' },
    rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
  }

  await prisma.league.upsert({
    where: { id: leagueId },
    create: {
      id: leagueId, userId: commissionerUserId, platform: 'allfantasy', platformLeagueId: leagueId,
      name: 'Runtime Seed NFL Best Ball War Room', sport: 'NFL', season: BEST_BALL_WAR_ROOM_RUNTIME_SEED.season,
      leagueSize: BEST_BALL_WAR_ROOM_RUNTIME_SEED.teamCount, scoring: 'PPR', scoringPresetId: 'ppr',
      isDynasty: false, rosterSize: 18, leagueType: 'best_ball', leagueVariant: null,
      status: 'active', lifecycleState: 'in_season', settingsSnapshotVersion: 1,
      bestBallMode: true, bestBallVariant: 'standard', bbMatchupFormat: 'h2h', bbScoringPeriod: 'weekly',
      settings, starters: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2 },
    },
    update: {
      userId: commissionerUserId, name: 'Runtime Seed NFL Best Ball War Room', sport: 'NFL', season: BEST_BALL_WAR_ROOM_RUNTIME_SEED.season,
      isDynasty: false, leagueType: 'best_ball', status: 'active', lifecycleState: 'in_season',
      bestBallMode: true, bestBallVariant: 'standard', bbMatchupFormat: 'h2h', bbScoringPeriod: 'weekly',
      settings, starters: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2 },
    },
  })

  await prisma.roster.createMany({
    data: [
      { id: memberRosterId, leagueId, platformUserId: memberUserId, playerData: buildPlayerData(memberPlayers) },
      { id: opponentRosterId, leagueId, platformUserId: commissionerUserId, playerData: buildPlayerData(opponentPlayers) },
    ],
  })

  await prisma.leagueTeam.createMany({
    data: [
      { id: 'bbwr-runtime-member-team', leagueId, externalId: 'bbwr-member-team', ownerName: 'BB Seed Member', teamName: 'BB Member FC', wins: 3, losses: 1, pointsFor: 480, pointsAgainst: 440, platformUserId: memberUserId, claimedByUserId: memberUserId, role: 'member' },
      { id: 'bbwr-runtime-commish-team', leagueId, externalId: 'bbwr-commish-team', ownerName: 'BB Seed Commissioner', teamName: 'BB Commish FC', wins: 4, losses: 0, pointsFor: 510, pointsAgainst: 420, platformUserId: commissionerUserId, claimedByUserId: commissionerUserId, role: 'commissioner', isCommissioner: true },
    ],
  })

  // Weekly scores → real spike-week ceiling. isStarter marks the auto-optimal lineup pick.
  const wsData: Array<{ leagueId: string; season: number; week: number; rosterId: string; playerId: string; points: number; isStarter: boolean }> = []
  const addWeekly = (rosterId: string, players: SeedPlayer[]) => {
    for (let week = 1; week <= 4; week++) {
      // crude per-week starter mark: top scorers that week are "started" by the auto lineup.
      const ranked = [...players].sort((a, b) => (b.weekly[week - 1] ?? 0) - (a.weekly[week - 1] ?? 0))
      ranked.forEach((p, idx) => {
        wsData.push({ leagueId, season: BEST_BALL_WAR_ROOM_RUNTIME_SEED.season, week, rosterId, playerId: p.playerId, points: p.weekly[week - 1] ?? 0, isStarter: idx < 9 })
      })
    }
  }
  addWeekly(memberRosterId, memberPlayers)
  addWeekly(opponentRosterId, opponentPlayers)
  await prisma.weeklyScore.createMany({ data: wsData, skipDuplicates: true })
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

export async function seedBestBallWarRoomRuntime() {
  await connectWithRetry()
  await seedUsersAndEntitlement()
  await seedSportsPlayers()
  await seedAdp()
  await seedLeague()
  return { ...BEST_BALL_WAR_ROOM_RUNTIME_SEED }
}

export async function disconnectBestBallWarRoomRuntimeSeed() {
  await prisma.$disconnect()
}

async function main() {
  // Fail closed before the first write: these fixtures create login accounts whose password
  // is hardcoded in this public repo, so seeding a real environment publishes credentials.
  assertSafeSeedTarget('seed-best-ball-war-room-runtime')

  const result = await seedBestBallWarRoomRuntime()
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
