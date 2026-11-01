/**
 * Weekly winnings dispatches by the policy sealed before resolution.
 * New native snapshots use the approved 2025 cumulative winnings rules.
 * Snapshots without that policy retain the earlier score-based calculation for historical replay.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { computeBeta2025Winnings, beta2025ContextFromSnapshot, BETA_2025_WINNINGS_SOURCE, type Beta2025WinningsContext, type Beta2025Transfer } from './beta2025Winnings'
import { loadNativeWeekResults, type NativeWeekResult } from '@/lib/zombie/ZombieInfectionEngine'
import { getZombieRulesForSport } from '@/lib/zombie/zombieRules'
import { getTotalWinningsByRoster, recordWinnings } from '@/lib/zombie/ZombieWeeklyWinningsLedger'
import { BASH_TRANSFER_SHARE, MAUL_TRANSFER_SHARE } from '@/lib/zombie/winningsShares'

export { BASH_TRANSFER_SHARE, MAUL_TRANSFER_SHARE }

export type WinningsTransfer = {
  matchupId: string
  fromRosterId: string
  toRosterId: string
  amount: number
  kind: Beta2025Transfer['kind']
}

export type InfectionPair = { victimRosterId: string; infectorRosterId: string }

const round2 = (n: number) => Math.round(n * 100) / 100

/** Pure: the week's bank and transfers. Only final, fully mapped matchups count; a tie moves nothing. */
export function computeWeeklyWinnings(
  results: NativeWeekResult[],
  infected: InfectionPair[],
  thresholds: { bashingThreshold: number; maulingThreshold: number },
  context?: Beta2025WinningsContext,
): { netByRoster: Map<string, number>; transfers: WinningsTransfer[] } {
  if (context) return computeBeta2025Winnings(results, context, thresholds)
  const infectorOf = new Map(infected.map((p) => [p.victimRosterId, p.infectorRosterId]))
  const net = new Map<string, number>()
  const transfers: WinningsTransfer[] = []

  for (const r of results) {
    if (!r.final || !r.homeRosterId || !r.awayRosterId) continue
    net.set(r.homeRosterId, (net.get(r.homeRosterId) ?? 0) + r.homeScore)
    net.set(r.awayRosterId, (net.get(r.awayRosterId) ?? 0) + r.awayScore)
    if (r.homeScore === r.awayScore) continue

    const homeWon = r.homeScore > r.awayScore
    const winner = homeWon ? r.homeRosterId : r.awayRosterId
    const loser = homeWon ? r.awayRosterId : r.homeRosterId
    const loserScore = homeWon ? r.awayScore : r.homeScore
    const margin = Math.abs(r.homeScore - r.awayScore)

    let kind: WinningsTransfer['kind'] | null = null
    let share = 0
    if (infectorOf.get(loser) === winner) {
      kind = 'infection'
      share = 1
    } else if (margin >= thresholds.maulingThreshold) {
      kind = 'mauling'
      share = MAUL_TRANSFER_SHARE
    } else if (margin >= thresholds.bashingThreshold) {
      kind = 'bashing'
      share = BASH_TRANSFER_SHARE
    }
    if (!kind) continue
    const amount = round2(Math.max(0, loserScore) * share)
    if (amount <= 0) continue
    net.set(loser, (net.get(loser) ?? 0) - amount)
    net.set(winner, (net.get(winner) ?? 0) + amount)
    transfers.push({ matchupId: r.matchupId, fromRosterId: loser, toRosterId: winner, amount, kind })
  }

  for (const [k, v] of net) net.set(k, round2(v))
  return { netByRoster: net, transfers }
}

export type WeeklyWinningsSettlement = {
  teams: number
  transfers: WinningsTransfer[]
  totalTransferred: number
  distribution?: Record<string, number>
}

/**
 * Settle one resolved week: write the ledger, the teams' weekly/total winnings, and each infection
 * event's amount and scores. Idempotent — a replayed week (stat correction) rewrites the same rows.
 * Null for an imported league (no native season); the legacy finalizer owns those.
 */
export async function settleWeeklyWinnings(input: {
  zombieLeagueId: string
  leagueId: string
  season: number
  sport: string
  week: number
  /** This run's infections. Merged with the week's recorded events, so a replay — where the victims are
   *  already zombies and nothing new is infected — still moves the week it moved the first time. */
  infected: InfectionPair[]
}): Promise<WeeklyWinningsSettlement | null> {
  const results = await loadNativeWeekResults(input.leagueId, input.week, input.season)
  if (!results) return null
  const resolution = await prisma.zombieWeeklyResolution.findUnique({
    where: { zombieLeagueId_week: { zombieLeagueId: input.zombieLeagueId, week: input.week } },
    select: { settlementSnapshot: true },
  })
  const context = beta2025ContextFromSnapshot(resolution?.settlementSnapshot)
  if (context) return settleBeta2025Winnings(input, results, context)

  const rosters = await prisma.roster.findMany({
    where: { leagueId: input.leagueId },
    select: { id: true, platformUserId: true },
  })
  const rosterByUser = new Map(rosters.filter((r) => r.platformUserId).map((r) => [r.platformUserId as string, r.id]))
  const userByRoster = new Map(rosters.map((r) => [r.id, r.platformUserId]))

  const recorded = await prisma.zombieInfectionEvent.findMany({
    where: { zombieLeagueId: input.zombieLeagueId, week: input.week },
    select: { victimUserId: true, infectorUserId: true },
  })
  const pairs = new Map<string, string>(input.infected.map((p) => [p.victimRosterId, p.infectorRosterId]))
  for (const e of recorded) {
    const victim = rosterByUser.get(e.victimUserId)
    const infector = rosterByUser.get(e.infectorUserId)
    if (victim && infector && !pairs.has(victim)) pairs.set(victim, infector)
  }

  const rules = await getZombieRulesForSport(input.sport)
  const { netByRoster, transfers } = computeWeeklyWinnings(
    results,
    [...pairs].map(([victimRosterId, infectorRosterId]) => ({ victimRosterId, infectorRosterId })),
    rules,
  )

  for (const [rosterId, amount] of netByRoster) {
    await recordWinnings(input.leagueId, rosterId, input.week, amount, 'weekly_settlement', input.zombieLeagueId)
  }

  // Totals come from the ledger, so a replay or a missed week can never double-count.
  const totals = await getTotalWinningsByRoster(input.leagueId)
  for (const [rosterId, weekly] of netByRoster) {
    await prisma.zombieLeagueTeam.updateMany({
      where: { leagueId: input.leagueId, rosterId },
      data: { weeklyWinnings: weekly, totalWinnings: round2(totals[rosterId] ?? weekly) },
    })
  }

  const resultByMatchup = new Map(results.map((r) => [r.matchupId, r]))
  for (const t of transfers) {
    if (t.kind !== 'infection') continue
    const victimUserId = userByRoster.get(t.fromRosterId)
    const infectorUserId = userByRoster.get(t.toRosterId)
    const r = resultByMatchup.get(t.matchupId)
    if (!victimUserId || !infectorUserId || !r) continue
    const infectorScore = r.homeRosterId === t.toRosterId ? r.homeScore : r.awayScore
    const victimScore = r.homeRosterId === t.fromRosterId ? r.homeScore : r.awayScore
    await prisma.zombieInfectionEvent.updateMany({
      where: { zombieLeagueId: input.zombieLeagueId, week: input.week, victimUserId, infectorUserId },
      data: {
        winningsTransferred: t.amount,
        infectorScore,
        victimScore,
        scoreDifference: round2(infectorScore - victimScore),
      },
    })
  }

  return {
    teams: netByRoster.size,
    distribution: Object.fromEntries(netByRoster),
    transfers,
    totalTransferred: round2(transfers.reduce((s, t) => s + t.amount, 0)),
  }
}

/** Write both sides and their totals together; a failed or repeated write cannot create money. */
async function settleBeta2025Winnings(
  input: { zombieLeagueId: string; leagueId: string; week: number; sport: string },
  results: NativeWeekResult[],
  context: Beta2025WinningsContext,
): Promise<WeeklyWinningsSettlement> {
  const storedRules = await getZombieRulesForSport(input.sport)
  const rules = context.thresholds ?? (input.sport.toUpperCase() === 'NFL'
    ? { bashingThreshold: 60, maulingThreshold: 60 } : storedRules)
  const computed = computeBeta2025Winnings(results, context, rules)
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "zombie_leagues" WHERE "id" = ${input.zombieLeagueId} FOR UPDATE`)
        const existing = await tx.zombieWeeklyWinnings.findMany({
          where: { leagueId: input.leagueId, week: input.week }, select: { source: true },
        })
        if (existing.some(row => row.source !== BETA_2025_WINNINGS_SOURCE)) throw new Error('ZOMBIE_WINNINGS_POLICY_REVIEW_REQUIRED')
        for (const [rosterId, amount] of computed.netByRoster) {
          await tx.zombieWeeklyWinnings.upsert({
            where: { leagueId_rosterId_week: { leagueId: input.leagueId, rosterId, week: input.week } },
            create: { leagueId: input.leagueId, zombieLeagueId: input.zombieLeagueId, rosterId,
              week: input.week, amount, source: BETA_2025_WINNINGS_SOURCE },
            update: { amount, source: BETA_2025_WINNINGS_SOURCE },
          })
        }
        const ledger = await tx.zombieWeeklyWinnings.findMany({
          where: { leagueId: input.leagueId }, select: { rosterId: true, amount: true },
        })
        const totals = new Map<string, number>()
        for (const row of ledger) totals.set(row.rosterId, round2((totals.get(row.rosterId) ?? 0) + row.amount))
        for (const [rosterId, weeklyWinnings] of computed.netByRoster) {
          await tx.zombieLeagueTeam.updateMany({ where: { leagueId: input.leagueId, rosterId },
            data: { weeklyWinnings, totalWinnings: totals.get(rosterId) ?? weeklyWinnings } })
        }
        const owners = await tx.roster.findMany({ where: { leagueId: input.leagueId }, select: { id: true, platformUserId: true } })
        const ownerByRoster = new Map(owners.map(row => [row.id, row.platformUserId]))
        for (const r of results) {
          if (!r.final || !r.homeRosterId || !r.awayRosterId || r.homeScore === r.awayScore) continue
          const winner = r.homeScore > r.awayScore ? r.homeRosterId : r.awayRosterId
          const loser = winner === r.homeRosterId ? r.awayRosterId : r.homeRosterId
          const transfer = computed.transfers.find(t => t.matchupId === r.matchupId)
          await tx.zombieInfectionEvent.updateMany({
            where: { zombieLeagueId: input.zombieLeagueId, week: input.week,
              victimUserId: ownerByRoster.get(loser) ?? '__missing__', infectorUserId: ownerByRoster.get(winner) ?? '__missing__' },
            data: { winningsTransferred: transfer?.amount ?? 0,
              infectorScore: Math.max(r.homeScore,r.awayScore), victimScore: Math.min(r.homeScore,r.awayScore),
              scoreDifference: round2(Math.abs(r.homeScore-r.awayScore)) },
          })
        }
        return { teams: computed.netByRoster.size, distribution: Object.fromEntries(computed.netByRoster), transfers: computed.transfers,
          totalTransferred: round2(computed.transfers.reduce((sum,t)=>sum+t.amount,0)) }
      }, { isolationLevel: 'Serializable' })
    } catch (error) {
      if (attempt >= 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error
    }
  }
}
