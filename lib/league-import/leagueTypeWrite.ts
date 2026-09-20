/**
 * Whether an import may write `League.leagueType`, and what value.
 *
 * 🛑 THE COLUMN CANNOT TELL A CLASSIFICATION FROM A SHRUG. `leagueType` is
 * `@default("redraft")`, and `inferLeagueConceptFromNormalized` also returns `'redraft'`
 * when every signal it has comes up empty — no source-reported type, not dynasty, not best
 * ball, and no name match in `heuristicConceptFromSignals`. Those two `'redraft'`s are the
 * same seven characters, so once written nothing downstream can separate "this is a redraft
 * league" from "we could not tell".
 *
 * That is only a labelling problem on a FIRST import, where the fallback is the best answer
 * available and there is nothing to lose. It is a data-loss problem on a re-import, because
 * the stored value was produced by a run that was at least as informed as this one — and may
 * have been corrected by a human since.
 *
 * ⚠ MEASURED, NOT HYPOTHETICAL. On 2026-09-20 "🪓 Elimination Station 2" was a guillotine
 * league — 18 matchup groups of one roster each, `avg(pointsAgainst) = 0.00` — stored as
 * `redraft`, because its name contains neither "guillotine" nor "survivor" and nothing else
 * in the import says so. Correcting the column by hand would have held only until the next
 * sync of that league overwrote it again.
 *
 * ⚠ AND THE REPAIR IS NOT A BIGGER NAME REGEX, WHICH THE SAME MEASUREMENT RULES OUT. The
 * name heuristic is wrong in BOTH directions on that account: three leagues carrying
 * "Guillotine" in the name play ordinary head-to-head schedules (`avg(pointsAgainst)` 5.93,
 * 6.09, 6.21). Adding `elimination|chopped` would catch a few more and mislabel those three.
 * A name is not evidence about a format; refusing to overwrite is the fix that does not
 * depend on guessing better.
 *
 * Returning `undefined` is deliberate: Prisma omits an `undefined` key entirely, so the
 * stored value is left alone rather than being overwritten with null.
 */
export function leagueTypeForUpdate(args: {
  /**
   * Whether a league row already exists. False on a first import, where there is nothing to
   * protect and the fallback is the best answer we have.
   */
  existing: boolean
  leagueTypeColumn: string | null | undefined
  /** See `CanonicalImportBundle.leagueTypeConfident`. */
  leagueTypeConfident: boolean | undefined
}): string | undefined {
  const column =
    typeof args.leagueTypeColumn === 'string' && args.leagueTypeColumn.trim()
      ? args.leagueTypeColumn
      : undefined
  if (!column) return undefined

  /*
   * ⚠ `undefined` CONFIDENCE IS TREATED AS UNCONFIDENT, AND ONLY WHEN A LEAGUE EXISTS.
   * A caller that has not been updated to pass the flag would otherwise keep overwriting,
   * which is the bug this exists to stop — so the safe reading is the default. It costs
   * nothing on a first import, where the value is written regardless.
   */
  if (args.existing && args.leagueTypeConfident !== true) return undefined

  return column
}
