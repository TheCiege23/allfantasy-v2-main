import { prisma } from '../prisma'
import { matchInjuryRowsToPlayers, type InjuryPlayerLookup } from '@/lib/injuries/matchInjuryRows'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'

export type TradeInjuryEntry = {
  status: string
  type: string | null
  description: string | null
  date: string | null
  fetchedAt: string | null
}

/**
 * The newest NFL injury row per player for the trade assemblers, keyed by the name the caller asked
 * with. Same query as the two copies it replaces (league-context-assembler, trade-context-assembler):
 * exact names, newest `fetchedAt` first. The one change is identity — a name shared by two athletes
 * (WR vs LB Justin Jefferson) binds only when the caller's team or position tells them apart, and is
 * otherwise left out rather than given the other player's status. See `matchInjuryRows.ts`.
 */
export async function fetchVerifiedTradeInjuries(
  players: readonly InjuryPlayerLookup[],
  logTag: string,
): Promise<Map<string, TradeInjuryEntry>> {
  const result = new Map<string, TradeInjuryEntry>()
  if (players.length === 0) return result
  try {
    const rows = await prisma.sportsInjury.findMany({
      where: { playerName: { in: [...new Set(players.map((p) => p.name))] }, sport: 'NFL' },
      orderBy: { fetchedAt: 'desc' },
    })
    const { byPlayer } = matchInjuryRowsToPlayers(rows, players, 'NFL')
    for (const p of players) {
      const inj = byPlayer.get(normalizeMatchName(p.name))?.[0]
      if (!inj || result.has(p.name)) continue
      result.set(p.name, {
        status: inj.status || 'Unknown',
        type: inj.type,
        description: inj.description,
        date: inj.date ? inj.date.toISOString().split('T')[0] : null,
        fetchedAt: inj.fetchedAt ? inj.fetchedAt.toISOString() : null,
      })
    }
  } catch (e) {
    console.warn(`[${logTag}] Injury fetch failed:`, e)
  }
  return result
}
