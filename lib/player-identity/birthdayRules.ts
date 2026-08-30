/**
 * What counts as a usable birthday for identity matching.
 *
 * ⚠ A PURE MODULE ON PURPOSE, AND EXTRACTED RATHER THAN COPIED. These two rules
 * decide whether a birthday may corroborate a name match, and
 * `matchProviderAthlete` treats an agreeing birthday as near decisive — so two
 * copies drifting apart would mean two callers disagreeing about who a player
 * is. They lived in `backfillCanonicalBirthdays.ts`, which imports prisma at
 * module scope; a second consumer that must stay prisma-free (see
 * `lib/espn/sleeperDobMap.ts`) therefore could not reach them at all, and in
 * this repo that failure surfaces as a 60-second worker timeout rather than a
 * readable error.
 *
 * `backfillCanonicalBirthdays` re-exports both, so its existing importers and
 * its own suite are untouched.
 */

/**
 * A `YYYY-MM-DD` string as a UTC-midnight Date, or null.
 *
 * Anything else is refused rather than coerced. `new Date('9/6/02')` succeeds and
 * means something different in two time zones, and a birthday that shifts by a day
 * is a birthday that stops matching.
 */
export function parseBirthday(value: string | null | undefined): Date | null {
  const raw = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const year = Number(raw.slice(0, 4))
  if (year < 1940 || year > 2015) return null
  const parsed = new Date(`${raw}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return null
  /* Reject a date that rolled over — '2001-02-30' parses to March 2nd. */
  if (parsed.toISOString().slice(0, 10) !== raw) return null
  return parsed
}

/**
 * True for a filler birthday, which must never corroborate a match.
 *
 * ⚠ MEASURED, NOT ASSUMED. Across 2,023 well-formed thesportsdb NFL birthdays,
 * Jan-1 dates average 3.17 players per date against 1.34 for every other day,
 * and `2001-01-01` alone carries 8. A filler birthday is worse here than no
 * birthday: eight players "agreeing" on it would hand the matcher eight
 * 0.95-confidence links between different people. The exclusion costs at most 19
 * rows, some of them genuine Jan-1 births, and that trade is only correct
 * because an agreeing birthday is near decisive — the same reason the rule is
 * worth having at all.
 */
export function isPlaceholderBirthday(value: string | null | undefined): boolean {
  return (
    String(value ?? '')
      .trim()
      .slice(5) === '01-01'
  )
}
