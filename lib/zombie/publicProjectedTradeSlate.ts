import 'server-only'

import { compareBeta2025TradeWeeks, type CorrectionWeekInput, type ReplayItem, type ReplayWeek } from './beta2025CorrectionPlan'
import { itemRole } from './beta2025Items'
import { buildProjectedZombieSlate } from './projectedWeeklySlate'
import { capturePublicZombieForecastSnapshot } from './weeklySettlementSnapshot'

type SlateInput = Parameters<typeof buildProjectedZombieSlate>[0]

/** Evaluate a single conditional slate. The result carries counts and ledger deltas, never role or owner records. */
export async function projectPublicZombieTradeSlate(input: {
  leagueId: string
  zombieLeagueId: string
  openingWeek: number
  forecastWeek?: number
  laterWeeks?: ReadonlyArray<{ week: number; before: SlateInput; afterRosters: SlateInput['rosters'] }>
  before: SlateInput
  afterRosters: SlateInput['rosters']
  affectedRosterIds: readonly string[]
  settledAt: CorrectionWeekInput['settledAt']
  deadlineAt: CorrectionWeekInput['deadlineAt']
  applyItemTransfers: (items: readonly ReplayItem[]) => ReplayItem[] | null
}) {
  const matches = buildProjectedZombieSlate(input.before)
  const afterMatches = buildProjectedZombieSlate({ ...input.before, rosters: input.afterRosters })
  if (!matches || !afterMatches || input.affectedRosterIds.some(id => !input.before.rosters.has(id))) return null
  const snapshot = await capturePublicZombieForecastSnapshot({
    leagueId: input.leagueId, zombieLeagueId: input.zombieLeagueId, openingWeek: input.openingWeek, matches,
  })
  if (!snapshot?.config || input.affectedRosterIds.some(id => !snapshot.teams.some(team => team.rosterId === id))) return null
  const afterItems = input.applyItemTransfers(structuredClone(snapshot.items))
  if (!afterItems) return null
  const weeks = [{ week: input.forecastWeek ?? input.openingWeek, matches, afterMatches,
    settledAt: input.settledAt, deadlineAt: input.deadlineAt }]
  for (const later of input.laterWeeks ?? []) {
    const matches = buildProjectedZombieSlate(later.before)
    const afterMatches = buildProjectedZombieSlate({ ...later.before, rosters: later.afterRosters })
    if (!matches || !afterMatches) return null
    weeks.push({ week: later.week, matches, afterMatches, settledAt: input.settledAt, deadlineAt: input.deadlineAt })
  }
  const projected = compareBeta2025TradeWeeks({
    zombieLeagueId: input.zombieLeagueId,
    opening: snapshot,
    weeks,
    afterItems,
  })
  const summarize = (slate: ReplayWeek, rosterId: string) => {
    const openingTeam = snapshot.teams.find(team => team.rosterId === rosterId)!
    const settledTeam = slate.teams.find(team => team.rosterId === rosterId)!
    const match = slate.matches.find(match => match.homeRosterId === rosterId || match.awayRosterId === rosterId)!
    return {
      points: match.homeRosterId === rosterId ? match.homeScore : match.awayScore,
      infected: slate.infections.some(infection => infection.victimRosterId === rosterId),
      revived: itemRole(openingTeam.status) === 'Zombie' && itemRole(settledTeam.status) === 'Survivor',
      inventoryAfter: slate.items.filter(item => item.teamStatusId === settledTeam.id && !item.isUsed && !item.isExpired).length,
      weeklyWinnings: slate.distribution[rosterId] ?? 0,
      eligiblePartners: itemRole(settledTeam.status) === 'Zombie' ? 0 : slate.teams.filter(team =>
        team.rosterId !== rosterId && itemRole(team.status) !== 'Zombie').length,
    }
  }
  // An unresolved manager choice can change the outcome and the eligible partner pool.
  if (projected.some(paired => [...paired.before.choices, ...paired.after.choices].some(choice => choice.status === 'pending'))) return null
  const first = projected[0]!
  const final = projected[projected.length - 1]!
  return input.affectedRosterIds.map(rosterId => ({
    before: summarize(first.before, rosterId), after: summarize(first.after, rosterId),
    throughWeek: final.before.week,
    season: {
      before: {
        ledgerBalance: final.before.totals[rosterId],
        eligibleWeeks: projected.filter(paired => itemRole(paired.before.teams.find(team => team.rosterId === rosterId)!.status) !== 'Zombie').length,
        eligiblePartners: summarize(final.before, rosterId).eligiblePartners,
      },
      after: {
        ledgerBalance: final.after.totals[rosterId],
        eligibleWeeks: projected.filter(paired => itemRole(paired.after.teams.find(team => team.rosterId === rosterId)!.status) !== 'Zombie').length,
        eligiblePartners: summarize(final.after, rosterId).eligiblePartners,
      },
    },
  }))
}
