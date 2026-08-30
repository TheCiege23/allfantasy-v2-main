/**
 * Fold a stored position into the abbreviation fantasy lineups actually use.
 *
 * ⚠ `normalizePositionForSport` FOLDS ABBREVIATIONS AND NOTHING ELSE, so
 * "Quarterback" comes back as "QUARTERBACK" — which then becomes a slot label
 * and reads as a different position from the "QB" beside it. Measured on
 * production: 415 `Wide Receiver`, 216 `Running Back`, 135 `Quarterback`, so the
 * long spelling is the common case rather than an edge one.
 *
 * ⚠ IT WAS INVISIBLE UNTIL ESPN LINEUPS RESOLVED. Sleeper rosters happen to
 * carry abbreviations, so nothing hit this path; the moment the ESPN crosswalk
 * started resolving players through `SportsPlayer`, a My Team slot rendered
 * "WIDE RECEIVER" beside another reading "WR".
 *
 * ⚠ A PURE MODULE AND ONE COPY. `matchup.ts` and `myTeam.ts` render the SAME
 * lineup and must not disagree about what a slot is called — matchup.ts said so
 * in a comment while holding the only copy of the table. Both now read this.
 */

const LONG_POSITION: Record<string, string> = {
  QUARTERBACK: 'QB',
  'RUNNING BACK': 'RB',
  FULLBACK: 'RB',
  'WIDE RECEIVER': 'WR',
  'TIGHT END': 'TE',
  KICKER: 'K',
  'PLACE KICKER': 'K',
  PUNTER: 'P',
  LINEBACKER: 'LB',
  CORNERBACK: 'DB',
  SAFETY: 'DB',
  'DEFENSIVE END': 'DL',
  'DEFENSIVE TACKLE': 'DL',
  'OFFENSIVE TACKLE': 'OL',
  GUARD: 'OL',
  CENTER: 'OL',
  'DEFENSIVE BACK': 'DB',
  'DEFENSIVE LINEMAN': 'DL',
}

/** The long spelling folded to its abbreviation, or null when there is none. */
export function foldLongPosition(raw: string | null | undefined): string | null {
  const v = raw?.trim()
  if (!v) return null
  return LONG_POSITION[v.toUpperCase()] ?? null
}

/**
 * The abbreviation to render for a stored position.
 *
 * Returns the input upper-cased when it is already short or unrecognised —
 * an unfamiliar position is shown as given rather than dropped, because a
 * position we cannot fold is still information.
 */
export function displayPosition(raw: string | null | undefined): string | null {
  const v = raw?.trim()
  if (!v) return null
  return foldLongPosition(v) ?? v.toUpperCase()
}

/**
 * Slot labels in the order fantasy lineups conventionally read.
 *
 * ⚠ THE FALLBACK IS DELIBERATELY NEUTRAL. `SLOT 3` claims nothing; naming a
 * slot after whoever is standing in it names a FLEX after its occupant, and a
 * bench check run against that label then refuses every player who is in fact
 * eligible for it. The league's own template is the only honest source — see
 * `startingSlotTemplate` — and this is what runs when there is none.
 */
export function inferSlotLabel(position: string | null | undefined, index: number): string {
  const p = displayPosition(position) ?? ''
  if (['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DST'].includes(p)) return p === 'DST' ? 'DEF' : p
  return p || `SLOT ${index + 1}`
}
