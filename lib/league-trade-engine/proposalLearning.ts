import type { PartnerBehaviorProfile } from '@/lib/league-trade-engine/proposalSuggestions'

export type HistoricalProposal = {
  proposerRosterId: string
  receiverRosterId: string
  status: string
  metadata?: unknown
  items: Array<{ itemType: string; fromRosterId: string; toRosterId: string }>
}

const ACCEPTED = new Set(['processed', 'accepted', 'scheduled', 'awaiting_commissioner', 'awaiting_votes'])
const DECIDED = new Set([...ACCEPTED, 'rejected', 'countered', 'expired', 'cancelled', 'vetoed'])

export function derivePartnerBehaviorProfiles(trades: HistoricalProposal[], rosterIds: string[]): PartnerBehaviorProfile[] {
  return rosterIds.map((rosterId) => {
    const relevant = trades.filter((trade) => trade.proposerRosterId !== rosterId && (
      trade.receiverRosterId === rosterId || trade.items.some((item) => item.toRosterId === rosterId || item.fromRosterId === rosterId)
    ) && DECIDED.has(trade.status))
    const weight = (trade: HistoricalProposal) => {
      const metadata = trade.metadata && typeof trade.metadata === 'object' && !Array.isArray(trade.metadata)
        ? trade.metadata as Record<string, unknown>
        : {}
      return typeof metadata.suggestionId === 'string' && metadata.suggestionId.length > 0 ? 2 : 1
    }
    const accepted = relevant.filter((trade) => ACCEPTED.has(trade.status))
    const counters = relevant.filter((trade) => trade.status === 'countered')
    const decidedWeight = relevant.reduce((sum, trade) => sum + weight(trade), 0)
    const acceptedWeight = accepted.reduce((sum, trade) => sum + weight(trade), 0)
    const kindCounts = new Map<'player' | 'pick' | 'faab', number>()
    for (const trade of accepted) {
      for (const item of trade.items.filter((row) => row.toRosterId === rosterId)) {
        const kind = item.itemType === 'player' ? 'player' : item.itemType === 'faab' ? 'faab' : item.itemType.includes('pick') ? 'pick' : null
        if (kind) kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + weight(trade))
      }
    }
    const preferredAssetKinds = [...kindCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([kind]) => kind)
    return {
      rosterId,
      sampleSize: relevant.length,
      acceptanceRate: relevant.length ? (acceptedWeight + 1) / (decidedWeight + 2) : null,
      counterRate: relevant.length ? counters.length / relevant.length : null,
      preferredAssetKinds,
    }
  })
}
