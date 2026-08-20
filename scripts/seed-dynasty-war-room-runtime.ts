import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { assertSafeSeedTarget } from './_assert-safe-seed-target'

const prisma = new PrismaClient()

export const DYNASTY_WAR_ROOM_RUNTIME_SEED = {
  leagueId: 'dwr-runtime-nfl-dynasty-league',
  memberUserId: 'dwr-runtime-member-user',
  commissionerUserId: 'dwr-runtime-commissioner-user',
  outsiderUserId: 'dwr-runtime-outsider-user',
  memberRosterId: 'dwr-runtime-member-roster',
  opponentRosterId: 'dwr-runtime-opponent-roster',
  password: 'Password123!',
  memberLogin: 'dwr_runtime_member',
  commissionerLogin: 'dwr_runtime_commish',
  outsiderLogin: 'dwr_runtime_outsider',
  // A player on the opponent roster the member can reference in a trade-analyze body.
  opponentIncomingPlayerId: 'dwr-opp-wr-young',
  season: 2026,
} as const

const now = new Date()
const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

type SeedPlayer = {
  playerId: string
  name: string
  position: string
  team: string
  age: number
  adp: number
  slot: 'starters' | 'bench' | 'taxi' | 'ir'
  injuryStatus?: string
}

// Member = contender: winning record, mostly prime/ascending, one aging RB to sell.
const memberPlayers: SeedPlayer[] = [
  { playerId: 'dwr-mem-qb-1', name: 'Dwr Member QB1', position: 'QB', team: 'BUF', age: 26, adp: 5, slot: 'starters' },
  { playerId: 'dwr-mem-qb-2', name: 'Dwr Member QB2', position: 'QB', team: 'CIN', age: 27, adp: 18, slot: 'starters' },
  { playerId: 'dwr-mem-rb-1', name: 'Dwr Member RB1', position: 'RB', team: 'ATL', age: 23, adp: 8, slot: 'starters' },
  { playerId: 'dwr-mem-rb-2', name: 'Dwr Member RB2', position: 'RB', team: 'DET', age: 29, adp: 42, slot: 'starters' },
  { playerId: 'dwr-mem-wr-1', name: 'Dwr Member WR1', position: 'WR', team: 'MIN', age: 24, adp: 3, slot: 'starters' },
  { playerId: 'dwr-mem-wr-2', name: 'Dwr Member WR2', position: 'WR', team: 'DAL', age: 25, adp: 15, slot: 'starters' },
  { playerId: 'dwr-mem-wr-3', name: 'Dwr Member WR3', position: 'WR', team: 'LAC', age: 27, adp: 30, slot: 'starters', injuryStatus: 'Questionable' },
  { playerId: 'dwr-mem-te-1', name: 'Dwr Member TE1', position: 'TE', team: 'KC', age: 28, adp: 25, slot: 'starters' },
  { playerId: 'dwr-mem-rb-3', name: 'Dwr Member RB3', position: 'RB', team: 'SEA', age: 22, adp: 60, slot: 'bench' },
  { playerId: 'dwr-mem-wr-4', name: 'Dwr Member WR4', position: 'WR', team: 'NYJ', age: 21, adp: 70, slot: 'bench' },
  { playerId: 'dwr-mem-qb-3', name: 'Dwr Member Taxi QB', position: 'QB', team: 'WAS', age: 21, adp: 90, slot: 'taxi' },
  { playerId: 'dwr-mem-rb-4', name: 'Dwr Member IR RB', position: 'RB', team: 'GB', age: 24, adp: 110, slot: 'ir', injuryStatus: 'IR' },
]

// Opponent/commissioner = rebuilder: losing record, several aging vets to sell + young WRs.
const opponentPlayers: SeedPlayer[] = [
  { playerId: 'dwr-opp-qb-old', name: 'Dwr Opp QB Vet', position: 'QB', team: 'PIT', age: 35, adp: 50, slot: 'starters' },
  { playerId: 'dwr-opp-rb-old', name: 'Dwr Opp RB Vet', position: 'RB', team: 'TEN', age: 30, adp: 45, slot: 'starters' },
  { playerId: 'dwr-opp-rb-old2', name: 'Dwr Opp RB Vet2', position: 'RB', team: 'CLE', age: 31, adp: 80, slot: 'starters' },
  { playerId: 'dwr-opp-wr-old', name: 'Dwr Opp WR Vet', position: 'WR', team: 'TB', age: 32, adp: 55, slot: 'starters' },
  { playerId: 'dwr-opp-wr-young', name: 'Dwr Opp WR Young', position: 'WR', team: 'HOU', age: 22, adp: 20, slot: 'starters' },
  { playerId: 'dwr-opp-wr-young2', name: 'Dwr Opp WR Young2', position: 'WR', team: 'ARI', age: 23, adp: 28, slot: 'starters' },
  { playerId: 'dwr-opp-te-old', name: 'Dwr Opp TE Vet', position: 'TE', team: 'LV', age: 33, adp: 100, slot: 'starters' },
  { playerId: 'dwr-opp-qb-2', name: 'Dwr Opp QB2', position: 'QB', team: 'NO', age: 28, adp: 65, slot: 'bench' },
]

// Free agents (NOT rostered) so the dynasty free-agent pool resolves real adds.
const freeAgentPlayers: SeedPlayer[] = [
  { playerId: 'dwr-fa-wr-young', name: 'Dwr FA WR Young', position: 'WR', team: 'PHI', age: 22, adp: 48, slot: 'bench' },
  { playerId: 'dwr-fa-rb-young', name: 'Dwr FA RB Young', position: 'RB', team: 'CAR', age: 21, adp: 52, slot: 'bench' },
  { playerId: 'dwr-fa-te-young', name: 'Dwr FA TE Young', position: 'TE', team: 'NE', age: 23, adp: 75, slot: 'bench' },
  { playerId: 'dwr-fa-wr-old', name: 'Dwr FA WR Old', position: 'WR', team: 'SF', age: 31, adp: 58, slot: 'bench' },
  { playerId: 'dwr-fa-qb-young', name: 'Dwr FA QB Young', position: 'QB', team: 'IND', age: 24, adp: 85, slot: 'bench' },
  { playerId: 'dwr-fa-rb-old', name: 'Dwr FA RB Old', position: 'RB', team: 'BAL', age: 30, adp: 95, slot: 'bench' },
]

const allRosteredPlayers = [...memberPlayers, ...opponentPlayers]
const allPlayers = [...allRosteredPlayers, ...freeAgentPlayers]

function buildPlayerKey(name: string, position: string): string {
  return `${name.trim().toLowerCase()}|${position.trim().toLowerCase()}`
}

/** Build legacy Roster.playerData with lineup_sections (canonical shape). */
function buildPlayerData(players: SeedPlayer[]) {
  const section = (slot: SeedPlayer['slot']) =>
    players
      .filter((p) => p.slot === slot)
      .map((p) => ({ id: p.playerId, name: p.name, position: p.position, team: p.team }))
  return {
    seed: 'dynasty-war-room-runtime',
    lineup_sections: {
      starters: section('starters'),
      bench: section('bench'),
      ir: section('ir'),
      taxi: section('taxi'),
      devy: [],
    },
  }
}

async function upsertUser(input: { id: string; email: string; username: string; displayName: string; passwordHash: string }) {
  await prisma.appUser.upsert({
    where: { id: input.id },
    create: {
      id: input.id,
      email: input.email,
      username: input.username,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      emailVerified: now,
    },
    update: {
      email: input.email,
      username: input.username,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      emailVerified: now,
    },
  })
}

async function seedUsersAndEntitlement() {
  const passwordHash = await bcrypt.hash(DYNASTY_WAR_ROOM_RUNTIME_SEED.password, 10)
  await upsertUser({
    id: DYNASTY_WAR_ROOM_RUNTIME_SEED.memberUserId,
    email: 'dwr-runtime-member@example.com',
    username: DYNASTY_WAR_ROOM_RUNTIME_SEED.memberLogin,
    displayName: 'Dynasty Seed Member',
    passwordHash,
  })
  await upsertUser({
    id: DYNASTY_WAR_ROOM_RUNTIME_SEED.commissionerUserId,
    email: 'dwr-runtime-commissioner@example.com',
    username: DYNASTY_WAR_ROOM_RUNTIME_SEED.commissionerLogin,
    displayName: 'Dynasty Seed Commissioner',
    passwordHash,
  })
  await upsertUser({
    id: DYNASTY_WAR_ROOM_RUNTIME_SEED.outsiderUserId,
    email: 'dwr-runtime-outsider@example.com',
    username: DYNASTY_WAR_ROOM_RUNTIME_SEED.outsiderLogin,
    displayName: 'Dynasty Seed Outsider',
    passwordHash,
  })

  const plan = await prisma.subscriptionPlan.upsert({
    where: { code: 'af_war_room' },
    create: {
      code: 'af_war_room',
      name: 'AF War Room',
      description: 'Runtime seed entitlement for Dynasty War Room QA.',
      isBundle: false,
      isActive: true,
      metadata: { seed: 'dynasty-war-room-runtime' },
    },
    update: { name: 'AF War Room', isActive: true },
  })

  await prisma.userSubscription.upsert({
    where: { id: 'dwr-runtime-commissioner-subscription' },
    create: {
      id: 'dwr-runtime-commissioner-subscription',
      userId: DYNASTY_WAR_ROOM_RUNTIME_SEED.commissionerUserId,
      subscriptionPlanId: plan.id,
      status: 'active',
      source: 'runtime-seed',
      sku: 'af_war_room_runtime_seed',
      currentPeriodStart: now,
      currentPeriodEnd: nextMonth,
      expiresAt: nextMonth,
      metadata: { seed: 'dynasty-war-room-runtime', synthetic: true },
    },
    update: {
      subscriptionPlanId: plan.id,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: nextMonth,
      expiresAt: nextMonth,
      canceledAt: null,
    },
  })
}

async function seedSportsPlayers() {
  // Ages drive the dynasty age-trajectory signal; the context joins SportsPlayer by name.
  for (const p of allPlayers) {
    await prisma.sportsPlayer.upsert({
      where: { sport_externalId_source: { sport: 'NFL', externalId: p.playerId, source: 'dynasty-war-room-runtime' } },
      create: {
        sport: 'NFL',
        externalId: p.playerId,
        name: p.name,
        position: p.position,
        team: p.team,
        age: p.age,
        source: 'dynasty-war-room-runtime',
        expiresAt: nextMonth,
      },
      update: { name: p.name, position: p.position, team: p.team, age: p.age, expiresAt: nextMonth },
    })
  }
}

async function seedDynastyAdp() {
  const season = String(DYNASTY_WAR_ROOM_RUNTIME_SEED.season)
  await prisma.allFantasyAdpSnapshot.deleteMany({
    where: { sport: 'NFL', leagueType: 'dynasty', season, draftMode: 'test', contextHash: 'dwr-runtime-ctx' },
  })
  await prisma.allFantasyAdpSnapshot.createMany({
    data: allPlayers.map((p) => ({
      playerKey: buildPlayerKey(p.name, p.position),
      playerName: p.name,
      sport: 'NFL',
      leagueType: 'dynasty',
      draftType: 'startup',
      scoringFormat: 'ppr',
      rosterFormat: 'superflex',
      teamCount: 12,
      season,
      draftMode: 'test',
      sampleSize: 10,
      averageOverallPick: p.adp,
      averageRound: Math.ceil(p.adp / 12),
      averagePickInRound: ((p.adp - 1) % 12) + 1,
      minOverallPick: Math.max(1, p.adp - 5),
      maxOverallPick: p.adp + 5,
      contextHash: 'dwr-runtime-ctx',
    })),
    skipDuplicates: true,
  })
}

async function seedLeague() {
  const { leagueId, memberUserId, commissionerUserId } = DYNASTY_WAR_ROOM_RUNTIME_SEED
  await prisma.roster.deleteMany({ where: { leagueId } })
  await prisma.leagueTeam.deleteMany({ where: { leagueId } })

  await prisma.league.upsert({
    where: { id: leagueId },
    create: {
      id: leagueId,
      userId: commissionerUserId,
      platform: 'allfantasy',
      platformLeagueId: leagueId,
      name: 'Runtime Seed NFL Dynasty War Room',
      sport: 'NFL',
      season: DYNASTY_WAR_ROOM_RUNTIME_SEED.season,
      leagueSize: 12,
      scoring: 'PPR',
      scoringPresetId: 'ppr',
      isDynasty: true,
      rosterSize: 25,
      leagueType: 'dynasty',
      leagueVariant: null,
      status: 'active',
      lifecycleState: 'in_season',
      settingsSnapshotVersion: 1,
      settings: {
        seed: 'dynasty-war-room-runtime',
        roster_format_type: 'dynasty_superflex',
        scoring_format_type: 'PPR',
        sportConfig: { scoringPreset: 'PPR', enableSuperflex: true },
        rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'SUPER_FLEX', 'BN', 'BN', 'TAXI', 'IR'],
        nfl_roster_config: { slots: { QB: 1, RB: 2, WR: 3, TE: 1, SUPER_FLEX: 1, BN: 8, TAXI: 4, IR: 2 } },
      },
      starters: { QB: 1, RB: 2, WR: 3, TE: 1, SUPER_FLEX: 1 },
    },
    update: {
      userId: commissionerUserId,
      name: 'Runtime Seed NFL Dynasty War Room',
      sport: 'NFL',
      season: DYNASTY_WAR_ROOM_RUNTIME_SEED.season,
      isDynasty: true,
      leagueType: 'dynasty',
      leagueVariant: null,
      status: 'active',
      lifecycleState: 'in_season',
      settings: {
        seed: 'dynasty-war-room-runtime',
        roster_format_type: 'dynasty_superflex',
        scoring_format_type: 'PPR',
        sportConfig: { scoringPreset: 'PPR', enableSuperflex: true },
        rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'SUPER_FLEX', 'BN', 'BN', 'TAXI', 'IR'],
        nfl_roster_config: { slots: { QB: 1, RB: 2, WR: 3, TE: 1, SUPER_FLEX: 1, BN: 8, TAXI: 4, IR: 2 } },
      },
      starters: { QB: 1, RB: 2, WR: 3, TE: 1, SUPER_FLEX: 1 },
    },
  })

  await prisma.roster.createMany({
    data: [
      {
        id: DYNASTY_WAR_ROOM_RUNTIME_SEED.memberRosterId,
        leagueId,
        platformUserId: memberUserId,
        playerData: buildPlayerData(memberPlayers),
        faabRemaining: 80,
        waiverPriority: 4,
      },
      {
        id: DYNASTY_WAR_ROOM_RUNTIME_SEED.opponentRosterId,
        leagueId,
        platformUserId: commissionerUserId,
        playerData: buildPlayerData(opponentPlayers),
        faabRemaining: 60,
        waiverPriority: 1,
      },
    ],
  })

  await prisma.leagueTeam.createMany({
    data: [
      {
        id: 'dwr-runtime-member-team',
        leagueId,
        externalId: 'runtime-member-team',
        ownerName: 'Dynasty Seed Member',
        teamName: 'Dynasty Member FC',
        wins: 8,
        losses: 2,
        ties: 0,
        pointsFor: 1420.5,
        pointsAgainst: 1180.2,
        currentRank: 2,
        claimedByUserId: memberUserId,
        platformUserId: memberUserId,
        role: 'member',
      },
      {
        id: 'dwr-runtime-commissioner-team',
        leagueId,
        externalId: 'runtime-commissioner-team',
        ownerName: 'Dynasty Seed Commissioner',
        teamName: 'Dynasty Commissioner FC',
        wins: 3,
        losses: 7,
        ties: 0,
        pointsFor: 1090.8,
        pointsAgainst: 1310.4,
        currentRank: 9,
        claimedByUserId: commissionerUserId,
        platformUserId: commissionerUserId,
        role: 'commissioner',
        isCommissioner: true,
      },
    ],
  })
}

/**
 * Seed real future-pick capital + a rookie draft window.
 *
 * Scenario: the MEMBER is a contender with WEAK pick capital (only late picks, and
 * traded its 2027 1st + 2nd away). The OPPONENT/commissioner is a rebuilder with
 * STRONG pick capital (multiple early picks, including the member's traded 1st/2nd).
 * Picks reference rosterIds (currentOwnerId/originalRosterId). Wrapped so a test env
 * WITHOUT the migration (P2021) degrades gracefully instead of hard-failing.
 */
async function seedPicks() {
  const { leagueId, memberRosterId, opponentRosterId } = DYNASTY_WAR_ROOM_RUNTIME_SEED
  type SeedPick = {
    pickSeason: number
    round: number
    originalRosterId: string
    currentOwnerId: string
    traded: boolean
  }
  const picks: SeedPick[] = [
    // Member (contender) keeps only late picks.
    { pickSeason: 2027, round: 3, originalRosterId: memberRosterId, currentOwnerId: memberRosterId, traded: false },
    { pickSeason: 2028, round: 3, originalRosterId: memberRosterId, currentOwnerId: memberRosterId, traded: false },
    { pickSeason: 2028, round: 4, originalRosterId: memberRosterId, currentOwnerId: memberRosterId, traded: false },
    // Opponent (rebuilder) owns its own early picks…
    { pickSeason: 2027, round: 1, originalRosterId: opponentRosterId, currentOwnerId: opponentRosterId, traded: false },
    { pickSeason: 2027, round: 2, originalRosterId: opponentRosterId, currentOwnerId: opponentRosterId, traded: false },
    { pickSeason: 2028, round: 1, originalRosterId: opponentRosterId, currentOwnerId: opponentRosterId, traded: false },
    { pickSeason: 2029, round: 1, originalRosterId: opponentRosterId, currentOwnerId: opponentRosterId, traded: false },
    // …plus the member's traded-away 2027 1st + 2nd (traded scenario).
    { pickSeason: 2027, round: 1, originalRosterId: memberRosterId, currentOwnerId: opponentRosterId, traded: true },
    { pickSeason: 2027, round: 2, originalRosterId: memberRosterId, currentOwnerId: opponentRosterId, traded: true },
  ]

  try {
    await prisma.futureDraftPick.deleteMany({ where: { leagueId } })
    await prisma.futureDraftPick.createMany({
      data: picks.map((p) => ({
        leagueId,
        pickSeason: p.pickSeason,
        round: p.round,
        originalRosterId: p.originalRosterId,
        currentOwnerId: p.currentOwnerId,
        // A traded pick is still a live, usable asset for its new owner — keep it
        // 'active'; the `traded` boolean records that it changed hands.
        status: 'active',
        traded: p.traded,
      })),
      skipDuplicates: true,
    })
    await prisma.rookieDraftWindow.deleteMany({ where: { leagueId } })
    await prisma.rookieDraftWindow.create({
      data: { leagueId, season: 2027, status: 'pending', draftOrderMethod: 'max_pf' },
    })
  } catch (error) {
    if ((error as { code?: string } | null)?.code === 'P2021') {
      console.warn('[seed] future_draft_picks / rookie_draft_windows not migrated in this DB — skipping pick seed.')
      return
    }
    throw error
  }
}

async function connectWithRetry(attempts = 5): Promise<void> {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await prisma.$queryRaw`SELECT 1`
      return
    } catch (error) {
      if (i === attempts) throw error
      const waitMs = 1500 * i
      console.warn(`[seed] database not reachable yet (attempt ${i}/${attempts}); retrying in ${waitMs}ms…`)
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
  }
}

export async function seedDynastyWarRoomRuntime() {
  await connectWithRetry()
  await seedUsersAndEntitlement()
  await seedSportsPlayers()
  await seedDynastyAdp()
  await seedLeague()
  await seedPicks()
  return { ...DYNASTY_WAR_ROOM_RUNTIME_SEED }
}

export async function disconnectDynastyWarRoomRuntimeSeed() {
  await prisma.$disconnect()
}

async function main() {
  // Fail closed before the first write: these fixtures create login accounts whose password
  // is hardcoded in this public repo, so seeding a real environment publishes credentials.
  assertSafeSeedTarget('seed-dynasty-war-room-runtime')

  const result = await seedDynastyWarRoomRuntime()
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
