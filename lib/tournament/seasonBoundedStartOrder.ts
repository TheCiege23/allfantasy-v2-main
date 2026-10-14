export type BoundedGameStart = { gameId: string; startAfter: string; startedBy: string }

/**
 * A status-poll window only proves ordering when one possible start interval
 * ends before the next begins. Overlapping NBA windows cannot decide game-cap order.
 */
export function assessSeasonBoundedStartOrder(raw: BoundedGameStart[]) {
  if (raw.length > 250 || new Set(raw.map(game => game.gameId)).size !== raw.length) throw new Error('Game-start windows must be unique and bounded.')
  const games = raw.map(game => {
    const after = Date.parse(game.startAfter), by = Date.parse(game.startedBy)
    if (!game.gameId || !Number.isFinite(after) || !Number.isFinite(by) || after >= by) throw new Error('A valid observed start window is required.')
    return { ...game, after, by }
  }).sort((a, b) => a.after - b.after || a.by - b.by || a.gameId.localeCompare(b.gameId))
  const ambiguousPairs: Array<[string, string]> = []
  for (let i = 0; i < games.length; i++) {
    for (let j = i + 1; j < games.length && games[j]!.after < games[i]!.by; j++) {
      ambiguousPairs.push([games[i]!.gameId, games[j]!.gameId])
    }
  }
  return { canOrder: ambiguousPairs.length === 0, orderedGameIds: ambiguousPairs.length ? null : games.map(game => game.gameId), ambiguousPairs }
}
