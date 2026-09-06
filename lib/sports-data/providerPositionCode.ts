/**
 * Fold a PROVIDER'S display-name position into the code the rest of the table uses.
 *
 * 🛑 THE PROBLEM THIS EXISTS FOR, MEASURED ON PRODUCTION 2026-09-06. `SportsPlayer.position`
 * carries two vocabularies at once, and both are being written today:
 *
 *     source            short code   long name   newest
 *     thesportsdb              143       2,081   2026-09-04
 *     sleeper               11,718         242   2026-09-04
 *     rolling_insights       9,521          40   2026-09-04
 *
 * TheSportsDB emits `strPosition` as English display names — 414 `Wide Receiver`,
 * 273 `Offensive Tackle`, 216 `Running Back` — and `theSportsDbIngest` stored it verbatim.
 * Sleeper and Rolling Insights emit codes. So a filter as ordinary as
 * `position in ('QB','RB','WR','TE')` silently drops ~40% of NFL players, and 265 of the
 * long-form rows carry a value snapshot, meaning they are inside the trade-grading
 * population rather than off in an unused corner.
 *
 * 🛑 THIS IS NOT `foldLongPosition` FROM lib/core-app/positionLabels.ts, AND THE DIFFERENCE
 * IS THE WHOLE REASON A SECOND TABLE IS JUSTIFIED. That one answers "what should this SLOT
 * be labelled" and folds toward lineup groupings — `CORNERBACK -> DB`, `SAFETY -> DB`,
 * `DEFENSIVE END -> DL`. Applying it here would convert one inconsistency into another:
 * Sleeper already stores `CB` (1,525), `S` (255) and `DE` (1,051) as distinct codes, so
 * folding TheSportsDB's `Cornerback` to `DB` would leave the column split a different way
 * and destroy specificity the other providers preserve — which the IDP stack needs, because
 * its curve is about ORDERING within a position, not spread across a grouping.
 *
 * ⚠ SO THE TARGET VOCABULARY WAS MEASURED, NOT INVENTED. Every code below is one Sleeper or
 * Rolling Insights already writes for NFL, counted on production:
 *
 *     WR 3147 · LB 2405 · DB 1915 · RB 1635 · CB 1525 · TE 1498 · DE 1051 · DT 1043
 *     OT 977 · DL 886 · QB 818 · OL 609 · G 585 · C 502 · K 280 · OLB 271 · P 263
 *     S 255 · LS 233 · SS 187 · FB 176 · FS 163 · ILB 151 · NT 104
 *
 * A mapping to a code nobody else stores would create a THIRD vocabulary, which is the
 * failure this module exists to end.
 */

/**
 * Display name (upper-cased, trimmed) -> the code the other providers store.
 *
 * ⚠ Deliberately does NOT include grouping words that are already codes elsewhere
 * (`DEFENSIVE BACK`, `DEFENSIVE LINEMAN`, `OFFENSIVE LINEMAN`) — those map to DB/DL/OL,
 * which are themselves real stored codes, so they are listed rather than assumed.
 */
const PROVIDER_POSITION_CODE: Record<string, string> = {
  QUARTERBACK: 'QB',
  'RUNNING BACK': 'RB',
  FULLBACK: 'FB',
  /*
   * ⚠ A SECOND KEY RATHER THAN A HYPHEN-STRIPPING RULE — and the honest reason is precedent,
   * not danger. A rule would ALSO be safe here (`Co-Driver` normalises to `CODRIVER`, still
   * not a key, still returned unchanged). It is not used because this table enumerates the
   * variants it has actually measured — PLACEKICKER beside PLACE KICKER is the same call —
   * and football stores exactly ONE hyphenated position, so a rule would be generalising
   * from a single observation.
   *
   * ⚠ AND IT IS A FOOTBALL FULLBACK, WHICH WAS CHECKED RATHER THAN ASSUMED — `Full-back` is
   * also the standard soccer term for a defender, the same trap as MLB's `Center` meaning
   * centre FIELDER. All 7 rows on production 2026-09-06 are NFL and named: Kyle Juszczyk,
   * Patrick Ricard, Reggie Gilliam, Robbie Ouzts, Ben VanSumeren, Lucas Scott, Nikola
   * Kalinic. `Full-back` appears in NO other sport, so there is nothing to collide with.
   */
  'FULL-BACK': 'FB',
  'WIDE RECEIVER': 'WR',
  'TIGHT END': 'TE',
  KICKER: 'K',
  'PLACE KICKER': 'K',
  PLACEKICKER: 'K',
  PUNTER: 'P',
  'LONG SNAPPER': 'LS',

  LINEBACKER: 'LB',
  'OUTSIDE LINEBACKER': 'OLB',
  'INSIDE LINEBACKER': 'ILB',
  'MIDDLE LINEBACKER': 'ILB',

  CORNERBACK: 'CB',
  SAFETY: 'S',
  'FREE SAFETY': 'FS',
  'STRONG SAFETY': 'SS',
  'DEFENSIVE BACK': 'DB',

  'DEFENSIVE END': 'DE',
  'DEFENSIVE TACKLE': 'DT',
  'NOSE TACKLE': 'NT',
  'DEFENSIVE LINEMAN': 'DL',

  'OFFENSIVE TACKLE': 'OT',
  TACKLE: 'OT',
  GUARD: 'G',
  'OFFENSIVE GUARD': 'OG',
  CENTER: 'C',
  'OFFENSIVE LINEMAN': 'OL',
}

/**
 * 🛑 THE TABLE IS FOOTBALL-ONLY, AND THAT IS A MEASURED CONSTRAINT, NOT CAUTION.
 *
 * The same English words mean different positions in different sports, and applying this
 * table outside football silently mislabels players. Found on production before shipping,
 * by checking what each sport ALREADY stores rather than assuming the words transfer:
 *
 *   🛑 MLB stores `C` = CATCHER (627 rows). MLB also has 2 players stored as "Center",
 *      meaning centre FIELDER. Folding those to `C` would relabel two outfielders as
 *      catchers — a wrong value that looks entirely valid.
 *   🛑 NBA has no plain `G`. It stores `PG` (370) and `SG` (383). Folding NBA's 19 "Guard"
 *      rows to `G` would invent a third vocabulary in the column this module exists to
 *      unify.
 *   ✓ NHL "Center" (269) -> `C` happens to be right, and NBA "Center" (85) -> `C` too — but
 *      "right by coincidence in two sports" is not evidence for the third, which is exactly
 *      how the MLB case would have shipped.
 *
 * NCAAF is included: its long forms are all football words (Quarterback, Cornerback, Wide
 * Receiver, Offensive Lineman) and it shares the NFL code set.
 */
const FOLDABLE_SPORTS = new Set(['NFL', 'NCAAF'])

/**
 * The stored code for a provider's raw position string, for a given sport.
 *
 * ⚠ AN UNRECOGNISED VALUE IS RETURNED UNCHANGED, NOT DROPPED AND NOT GUESSED. A position we
 * cannot map is still information — a player stored with an odd position is findable, while
 * a player stored with `null` is invisible to every position query. Returning the input also
 * makes this safe to apply to sources that already emit codes: `WR` is not in the table, so
 * it comes back as `WR`.
 *
 * ⚠ A NON-FOOTBALL SPORT IS RETURNED UNCHANGED for the same reason: leaving NHL's "Center"
 * as-is keeps one sport's column slightly split, while folding it with a football table
 * risks a confidently wrong value in another.
 */
export function providerPositionCode(
  raw: string | null | undefined,
  sport: string | null | undefined,
): string | null {
  const v = raw?.trim()
  if (!v) return null
  if (!FOLDABLE_SPORTS.has((sport ?? '').trim().toUpperCase())) return v
  return PROVIDER_POSITION_CODE[v.toUpperCase()] ?? v
}

/** True when this raw value, for this sport, is a display name the table can fold. */
export function isLongFormPosition(
  raw: string | null | undefined,
  sport: string | null | undefined,
): boolean {
  const v = raw?.trim()
  if (!v) return false
  if (!FOLDABLE_SPORTS.has((sport ?? '').trim().toUpperCase())) return false
  return v.toUpperCase() in PROVIDER_POSITION_CODE
}
