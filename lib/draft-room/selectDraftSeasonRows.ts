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

/** RI season clocks are seconds, measured in lib/chimmy/tools/dailySportStats.ts (2026-09-24). Generic provider extractors consume minutes. */
export function normalizeRiDraftSeasonUnits(sport: string, blob: unknown): Record<string, unknown> {
  const out = blob && typeof blob === 'object' && !Array.isArray(blob) ? { ...blob } as Record<string, unknown> : {}
  const field = sport === 'NBA' ? 'minutes' : sport === 'NHL' ? 'time_on_ice' : null
  if (!field) return out
  const raw = out[field]
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() && !raw.includes(':') ? Number(raw) : NaN
  if (Number.isFinite(n) && n >= 0) out[field] = n / 60
  return out
}
