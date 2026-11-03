/** Optional scope for the existing TheSportsDB schedule cron; omitted keeps its normal sports. */
export function resolveTsdbScheduleSports<T extends string>(
  value: string | null,
  supported: readonly T[],
): T[] {
  if (value === null) return [...supported]
  const selected = [...new Set(value.split(',').map((sport) => sport.trim().toUpperCase()))]
  if (!selected.length || selected.some((sport) => !supported.includes(sport as T))) {
    throw new Error('Unsupported TheSportsDB schedule sport')
  }
  return selected as T[]
}
