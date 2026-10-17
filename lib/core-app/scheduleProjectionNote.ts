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
 *
 * Spanish (2026-10-06): every function takes the reader's language, last and defaulting to English,
 * so an English caller is byte-identical. Built here rather than translated from the English, because
 * the sentence is assembled from parts this module already holds.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** "Sep 29" ("29 sep" in Spanish), in UTC so a server render and a client render agree. */
export function shortAsOf(iso: string | null | undefined, language: string = 'en'): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  return language === 'es'
    ? `${d.getUTCDate()} ${MONTHS_ES[d.getUTCMonth()]}`
    : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** "Week 5", "Weeks 5–6", "Weeks 5, 7" ("Semana 5", "Semanas 5–6" …). */
export function weekList(weeks: readonly number[], language: string = 'en'): string {
  const [one, many] = language === 'es' ? ['Semana', 'Semanas'] : ['Week', 'Weeks']
  const sorted = [...weeks].sort((a, b) => a - b)
  if (sorted.length === 1) return `${one} ${sorted[0]}`
  const contiguous = sorted.every((w, i) => i === 0 || w === sorted[i - 1]! + 1)
  return contiguous ? `${many} ${sorted[0]}–${sorted[sorted.length - 1]}` : `${many} ${sorted.join(', ')}`
}

const LINEUP_TAIL = 'Your lineup view applies league scoring and current injury availability.'
const LINEUP_TAIL_ES = 'Tu alineación aplica la puntuación de la liga y la disponibilidad actual por lesiones.'

export function scheduleProjectionNote(
  data: Pick<PlayerCardSchedule, 'weeks' | 'projectedWeek' | 'futureWeeks'>,
  language: string = 'en',
): string {
  const es = language === 'es'
  if (!data.futureWeeks) {
    if (es) {
      return data.projectedWeek != null
        ? `Las proyecciones base publicadas cubren solo la semana ${data.projectedWeek}; las semanas siguientes muestran el partido. ${LINEUP_TAIL_ES}`
        : 'Todavía no hay ninguna semana proyectada publicada; estos son los partidos.'
    }
    return data.projectedWeek != null
      ? `Published baseline projections cover week ${data.projectedWeek} only; later weeks show the fixture. ${LINEUP_TAIL}`
      : 'No projected week is published yet; these are fixtures.'
  }

  const parts: string[] = []
  parts.push(
    es
      ? data.projectedWeek != null
        ? `La semana ${data.projectedWeek} es la línea publicada de esta semana.`
        : 'Todavía no se publicó la línea de esta semana.'
      : data.projectedWeek != null
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
    const asOf = shortAsOf(oldest, language)
    const list = weekList(published.map((w) => w.week), language)
    parts.push(
      es
        ? `${list}: líneas PPR tempranas de Sleeper${asOf ? `, al ${asOf}` : ''}.`
        : `${list}: Sleeper's early PPR lines${asOf ? `, as of ${asOf}` : ''}.`
    )
  }
  if (notPublished.length > 0) {
    parts.push(`${weekList(notPublished.map((w) => w.week), language)}: ${es ? 'aún sin publicar' : 'not published yet'}.`)
  }
  if (unchecked.length > 0) {
    parts.push(`${weekList(unchecked.map((w) => w.week), language)}: ${es ? 'todavía sin línea registrada' : 'no line on file yet'}.`)
  }

  parts.push(es ? LINEUP_TAIL_ES : LINEUP_TAIL)
  return parts.join(' ')
}

/** What a schedule row shows in its value column. */
export function scheduleRowValue(
  w: PlayerCardWeek,
  language: string = 'en',
): { text: string; muted: boolean; title: string | undefined } {
  const es = language === 'es'
  if (w.projection != null) {
    const asOf = w.projectionKind === 'future' ? shortAsOf(w.projectionAsOf, language) : null
    return {
      text: w.projection.toFixed(1),
      muted: false,
      title:
        w.projectionKind === 'future'
          ? es
            ? `Línea temprana de Sleeper${asOf ? `, al ${asOf}` : ''}`
            : `Sleeper early line${asOf ? `, as of ${asOf}` : ''}`
          : undefined,
    }
  }
  if (!w.bye && w.futureStatus === 'not_published') {
    const asOf = shortAsOf(w.projectionAsOf, language)
    return es
      ? { text: 'aún sin publicar', muted: true, title: asOf ? `Revisado el ${asOf}` : undefined }
      : { text: 'not published yet', muted: true, title: asOf ? `Checked ${asOf}` : undefined }
  }
  return { text: '—', muted: false, title: undefined }
}
