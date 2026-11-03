/** Keep the requested AF-ADP option separate from which data is actually available. */
export function canDisplayAiAdp(
  requested: boolean, unavailable: boolean, players: ReadonlyArray<{ aiAdp?: number | null }>,
): boolean {
  return requested && !unavailable && players.some(player =>
    typeof player.aiAdp === 'number' && Number.isFinite(player.aiAdp) && player.aiAdp > 0)
}
