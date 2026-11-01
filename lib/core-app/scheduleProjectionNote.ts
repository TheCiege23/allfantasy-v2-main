import type { PlayerCardSchedule, PlayerCardWeek } from './playerCard'
import { messagesFor } from '@/lib/i18n/messages'
import { scheduleProjectionNoteMessages } from './messages/scheduleProjectionNote'

/**
 * The sentence under the player card's schedule strip, and the per-row value text.
 *
 * ⚠ A CLIENT-SAFE LEAF. The sheet is a client component and `playerCard.ts` is `server-only`, so
 * this module imports only its client-safe catalog at runtime — the `import type` above is erased.
 * Keep it that way: a client component reaching a server-only module through a value import breaks
 * `next build` with no local signal.
 *
 * Without later-week data (`futureWeeks` absent — the tables are not migrated, or the sport has no
 * weekly feed) the sentences are exactly the ones the card has always shown.
 *
 * Spanish (2026-10-06): every function takes the reader's language, last and defaulting to English,
 * so an English caller is byte-identical. Built here rather than translated from the English, because
 * the sentence is assembled from parts this module already holds.
 */

/** "Sep 29" ("29 sep" in Spanish), in UTC so a server render and a client render agree. */
export function shortAsOf(iso: string | null | undefined, language: string = 'en'): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  return messagesFor(scheduleProjectionNoteMessages, language).shortDate(d.getUTCDate(), d.getUTCMonth())
}

/** "Week 5", "Weeks 5–6", "Weeks 5, 7" ("Semana 5", "Semanas 5–6" …). */
export function weekList(weeks: readonly number[], language: string = 'en'): string {
  const m = messagesFor(scheduleProjectionNoteMessages, language)
  const [one, many] = [m.week, m.weeks]
  const sorted = [...weeks].sort((a, b) => a - b)
  if (sorted.length === 1) return `${one} ${sorted[0]}`
  const contiguous = sorted.every((w, i) => i === 0 || w === sorted[i - 1]! + 1)
  return contiguous ? `${many} ${sorted[0]}–${sorted[sorted.length - 1]}` : `${many} ${sorted.join(', ')}`
}

export function scheduleProjectionNote(
  data: Pick<PlayerCardSchedule, 'weeks' | 'projectedWeek' | 'futureWeeks'>,
  language: string = 'en',
): string {
  const m = messagesFor(scheduleProjectionNoteMessages, language)
  if (!data.futureWeeks) {
    return data.projectedWeek != null ? m.baselineOnly(data.projectedWeek) : m.noProjectedWeek
  }

  const parts: string[] = []
  parts.push(data.projectedWeek != null ? m.currentWeekLine(data.projectedWeek) : m.noCurrentWeekLine)

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
    const asOf = shortAsOf(oldest, language)
    const list = weekList(published.map((w) => w.week), language)
    parts.push(m.earlyLines(list, asOf))
  }
  if (notPublished.length > 0) {
    parts.push(`${weekList(notPublished.map((w) => w.week), language)}: ${m.notPublishedYet}.`)
  }
  if (unchecked.length > 0) {
    parts.push(`${weekList(unchecked.map((w) => w.week), language)}: ${m.noLineOnFile}.`)
  }

  parts.push(m.lineupTail)
  return parts.join(' ')
}

/** What a schedule row shows in its value column. */
export function scheduleRowValue(
  w: PlayerCardWeek,
  language: string = 'en',
): { text: string; muted: boolean; title: string | undefined } {
  const m = messagesFor(scheduleProjectionNoteMessages, language)
  if (w.projection != null) {
    const asOf = w.projectionKind === 'future' ? shortAsOf(w.projectionAsOf, language) : null
    return {
      text: w.projection.toFixed(1),
      muted: false,
      title: w.projectionKind === 'future' ? m.earlyLine(asOf) : undefined,
    }
  }
  if (!w.bye && w.futureStatus === 'not_published') {
    const asOf = shortAsOf(w.projectionAsOf, language)
    return { text: m.notPublishedYet, muted: true, title: asOf ? m.checked(asOf) : undefined }
  }
  return { text: '—', muted: false, title: undefined }
}
