/** Current season first, previous season only when no played current row exists. Zero games is not a stat line. */
export function selectDraftSeasonRows<T extends { playerId: string; season: string; gamesPlayed: number | null }>(rows: readonly T[], season: number): Map<string, T> {
  const out = new Map<string, T>()
  for (const row of rows) {
    const year = Number(row.season)
    if ((year !== season && year !== season - 1) || row.gamesPlayed == null || row.gamesPlayed <= 0) continue
    const prior = out.get(row.playerId)
    if (!prior || year > Number(prior.season)) out.set(row.playerId, row)
  }
  return out
}
