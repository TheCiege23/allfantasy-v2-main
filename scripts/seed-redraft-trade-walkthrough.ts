/**
 * TRADE CENTER WALKTHROUGH SEED — dev/test only.
 *
 * Creates two native redraft leagues (RedraftSeason / RedraftRoster / RedraftRosterPlayer) so the
 * Playwright trade smoke can prove the stepped Trade Center end-to-end in a real browser:
 *   - tc-nfl   : NFL redraft, commissioner + 4 managers, populated rosters, FAAB balances,
 *                pending + accepted + rejected + league-vote proposals.
 *   - tc-ncaaf : NCAAF redraft, commissioner + 4 managers, populated rosters (limited-data sport).
 *
 * Everything is namespaced under `tc-*` ids and torn down/recreated on each run. No provider write
 * syncs, no env changes, no production data mutation beyond these dev/test fixtures.
 */

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { assertSafeSeedTarget } from './_assert-safe-seed-target'

const prisma = new PrismaClient()

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_TC_SEED !== 'true') {
  console.error('Refusing to run the Trade Center walkthrough seed in production (set ALLOW_TC_SEED=true to override).')
  process.exit(1)
}

export const TC_TRADE_SEED = {
  password: 'Password123!',
  commissionerUserId: 'tc-commish-user',
  commissionerLogin: 'tc_commish',
  managerUserIds: ['tc-mgr-1-user', 'tc-mgr-2-user', 'tc-mgr-3-user', 'tc-mgr-4-user'],
  managerLogins: ['tc_mgr_1', 'tc_mgr_2', 'tc_mgr_3', 'tc_mgr_4'],
  leagues: {
    nfl: { leagueId: 'tc-nfl-league', seasonId: 'tc-nfl-season' },
    ncaaf: { leagueId: 'tc-ncaaf-league', seasonId: 'tc-ncaaf-season' },
  },
} as const

const now = new Date()
const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

type SeedUser = { id: string; username: string; displayName: string }

const COMMISH: SeedUser = {
  id: TC_TRADE_SEED.commissionerUserId,
  username: TC_TRADE_SEED.commissionerLogin,
  displayName: 'TC Commissioner',
}
const MANAGERS: SeedUser[] = TC_TRADE_SEED.managerUserIds.map((id, i) => ({
  id,
  username: TC_TRADE_SEED.managerLogins[i]!,
  displayName: `TC Manager ${i + 1}`,
}))
const ALL_USERS = [COMMISH, ...MANAGERS]

const NFL_POS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'K', 'DST']
const NCAAF_POS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE']

async function upsertUser(u: SeedUser, passwordHash: string) {
  const holder = await prisma.appUser.findUnique({ where: { username: u.username }, select: { id: true } })
  if (holder && holder.id !== u.id) {
    await prisma.appUser.update({ where: { id: holder.id }, data: { username: `stale-${holder.id}-${Date.now()}` } })
  }
  await prisma.appUser.upsert({
    where: { id: u.id },
    create: { id: u.id, email: `${u.username}@example.com`, username: u.username, displayName: u.displayName, passwordHash, emailVerified: now },
    update: { email: `${u.username}@example.com`, username: u.username, displayName: u.displayName, passwordHash, emailVerified: now },
  })
}

function rosterPlayers(sport: 'NFL' | 'NCAAF', leaguePrefix: string, mgrIndex: number) {
  const positions = sport === 'NFL' ? NFL_POS : NCAAF_POS
  return positions.map((pos, i) => ({
    playerId: `${leaguePrefix}-m${mgrIndex}-p${i}`,
    playerName: `${leaguePrefix.toUpperCase()} M${mgrIndex} ${pos}${i}`,
    position: pos,
    team: 'FA',
    sport,
    slotType: i < 6 ? pos : 'BENCH',
    byeWeek: 6 + (i % 6),
    injuryStatus: null as string | null,
    acquisitionType: 'drafted',
  }))
}

async function clearLeague(leagueId: string) {
  // Proposals/assets/votes cascade from RedraftSeason delete; clear belt-and-suspenders.
  const season = await prisma.redraftSeason.findFirst({ where: { leagueId }, select: { id: true } })
  if (season) {
    await prisma.redraftTradeProposal.deleteMany({ where: { seasonId: season.id } }).catch(() => undefined)
  }
  await prisma.redraftLeagueTrade.deleteMany({ where: { leagueId } }).catch(() => undefined)
  await prisma.redraftSeason.deleteMany({ where: { leagueId } }).catch(() => undefined)
  await prisma.leagueTeam.deleteMany({ where: { leagueId } }).catch(() => undefined)
}

async function seedLeague(opts: {
  sport: 'NFL' | 'NCAAF'
  leagueId: string
  seasonId: string
  name: string
}) {
  const { sport, leagueId, seasonId, name } = opts
  const prefix = sport === 'NFL' ? 'tc-nfl' : 'tc-ncaaf'
  await clearLeague(leagueId)

  await prisma.league.upsert({
    where: { id: leagueId },
    create: {
      id: leagueId,
      userId: COMMISH.id,
      platform: 'allfantasy',
      platformLeagueId: leagueId,
      name,
      sport,
      season: 2026,
      leagueSize: 5,
      scoring: 'PPR',
      isDynasty: false,
      rosterSize: 15,
      leagueType: 'redraft',
      status: 'active',
      lifecycleState: 'in_season',
      waiverType: 'faab',
      waiverBudget: 100,
      tradeReviewHours: 48,
      tradeDeadlineWeek: 12,
      draftPickTrading: false,
      settingsSnapshotVersion: 1,
      settings: { seed: 'tc-trade-walkthrough', syntheticProviderRows: true },
    },
    update: {
      userId: COMMISH.id,
      name,
      sport,
      leagueType: 'redraft',
      status: 'active',
      lifecycleState: 'in_season',
      waiverType: 'faab',
      waiverBudget: 100,
      tradeReviewHours: 48,
      tradeDeadlineWeek: 12,
      draftPickTrading: false,
      settings: { seed: 'tc-trade-walkthrough', syntheticProviderRows: true },
    },
  })

  await prisma.redraftLeagueExtendedSettings.upsert({
    where: { leagueId },
    create: { leagueId, commissionerTradeReviewType: 'commissioner' },
    update: { commissionerTradeReviewType: 'commissioner' },
  })

  await prisma.redraftSeason.create({
    data: {
      id: seasonId,
      leagueId,
      sport,
      season: 2026,
      status: 'active',
      totalWeeks: 17,
      playoffStartWeek: 15,
      currentWeek: 6,
    },
  })

  // Commissioner + 4 managers => 5 teams + rosters.
  const owners = [COMMISH, ...MANAGERS]
  const rosterIds: string[] = []
  for (let idx = 0; idx < owners.length; idx += 1) {
    const owner = owners[idx]!
    const rosterId = `${leagueId}-roster-${idx}`
    rosterIds.push(rosterId)
    const isCommish = idx === 0

    await prisma.leagueTeam.create({
      data: {
        id: `${leagueId}-team-${idx}`,
        leagueId,
        externalId: `${leagueId}-team-${idx}`,
        ownerName: owner.displayName,
        teamName: `${owner.displayName} FC`,
        wins: 3,
        losses: 3,
        claimedByUserId: owner.id,
        platformUserId: owner.id,
        role: isCommish ? 'commissioner' : 'member',
        isCommissioner: isCommish,
      },
    })

    await prisma.redraftRoster.create({
      data: {
        id: rosterId,
        seasonId,
        leagueId,
        ownerId: owner.id,
        ownerName: owner.displayName,
        teamName: `${owner.displayName} FC`,
        wins: 3,
        losses: 3,
        pointsFor: 700 + idx,
        pointsAgainst: 690,
        faabBalance: 100 - idx * 5,
        waiverPriority: idx + 1,
        players: { create: rosterPlayers(sport, prefix, idx) },
      },
    })
  }

  // Proposals in multiple states (manager 1 = roster-1, manager 2 = roster-2, etc.).
  const [, r1, r2, r3] = rosterIds
  async function makeProposal(input: {
    id: string
    proposer: string
    receiver: string
    status: string
    vetoMode?: string
    assets: Array<{ from: string; to: string; assetType: string; playerId?: string; playerName?: string; metadata?: object }>
  }) {
    await prisma.redraftTradeProposal.create({
      data: {
        id: input.id,
        leagueId,
        seasonId,
        proposerRosterId: input.proposer,
        receiverRosterId: input.receiver,
        status: input.status,
        vetoMode: input.vetoMode ?? 'commissioner',
        vetoThreshold: 4,
        reason: `Seeded ${input.status} proposal`,
        expiresAt: nextMonth,
        assets: {
          create: input.assets.map((a, i) => ({
            id: `${input.id}-a${i}`,
            fromRosterId: a.from,
            toRosterId: a.to,
            assetType: a.assetType,
            playerId: a.playerId ?? null,
            playerName: a.playerName ?? null,
            metadata: a.metadata ?? {},
          })),
        },
      },
    })
  }

  await makeProposal({
    id: `${leagueId}-prop-pending`,
    proposer: r1!,
    receiver: r2!,
    status: 'pending',
    assets: [
      { from: r1!, to: r2!, assetType: 'player', playerId: `${prefix}-m1-p1`, playerName: `${prefix.toUpperCase()} M1 RB1` },
      { from: r2!, to: r1!, assetType: 'player', playerId: `${prefix}-m2-p3`, playerName: `${prefix.toUpperCase()} M2 WR3` },
    ],
  })
  await makeProposal({
    id: `${leagueId}-prop-vote`,
    proposer: r2!,
    receiver: r3!,
    status: 'pending',
    vetoMode: 'league_vote',
    assets: [
      { from: r2!, to: r3!, assetType: 'player', playerId: `${prefix}-m2-p0`, playerName: `${prefix.toUpperCase()} M2 QB0` },
      { from: r3!, to: r2!, assetType: 'faab', metadata: { amount: 15 } },
    ],
  })
  await makeProposal({
    id: `${leagueId}-prop-rejected`,
    proposer: r1!,
    receiver: r3!,
    status: 'rejected',
    assets: [
      { from: r1!, to: r3!, assetType: 'player', playerId: `${prefix}-m1-p0`, playerName: `${prefix.toUpperCase()} M1 QB0` },
      { from: r3!, to: r1!, assetType: 'player', playerId: `${prefix}-m3-p0`, playerName: `${prefix.toUpperCase()} M3 QB0` },
    ],
  })

  return { leagueId, seasonId, sport, teams: owners.length, rosterIds }
}

export async function seedRedraftTradeWalkthrough() {
  const passwordHash = await bcrypt.hash(TC_TRADE_SEED.password, 10)
  for (const u of ALL_USERS) await upsertUser(u, passwordHash)

  const nfl = await seedLeague({ sport: 'NFL', ...TC_TRADE_SEED.leagues.nfl, name: 'TC NFL Trade League' })
  const ncaaf = await seedLeague({ sport: 'NCAAF', ...TC_TRADE_SEED.leagues.ncaaf, name: 'TC NCAAF Trade League' })
  return { ...TC_TRADE_SEED, results: { nfl, ncaaf } }
}

async function main() {
  // Fail closed before the first write — see scripts/_assert-safe-seed-target.ts.
  assertSafeSeedTarget('seed-redraft-trade-walkthrough')

  const result = await seedRedraftTradeWalkthrough()
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
