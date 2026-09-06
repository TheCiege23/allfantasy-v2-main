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
 *
 * ⚠ THE OTHER SPORTS NOW HAVE THEIR OWN TABLES BELOW rather than being excluded. The constraint
 * above is unchanged and is why they are SEPARATE tables and not one shared one — see MLB's
 * `CENTER`, which folds to `CF` where the identical word folds to `C` in NBA and NHL.
 *
 * ⚠ ONE CLAIM ABOVE WAS TRUE WHEN WRITTEN AND IS NOW STALE: "NBA has no plain `G`". Production
 * 2026-09-06 carries NBA `G` (61) and `F` (20), both from rolling_insights. So `Guard` -> `G` and
 * `Forward` -> `F` land on codes that already exist and create no third vocabulary. Re-measured
 * rather than inherited, which is the only reason the NBA table includes them.
 */

/**
 * NBA. Existing codes measured on production: SG 400 · PG 383 · PF 380 · SF 294 · C 292 · G 61 ·
 * F 20 · FC 2. Every target below is one of those.
 */
const NBA_POSITION_CODE: Record<string, string> = {
  'POINT GUARD': 'PG',
  'SHOOTING GUARD': 'SG',
  'SMALL FORWARD': 'SF',
  'POWER FORWARD': 'PF',
  CENTER: 'C',
  CENTRE: 'C',
  GUARD: 'G',
  FORWARD: 'F',
  'FORWARD/CENTER': 'FC',
}

/**
 * NHL. Existing codes: D 1334 · C 991 · LW 685 · RW 634 · G 471.
 *
 * 🛑 `WING`, `WINGER` AND `FORWARD` ARE DELIBERATELY ABSENT. A winger is LW or RW and the raw
 * value does not say which — folding it would INVENT the side. And NHL stores no `F` at all, so
 * `Forward` (105 rows) has nowhere to land: folding it would create the third vocabulary this
 * module exists to prevent. They stay long-form, which is honest about what the provider sent.
 */
const NHL_POSITION_CODE: Record<string, string> = {
  CENTER: 'C',
  CENTRE: 'C',
  DEFENCEMAN: 'D',
  DEFENSEMAN: 'D',
  DEFENSE: 'D',
  DEFENCE: 'D',
  DEFENDER: 'D',
  'LEFT WING': 'LW',
  'LEFT WINGER': 'LW',
  'RIGHT WING': 'RW',
  'RIGHT WINGER': 'RW',
  GOALTENDER: 'G',
  GOALIE: 'G',
  // Unambiguous inside NHL even though it is the soccer word; the sport gate is what makes it so.
  GOALKEEPER: 'G',
}

/**
 * MLB. Existing codes: P 3375 · C 627 · SS 593 · 2B 444 · CF 400 · OF 395 · 3B 384 · 1B 372 ·
 * LF 323 · RF 304 · DH 52 · IF 47.
 *
 * 🛑 `CENTER` -> `CF`, NOT `C`. THIS IS THE ENTIRE REASON THESE TABLES ARE PER-SPORT. In MLB
 * "Center" is a centre FIELDER; `C` is the catcher, and 627 rows already hold it. The shared
 * football table would have relabelled outfielders as catchers — a wrong value that looks valid.
 *
 * 🛑 `STARTING PITCHER` AND `RELIEF PITCHER` ARE DELIBERATELY ABSENT. MLB stores no `SP` or `RP`
 * here, so the only available target is `P` — which unifies the query but DESTROYS the role
 * distinction on 111 rows. Losing information is not the same as unifying a spelling, and this
 * module only does the latter. Left for a product decision.
 */
const MLB_POSITION_CODE: Record<string, string> = {
  PITCHER: 'P',
  CATCHER: 'C',
  SHORTSTOP: 'SS',
  'FIRST BASE': '1B',
  'FIRST BASEMAN': '1B',
  'SECOND BASE': '2B',
  'SECOND BASEMAN': '2B',
  'THIRD BASE': '3B',
  'THIRD BASEMAN': '3B',
  OUTFIELDER: 'OF',
  INFIELDER: 'IF',
  'LEFT FIELDER': 'LF',
  'RIGHT FIELDER': 'RF',
  'CENTER FIELDER': 'CF',
  'CENTRE FIELDER': 'CF',
  CENTER: 'CF',
  CENTRE: 'CF',
  'DESIGNATED HITTER': 'DH',
}

/**
 * Sport -> its own table. A sport absent from this map folds NOTHING, which makes the gate
 * structural rather than a condition someone has to remember to write.
 */
const POSITION_CODE_BY_SPORT: Record<string, Record<string, string>> = {
  NFL: PROVIDER_POSITION_CODE,
  NCAAF: PROVIDER_POSITION_CODE,
  NBA: NBA_POSITION_CODE,
  NHL: NHL_POSITION_CODE,
  MLB: MLB_POSITION_CODE,
}

/**
 * Exported for one purpose: the "no third vocabulary" test iterates each sport's REAL targets
 * and checks them against what that sport already stores.
 *
 * ⚠ THAT TEST USED TO REGEX-SCRAPE THIS FILE, which worked while there was one table and broke
 * the moment there were four — it began checking NBA and MLB targets against the NFL code set.
 * A source scrape is a proxy for the mapping; this is the mapping. Not for runtime use.
 */
export const POSITION_CODE_TABLES_FOR_TEST: Readonly<Record<string, Readonly<Record<string, string>>>> =
  POSITION_CODE_BY_SPORT

/** The table for a sport, or null when that sport has none. */
function tableFor(sport: string | null | undefined): Record<string, string> | null {
  return POSITION_CODE_BY_SPORT[(sport ?? '').trim().toUpperCase()] ?? null
}

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
  const table = tableFor(sport)
  if (!table) return v
  return table[v.toUpperCase()] ?? v
}

/** True when this raw value, for this sport, is a display name the table can fold. */
export function isLongFormPosition(
  raw: string | null | undefined,
  sport: string | null | undefined,
): boolean {
  const v = raw?.trim()
  if (!v) return false
  const table = tableFor(sport)
  if (!table) return false
  return v.toUpperCase() in table
}
