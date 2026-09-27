import type { AiRosterPlayerRef } from '@/lib/ai-payload/types'

/** Count the full evidence, rather than the shortened player list sent to the model. */
export function listedPositionCounts(players: readonly { position: string | null }[]): string {
  const counts = new Map<string, number>()
  for (const player of players) {
    const position = player.position?.trim().toUpperCase() || 'UNKNOWN'
    counts.set(position, (counts.get(position) ?? 0) + 1)
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([p, n]) => `${p}: ${n}`).join('; ')
}

export function rosterCountEvidence(players: readonly AiRosterPlayerRef[]): string {
  const positions = new Map<string, Set<string>>()
  let unidentifiedRows = 0
  for (const player of players) {
    const id = player.playerId?.trim()
    if (!id) { unidentifiedRows++; continue }
    const known = positions.get(id) ?? new Set<string>()
    const position = player.position?.trim().toUpperCase()
    if (position) known.add(position)
    positions.set(id, known)
  }
  // Conflicting primary positions cannot honestly be assigned to either bucket.
  const unique = [...positions.values()].map((p) => ({ position: p.size === 1 ? [...p][0]! : null }))
  return `CURRENT ROSTER COUNTS: ${unique.length} distinct identified players across starters, bench, IR and taxi. ` +
    `By listed primary position: ${listedPositionCounts(unique) || 'none'}. ` +
    'Counts use the full synced roster before display truncation, deduplicate player IDs, and are not roster capacity or a count of healthy players. UNKNOWN means missing or conflicting position evidence.' +
    (unidentifiedRows ? ` ${unidentifiedRows} row(s) lack a player ID and cannot be included in distinct-player counts.` : '')
}
