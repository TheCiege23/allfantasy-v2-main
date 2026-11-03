/**
 * Sealed immunity (original league, gap report §11 P2 #11): an option to keep the individual
 * immunity winner hidden until every vote is in, then read it with the votes. Default off.
 *
 * Pure hooks — every surface that shows who is immune asks these rather than re-deriving the rule:
 *
 *  - `isImmunitySealed`: is the winner hidden right now? Only while the week's council is still
 *    taking votes (or has not opened yet). Once it closes the seal breaks and the read shows it.
 *  - `sealCouncilImmunity`: the council context while sealed. The immune managers STAY on every
 *    ballot (removing them would announce who is immune), the public "immune" list is empty, and the
 *    sealed ids are kept apart. Votes cast against them are marked `target_safe` in the read,
 *    because the tally runs after the close, when the seal is broken and immunity applies again.
 *
 * ⚠ When immunity goes to the week's top scorer, the public weekly scores already say who it is.
 * The seal is meant for an immunity a challenge awards (e.g. "closest without going over",
 * survivorClosestWithoutGoingOver.ts); it hides the announcement and the ballot, not the scores.
 *
 * For the challenge builder: when a challenge awards INDIVIDUAL immunity, call
 * `shouldDeferImmunityAnnouncement(sealedImmunity, councilStatus)` before posting "X won immunity";
 * when it is true, skip the post. The council close posts the deferred line
 * (survivorCouncilService.closeVoteWindow → postDeferredImmunityLines).
 */

export interface SealCouncilInput {
  status: string | null | undefined
  closedAt?: Date | string | null
  isRevealed?: boolean | null
}

const OPEN_STATUSES = new Set(['scheduled', 'voting_open'])

/** Hidden while the week's council has not opened yet or is still taking votes. */
export function isImmunitySealed(sealedImmunity: boolean, council: SealCouncilInput | null): boolean {
  if (!sealedImmunity) return false
  if (!council) return true
  if (council.isRevealed || council.closedAt) return false
  return OPEN_STATUSES.has(String(council.status ?? ''))
}

/** Whether a "won immunity" line should wait for the council close. */
export function shouldDeferImmunityAnnouncement(sealedImmunity: boolean, council: SealCouncilInput | null): boolean {
  return isImmunitySealed(sealedImmunity, council)
}

export interface SealedCouncilImmunity {
  /** Ids removed from eligibility (made safe). Empty while sealed. */
  safeImmuneUserIds: string[]
  /** What the public council context lists as immune. Empty while sealed. */
  publicImmuneUserIds: string[]
  /** Immune but hidden; for the tally and host views only. */
  sealedImmuneUserIds: string[]
}

export function sealCouncilImmunity(immuneUserIds: ReadonlyArray<string>, sealed: boolean): SealedCouncilImmunity {
  const ids = [...new Set(immuneUserIds)]
  return sealed
    ? { safeImmuneUserIds: [], publicImmuneUserIds: [], sealedImmuneUserIds: ids }
    : { safeImmuneUserIds: ids, publicImmuneUserIds: ids, sealedImmuneUserIds: [] }
}

/**
 * Redact an immunity list for a viewer while sealed. The winner may know they are immune (as a
 * hidden immunity holder would), and a non-playing host sees everything; everyone else sees none.
 */
export function redactImmunityList<T>(rows: ReadonlyArray<T>, sealed: boolean, keep: (row: T) => boolean): T[] {
  return sealed ? rows.filter(keep) : [...rows]
}
