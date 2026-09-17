import 'server-only'

import { readTradeBlock, type TradeBlockRead } from '@/lib/trade-block/importedTradeBlock'

/**
 * The league's trade block, as Chimmy is told it.
 *
 * 🛑 SAYS WHAT IT CANNOT SEE, EVERY TIME. Sleeper does not share its own trade block with outside
 * apps (measured 2026-09-17), so the only listings are the ones managers marked in AllFantasy. An
 * empty list is therefore NOT "nobody is available" — and a model told only "no listings" would say
 * exactly that. The sentence it gets names the gap so the answer can too.
 *
 * The league id must be membership-proven: this reads every roster in the league.
 */
export function renderTradeBlockContext(read: TradeBlockRead | null): string {
  if (!read) return 'This league could not be read, so its trade block is unknown. Say so; do not guess who is available.'
  const { support, listings } = read
  if (!support.supported) {
    return `${support.note} Say so plainly; do not guess who is on the trade block.`
  }
  if (listings.length === 0) {
    return [
      'No players are marked on the trade block in AllFantasy for this league.',
      support.note,
      'Say both. Do not say nobody is available — managers may have players on the block in Sleeper that you cannot see.',
    ].join(' ')
  }
  const lines = listings.map((l) => {
    const who = [l.position, l.nflTeam].filter(Boolean).join(', ')
    const team = l.teamName ?? l.ownerName ?? 'a manager in this league'
    return `- ${l.playerName}${who ? ` (${who})` : ''} — listed by ${team}, ${l.since.slice(0, 10)}`
  })
  return [`Trade block (marked in AllFantasy), ${listings.length} player${listings.length === 1 ? '' : 's'}:`, ...lines, support.note].join('\n')
}

export async function buildTradeBlockContext(leagueId: string): Promise<string> {
  const read = await readTradeBlock(leagueId).catch(() => null)
  return renderTradeBlockContext(read)
}
