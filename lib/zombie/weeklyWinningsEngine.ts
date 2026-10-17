/**
 * Zombie weekly winnings: what each team banks for a resolved week, and what changes hands.
 *
 * 🛑 WEEKLY WINNINGS WERE NEVER PAID. The weekly resolution summed `ZombieInfectionEvent.winningsTransferred`,
 * which nothing set, and the winnings ledger (`ZombieWeeklyWinnings`, `ZombieLeagueTeam.weeklyWinnings` /
 * `totalWinnings`) was written only by the legacy MatchupFact finalizer — which a native league never runs.
 * Every native zombie league showed 0 winnings all season.
 *
 * The rules (decided 2026-10-15):
 *   - every team banks its weekly score ("Outbreak Points"; in a paid league the commissioner converts at
 *     season end — the money itself moves outside the app);
 *   - a Survivor infected by its opponent loses that whole week to the infector;
 *   - otherwise a mauling moves 50% of the loser's week to the winner, a bashing 25%, on the same margins
 *     `bashingEngine` / `maulingEngine` record events on (`getZombieRulesForSport`).
 */
import { prisma } from '@/lib/prisma'
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
  kind: 'infection' | 'mauling' | 'bashing'
}

export type InfectionPair = { victimRosterId: string; infectorRosterId: string }

const round2 = (n: number) => Math.round(n * 100) / 100

/** Pure: the week's bank and transfers. Only final, fully mapped matchups count; a tie moves nothing. */
export function computeWeeklyWinnings(
  results: NativeWeekResult[],
  infected: InfectionPair[],
  thresholds: { bashingThreshold: number; maulingThreshold: number },
): { netByRoster: Map<string, number>; transfers: WinningsTransfer[] } {
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
    transfers,
    totalTransferred: round2(transfers.reduce((s, t) => s + t.amount, 0)),
  }
}
