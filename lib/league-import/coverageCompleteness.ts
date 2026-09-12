import type { ImportCoverageBucket } from './types'

/**
 * Deciding `full` vs `partial` against an INDEPENDENT expected count.
 *
 * 🛑 `rows.length > 0 ? 'full' : 'missing'` CANNOT TELL SOME FROM ALL.
 *
 * Eight of the coverage buckets across four adapters were written that way, so
 * a standings table with eight of twelve teams reported `full`. The coverage
 * block is what the nav gating and the import banner both read, so a partial
 * import was presented as a whole one — and the user's only signal that
 * anything was missing was the missing thing itself.
 *
 * ⚠ AND THE OBVIOUS FIX IS A TAUTOLOGY IN MOST OF THESE ADAPTERS.
 *
 * Sleeper compares `history.standings.length === rosterCount`, which is a real
 * check because those two are built from different parts of the payload. Copying
 * that shape into ESPN, Yahoo or MFL would prove nothing: there
 * `standings = raw.teams.map(...)`, so its length equals the team count BY
 * CONSTRUCTION and the comparison always agrees with itself. That is the same
 * circular check already caught in `FleaflickerAdapter` — a measurement in shape
 * only, which is worse than the naive version because it looks rigorous.
 *
 * So the comparison here is against a count the PROVIDER declared separately —
 * `league.size` (ESPN, MFL, Fleaflicker) or `league.numTeams` (Yahoo) — which is
 * genuinely independent of how many team rows came back.
 *
 * ⚠ WHEN THERE IS NO INDEPENDENT COUNT, SAY SO RATHER THAN GUESS. An absent or
 * nonsensical declared size yields `partial` with a named reason, never `full`.
 * "Could not verify" and "verified complete" are different answers, and only one
 * of them should let a surface present the data as whole.
 */
export function coverageAgainstExpected(args: {
  /** How many rows actually came back. */
  actual: number
  /**
   * How many the provider says there should be — from a DIFFERENT field than
   * the rows were derived from. Pass null when the provider does not declare it;
   * do not pass a value computed from `actual`, which is the tautology above.
   */
  expected: number | null | undefined
  /** Plural noun for the note, e.g. "teams". */
  unit: string
}): ImportCoverageBucket {
  const { actual, unit } = args
  const expected =
    typeof args.expected === 'number' && Number.isFinite(args.expected) && args.expected > 0
      ? Math.floor(args.expected)
      : null

  if (actual <= 0) return { state: 'missing', count: 0 }

  if (expected == null) {
    return {
      state: 'partial',
      count: actual,
      note: `The provider did not report how many ${unit} to expect, so completeness could not be verified.`,
    }
  }

  if (actual >= expected) return { state: 'full', count: actual }

  return {
    state: 'partial',
    count: actual,
    note: `Covers ${actual} of ${expected} ${unit}.`,
  }
}

/**
 * The coverage for a collection that is LEGITIMATELY ALLOWED TO BE EMPTY.
 *
 * 🛑 ZERO TRADES IS A NORMAL LEAGUE STATE AND WAS BEING REPORTED AS A FAILURE.
 *
 * Every adapter wrote `transactions.length > 0 ? … : 'missing'`, so a league that
 * simply has not traded yet — which is most leagues in September — was treated
 * identically to one whose trade history could not be retrieved.
 *
 * ⚠ AND `missing` IS NOT A COSMETIC LABEL HERE. It drives two things in
 * `summarizeImportCoverage`: the `trades` capability flips false, which REMOVES
 * THE TRADES TAB, and the banner reads "<Provider> doesn't publish trade
 * history, so those aren't available for this league." That sentence is FALSE
 * for Sleeper, ESPN, Yahoo and MFL — all four publish it. The league just has
 * none. So the product told users their platform lacked a feature it has, and
 * took away the screen that would have shown it was empty.
 *
 * An empty result is complete when the fetch succeeded: nothing is missing.
 *
 * ⚠ THE THREE-VALUED `fetched` IS THE POINT, NOT AN AFFECTATION. Only ESPN
 * (`transactionsFetched`) and Sleeper (an OPTIONAL `transactions` field, where
 * `undefined` means the provider was never asked — the same idiom its adapter
 * already uses for `tradedPicks`) can distinguish a real empty from an unasked
 * one. Yahoo, MFL and Fantrax type it as a required array, so `[]` is genuinely
 * ambiguous and `null` is the honest answer: `partial` keeps the tab and says
 * so, rather than asserting either completeness or provider failure.
 */
export function emptyableHistoryCoverage(args: {
  /** `true` fetched, `false` known not fetched, `null` cannot tell. */
  fetched: boolean | null
  /** Plural noun for the note, e.g. "trades". */
  unit: string
}): ImportCoverageBucket {
  if (args.fetched === true) {
    return { state: 'full', count: 0, note: `This league has no ${args.unit} yet.` }
  }
  if (args.fetched === false) {
    return { state: 'missing', count: 0 }
  }
  return {
    state: 'partial',
    count: 0,
    note: `No ${args.unit} came across, and this provider does not say whether that means none exist or none were retrieved.`,
  }
}
