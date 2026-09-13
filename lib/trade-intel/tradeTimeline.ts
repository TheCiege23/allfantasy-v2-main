export type SeasonedTradeTimelineItem = {
  season: string | null
  sortKey: number
}

export type TradeTimelineSeasonGroup<T> = {
  season: string
  items: T[]
}

export function tradeSeasonFromIso(iso: string): string | null {
  const parsed = new Date(iso)
  return Number.isFinite(parsed.getTime()) ? String(parsed.getFullYear()) : null
}

export function tradeTimelineSeasons<T extends SeasonedTradeTimelineItem>(items: T[]): string[] {
  return [...new Set(items.map((item) => item.season).filter((season): season is string => Boolean(season)))]
    .sort((a, b) => Number(b) - Number(a) || b.localeCompare(a))
}

export function groupTradeTimelineBySeason<T extends SeasonedTradeTimelineItem>(
  items: T[],
): TradeTimelineSeasonGroup<T>[] {
  const groups = new Map<string, T[]>()
  for (const item of [...items].sort((a, b) => b.sortKey - a.sortKey)) {
    const season = item.season ?? 'Season unknown'
    const list = groups.get(season) ?? []
    list.push(item)
    groups.set(season, list)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === 'Season unknown') return 1
      if (b === 'Season unknown') return -1
      return Number(b) - Number(a) || b.localeCompare(a)
    })
    .map(([season, groupedItems]) => ({ season, items: groupedItems }))
}
