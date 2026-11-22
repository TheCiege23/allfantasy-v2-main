import 'server-only'

import { prisma } from '@/lib/prisma'
import { itemRole } from './beta2025Items'
import { planSeasonAccounting } from './seasonAccountingPlan'
import type { ReplayWeek } from './beta2025CorrectionPlan'
import type { ZombieSettlementSnapshotV1 } from './weeklySettlementSnapshot'

/** Apply the existing 2025 cash policy only with a complete horizon and documented ownership. */
export async function projectedZombieCashPayout(input: {
  leagueId: string
  zombieLeagueId: string
  opening: ZombieSettlementSnapshotV1
  weeks: readonly { before: ReplayWeek; after: ReplayWeek }[]
}): Promise<{ before: Record<string, number>; after: Record<string, number> } | null> {
  const final = input.weeks.at(-1)
  if (!final) return null
  return prisma.$transaction(async db => {
    const league = await db.zombieLeague.findUnique({ where: { id: input.zombieLeagueId }, include: { paidConfig: true } })
    const config = league?.paidConfig
    if (!league || league.leagueId !== input.leagueId || !league.isPaid || !config ||
        config.ultimateSurvivorEnabled || league.ultimateSurvivorPot || final.before.week !== league.totalWeeks) return null
    // Separate external awards need a recorded reconciliation basis before predicting cash.
    if (await db.zombieExternalWeeklyPayout.count({ where: { zombieLeagueId: league.id } })) return null
    const [stints, teams] = await Promise.all([
      db.zombieOperationsRecord.findMany({ where: { scope: `l:${input.leagueId}`, season: league.season, kind: 'owner_stints' } }),
      db.zombieLeagueTeam.findMany({ where: { leagueId: input.leagueId }, select: { rosterId: true, pointsFor: true } }),
    ])
    const fundedCents = Math.round(config.totalCollected * 100)
    if (!config.potIsLocked || !(fundedCents > 0)) return null
    const feeCents = Math.min(Math.round(fundedCents * config.commissionerFeeRate),
      config.commissionerFeeCap == null ? fundedCents : Math.round(config.commissionerFeeCap * 100))
    const calculate = (side: 'before' | 'after') => {
      const last = final[side]
      const field = last.teams.map(team => {
        const record = stints.find(record => record.id === `stints:${input.leagueId}:${team.rosterId}:${league.season}`)
        const payload = record?.payload as { stints?: Array<{ userId: string; startWeek: number; endWeek: number | null }> } | undefined
        if (!Array.isArray(payload?.stints)) throw new Error('Forecast requires recorded ownership stints.')
        const current = teams.find(row => row.rosterId === team.rosterId)
        if (!current) throw new Error('Forecast team points are unavailable.')
        const projectedPoints = input.weeks.reduce((sum, week) => {
          const match = week[side].matches.find(match => match.homeRosterId === team.rosterId || match.awayRosterId === team.rosterId)
          if (!match) throw new Error('Forecast matchup is unavailable.')
          return sum + (match.homeRosterId === team.rosterId ? match.homeScore : match.awayScore)
        }, 0)
        return { rosterId: team.rosterId, role: itemRole(team.status), points: current.pointsFor + projectedPoints,
          weeklyCents: Math.round(last.totals[team.rosterId] * 100),
          stints: payload.stints.map(stint => ({ ...stint, endWeek: stint.endWeek ?? league.totalWeeks })) }
      })
      const result = planSeasonAccounting({ teams: field, totalWeeks: league.totalWeeks, paid: true,
        fundedCents, feeCents, otherPrizeCents: 0 })
      return Object.fromEntries(input.opening.owners.map(owner => [owner.rosterId,
        result.owners.filter(row => row.rosterId === owner.rosterId && row.userId === owner.userId)
          .reduce((sum, row) => sum + row.amountCents, 0)]))
    }
    try { return { before: calculate('before'), after: calculate('after') } } catch { return null }
  }, { isolationLevel: 'RepeatableRead' })
}
