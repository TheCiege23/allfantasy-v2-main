import type { DraftFormatKind } from './types'
import { resolveNextPickOrder } from './format-adapters'

interface NextPickPredictionRow {
  manager: string
  predictedPlayer: string
  predictedPosition: string
  probability: number
  reason: string
  confidenceBand: [number, number]
  mayNotMakeItBack: boolean
  safeToWait: boolean
}

/**
 * Predict next picks across draft types — uses ADP + scarcity; auction uses nomination/budget heuristics.
 */
export function predictNextPicks(args: {
  draftFormat: DraftFormatKind
  upcomingTeamIds: string[]
  teamDisplayNameById: Record<string, string>
  available: Array<{ name: string; position: string; adp?: number | null }>
  adpByPlayerName?: Record<string, number>
  /** Auction budgets remaining */
  auctionBudgetByTeamId?: Record<string, number>
  /** Max predictions (default 3) */
  limit?: number
}): NextPickPredictionRow[] {
  const limit = args.limit ?? 3
  const order = resolveNextPickOrder(args.draftFormat, args.upcomingTeamIds)
  const pool = args.available
    .map((p) => ({
      ...p,
      adp: p.adp ?? args.adpByPlayerName?.[p.name] ?? 999,
    }))
    .sort((a, b) => a.adp - b.adp)

  const out: NextPickPredictionRow[] = []
  for (let i = 0; i < Math.min(limit, order.length); i++) {
    const teamId = order[i]
    const manager = args.teamDisplayNameById[teamId] ?? teamId
    const top = pool[i] ?? pool[0]
    if (!top) break

    let probability = 0.42
    let reason = 'ADP leader for this pick window with typical scarcity pressure.'
    let mayNotMakeItBack = false
    let safeToWait = true

    if (args.draftFormat === 'AUCTION' || args.draftFormat === 'SALARY_CAP') {
      const budget = args.auctionBudgetByTeamId?.[teamId] ?? 200
      probability = budget > 40 ? 0.38 : 0.28
      reason = `Nomination pressure: budget ~${Math.round(budget)} — stars may draw aggressive bids.`
      mayNotMakeItBack = budget > 55
      safeToWait = budget < 35
    } else {
      const pos = String(top.position || '').toUpperCase()
      const left = pool.filter((p) => String(p.position).toUpperCase() === pos).length
      if (left <= 3) {
        probability = 0.55
        mayNotMakeItBack = true
        safeToWait = false
        reason = `${pos} scarcity — likely off the board before your next turn.`
      }
    }

    const low = Math.max(0.05, probability - 0.12)
    const high = Math.min(0.95, probability + 0.12)

    out.push({
      manager,
      predictedPlayer: top.name,
      predictedPosition: top.position,
      probability: Math.round(probability * 100) / 100,
      reason,
      confidenceBand: [Math.round(low * 100), Math.round(high * 100)],
      mayNotMakeItBack,
      safeToWait,
    })
  }

  return out
}
