// lib/trade-engine/tradeBlock.ts

export type TradeBlockEntry = {
  rosterId: number
  assetId: string
  source: 'sleeper' | 'legacy'
}

export function buildTradeBlockIndex(entries: TradeBlockEntry[]) {
  const index = new Map<string, TradeBlockEntry>()

  for (const e of entries) {
    index.set(`${e.rosterId}:${e.assetId}`, e)
  }

  return {
    has(rosterId: number, assetId: string) {
      return index.has(`${rosterId}:${assetId}`)
    },
    get(rosterId: number, assetId: string) {
      return index.get(`${rosterId}:${assetId}`)
    },
  }
}
