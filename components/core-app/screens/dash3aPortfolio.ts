/**
 * Leagues per platform, for the home's portfolio chart.
 *
 * Pure and outside the client component on purpose: the streamed home computes it on the server and
 * sends the chart a handful of counts, instead of shipping every league row to the browser only to
 * count them there (components/core-app/home/HomeCards.tsx). `Dashboard3A` uses the same function
 * when it builds the chart from its own props, so the two can never count differently.
 */

export type PlatformCount = { label: string; value: number; displayValue: string }

export function platformCountsOf(leagues: ReadonlyArray<{ platform?: string | null }>): PlatformCount[] {
  const counts = leagues.reduce((byPlatform, league) => {
    const platform = String(league.platform ?? 'AllFantasy').trim() || 'AllFantasy'
    byPlatform.set(platform, (byPlatform.get(platform) ?? 0) + 1)
    return byPlatform
  }, new Map<string, number>())
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, value]) => ({ label, value, displayValue: value.toLocaleString() }))
}
