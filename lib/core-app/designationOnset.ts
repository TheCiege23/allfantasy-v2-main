/**
 * One injury claim from several provider rows: the freshest row's word, and
 * the EARLIEST time any row of the same episode said that word.
 *
 * ⚠ THE FRESHEST ROW IS NOT WHEN IT WAS SAID. `SportsInjury` keeps one row per
 * (player, source). During a game window the alert sweep re-folds Sleeper's
 * live blob every five minutes (source `sleeper_live`), so that row is always
 * the freshest by `fetchedAt` and, until 2026-09-06, carried no `date` at all —
 * so a card that took the freshest row lost ESPN's report time the moment the
 * fold started, and an Out ruled on Friday looked like Sunday news. The fold
 * now records when it FIRST saw a designation (liveStatusFold.ts), and this
 * helper takes the earliest `date` across rows that carry the SAME designation
 * — ESPN's Friday 4:31p for a Friday ruling; the fold's 11:32a for a scratch
 * that no other feed has caught up with. The description comes from the first
 * row of that designation that states one, since the live blob states none.
 *
 * Rows re-fetched more than a week before the freshest one belong to an
 * earlier episode (a June "Out" is not this week's) and are ignored. Pure.
 */

export type InjuryRowLike = {
  status: string | null
  description: string | null
  date: Date | null
  fetchedAt: Date
}

export type DesignationOnset = {
  status: string | null
  description: string | null
  /** The earliest report of the current designation; null when no row of it carries a date. */
  reportedAt: Date | null
}

export const SAME_EPISODE_HOURS = 7 * 24

/** The designation reduced to comparable words — "Out", "OUT" and "Out." are one. */
export function designationKey(status: string | null | undefined): string {
  return (status ?? '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function designationOnset(rows: readonly InjuryRowLike[]): DesignationOnset | null {
  if (rows.length === 0) return null
  const sorted = [...rows].sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime())
  const top = sorted[0]!
  const key = designationKey(top.status)
  const cutoff = top.fetchedAt.getTime() - SAME_EPISODE_HOURS * 60 * 60 * 1000
  let reportedAt = top.date
  let description = top.description?.trim() ? top.description : null
  for (const r of sorted) {
    if (r.fetchedAt.getTime() < cutoff) continue
    if (designationKey(r.status) !== key) continue
    if (r.date && (!reportedAt || r.date.getTime() < reportedAt.getTime())) reportedAt = r.date
    if (!description && r.description?.trim()) description = r.description
  }
  return { status: top.status, description, reportedAt }
}
