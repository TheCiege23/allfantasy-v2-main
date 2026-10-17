/** Circular nomination order skips completed or insolvent teams. Returns null only when none can bid. */
export function nextSeasonNominator(order: Array<{ rosterId: string }>, start: number, picks: Array<{ rosterId: string; playerName: string; position: string }>, rounds: number, budgets: Record<string, number>, minimumBid: number) {
  if (!order.length) return null
  const first = ((Math.floor(start) % order.length) + order.length) % order.length
  for (let step = 0; step < order.length; step++) {
    const index = (first + step) % order.length, id = order[index]!.rosterId
    const remaining = rounds - picks.filter(p => p.rosterId === id && p.playerName.trim() && p.position.trim()).length
    if (remaining > 0 && Number.isSafeInteger(budgets[id]) && budgets[id]! >= remaining * minimumBid) return index
  }
  return null
}
