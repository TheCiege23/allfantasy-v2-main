/**
 * The rewards line of Chimmy's weekly commissioner report (chimmyWeeklyReport.ts). Pure; counts only,
 * so it is spoiler-safe for a commissioner who also plays: it never names who holds a blocker, a
 * steal or an advantage.
 *
 *  - paid this week: rewards that landed this week (applied / held / used / blocked, by the week they
 *    apply to — a deferred prize counts in the week it pays);
 *  - pending choices: every reward still waiting for its winner's choice (any week);
 *  - reversals: rewards for this week the commissioner reversed.
 */
import type { SurvivorRewardRecord } from './survivorRewardModel'

const LANDED = new Set(['applied', 'available', 'consumed', 'blocked'])

export type RewardWeekCounts = { paid: number; pending: number; reversed: number }

export function countRewardsForWeek(records: readonly Pick<SurvivorRewardRecord, 'status' | 'week' | 'applyWeek'>[], week: number): RewardWeekCounts {
  let paid = 0
  let pending = 0
  let reversed = 0
  for (const r of records) {
    if (r.status === 'awaiting_choice') pending++
    else if (r.status === 'reversed' && (r.applyWeek === week || r.week === week)) reversed++
    else if (LANDED.has(r.status) && r.applyWeek === week) paid++
  }
  return { paid, pending, reversed }
}

/** Null when there is nothing to say (no reward this week, none pending, none reversed). */
export function rewardsWeeklyReportLine(records: readonly Pick<SurvivorRewardRecord, 'status' | 'week' | 'applyWeek'>[], week: number, lang: 'en' | 'es' = 'en'): string | null {
  const { paid, pending, reversed } = countRewardsForWeek(records, week)
  if (!paid && !pending && !reversed) return null
  if (lang === 'es') {
    return `Recompensas: ${paid} ${paid === 1 ? 'pagada' : 'pagadas'} esta semana, ${pending} ${pending === 1 ? 'elección pendiente' : 'elecciones pendientes'}, ${reversed} ${reversed === 1 ? 'anulada' : 'anuladas'}.${pending ? ' Puedes elegir por un mánager en el Centro del Comisionado → Recompensas.' : ''}`
  }
  return `Rewards: ${paid} paid this week, ${pending} ${pending === 1 ? 'choice' : 'choices'} pending, ${reversed} reversed.${pending ? ' You can choose for a manager in the Commissioner Hub → Rewards.' : ''}`
}
