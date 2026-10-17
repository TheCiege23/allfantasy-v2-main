/**
 * Dates and counts, formatted the same on the server and in the browser.
 *
 * 🛑 `toLocaleDateString(undefined, …)` AND A BARE `toLocaleString()` READ THE VISITOR'S LOCALE AND
 * TIME ZONE. Commissioner OS screens are server-rendered and hydrated, so the server (UTC, and
 * whatever locale the runtime defaults to) and a visitor outside that zone produce different text
 * for the same instant — a hydration mismatch, React error #425, and a screen that can blank.
 * #681 fixed one of these on the analytics sheet by pinning a formatter; these are the same rule in
 * one place, so the next screen does not have to rediscover it.
 *
 * ⚠ THE ZONE IS PART OF THE FACT FOR A TIME, NOT FOR A DATE. `dateTime` carries `timeZoneName` so
 * "3:05 PM EDT" cannot be misread as the reader's own clock. A day ("Sep 10") does not need the
 * label, but it still needs the zone pinned, or the same instant renders as two different days
 * either side of midnight.
 *
 * ⚠ NUMBERS TOO. `Number.prototype.toLocaleString()` is locale-dependent in exactly the same way
 * (1,234 vs 1.234), and one of these sits in the same sentence as a pinned date.
 *
 * ⚠ CONSTRUCTED ONCE AT MODULE SCOPE, deliberately: `Intl.DateTimeFormat` is expensive enough that
 * building one per row shows up in a long table.
 */

const ZONE = 'America/New_York'
const LOCALE = 'en-US'

const SHORT_DATE = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', timeZone: ZONE })
const MEDIUM_DATE = new Intl.DateTimeFormat(LOCALE, { year: 'numeric', month: 'short', day: 'numeric', timeZone: ZONE })
const LONG_DATE = new Intl.DateTimeFormat(LOCALE, { year: 'numeric', month: 'long', day: 'numeric', timeZone: ZONE })
const DATE_TIME = new Intl.DateTimeFormat(LOCALE, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: ZONE,
  timeZoneName: 'short',
})
const COUNT = new Intl.NumberFormat(LOCALE)

/** An unparseable or absent value renders as an em dash rather than "Invalid Date". */
function parsed(value: string | number | Date | null | undefined): Date | null {
  if (value == null) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/*
 * Spanish (2026-10-06). Built from the SAME pinned en-US formatters' parts rather than from an es
 * locale: the zone stays pinned, and the month names come from the table below rather than from the
 * runtime's ICU data, which spells some of them differently between versions ("sep" / "sept") — the
 * exact server-versus-browser disagreement this file exists to prevent. The short months match
 * lib/core-app/kickoffText.ts, so a Commissioner OS date and a /core date read the same.
 */
const MONTH_SHORT_ES: Record<string, string> = {
  Jan: 'ene', Feb: 'feb', Mar: 'mar', Apr: 'abr', May: 'may', Jun: 'jun',
  Jul: 'jul', Aug: 'ago', Sep: 'sep', Oct: 'oct', Nov: 'nov', Dec: 'dic',
}
const MONTH_LONG_ES: Record<string, string> = {
  January: 'enero', February: 'febrero', March: 'marzo', April: 'abril', May: 'mayo', June: 'junio',
  July: 'julio', August: 'agosto', September: 'septiembre', October: 'octubre', November: 'noviembre', December: 'diciembre',
}

function partsOf(format: Intl.DateTimeFormat, d: Date): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of format.formatToParts(d)) out[part.type] = part.value
  return out
}

/** "Sep 10" — or "10 sep" when `language` is 'es'. */
export function shortDate(value: string | number | Date | null | undefined, language?: string | null): string {
  const d = parsed(value)
  if (!d) return '—'
  if (language !== 'es') return SHORT_DATE.format(d)
  const p = partsOf(SHORT_DATE, d)
  return `${p.day} ${MONTH_SHORT_ES[p.month] ?? p.month}`
}

/** "Sep 10, 2026" — or "10 sep 2026". */
export function mediumDate(value: string | number | Date | null | undefined, language?: string | null): string {
  const d = parsed(value)
  if (!d) return '—'
  if (language !== 'es') return MEDIUM_DATE.format(d)
  const p = partsOf(MEDIUM_DATE, d)
  return `${p.day} ${MONTH_SHORT_ES[p.month] ?? p.month} ${p.year}`
}

/** "September 10, 2026" — or "10 de septiembre de 2026". */
export function longDate(value: string | number | Date | null | undefined, language?: string | null): string {
  const d = parsed(value)
  if (!d) return '—'
  if (language !== 'es') return LONG_DATE.format(d)
  const p = partsOf(LONG_DATE, d)
  return `${p.day} de ${MONTH_LONG_ES[p.month] ?? p.month} de ${p.year}`
}

/** "Sep 10, 2026, 3:05 PM EDT" — or "10 sep 2026, 3:05 p. m. EDT". The zone label stays. */
export function dateTime(value: string | number | Date | null | undefined, language?: string | null): string {
  const d = parsed(value)
  if (!d) return '—'
  if (language !== 'es') return DATE_TIME.format(d)
  const p = partsOf(DATE_TIME, d)
  const period = p.dayPeriod === 'AM' ? 'a. m.' : p.dayPeriod === 'PM' ? 'p. m.' : p.dayPeriod ?? ''
  return `${p.day} ${MONTH_SHORT_ES[p.month] ?? p.month} ${p.year}, ${p.hour}:${p.minute} ${period} ${p.timeZoneName}`.replace(/\s+/g, ' ').trim()
}

/** "1,234" */
export function count(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? COUNT.format(value) : '—'
}

/**
 * What each formatter actually resolved to. For tests.
 *
 * 🛑 ASSERTING THE OUTPUT CANNOT CATCH AN UNPINNED FORMATTER ON A MACHINE THAT ALREADY MATCHES.
 * A developer box on Eastern time formats the Eastern day whether or not the zone is pinned, and
 * an en-US box groups thousands with commas either way — so a test that only reads the string goes
 * green on exactly the machine most likely to run it. These options come from the formatters
 * themselves, so a dropped `timeZone` or `LOCALE` fails anywhere.
 */
export function resolvedFormats(): Record<string, { locale: string; timeZone?: string }> {
  return {
    shortDate: SHORT_DATE.resolvedOptions(),
    mediumDate: MEDIUM_DATE.resolvedOptions(),
    longDate: LONG_DATE.resolvedOptions(),
    dateTime: DATE_TIME.resolvedOptions(),
    count: COUNT.resolvedOptions(),
  }
}
