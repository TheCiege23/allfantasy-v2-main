import { isStale, type DataClass } from '@/lib/sports-data/freshnessPolicy'

/**
 * "When did the information behind this card last change?" — one shape for every /core home card.
 *
 * WHY ONE SHAPE. The home already knew its sync age (`syncAge`, computed once per render), but only
 * one card printed it, and the injury rows each carried their own "reported 30m ago". A reader had
 * no way to tell a card built from a roster read four minutes ago from one built from a read that
 * never happened. Each card now carries one or more stamps, each naming its SOURCE, because "updated
 * 4m ago" means nothing unless it says what was updated.
 *
 * ⚠ THE TIME IS A FACT ABOUT THE DATA, NEVER ABOUT THIS RENDER. `now` is not a freshness value: a
 * card computed this second from rosters read three days ago is three days old. A source whose time
 * we do not hold is `asOf: null` and says "not read yet" — it is never filled in with `now`.
 *
 * ⚠ `asOf` IS AN ISO STRING, NOT A `Date`, because the stamp is rendered by a client component and
 * re-derived there once a minute. `label` is the server's rendering of the same instant so the first
 * client paint matches the server's and hydration does not warn.
 */
export type CardFreshnessStamp = {
  /** What the time describes — "Rosters", "Injury reports". Shown to the reader. */
  source: string
  /** When that source last changed or was last read, as ISO. Null when we hold no time at all. */
  asOf: string | null
  /** The server's relative label for `asOf` ("4m ago"), or null when `asOf` is null. */
  label: string | null
  /** Past the source's own freshness rule (lib/sports-data/freshnessPolicy.ts). */
  stale: boolean
  /** What to say when `asOf` is null — see `MissingMeaning`. */
  missingLabel: string
}

/**
 * What an absent time MEANS, which differs by source and changes the wording and the warning:
 *   'never-read' — we should hold a time and do not: a league never synced. Stale, and says so.
 *   'none-yet'   — nothing has happened to stamp: no scored week yet, no injury reported. Not a
 *                  fault, so no warning; "not read yet" there would accuse a read that did happen.
 */
export type MissingMeaning = 'never-read' | 'none-yet'

export function freshnessStamp(
  source: string,
  at: Date | string | null | undefined,
  now: Date,
  options: {
    /**
     * Judge staleness by this data class's rule. ONLY for a time that says when WE last read the
     * source (a league sync). A time that says when the thing itself happened — an injury report, a
     * scored week — is not stale for being old: last Sunday's score is still last Sunday's score.
     */
    staleRule?: DataClass
    missing?: MissingMeaning
  } = {},
): CardFreshnessStamp {
  const missing = options.missing ?? 'never-read'
  const missingLabel = missing === 'never-read' ? 'not read yet' : 'none yet'
  const date = toDate(at)
  if (!date) return { source, asOf: null, label: null, stale: missing === 'never-read', missingLabel }
  return {
    source,
    asOf: date.toISOString(),
    label: relativeAge(date.getTime(), now.getTime()),
    stale: options.staleRule ? isStale(options.staleRule, date, now) : false,
    missingLabel,
  }
}

/** The newest valid instant in a list — null when none parses. */
export function latestInstant(values: Iterable<Date | string | null | undefined>): Date | null {
  let latest: Date | null = null
  for (const value of values) {
    const date = toDate(value)
    if (date && (latest == null || date > latest)) latest = date
  }
  return latest
}

/**
 * "just now" / "4m ago" / "3h ago" / "2d ago". Shared by the server label and the client ticker so
 * the two never render the same instant differently. A time in the future (clock skew) reads as
 * "just now" rather than as a negative age.
 */
export function relativeAge(asOfMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - asOfMs) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86_400)}d ago`
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
