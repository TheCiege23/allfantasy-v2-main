import type { TradeRecord } from './trades'

/** Completed import history already read for the page; no second feed or grade. */
export function importedTradeTimelineRows(trades: readonly TradeRecord[]) {
  return trades.flatMap(trade => {
    // Received assets identify the opposite side's sends only in a two-party deal.
    if (trade.players.length !== 2 || trade.rosterIds.length !== 2) return []
    const first = trade.players.find(side => side.isYou) ?? trade.players[0]
    const second = trade.players.find(side => side !== first)!
    const assets = (side: typeof first) => [
      ...side.received.map(player => ({ id: player.sleeperId, label: player.name, sublabel: player.position })),
      ...(side.picks ?? []).map((label, i) => ({ id: `pick:${i}:${label}`, label, sublabel: null })),
    ]
    const date = new Date(trade.at)
    return [{
      id: `sleeper:${trade.transactionId.split(':').at(-1)}`,
      direction: 'complete' as const, status: 'completed_on_sleeper',
      partnerName: `${first.manager ?? 'Side A'} ↔ ${second.manager ?? 'Side B'}`,
      sideALabel: `${first.manager ?? 'Side A'} sent`, sideBLabel: `${second.manager ?? 'Side B'} sent`,
      sent: assets(second), received: assets(first),
      timestamp: Number.isFinite(date.getTime()) ? date.toISOString() : '',
      realizedGrade: first.gradeBasis === 'Realized' ? first.grade ?? null : null,
      realizedNote: first.gradeBasis === 'Realized' ? first.gradeNote ?? null : null,
    }]
  })
}
