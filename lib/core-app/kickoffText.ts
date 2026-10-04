/**
 * Kickoff times and dates in the reader's language (2026-10-03).
 *
 * The kickoff formatters — `kickoffClock` ("Sun 1:00p ET"), `formatKickoff` ("Thu 10/1 8:15p ET"),
 * `kickoffDayLabel` ("Oct 4") and `formatLockLabel` ("Locked", "Oct 4") — PIN the en-US locale and
 * the Eastern zone on purpose: the server paints the first render and the browser re-renders it, and
 * an unpinned locale would ask two machines for two answers and break hydration. Several of these
 * strings are also built on the SERVER (`myTeam.ts`'s gameContext), which does not know the reader's
 * language.
 *
 * So rather than unpin the formatters, this translates their fixed output at render, in the client,
 * where the language is known. That is hydration-safe for the same reason the pin is: the language
 * provider starts at English on server and client alike, and switches after mount.
 *
 * Spanish:  "Sun 1:00p ET" → "dom 1:00p ET" · "Thu 10/1 8:15p ET" → "jue 1/10 8:15p ET" (day first) ·
 *           "Oct 4" → "4 oct" · "Locked" → "Bloqueado". The compact clock (1:00p ET) and the
 *           countdown ("3d 4h", "4:05:09") read the same in Spanish and are left alone.
 *
 * Anything it does not recognise passes through unchanged — never blanked. PURE, client-safe.
 */
const WEEKDAY_ES: Record<string, string> = { Sun: 'dom', Mon: 'lun', Tue: 'mar', Wed: 'mié', Thu: 'jue', Fri: 'vie', Sat: 'sáb' }
const MONTH_ES: Record<string, string> = {
  Jan: 'ene', Feb: 'feb', Mar: 'mar', Apr: 'abr', May: 'may', Jun: 'jun',
  Jul: 'jul', Aug: 'ago', Sep: 'sep', Oct: 'oct', Nov: 'nov', Dec: 'dic',
}
const WD = '(Sun|Mon|Tue|Wed|Thu|Fri|Sat)'
const MO = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)'

export function kickoffText(text: string, language: string): string
export function kickoffText(text: string | null | undefined, language: string): string | null | undefined
export function kickoffText(text: string | null | undefined, language: string): string | null | undefined {
  if (!text || language !== 'es') return text
  return text
    // "Thu 10/1 8:15p ET" — weekday + month/day: Spanish reads the day first.
    .replace(new RegExp(`\\b${WD} (\\d{1,2})/(\\d{1,2})\\b`, 'g'), (_, w: string, m: string, d: string) => `${WEEKDAY_ES[w]} ${d}/${m}`)
    // "Sun 1:00p ET" — a weekday directly before a clock.
    .replace(new RegExp(`\\b${WD}(?= \\d{1,2}:\\d{2}[ap]\\b)`, 'g'), (w: string) => WEEKDAY_ES[w]!)
    // "Oct 4" — month then day.
    .replace(new RegExp(`\\b${MO} (\\d{1,2})\\b`, 'g'), (_, mo: string, d: string) => `${d} ${MONTH_ES[mo]}`)
    .replace(/^Locked$/, 'Bloqueado')
}
