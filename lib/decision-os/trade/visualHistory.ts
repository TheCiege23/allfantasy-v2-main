/** Client-safe history buckets. Missing captures stay missing; prices are never interpolated. */
export type ValueCapture = { day: string; value: number }
export type ValueBucket = { label: string; day: string; value: number | null }
export function valueHistoryBuckets(rows: readonly ValueCapture[], mode: 'weeks' | 'seasons'): ValueBucket[] {
  const valid = rows.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.day) && Number.isFinite(Date.parse(r.day)) && Number.isFinite(r.value) && r.value >= 0).slice().sort((a,b) => a.day.localeCompare(b.day))
  const buckets = new Map<string, ValueCapture>()
  for (const row of valid) {
    const date = new Date(`${row.day}T00:00:00Z`)
    const season = date.getUTCFullYear() - (date.getUTCMonth() < 2 ? 1 : 0)
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
    buckets.set(mode === 'seasons' ? String(season) : date.toISOString().slice(0,10), row)
  }
  if (mode === 'seasons') {
    const seasons=[...buckets.keys()].map(Number)
    if (!seasons.length) return []
    const points:ValueBucket[]=[]
    for (let season=seasons[0];season<=seasons.at(-1)!;season++) {
      const row=buckets.get(String(season))
      points.push({label:String(season),day:row?.day??`${season}-03-01`,value:row?.value??null})
    }
    return points
  }
  const keys = [...buckets.keys()]
  if (!keys.length) return []
  const end = Date.parse(keys.at(-1)!)
  const result: ValueBucket[] = []
  for (let t = Date.parse(keys[0]); t <= end; t += 7*86400000) {
    const key = new Date(t).toISOString().slice(0,10)
    const row = buckets.get(key)
    result.push({ label: `Week of ${key}`, day: row?.day ?? key, value: row?.value ?? null })
  }
  return result
}

/** A retrospective cannot undo later transactions without a reliable asset lineage. */
export function retrospectiveRoster(held: readonly string[], sent: readonly string[], received: readonly string[]) {
  const have = new Set(held)
  const moved = received.filter(id => !have.has(id))
  const returned = sent.filter(id => have.has(id))
  return { moved, returned, withoutTrade: moved.length || returned.length ? null : [...held.filter(id => !received.includes(id)), ...sent] }
}
