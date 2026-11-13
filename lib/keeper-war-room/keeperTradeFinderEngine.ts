/**
 * KEEPER TRADE-FINDER ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Ranks partner teams by complementary roster needs/surplus AFTER keepers. Keeper-aware:
 * a team carrying MORE positive-value keepers than keeper slots has surplus keeper value
 * to trade. Requires an ADP/value signal. NO future picks / dynasty pick capital.
 */

import { rankKeepers } from './keeperValueEngine'
import { evaluateKeeperRosterNeeds } from './keeperRosterNeedsEngine'
import type { KeeperWarRoomContext } from './types'

interface KeeperTradeTarget {
  rosterId: string
  teamName: string | null
  fitScore: number
  theySupply: string[]
  theyNeed: string[]
  reasons: string[]
}

export interface KeeperTradeFinderResult {
  rosterId: string
  targets: KeeperTradeTarget[]
  missingDataFlags: string[]
  needsMoreData: boolean
}

function surplusKeeperPositions(context: KeeperWarRoomContext, rosterId: string): string[] {
  // Positions where a team holds more positive-surplus keepers than it can keep.
  const ranked = rankKeepers(context, rosterId).filter((r) => (r.surplusRounds ?? -99) >= 1)
  if (ranked.length <= context.keeper.maxKeepers) return []
  return [...new Set(ranked.slice(context.keeper.maxKeepers).map((r) => r.position))]
}

export function findKeeperTradeTargets(context: KeeperWarRoomContext, rosterId: string): KeeperTradeFinderResult {
  const missingDataFlags = [...context.missingDataFlags]
  if (!context.featureAvailability.tradeFind) {
    return {
      rosterId,
      targets: [],
      missingDataFlags: [...new Set([...missingDataFlags, 'Trade finder needs ADP/value data to rank partner fit.'])],
      needsMoreData: true,
    }
  }

  const myNeeds = evaluateKeeperRosterNeeds(context, rosterId)
  const myNeedPositions = new Set(myNeeds.draftTargetPositions)
  const mySurplusKeepers = new Set(surplusKeeperPositions(context, rosterId))

  const targets: KeeperTradeTarget[] = []
  for (const other of context.teams) {
    if (other.rosterId === rosterId) continue
    const otherNeeds = evaluateKeeperRosterNeeds(context, other.rosterId)
    const otherNeedPositions = new Set(otherNeeds.draftTargetPositions)
    const otherSurplusKeepers = new Set(surplusKeeperPositions(context, other.rosterId))

    const theySupply = [...otherSurplusKeepers].filter((pos) => myNeedPositions.has(pos))
    const theyNeed = [...mySurplusKeepers].filter((pos) => otherNeedPositions.has(pos))
    let fitScore = theySupply.length * 22 + theyNeed.length * 22
    const reasons: string[] = []
    if (theySupply.length) reasons.push(`They have surplus keeper value at ${theySupply.join('/')} you need.`)
    if (theyNeed.length) reasons.push(`They need ${theyNeed.join('/')} where you have surplus keepers.`)
    if (fitScore <= 0) continue
    fitScore = Math.min(100, fitScore)
    targets.push({ rosterId: other.rosterId, teamName: other.teamName, fitScore, theySupply, theyNeed, reasons })
  }

  targets.sort((a, b) => b.fitScore - a.fitScore)
  return { rosterId, targets, missingDataFlags: [...new Set(missingDataFlags)], needsMoreData: false }
}
