import type { PlayerCardSchedule, PlayerCardWeek } from './playerCard'

/**
 * The sentence under the player card's schedule strip, and the per-row value text.
 *
 * ⚠ A CLIENT-SAFE LEAF. The sheet is a client component and `playerCard.ts` is `server-only`, so
 * this module imports nothing at runtime — the `import type` above is erased. Keep it that way: a
 * client component reaching a server-only module through a value import breaks `next build` with
 * no local signal.
 *
 * Without later-week data (`futureWeeks` absent — the tables are not migrated, or the sport has no
 * weekly feed) the sentences are exactly the ones the card has always shown.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Sep 29", in UTC so a server render and a client render agree. */
export function shortAsOf(iso: string | null | undefined): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** "Week 5", "Weeks 5–6", "Weeks 5, 7". */
export function weekList(weeks: readonly number[]): string {
  const sorted = [...weeks].sort((a, b) => a - b)
  if (sorted.length === 1) return `Week ${sorted[0]}`
  const contiguous = sorted.every((w, i) => i === 0 || w === sorted[i - 1]! + 1)
  return contiguous ? `Weeks ${sorted[0]}–${sorted[sorted.length - 1]}` : `Weeks ${sorted.join(', ')}`
}

const LINEUP_TAIL = 'Your lineup view applies league scoring and current injury availability.'

export function scheduleProjectionNote(data: Pick<PlayerCardSchedule, 'weeks' | 'projectedWeek' | 'futureWeeks'>): string {
  if (!data.futureWeeks) {
    return data.projectedWeek != null
      ? `Published baseline projections cover week ${data.projectedWeek} only; later weeks show the fixture. ${LINEUP_TAIL}`
      : 'No projected week is published yet; these are fixtures.'
  }

  const parts: string[] = []
  parts.push(
    data.projectedWeek != null
      ? `Week ${data.projectedWeek} is this week's published line.`
      : 'No current-week line is published yet.'
  )

  const later = data.weeks.filter((w) => !w.bye && w.futureStatus)
  const published = later.filter((w) => w.futureStatus === 'published' || w.futureStatus === 'no_line')
  const notPublished = later.filter((w) => w.futureStatus === 'not_published')
  const unchecked = later.filter((w) => w.futureStatus === 'unchecked')

  if (published.length > 0) {
    // The OLDEST confirmation among them — the sentence must not claim more freshness than the
    // least fresh number it covers.
    const oldest = published
      .map((w) => w.projectionAsOf)
      .filter((s): s is string => typeof s === 'string' && Number.isFinite(Date.parse(s)))
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0]
    const asOf = shortAsOf(oldest)
    parts.push(`${weekList(published.map((w) => w.week))}: Sleeper's early PPR lines${asOf ? `, as of ${asOf}` : ''}.`)
  }
  if (notPublished.length > 0) parts.push(`${weekList(notPublished.map((w) => w.week))}: not published yet.`)
  if (unchecked.length > 0) parts.push(`${weekList(unchecked.map((w) => w.week))}: no line on file yet.`)

  parts.push(LINEUP_TAIL)
  return parts.join(' ')
}

/** What a schedule row shows in its value column. */
export function scheduleRowValue(w: PlayerCardWeek): { text: string; muted: boolean; title: string | undefined } {
  if (w.projection != null) {
    const asOf = w.projectionKind === 'future' ? shortAsOf(w.projectionAsOf) : null
    return {
      text: w.projection.toFixed(1),
      muted: false,
      title: w.projectionKind === 'future' ? `Sleeper early line${asOf ? `, as of ${asOf}` : ''}` : undefined,
    }
  }
  if (!w.bye && w.futureStatus === 'not_published') {
    const asOf = shortAsOf(w.projectionAsOf)
    return { text: 'not published yet', muted: true, title: asOf ? `Checked ${asOf}` : undefined }
  }
  return { text: '—', muted: false, title: undefined }
}
