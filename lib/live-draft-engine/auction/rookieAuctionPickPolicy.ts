import type { SlotOrderEntry } from '@/lib/live-draft-engine/types'

export type RookieAuctionPickPolicy = 'block' | 'budget' | 'nominations'
export type RookieAuctionTrade = { round: number; originalRosterId: string; newRosterId: string }
export type RookieAuctionPlan = {
  policy: RookieAuctionPickPolicy
  budgets: Record<string, number>
  nominationOrder: SlotOrderEntry[]
  trades: RookieAuctionTrade[]
}

/** Resolve already-settled pick rights exactly once into auction terms. Throws before any rights are consumed. */
export function planRookieAuction(input: {
  policy: RookieAuctionPickPolicy
  slotOrder: SlotOrderEntry[]
  rounds: number
  budgetPerTeam: number
  valuesByRound: Record<string, number>
  trades: RookieAuctionTrade[]
}): RookieAuctionPlan {
  const { policy, slotOrder, rounds, budgetPerTeam, valuesByRound, trades } = input
  if (!['block', 'budget', 'nominations'].includes(policy)) throw new Error('Choose how to handle traded rookie picks before creating the auction.')
  if (!Number.isSafeInteger(rounds) || rounds < 1 || !Number.isSafeInteger(budgetPerTeam) || budgetPerTeam < rounds) throw new Error('The rookie auction budget must cover at least $1 for each rookie draft round.')
  const ids = new Set(slotOrder.map(s => s.rosterId))
  if (!slotOrder.length || ids.size !== slotOrder.length) throw new Error('Every auction team must have one draft seat.')
  const budgets = Object.fromEntries(slotOrder.map(s => [s.rosterId, budgetPerTeam])) as Record<string, number>
  const transfers = new Map<string, RookieAuctionTrade>()
  for (const trade of trades) {
    const key = `${trade.round}:${trade.originalRosterId}`
    if (!Number.isSafeInteger(trade.round) || trade.round < 1 || trade.round > rounds || !ids.has(trade.originalRosterId) || !ids.has(trade.newRosterId) || trade.originalRosterId === trade.newRosterId || transfers.has(key)) throw new Error('A traded rookie pick cannot be matched to this auction. Resolve it before creating the draft.')
    transfers.set(key, trade)
  }
  if (policy === 'block' && trades.length) throw new Error('Traded rookie picks must be resolved before creating an auction, or the commissioner can choose a conversion option.')
  if (policy === 'budget') {
    for (const trade of trades) {
      const value = valuesByRound[String(trade.round)]
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Set a positive auction budget value for round ${trade.round}.`)
      budgets[trade.originalRosterId] -= value
      budgets[trade.newRosterId] += value
    }
    if (Object.values(budgets).some(value => !Number.isSafeInteger(value) || value < rounds)) throw new Error('The budget transfer would leave a team unable to bid $1 for every rookie slot.')
  }
  const byId = new Map(slotOrder.map(s => [s.rosterId, s]))
  const nominationOrder: SlotOrderEntry[] = []
  for (let round = 1; round <= rounds; round++) {
    for (const seat of slotOrder) {
      const trade = policy === 'nominations' ? transfers.get(`${round}:${seat.rosterId}`) : undefined
      const owner = trade ? byId.get(trade.newRosterId)! : seat
      nominationOrder.push({ ...owner })
    }
  }
  return { policy, budgets, nominationOrder, trades: trades.map(trade => ({ ...trade })) }
}
