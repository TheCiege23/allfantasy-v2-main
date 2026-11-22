/**
 * One sentence for "where do Survivor trades stand right now", shared by the castaway's governance card
 * and the Commissioner Hub so the two never word it differently. Pure and client-safe; the status is the
 * JSON of `survivorTradeWindowStatus` (lib/survivor/survivorTradeRules.ts), the same object the trade
 * check enforces.
 */
import type { SurvivorGovernanceUiMessages } from './survivorGovernanceUiMessages'

export interface TradeWindowJson {
  crossTribeOpen: boolean
  crossTribeClosesAt: string | null
  frozen: boolean
  crossTribeWindow?: { index: number; count: number } | null
  crossTribeOpensAt?: string | null
}

export function survivorTradeWindowText(m: SurvivorGovernanceUiMessages, tw: TradeWindowJson, when: (iso: string) => string): string {
  if (tw.frozen) return m.tradeFrozen
  if (tw.crossTribeClosesAt) {
    const w = tw.crossTribeWindow
    return w && w.count > 1 ? m.tradeWindowOpenOf(when(tw.crossTribeClosesAt), w.index, w.count) : m.tradeWindowOpen(when(tw.crossTribeClosesAt))
  }
  if (tw.crossTribeOpen) return m.crossAllowed
  if (tw.crossTribeOpensAt) return m.tradeWindowOpensAt(when(tw.crossTribeOpensAt))
  return m.tradeWindowClosed
}
