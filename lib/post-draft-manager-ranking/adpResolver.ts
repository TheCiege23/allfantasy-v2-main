/**
 * Resolve ADP for draft picks. Uses AI ADP snapshot when available; fallback to pick-based proxy.
 */

import { getAiAdpForLeague } from '@/lib/ai-adp-engine'
import type { AiAdpPlayerEntry } from '@/lib/ai-adp-engine/types'

function normalize(s: string | null | undefined): string {
  if (s == null) return ''
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/** Build a stable key for matching draft pick to ADP entry. */
function playerKey(name: string, position: string, team: string | null): string {
  return `${normalize(name)}|${normalize(position)}|${normalize(team ?? '')}`
}

/** Build ADP map: playerKey -> adp (1-based overall). Uses AI ADP when available. */
export async function getAdpMapForLeague(
  sport: string,
  isDynasty: boolean,
  formatKey?: string
): Promise<Map<string, number>> {
  const result = await getAiAdpForLeague(sport, isDynasty, formatKey)
  const map = new Map<string, number>()
  if (!result?.entries?.length) return map
  for (const e of result.entries as AiAdpPlayerEntry[]) {
    const key = playerKey(e.playerName, e.position, e.team ?? null)
    map.set(key, e.adp)
  }
  return map
}

/** Get ADP for a single pick. Returns fallbackAdp when no match (e.g. overall as neutral proxy). */
export function getAdpForPick(
  adpMap: Map<string, number>,
  playerName: string,
  position: string,
  team: string | null,
  fallbackAdp: number
): number {
  const key = playerKey(playerName, position, team ?? null)
  const adp = adpMap.get(key)
  if (adp != null) return adp
  return fallbackAdp
}
