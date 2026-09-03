/**
 * The single format-derivation rule for a league, extracted so it exists in exactly one place.
 *
 * ⚠ MIRRORS what `canonicalLeagueRules.ts` computed inline — that site now calls this function
 * instead of repeating the expression. Two independent implementations of one rule is a mistake
 * this repo has already paid for (see CLAUDE.md on the SQL/JS name-normalizer divergence); do not
 * let a second copy grow back here. Any new consumer that needs a league's format imports this.
 *
 * ⚠ THIS DERIVATION IS KNOWN TO DISAGREE WITH ITSELF ON REAL DATA, AND NOTHING HERE FIXES THAT.
 * Measured 2026-09-03: 4 of 270 production leagues carry `leagueType: 'redraft'` with
 * `isDynasty: true`. `leagueType` wins here (checked first), so those resolve to `'redraft'` with
 * `isDynasty` silently discarded — the same import defect already filed as BUG-4 against
 * `isDynasty`/`leagueType`. Every consumer of this function inherits that limitation identically;
 * none of them should independently invent a different tiebreak.
 */
export function deriveLeagueFormat(league: {
  leagueType?: string | null
  isDynasty?: boolean | null
}): string {
  const raw = league.leagueType
  return typeof raw === 'string' && raw.trim() ? raw : league.isDynasty ? 'dynasty' : 'redraft'
}
