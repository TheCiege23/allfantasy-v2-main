/**
 * One `--since` parser and one centring tolerance, shared by the AF market-value writer and
 * its diagnosis probe.
 *
 * 🛑 THIS EXISTS BECAUSE THE PROBE SILENTLY ANSWERED A DIFFERENT QUESTION AND ITS PASS WAS
 * READ AS CLEARING THE WRITER'S FAIL. Measured 2026-09-06, minutes apart, same database:
 *
 *     recalculate-af-market-values-from-trades.ts --since 2025   FAIL  median +1.8%  n=2,081
 *     probe-af-market-values.ts                   --since 2025   PASS  median +0.2%  n=3,005
 *
 * The probe read `Number(process.argv[2]) || 2024`. Given `--since 2025`, `argv[2]` is the
 * literal string `"--since"`, `Number("--since")` is `NaN`, and it fell through to 2024 — so it
 * measured a season the caller never asked for and reported a healthy median for it. Nothing
 * threw. The only tell was `tradesUsed` disagreeing, which is easy to read past.
 *
 * ⚠ TWO IMPLEMENTATIONS OF ONE RULE IS THE BUG; A BETTER REGEX IN THE PROBE IS NOT THE FIX.
 * The repo already carries this lesson from the SQL copy of `normalizePlayerName` that
 * disagreed with the real one on 7.2% of rows. Deleting one implementation is what fixes it,
 * so both callers now import from here and there is no second parser to drift.
 *
 * ⚠ AND THE TOLERANCE IS HERE FOR THE SAME REASON. The probe hard-coded `1.5` beside the
 * writer's `CENTRING_TOLERANCE = 1.5`. They happened to agree; nothing made them agree, so a
 * change to the gate would have left the probe reporting PASS on a population the writer
 * refuses. A diagnosis tool that can disagree with the thing it diagnoses is worse than none.
 */

/**
 * How far the population median may sit from zero before the writer refuses to publish.
 *
 * Trades are zero-sum, so the adjustments must centre near 0. A non-centred population means
 * estimator bias, not a market that moved.
 *
 * ⚠ In practice this behaves as a SAMPLE-SIZE check: |median| shrinks monotonically as the
 * trade count grows (measured 2026-09-06 — 819 trades: -2.0%, 2,081: +1.8%, 3,005: +0.2%).
 * Widening the window is therefore the correct response to a FAIL, and narrowing it to "keep
 * the data recent" buys noise rather than recency.
 */
export const CENTRING_TOLERANCE = 1.5

/** Whether a median adjustment is centred enough for the writer to publish. */
export function isCentred(median: number | null | undefined): boolean {
  return median != null && Number.isFinite(median) && Math.abs(median) <= CENTRING_TOLERANCE
}

/**
 * Resolve the earliest season to include from a script's argv.
 *
 * Accepts three forms, so neither caller has to care which the operator typed:
 *
 *     --since 2024      flag and value as separate args
 *     --since=2024      flag and value joined
 *     2024              a bare positional year
 *
 * ⚠ A VALUE THAT IS NOT A PLAUSIBLE SEASON RETURNS THE FALLBACK RATHER THAN A NUMBER. That is
 * what the old probe got wrong: it coerced and kept going. `--since` followed by nothing, by
 * another flag, or by a typo must not silently become a season.
 *
 * ⚠ The bare-year form cannot capture a flag: `--write` is not a plausible season, so the
 * writer's `--write` positional is left alone and its behaviour is unchanged. The test suite
 * pins that, because it is the only reason this is safe to share.
 */
export function parseSinceSeason(
  argv: readonly string[],
  fallback: number | undefined = undefined,
): number | undefined {
  const plausible = (n: number): boolean => Number.isFinite(n) && Number.isInteger(n) && n > 2000 && n < 2100

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg == null) continue

    if (arg.startsWith('--since=')) {
      const n = Number(arg.slice('--since='.length))
      if (plausible(n)) return n
      return fallback
    }

    if (arg === '--since') {
      // The next arg is the value — but only if there IS one and it is a season.
      const n = Number(argv[i + 1])
      if (plausible(n)) return n
      return fallback
    }
  }

  // No flag anywhere. Fall back to the first bare positional that looks like a season.
  for (const arg of argv) {
    if (arg == null || arg.startsWith('-')) continue
    const n = Number(arg)
    if (plausible(n)) return n
  }

  return fallback
}
