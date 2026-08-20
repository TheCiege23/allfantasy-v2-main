import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { assertSafeSeedTarget } from './_assert-safe-seed-target'

const prisma = new PrismaClient()

export const REDRAFT_WAR_ROOM_RUNTIME_SEED = {
  leagueId: 'rwr-runtime-nfl-redraft-league',
  seasonId: 'rwr-runtime-nfl-redraft-season',
  memberUserId: 'rwr-runtime-member-user',
  commissionerUserId: 'rwr-runtime-commissioner-user',
  outsiderUserId: 'rwr-runtime-outsider-user',
  memberRosterId: 'rwr-runtime-member-roster',
  opponentRosterId: 'rwr-runtime-opponent-roster',
  memberLegacyRosterId: 'rwr-runtime-member-legacy-roster',
  opponentLegacyRosterId: 'rwr-runtime-opponent-legacy-roster',
  password: 'Password123!',
  memberLogin: 'rwr_runtime_member',
  commissionerLogin: 'rwr_runtime_commish',
  outsiderLogin: 'rwr_runtime_outsider',
  opponentIncomingPlayerId: 'rwr-opp-rb-1',
} as const

const now = new Date()
const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

export const memberPlayers = [
  { playerId: 'rwr-member-qb-1', playerName: 'Runtime Seed QB', position: 'QB', team: 'BUF', slotType: 'QB', byeWeek: 7, projection: 19.6, actual: 18.1 },
  { playerId: 'rwr-member-rb-1', playerName: 'Runtime Seed RB1', position: 'RB', team: 'ATL', slotType: 'RB', byeWeek: 5, projection: 15.2, actual: 14.4 },
  { playerId: 'rwr-member-rb-2', playerName: 'Runtime Seed RB2', position: 'RB', team: 'DET', slotType: 'RB', byeWeek: 9, projection: 12.8, actual: 11.9 },
  { playerId: 'rwr-member-wr-1', playerName: 'Runtime Seed WR1', position: 'WR', team: 'MIN', slotType: 'WR', byeWeek: 6, projection: 17.1, actual: 16.7 },
  { playerId: 'rwr-member-wr-2', playerName: 'Runtime Seed WR2', position: 'WR', team: 'DAL', slotType: 'WR', byeWeek: 8, projection: 13.3, actual: 12.2 },
  { playerId: 'rwr-member-te-1', playerName: 'Runtime Seed TE', position: 'TE', team: 'KC', slotType: 'TE', byeWeek: 10, projection: 10.6, actual: 9.8 },
  { playerId: 'rwr-member-rb-3', playerName: 'Runtime Seed Bench RB', position: 'RB', team: 'SEA', slotType: 'FLEX', byeWeek: 11, projection: 9.7, actual: 8.5 },
  { playerId: 'rwr-member-k-1', playerName: 'Runtime Seed K', position: 'K', team: 'BAL', slotType: 'K', byeWeek: 13, projection: 8.2, actual: 8.0 },
  { playerId: 'rwr-member-dst-1', playerName: 'Runtime Seed DST', position: 'DST', team: 'NYJ', slotType: 'DST', byeWeek: 12, projection: 7.4, actual: 6.8 },
  { playerId: 'rwr-member-wr-3', playerName: 'Runtime Seed Bench WR', position: 'WR', team: 'LAC', slotType: 'bench', byeWeek: 10, projection: 7.6, actual: 7.1, injuryStatus: 'Questionable' },
  { playerId: 'rwr-member-te-2', playerName: 'Runtime Seed Bench TE', position: 'TE', team: 'SF', slotType: 'bench', byeWeek: 14, projection: 5.2, actual: 4.9 },
]

export const opponentPlayers = [
  { playerId: 'rwr-opp-qb-1', playerName: 'Runtime Opponent QB', position: 'QB', team: 'PHI', slotType: 'QB', byeWeek: 9, projection: 21.2, actual: 20.5 },
  { playerId: 'rwr-opp-rb-1', playerName: 'Runtime Opponent RB1', position: 'RB', team: 'MIA', slotType: 'RB', byeWeek: 6, projection: 18.9, actual: 17.8 },
  { playerId: 'rwr-opp-rb-2', playerName: 'Runtime Opponent RB2', position: 'RB', team: 'CHI', slotType: 'RB', byeWeek: 7, projection: 11.4, actual: 10.1 },
  { playerId: 'rwr-opp-rb-3', playerName: 'Runtime Opponent Bench RB', position: 'RB', team: 'GB', slotType: 'bench', byeWeek: 8, projection: 8.3, actual: 7.4 },
  { playerId: 'rwr-opp-wr-1', playerName: 'Runtime Opponent WR1', position: 'WR', team: 'CIN', slotType: 'WR', byeWeek: 12, projection: 16.5, actual: 15.1 },
  { playerId: 'rwr-opp-wr-2', playerName: 'Runtime Opponent WR2', position: 'WR', team: 'HOU', slotType: 'WR', byeWeek: 14, projection: 14.1, actual: 13.2 },
  { playerId: 'rwr-opp-wr-3', playerName: 'Runtime Opponent Bench WR', position: 'WR', team: 'ARI', slotType: 'FLEX', byeWeek: 11, projection: 9.4, actual: 8.6 },
  { playerId: 'rwr-opp-te-1', playerName: 'Runtime Opponent TE', position: 'TE', team: 'LV', slotType: 'TE', byeWeek: 10, projection: 7.9, actual: 7.2 },
  { playerId: 'rwr-opp-k-1', playerName: 'Runtime Opponent K', position: 'K', team: 'PIT', slotType: 'K', byeWeek: 5, projection: 7.8, actual: 7.6 },
  { playerId: 'rwr-opp-dst-1', playerName: 'Runtime Opponent DST', position: 'DST', team: 'CLE', slotType: 'DST', byeWeek: 9, projection: 7.1, actual: 6.5 },
]

const allPlayers = [...memberPlayers, ...opponentPlayers]

/**
 * Legacy `Roster.playerData` shape read by two independent consumers, both
 * populated together by a real completed draft via
 * `finalizeRosterAssignments`/`buildPlayerDataFromSections`
 * (lib/roster/LineupTemplateValidation.ts):
 *  - `getRosterPlayerIds`/`getStarterIds` (lib/waiver-wire/roster-utils.ts,
 *    used by `/api/league/roster` -> TeamTab.tsx Roster tab) read the FLAT
 *    `players`/`starters` keys.
 *  - `getNormalizedLineupSections` (lib/roster/LineupTemplateValidation.ts,
 *    used by `evaluateFullRosterLegalityAsync` -> the waiver add-drop
 *    legality gate) reads the NESTED `lineup_sections.starters` block.
 * This seed bypasses the draft flow, so it must build both shapes by hand —
 * missing either one leaves a consumer seeing an empty roster despite real
 * `RedraftRosterPlayer` rows existing (confirmed: omitting `lineup_sections`
 * made every waiver add-drop attempt fail with "Not enough starters (0/9)").
 */
export function buildLegacyPlayerData(players: typeof memberPlayers) {
  const starters = players.filter((p) => p.slotType !== 'bench')
  const bench = players.filter((p) => p.slotType === 'bench')
  // `lineup_sections` entries need a real player `position` (e.g. 'QB'/'RB') —
  // `getStarterAllowedSet` checks it against the league template's allowed
  // positions per slot. Plain string ids default to `position: 'UTIL'`
  // (lib/roster/LineupTemplateValidation.ts's `normalizeLineupSection`),
  // which no NFL redraft slot allows, so every add-drop failed with
  // "Starter position UTIL is not eligible for this league template."
  return {
    seed: 'redraft-war-room-runtime',
    players: players.map((p) => p.playerId),
    starters: starters.map((p) => p.playerId),
    reserve: [] as string[],
    taxi: [] as string[],
    lineup_sections: {
      starters: starters.map((p) => ({ id: p.playerId, position: p.position })),
      bench: bench.map((p) => ({ id: p.playerId, position: p.position })),
      ir: [] as string[],
      taxi: [] as string[],
      devy: [] as string[],
    },
    lineup_updated_at: new Date().toISOString(),
  }
}

/**
 * Run an optional provider-table operation, tolerating the table being absent
 * from this database. The sports_core_* provider tables (injury reports, news)
 * are part of a separate platform-backend foundation that is not present in
 * every environment. When missing, the Redraft War Room context already degrades
 * to a truthful "provider-limited" state via its own `.catch(() => [])` guards,
 * so the seed should not hard-fail — it just skips the synthetic injury/news rows.
 * Only the "table does not exist" error (P2021) is swallowed; anything else throws.
 */
async function tryOptionalProviderOp(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (code === 'P2021') {
      console.warn(`[seed] skipping optional provider op "${label}" — backing table not present in this database.`)
      return
    }
    throw error
  }
}

async function upsertUser(input: {
  id: string
  email: string
  username: string
  displayName: string
  passwordHash: string
}) {
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
  const passwordHash = await bcrypt.hash(REDRAFT_WAR_ROOM_RUNTIME_SEED.password, 10)

  await upsertUser({
    id: REDRAFT_WAR_ROOM_RUNTIME_SEED.memberUserId,
    email: 'rwr-runtime-member@example.com',
    username: REDRAFT_WAR_ROOM_RUNTIME_SEED.memberLogin,
    displayName: 'Runtime Seed Member',
    passwordHash,
  })
  await upsertUser({
    id: REDRAFT_WAR_ROOM_RUNTIME_SEED.commissionerUserId,
    email: 'rwr-runtime-commissioner@example.com',
    username: REDRAFT_WAR_ROOM_RUNTIME_SEED.commissionerLogin,
    displayName: 'Runtime Seed Commissioner',
    passwordHash,
  })
  await upsertUser({
    id: REDRAFT_WAR_ROOM_RUNTIME_SEED.outsiderUserId,
    email: 'rwr-runtime-outsider@example.com',
    username: REDRAFT_WAR_ROOM_RUNTIME_SEED.outsiderLogin,
    displayName: 'Runtime Seed Outsider',
    passwordHash,
  })

  const plan = await prisma.subscriptionPlan.upsert({
    where: { code: 'af_war_room' },
    create: {
      code: 'af_war_room',
      name: 'AF War Room',
      description: 'Runtime seed entitlement for Redraft War Room QA.',
      isBundle: false,
      isActive: true,
      metadata: { seed: 'redraft-war-room-runtime' },
    },
    update: {
      name: 'AF War Room',
      isActive: true,
      metadata: { seed: 'redraft-war-room-runtime' },
    },
  })

  await prisma.userSubscription.upsert({
    where: { id: 'rwr-runtime-commissioner-subscription' },
    create: {
      id: 'rwr-runtime-commissioner-subscription',
      userId: REDRAFT_WAR_ROOM_RUNTIME_SEED.commissionerUserId,
      subscriptionPlanId: plan.id,
      status: 'active',
      source: 'runtime-seed',
      sku: 'af_war_room_runtime_seed',
      currentPeriodStart: now,
      currentPeriodEnd: nextMonth,
      expiresAt: nextMonth,
      metadata: { seed: 'redraft-war-room-runtime', synthetic: true },
    },
    update: {
      subscriptionPlanId: plan.id,
      status: 'active',
      source: 'runtime-seed',
      sku: 'af_war_room_runtime_seed',
      currentPeriodStart: now,
      currentPeriodEnd: nextMonth,
      expiresAt: nextMonth,
      canceledAt: null,
      metadata: { seed: 'redraft-war-room-runtime', synthetic: true },
    },
  })
}

async function seedLeague() {
  await prisma.fantasyProjection.deleteMany({ where: { playerId: { in: allPlayers.map((p) => p.playerId) } } })
  await prisma.playerWeeklyScore.deleteMany({ where: { playerId: { in: allPlayers.map((p) => p.playerId) } } })
  await tryOptionalProviderOp('injuryReport.deleteMany', () =>
    prisma.injuryReport.deleteMany({ where: { playerId: { in: allPlayers.map((p) => p.playerId) } } }),
  )
  await tryOptionalProviderOp('playerNewsItem.deleteMany', () =>
    prisma.playerNewsItem.deleteMany({ where: { playerId: { in: allPlayers.map((p) => p.playerId) } } }),
  )
  await prisma.redraftSeason.deleteMany({ where: { leagueId: REDRAFT_WAR_ROOM_RUNTIME_SEED.leagueId } })
  await prisma.roster.deleteMany({ where: { leagueId: REDRAFT_WAR_ROOM_RUNTIME_SEED.leagueId } })
  await prisma.leagueTeam.deleteMany({ where: { leagueId: REDRAFT_WAR_ROOM_RUNTIME_SEED.leagueId } })

  await prisma.league.upsert({
    where: { id: REDRAFT_WAR_ROOM_RUNTIME_SEED.leagueId },
    create: {
      id: REDRAFT_WAR_ROOM_RUNTIME_SEED.leagueId,
      userId: REDRAFT_WAR_ROOM_RUNTIME_SEED.commissionerUserId,
      platform: 'allfantasy',
      platformLeagueId: REDRAFT_WAR_ROOM_RUNTIME_SEED.leagueId,
      name: 'Runtime Seed NFL Redraft War Room',
      sport: 'NFL',
      season: 2026,
      leagueSize: 12,
      scoring: 'PPR',
      scoringPresetId: 'ppr',
      isDynasty: false,
      rosterSize: 15,
      leagueType: 'redraft',
      leagueVariant: null,
      status: 'active',
      lifecycleState: 'in_season',
      waiverType: 'faab',
      waiverBudget: 100,
      settingsSnapshotVersion: 1,
      settings: {
        seed: 'redraft-war-room-runtime',
        syntheticProviderRows: true,
        sportConfig: {
          scoringPreset: 'PPR',
          categoryPoints: { rec: 1 },
          waiverType: 'faab',
          waiverBudget: 100,
        },
        rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DST', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'IR'],
        nfl_roster_config: {
          slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6, IR: 1 },
        },
      },
      starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 },
    },
    update: {
      userId: REDRAFT_WAR_ROOM_RUNTIME_SEED.commissionerUserId,
      name: 'Runtime Seed NFL Redraft War Room',
      sport: 'NFL',
      season: 2026,
      leagueSize: 12,
      scoring: 'PPR',
      scoringPresetId: 'ppr',
      isDynasty: false,
      rosterSize: 15,
      leagueType: 'redraft',
      leagueVariant: null,
      status: 'active',
      lifecycleState: 'in_season',
      waiverType: 'faab',
      waiverBudget: 100,
      settingsSnapshotVersion: 1,
      settings: {
        seed: 'redraft-war-room-runtime',
        syntheticProviderRows: true,
        sportConfig: {
          scoringPreset: 'PPR',
          categoryPoints: { rec: 1 },
          waiverType: 'faab',
          waiverBudget: 100,
        },
        rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DST', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'IR'],
        nfl_roster_config: {
          slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6, IR: 1 },
        },
      },
      starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 },
    },
  })

  await prisma.roster.createMany({
    data: [
      {
        id: REDRAFT_WAR_ROOM_RUNTIME_SEED.memberLegacyRosterId,
        leagueId: REDRAFT_WAR_ROOM_RUNTIME_SEED.leagueId,
        platformUserId: REDRAFT_WAR_ROOM_RUNTIME_SEED.memberUserId,
        playerData: buildLegacyPlayerData(memberPlayers),
        faabRemaining: 78,
        waiverPriority: 5,
      },
      {
        id: REDRAFT_WAR_ROOM_RUNTIME_SEED.opponentLegacyRosterId,
        leagueId: REDRAFT_WAR_ROOM_RUNTIME_SEED.leagueId,
        platformUserId: REDRAFT_WAR_ROOM_RUNTIME_SEED.commissionerUserId,
        playerData: buildLegacyPlayerData(opponentPlayers),
        faabRemaining: 91,
        waiverPriority: 2,
      },
    ],
  })

  await prisma.leagueTeam.createMany({
    data: [
      {
        id: 'rwr-runtime-member-team',
        leagueId: REDRAFT_WAR_ROOM_RUNTIME_SEED.leagueId,
        externalId: 'runtime-member-team',
        ownerName: 'Runtime Seed Member',
        teamName: 'Runtime Member FC',
        wins: 4,
        losses: 2,
        ties: 0,
        pointsFor: 742.4,
        pointsAgainst: 698.1,
        claimedByUserId: REDRAFT_WAR_ROOM_RUNTIME_SEED.memberUserId,
        platformUserId: REDRAFT_WAR_ROOM_RUNTIME_SEED.memberUserId,
        role: 'member',
      },
      {
        id: 'rwr-runtime-commissioner-team',
        leagueId: REDRAFT_WAR_ROOM_RUNTIME_SEED.leagueId,
        externalId: 'runtime-commissioner-team',
        ownerName: 'Runtime Seed Commissioner',
        teamName: 'Runtime Commissioner FC',
        wins: 5,
        losses: 1,
        ties: 0,
        pointsFor: 781.6,
        pointsAgainst: 655.3,
        claimedByUserId: REDRAFT_WAR_ROOM_RUNTIME_SEED.commissionerUserId,
        platformUserId: REDRAFT_WAR_ROOM_RUNTIME_SEED.commissionerUserId,
        role: 'commissioner',
        isCommissioner: true,
      },
    ],
  })

  await prisma.redraftSeason.create({
    data: {
      id: REDRAFT_WAR_ROOM_RUNTIME_SEED.seasonId,
      leagueId: REDRAFT_WAR_ROOM_RUNTIME_SEED.leagueId,
      sport: 'NFL',
      season: 2026,
      status: 'active',
      totalWeeks: 17,
      playoffStartWeek: 15,
      currentWeek: 6,
    },
  })

  await prisma.redraftRoster.create({
    data: {
      id: REDRAFT_WAR_ROOM_RUNTIME_SEED.memberRosterId,
      seasonId: REDRAFT_WAR_ROOM_RUNTIME_SEED.seasonId,
      leagueId: REDRAFT_WAR_ROOM_RUNTIME_SEED.leagueId,
      ownerId: REDRAFT_WAR_ROOM_RUNTIME_SEED.memberUserId,
      ownerName: 'Runtime Seed Member',
      teamName: 'Runtime Member FC',
      wins: 4,
      losses: 2,
      pointsFor: 742.4,
      pointsAgainst: 698.1,
      streak: 'W2',
      playoffSeed: 3,
      faabBalance: 78,
      waiverPriority: 5,
      players: {
        create: memberPlayers.map((p) => ({
          playerId: p.playerId,
          playerName: p.playerName,
          position: p.position,
          team: p.team,
          sport: 'NFL',
          slotType: p.slotType,
          injuryStatus: p.injuryStatus ?? null,
          byeWeek: p.byeWeek,
          acquisitionType: 'runtime_seed',
        })),
      },
    },
  })

  await prisma.redraftRoster.create({
    data: {
      id: REDRAFT_WAR_ROOM_RUNTIME_SEED.opponentRosterId,
      seasonId: REDRAFT_WAR_ROOM_RUNTIME_SEED.seasonId,
      leagueId: REDRAFT_WAR_ROOM_RUNTIME_SEED.leagueId,
      ownerId: REDRAFT_WAR_ROOM_RUNTIME_SEED.commissionerUserId,
      ownerName: 'Runtime Seed Commissioner',
      teamName: 'Runtime Commissioner FC',
      wins: 5,
      losses: 1,
      pointsFor: 781.6,
      pointsAgainst: 655.3,
      streak: 'W4',
      playoffSeed: 1,
      faabBalance: 91,
      waiverPriority: 2,
      players: {
        create: opponentPlayers.map((p) => ({
          playerId: p.playerId,
          playerName: p.playerName,
          position: p.position,
          team: p.team,
          sport: 'NFL',
          slotType: p.slotType,
          injuryStatus: null,
          byeWeek: p.byeWeek,
          acquisitionType: 'runtime_seed',
        })),
      },
    },
  })

  await prisma.redraftMatchup.createMany({
    data: [
      {
        id: 'rwr-runtime-week-5-matchup',
        seasonId: REDRAFT_WAR_ROOM_RUNTIME_SEED.seasonId,
        leagueId: REDRAFT_WAR_ROOM_RUNTIME_SEED.leagueId,
        week: 5,
        homeRosterId: REDRAFT_WAR_ROOM_RUNTIME_SEED.memberRosterId,
        awayRosterId: REDRAFT_WAR_ROOM_RUNTIME_SEED.opponentRosterId,
        homeScore: 128.4,
        awayScore: 121.7,
        homeProjected: 124.1,
        awayProjected: 119.6,
        status: 'final',
      },
      {
        id: 'rwr-runtime-week-6-matchup',
        seasonId: REDRAFT_WAR_ROOM_RUNTIME_SEED.seasonId,
        leagueId: REDRAFT_WAR_ROOM_RUNTIME_SEED.leagueId,
        week: 6,
        homeRosterId: REDRAFT_WAR_ROOM_RUNTIME_SEED.opponentRosterId,
        awayRosterId: REDRAFT_WAR_ROOM_RUNTIME_SEED.memberRosterId,
        homeScore: 0,
        awayScore: 0,
        homeProjected: 124.9,
        awayProjected: 121.3,
        status: 'scheduled',
      },
    ],
  })

  await prisma.fantasyProjection.createMany({
    data: allPlayers.map((p) => ({
      playerId: p.playerId,
      sport: 'NFL',
      season: '2026',
      week: 6,
      scoringPresetId: 'ppr',
      projectedPoints: p.projection,
      stats: { seed: 'redraft-war-room-runtime', synthetic: true },
      source: 'runtime-seed',
      fetchedAt: now,
      expiresAt: nextMonth,
    })),
  })

  await prisma.playerWeeklyScore.createMany({
    data: allPlayers.map((p) => ({
      playerId: p.playerId,
      sport: 'NFL',
      week: 5,
      season: 2026,
      stats: { seed: 'redraft-war-room-runtime', synthetic: true },
      fantasyPts: p.actual,
      isFinalized: true,
    })),
  })

  await tryOptionalProviderOp('injuryReport.create', () =>
    prisma.injuryReport.create({
      data: {
        playerId: 'rwr-member-wr-3',
        sportKey: 'NFL',
        leagueKey: 'NFL',
        seasonKey: '2026',
        weekOrRound: '6',
        playerName: 'Runtime Seed Bench WR',
        teamName: 'LAC',
        status: 'Questionable',
        bodyPart: 'Hamstring',
        description: 'Synthetic runtime seed injury row.',
        reportDate: now,
        source: 'runtime-seed',
        confidence: 1,
        identityConfidence: 1,
        fetchedAt: now,
        expiresAt: nextMonth,
        rawPayload: { seed: 'redraft-war-room-runtime', synthetic: true },
      },
    }),
  )

  await tryOptionalProviderOp('playerNewsItem.create', () =>
    prisma.playerNewsItem.create({
      data: {
        playerId: 'rwr-member-wr-3',
        sportKey: 'NFL',
        leagueKey: 'NFL',
        headline: 'Runtime Seed Bench WR limited in synthetic practice report',
        body: 'Synthetic runtime seed news row used only for Redraft War Room QA.',
        category: 'injury',
        source: 'runtime-seed',
        publishedAt: now,
        fetchedAt: now,
        expiresAt: nextMonth,
        confidence: 1,
        identityConfidence: 1,
        rawPayload: { seed: 'redraft-war-room-runtime', synthetic: true },
      },
    }),
  )
}

/**
 * Neon serverless databases auto-suspend; the first connection after idle can
 * fail with a transient "Can't reach database server" before the compute wakes.
 * Establish the connection with a short retry loop so the seed (and the E2E
 * beforeAll that runs it) is not flaky against cold starts.
 */
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

export async function seedRedraftWarRoomRuntime() {
  await connectWithRetry()
  await seedUsersAndEntitlement()
  await seedLeague()
  return {
    ...REDRAFT_WAR_ROOM_RUNTIME_SEED,
    syntheticProviderRows: true,
  }
}

export async function disconnectRedraftWarRoomRuntimeSeed() {
  await prisma.$disconnect()
}

async function main() {
  // Fail closed before the first write: these fixtures create login accounts whose password
  // is hardcoded in this public repo, so seeding a real environment publishes credentials.
  assertSafeSeedTarget('seed-redraft-war-room-runtime')

  const result = await seedRedraftWarRoomRuntime()
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
