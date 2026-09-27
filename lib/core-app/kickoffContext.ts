/** Keep a scheduled game's roster action inside the sport named by the countdown. */
export function selectKickoffLeague<T extends { sport?: string | null }>(
  gameSport: string | null | undefined,
  rankedLeagues: readonly T[],
): T | null {
  const sport = String(gameSport ?? '').trim().toUpperCase()
  if (!sport) return null
  // The dashboard's league loader also treats a missing league sport as NFL.
  return rankedLeagues.find((l) => String(l.sport ?? 'NFL').trim().toUpperCase() === sport) ?? null
}
