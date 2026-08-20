/**
 * STEP 3B WAIVER WALKTHROUGH SEED — dev/test only.
 *
 * Creates lineup-legal redraft leagues so the Playwright walkthrough can prove every waiver
 * flow green in a real browser:
 *   1. s3b-nfl-fcfs-open   — NFL FCFS, member roster legal with open bench spots (Add direct)
 *   2. s3b-nfl-fcfs-full   — NFL FCFS, member roster filled to capacity (Add → requires drop)
 *   3. s3b-nfl-faab        — NFL FAAB, member + opponent rosters; opponent has a pending claim
 *                            (Claim CTA + privacy: member must not see the opponent's claim)
 *   4. s3b-ncaaf-fcfs      — NCAAF FCFS, member roster legal with open spots (Add, limited data)
 *
 * Rosters are made lineup-legal by filling each template starter slot via the canonical
 * `buildLineupSectionsFromPicks` builder (the same one draft completion uses), so the
 * roster-legality gate ("Not enough starters") passes and real free agents (from the existing
 * sportsPlayer pool) can be added. NO provider writes, NO env changes, NO production data:
 * everything is namespaced under `s3b-*` ids and torn down/recreated on each run.
 */

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { getRosterTemplate } from '../lib/multi-sport/RosterTemplateService'
import { getSlotLimitsFromTemplate } from '../lib/roster/LineupTemplateValidation'
import { buildLineupSectionsFromPicks, type DraftPickForLineup } from '../lib/post-draft/buildStartersFromPicks'
import { buildPersistedRosterDataFromRosterState } from '../lib/roster/buildPersistedRosterDataFromRosterState'
import { assertSafeSeedTarget } from './_assert-safe-seed-target'

const prisma = new PrismaClient()

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_S3B_SEED !== 'true') {
  console.error('Refusing to run the Step 3B walkthrough seed in production (set ALLOW_S3B_SEED=true to override).')
  process.exit(1)
}

export const S3B_WAIVER_SEED = {
  password: 'Password123!',
  memberUserId: 's3b-member-user',
  memberLogin: 's3b_member',
  opponentUserId: 's3b-opponent-user',
  opponentLogin: 's3b_opponent',
  commissionerUserId: 's3b-commish-user',
  commissionerLogin: 's3b_commish',
  leagues: {
    nflFcfsOpen: 's3b-nfl-fcfs-open',
    nflFcfsFull: 's3b-nfl-fcfs-full',
    nflFaab: 's3b-nfl-faab',
    ncaafFcfs: 's3b-ncaaf-fcfs',
  },
} as const

type SeedUser = { id: string; username: string; email: string; displayName: string }

const USERS: SeedUser[] = [
  { id: S3B_WAIVER_SEED.memberUserId, username: S3B_WAIVER_SEED.memberLogin, email: 's3b-member@example.com', displayName: 'S3B Member' },
  { id: S3B_WAIVER_SEED.opponentUserId, username: S3B_WAIVER_SEED.opponentLogin, email: 's3b-opponent@example.com', displayName: 'S3B Opponent' },
  { id: S3B_WAIVER_SEED.commissionerUserId, username: S3B_WAIVER_SEED.commissionerLogin, email: 's3b-commish@example.com', displayName: 'S3B Commissioner' },
]

async function upsertUser(u: SeedUser, passwordHash: string) {
  // Free a stale login held by a different id (re-runnable across schema/test churn).
  const holder = await prisma.appUser.findUnique({ where: { username: u.username }, select: { id: true } })
  if (holder && holder.id !== u.id) {
    await prisma.appUser.update({ where: { id: holder.id }, data: { username: `stale-${holder.id}-${Date.now()}` } })
  }
  await prisma.appUser.upsert({
    where: { id: u.id },
    create: { id: u.id, email: u.email, username: u.username, displayName: u.displayName, passwordHash, emailVerified: new Date() },
    update: { email: u.email, username: u.username, displayName: u.displayName, passwordHash, emailVerified: new Date() },
  })
}

/** Build a list of synthetic picks that legally fills the template's starter slots, plus N bench. */
function buildLegalPicks(template: Awaited<ReturnType<typeof getRosterTemplate>>, leaguePrefix: string, benchCount: number): DraftPickForLineup[] {
  const picks: DraftPickForLineup[] = []
  let n = 0
  const starterSlots = template.slots
    .slice()
    .sort((a, b) => (a.slotOrder ?? 0) - (b.slotOrder ?? 0))
  for (const slot of starterSlots) {
    const count = Math.max(0, slot.starterCount ?? 0)
    const pos = (slot.allowedPositions && slot.allowedPositions[0]) || 'UTIL'
    for (let i = 0; i < count; i += 1) {
      picks.push({ playerId: `${leaguePrefix}-syn-${n}`, playerName: `${leaguePrefix} Starter ${n + 1}`, position: String(pos).toUpperCase(), team: 'FA' })
      n += 1
    }
  }
  // Bench picks use a flexible offensive position so they never violate a starter slot.
  for (let i = 0; i < benchCount; i += 1) {
    picks.push({ playerId: `${leaguePrefix}-syn-${n}`, playerName: `${leaguePrefix} Bench ${i + 1}`, position: 'RB', team: 'FA' })
    n += 1
  }
  return picks
}

async function clearLeague(leagueId: string) {
  await prisma.waiverTransaction.deleteMany({ where: { leagueId } }).catch(() => undefined)
  await prisma.waiverClaim.deleteMany({ where: { leagueId } }).catch(() => undefined)
  await prisma.waiverRun.deleteMany({ where: { leagueId } }).catch(() => undefined)
  await prisma.leagueWaiverSettings.deleteMany({ where: { leagueId } }).catch(() => undefined)
  await prisma.redraftSeason.deleteMany({ where: { leagueId } }).catch(() => undefined)
  await prisma.roster.deleteMany({ where: { leagueId } })
  await prisma.leagueTeam.deleteMany({ where: { leagueId } })
}

interface SeedLeagueOpts {
  leagueId: string
  name: string
  sport: 'NFL' | 'NCAAF'
  waiverType: 'fcfs' | 'faab'
  /** 'open' leaves bench spots; 'full' fills to capacity so an add needs a drop. */
  fill: 'open' | 'full'
  withOpponentClaim?: boolean
}

async function seedLeague(opts: SeedLeagueOpts) {
  const { leagueId, name, sport, waiverType, fill } = opts
  await clearLeague(leagueId)

  const isFaab = waiverType === 'faab'
  await prisma.league.upsert({
    where: { id: leagueId },
    create: {
      id: leagueId,
      userId: S3B_WAIVER_SEED.commissionerUserId,
      platform: 'allfantasy',
      platformLeagueId: leagueId,
      name,
      sport,
      season: 2026,
      leagueSize: 12,
      scoring: 'PPR',
      isDynasty: false,
      rosterSize: 15,
      leagueType: 'redraft',
      status: 'active',
      lifecycleState: 'in_season',
      waiverType,
      waiverBudget: isFaab ? 100 : null,
      settingsSnapshotVersion: 1,
      settings: { seed: 's3b-waiver-walkthrough', syntheticProviderRows: true, sportConfig: { waiverType, ...(isFaab ? { waiverBudget: 100 } : {}) } },
    },
    update: {
      userId: S3B_WAIVER_SEED.commissionerUserId,
      name,
      sport,
      rosterSize: 15,
      leagueType: 'redraft',
      status: 'active',
      lifecycleState: 'in_season',
      waiverType,
      waiverBudget: isFaab ? 100 : null,
      settings: { seed: 's3b-waiver-walkthrough', syntheticProviderRows: true, sportConfig: { waiverType, ...(isFaab ? { waiverBudget: 100 } : {}) } },
    },
  })

  // Canonical waiver settings row (drives normalizedWaiverType for the CTA).
  await prisma.leagueWaiverSettings.create({ data: { leagueId, waiverType, faabBudget: isFaab ? 100 : null } }).catch(async () => {
    const existing = await prisma.leagueWaiverSettings.findFirst({ where: { leagueId } })
    if (existing) await prisma.leagueWaiverSettings.update({ where: { id: existing.id }, data: { waiverType, faabBudget: isFaab ? 100 : null } })
  })

  const template = await getRosterTemplate(sport, 'standard', leagueId)
  const limits = getSlotLimitsFromTemplate(template)
  const benchCapacity = Math.max(0, limits.bench)
  const benchToPlace = fill === 'full' ? benchCapacity : Math.max(0, benchCapacity - 4)
  // Cap rosterSize at the template capacity so a "full" roster (starters + all bench) actually
  // hits the limit and forces a drop on the next add.
  const rosterSizeLimit = limits.starters + benchCapacity
  await prisma.league.update({ where: { id: leagueId }, data: { rosterSize: rosterSizeLimit } })

  function buildRosterData(prefix: string) {
    const picks = buildLegalPicks(template, prefix, benchToPlace)
    const sections = buildLineupSectionsFromPicks(picks, template)
    return buildPersistedRosterDataFromRosterState(sections, { seed: 's3b-waiver-walkthrough', syntheticProviderRows: true })
  }

  await prisma.roster.create({
    data: {
      id: `${leagueId}-member-roster`,
      leagueId,
      platformUserId: S3B_WAIVER_SEED.memberUserId,
      playerData: buildRosterData(`${leagueId}-m`) as object,
      faabRemaining: isFaab ? 80 : null,
      waiverPriority: 3,
    },
  })
  await prisma.leagueTeam.create({
    data: {
      id: `${leagueId}-member-team`,
      leagueId,
      externalId: `${leagueId}-member-team`,
      ownerName: 'S3B Member',
      teamName: 'S3B Member FC',
      claimedByUserId: S3B_WAIVER_SEED.memberUserId,
      platformUserId: S3B_WAIVER_SEED.memberUserId,
      role: 'member',
    },
  })

  // Opponent roster (privacy + a second team). For the FAAB league, give the opponent a pending claim.
  await prisma.roster.create({
    data: {
      id: `${leagueId}-opp-roster`,
      leagueId,
      platformUserId: S3B_WAIVER_SEED.opponentUserId,
      playerData: buildRosterData(`${leagueId}-o`) as object,
      faabRemaining: isFaab ? 95 : null,
      waiverPriority: 1,
    },
  })
  await prisma.leagueTeam.create({
    data: {
      id: `${leagueId}-opp-team`,
      leagueId,
      externalId: `${leagueId}-opp-team`,
      ownerName: 'S3B Opponent',
      teamName: 'S3B Opponent FC',
      claimedByUserId: S3B_WAIVER_SEED.opponentUserId,
      platformUserId: S3B_WAIVER_SEED.opponentUserId,
      role: 'member',
    },
  })

  if (opts.withOpponentClaim) {
    // A real free agent for the opponent to claim (so the member must NOT see it).
    const fa = await prisma.sportsPlayer.findFirst({ where: { sport }, select: { id: true, name: true } })
    if (fa) {
      await prisma.waiverClaim.create({
        data: {
          leagueId,
          rosterId: `${leagueId}-opp-roster`,
          addPlayerId: fa.id,
          dropPlayerId: null,
          faabBid: isFaab ? 12 : null,
          priorityOrder: 1,
          status: 'pending',
          claimType: 'add_drop',
        },
      })
    }
  }

  return { leagueId, sport, waiverType, fill, benchCapacity, benchPlaced: benchToPlace, starters: limits.starters }
}

async function main() {
  // Fail closed before the first write — see scripts/_assert-safe-seed-target.ts.
  assertSafeSeedTarget('seed-redraft-waiver-walkthrough')

  const passwordHash = await bcrypt.hash(S3B_WAIVER_SEED.password, 10)
  for (const u of USERS) await upsertUser(u, passwordHash)

  const results = []
  results.push(await seedLeague({ leagueId: S3B_WAIVER_SEED.leagues.nflFcfsOpen, name: 'S3B NFL FCFS (Open Roster)', sport: 'NFL', waiverType: 'fcfs', fill: 'open' }))
  results.push(await seedLeague({ leagueId: S3B_WAIVER_SEED.leagues.nflFcfsFull, name: 'S3B NFL FCFS (Full Roster)', sport: 'NFL', waiverType: 'fcfs', fill: 'full' }))
  results.push(await seedLeague({ leagueId: S3B_WAIVER_SEED.leagues.nflFaab, name: 'S3B NFL FAAB', sport: 'NFL', waiverType: 'faab', fill: 'open', withOpponentClaim: true }))
  results.push(await seedLeague({ leagueId: S3B_WAIVER_SEED.leagues.ncaafFcfs, name: 'S3B NCAAF FCFS', sport: 'NCAAF', waiverType: 'fcfs', fill: 'open' }))

  console.log(JSON.stringify({ ...S3B_WAIVER_SEED, results }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
