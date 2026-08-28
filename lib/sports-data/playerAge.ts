/**
 * Turn whatever a vendor put in an `age` field into an actual age, or nothing.
 *
 * Every provider ingest reached for its own ad-hoc parse and each failed differently: one stripped
 * a date to digits, one passed the vendor's value straight through unchecked, one validated but
 * with a bound so loose it admitted a five-year-old. This is the single coercion they now share,
 * so a vendor changing shape produces a NULL rather than a number that means nothing.
 *
 * The worked example below is Rolling Insights, because it was the total failure.
 *
 * ⚠ THE FIELD IS NOT AN AGE, AND THE INGEST TURNED IT INTO A NUMBER THAT LOOKS LIKE ONE.
 * `rollingInsightsTeamsPlayers` stored it with a generic `intOf`, which does
 * `Number.parseInt(s.replace(/[^0-9-]/g, ''))` — it strips every separator and keeps the digits.
 * Applied to a birthdate that produces a plausible-looking integer with no separators left:
 *
 *     "2/9/1996"  ->  291996
 *     "1/1/1994"  ->  111994
 *
 * Measured on production 2026-08-28: **all 13,763** Rolling Insights rows carrying an age held an
 * impossible value (9,550 NFL, 4,213 SOCCER), against 0.0% for Sleeper and 0.6% for TheSportsDB.
 * Nothing rejected it because 291996 is a perfectly good integer.
 *
 * ⚠ ONLY THE YEAR SURVIVES, AND THAT IS WHY THIS RETURNS AN AGE RATHER THAN A DATE. The separator
 * positions are gone and the day and month are variable-width, so `41988` is `4/19/88` or
 * `4/1/988` or `4/1988` with no way to choose. The last four digits are recoverable: checked
 * against Sleeper's own age across 3,091 known-good pairs, `(thisYear - last4) - sleeperAge` lands
 * on 0 or 1 for 93.9% of them — the bimodal 0/1 split being exactly what a correct birth year
 * looks like, depending on whether the birthday has passed. The remaining 6% skew positive, which
 * is the signature of a stale age on the OTHER side rather than a bad extraction.
 *
 * So the age this returns is accurate to ±1 year. That is a real limitation and callers doing
 * anything finer than a rookie heuristic or an age curve should know it — but it replaces a column
 * that was 100% garbage, which is not a close comparison.
 */

/** Nobody in these leagues was born before this, and nobody younger than 14 is on a roster. */
const EARLIEST_BIRTH_YEAR = 1930
const MIN_PLAUSIBLE_AGE = 14
const MAX_PLAUSIBLE_AGE = 60

/**
 * Best-effort age from whatever Rolling Insights put in the field.
 *
 * Handles three shapes, in order: a value that is ALREADY a sane age; a parseable date; and the
 * separator-stripped digits left behind by the old ingest. The third is what the repair reads.
 * Returns null rather than guessing — an unknown age is honest, and a wrong one silently
 * mis-tiers a player in every age curve that reads it.
 */
export function coercePlayerAge(
  raw: unknown,
  now: Date = new Date(),
): number | null {
  if (raw == null) return null
  const thisYear = now.getUTCFullYear()

  // 1. Already an age. Nothing to recover.
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw >= MIN_PLAUSIBLE_AGE && raw <= MAX_PLAUSIBLE_AGE) return Math.trunc(raw)
  }

  const s = String(raw).trim()
  if (!s) return null

  const asNumber = Number(s)
  if (Number.isFinite(asNumber) && asNumber >= MIN_PLAUSIBLE_AGE && asNumber <= MAX_PLAUSIBLE_AGE) {
    return Math.trunc(asNumber)
  }

  /*
   * 2. A real date, which is what the vendor appears to send. Parsed before the digit fallback so
   *    a correctly-shaped value never goes through the lossy path.
   */
  if (/[^0-9]/.test(s)) {
    const parsed = Date.parse(s)
    if (Number.isFinite(parsed)) {
      const year = new Date(parsed).getUTCFullYear()
      const age = thisYear - year
      if (year >= EARLIEST_BIRTH_YEAR && age >= MIN_PLAUSIBLE_AGE && age <= MAX_PLAUSIBLE_AGE) return age
    }
  }

  /*
   * 3. The stripped digits. The last four are the year; everything before them is an unrecoverable
   *    day and month. Requires at least five digits, so a bare four-digit year is not mistaken for
   *    one of these and a two-digit age is not read as a year.
   */
  const digits = s.replace(/[^0-9]/g, '')
  if (digits.length >= 5) {
    const year = Number(digits.slice(-4))
    const age = thisYear - year
    if (year >= EARLIEST_BIRTH_YEAR && age >= MIN_PLAUSIBLE_AGE && age <= MAX_PLAUSIBLE_AGE) return age
  }

  return null
}

/**
 * The birth DATE, when the vendor actually sent one.
 *
 * Generic, though only the Rolling Insights ingest needs it today — it is the one whose date was
 * arriving and being destroyed before anything could store it.
 *
 * ⚠ THE INGEST HAS BEEN DISCARDING THIS EVERY SYNC. `dob` is written from `p.dob ?? p.birth_date
 * ?? p.date_of_birth` and is populated on 5 of 9,563 NFL rows — the vendor does not use those
 * keys, it puts the date in `age`. So the full date arrives, `intOf` strips it to digits, and the
 * month and day are gone by the time anything could have stored them. Capturing it here means the
 * loss stops at this sync rather than continuing, and a later backfill can compute an exact age
 * for every row ingested from now on.
 *
 * Returns an ISO `YYYY-MM-DD`, or null when the value is not a date — a bare age is not one.
 */
export function birthDateFromVendorValue(raw: unknown): string | null {
  if (raw == null) return null
  const s = String(raw).trim()
  // No separators means the date is already destroyed, or it was never a date.
  if (!s || !/[^0-9]/.test(s)) return null
  const parsed = Date.parse(s)
  if (!Number.isFinite(parsed)) return null
  const d = new Date(parsed)
  const year = d.getUTCFullYear()
  if (year < EARLIEST_BIRTH_YEAR || year > new Date().getUTCFullYear()) return null
  return d.toISOString().slice(0, 10)
}
