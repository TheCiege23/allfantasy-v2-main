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

/** "Sep 10" */
export function shortDate(value: string | number | Date | null | undefined): string {
  const d = parsed(value)
  return d ? SHORT_DATE.format(d) : '—'
}

/** "Sep 10, 2026" */
export function mediumDate(value: string | number | Date | null | undefined): string {
  const d = parsed(value)
  return d ? MEDIUM_DATE.format(d) : '—'
}

/** "September 10, 2026" */
export function longDate(value: string | number | Date | null | undefined): string {
  const d = parsed(value)
  return d ? LONG_DATE.format(d) : '—'
}

/** "Sep 10, 2026, 3:05 PM EDT" */
export function dateTime(value: string | number | Date | null | undefined): string {
  const d = parsed(value)
  return d ? DATE_TIME.format(d) : '—'
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
