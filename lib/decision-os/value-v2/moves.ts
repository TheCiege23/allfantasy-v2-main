import type { Estimate, Horizon, ValueDecisionV2 } from './types'
import { sumEstimates, validEstimate } from './value'

export interface ValueMovement {
  assetId: string
  from: string
  to: string
  marketValue: Estimate | null
  /** Utility must be resolved independently for each participant. */
  valuesByUser: Readonly<Record<string, ValueDecisionV2 | undefined>>
}
export interface MoveCosts {
  openSlotValue: Estimate | null
  transactionCost: Estimate | null
  opportunityCost: Estimate | null
}

/** Supports any number of teams. A partially priced package never becomes a full fairness grade. */
export function evaluateMove(input: {
  decisionId: string
  leagueId: string
  capturedAt: string
  horizon: Horizon
  movements: readonly ValueMovement[]
  costsByUser: Readonly<Record<string, MoveCosts | undefined>>
}) {
  const ids = new Set<string>()
  for (const m of input.movements) {
    if (!m.assetId || !m.from || !m.to || m.from === m.to || ids.has(m.assetId)) {
      throw new Error('Invalid or duplicate asset movement')
    }
    ids.add(m.assetId)
  }
  if (!input.movements.length) throw new Error('A move requires assets')
  const users = [...new Set(input.movements.flatMap(m => [m.from, m.to]))].sort()
  const marketComplete = input.movements.every(m => validEstimate(m.marketValue) && m.marketValue.value >= 0)
  const participants = users.map(userId => {
    const related = input.movements.filter(m => m.from === userId || m.to === userId)
    const marketDelta = marketComplete ? sumEstimates(related.map(m => ({
      estimate: m.marketValue, sign: m.to === userId ? 1 as const : -1 as const,
    })), 'value-v2/market-delta', input.capturedAt) : null
    const costs = input.costsByUser[userId]
    const utilityDelta = sumEstimates([
      ...related.map(m => {
        const d = m.valuesByUser[userId]
        const estimate = d?.assetId === m.assetId && d.userId === userId && d.leagueId === input.leagueId
          ? d.userUtility[input.horizon] : null
        return { estimate, sign: m.to === userId ? 1 as const : -1 as const }
      }),
      { estimate: costs?.openSlotValue ?? null, sign: 1 },
      { estimate: costs?.transactionCost ?? null, sign: -1 },
      { estimate: costs?.opportunityCost ?? null, sign: -1 },
    ], 'value-v2/move-utility', input.capturedAt)
    return { userId, marketDelta, utilityDelta,
      recommendation: utilityDelta === null ? 'insufficient_data' as const
        : utilityDelta.low === null || utilityDelta.high === null ? 'uncertain' as const
        : utilityDelta.low > 0 ? 'improves_utility' as const
        : utilityDelta.high < 0 ? 'reduces_utility' as const : 'uncertain' as const }
  })
  return { version: '2.0' as const, decisionId: input.decisionId, marketComplete, participants,
    unpricedAssetIds: input.movements.filter(m => !validEstimate(m.marketValue) || m.marketValue.value < 0).map(m => m.assetId) }
}

/** Feasible alternatives must already satisfy roster locks, eligibility, budget and availability. */
export function bestOpenSlotUse(alternatives: readonly { assetId: string; feasible: boolean; netUtility: Estimate | null }[]) {
  const feasible = alternatives.filter(a => a.feasible)
  if (feasible.some(a => !validEstimate(a.netUtility))) return null
  return [...feasible].sort((a, b) => b.netUtility!.value - a.netUtility!.value || a.assetId.localeCompare(b.assetId))[0] ?? null
}

export function evaluateWaiverPair(add: Estimate | null, drop: Estimate | null, faabOrPriorityCost: Estimate | null, capturedAt: string) {
  return sumEstimates([
    { estimate: add, sign: 1 }, { estimate: drop, sign: -1 }, { estimate: faabOrPriorityCost, sign: -1 },
  ], 'value-v2/waiver-pair', capturedAt)
}
