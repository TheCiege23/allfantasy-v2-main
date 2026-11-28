/**
 * The commissioner's waiver run report (AF Commissioner waiver extra, lib/waivers/waiverExtras.ts):
 * posted to league chat after each run — every player who moved, to whom, for how much, and (unless
 * the commissioner hides them) the bids that lost. Pure: run-hooks.ts supplies the names.
 */
import type { ProcessedClaimResult } from '@/lib/waiver-wire/types'

export function buildWaiverRunReport(input: {
  results: ProcessedClaimResult[]
  teamName: (rosterId: string) => string
  playerName: (playerId: string) => string
  hideLosingBids: boolean
  faab: boolean
}): string {
  const money = (n: number | null | undefined) => (input.faab && typeof n === 'number' ? ` ($${n})` : '')
  const wins = input.results.filter((r) => r.success)
  if (wins.length === 0) return 'Waivers processed. No claims awarded.'
  const lines = ['Waiver report']
  for (const w of wins) {
    const drop = w.dropPlayerId ? `, dropped ${input.playerName(w.dropPlayerId)}` : ''
    lines.push(`• ${input.teamName(w.rosterId)} added ${input.playerName(w.addPlayerId)}${money(w.faabSpent)}${drop}`)
    if (!input.hideLosingBids && input.faab) {
      const losers = input.results
        .filter((r) => !r.success && r.addPlayerId === w.addPlayerId && typeof r.faabBid === 'number')
        .sort((a, b) => (b.faabBid ?? 0) - (a.faabBid ?? 0))
      if (losers.length) lines.push(`  Also bid: ${losers.map((l) => `${input.teamName(l.rosterId)} $${l.faabBid}`).join(', ')}`)
    }
  }
  return lines.join('\n')
}
