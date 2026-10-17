import { injuryClaimAsOf } from '@/lib/injuries/matchInjuryRows'

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
 * The word itself is the newest CLAIM among rows still on a feed (`expiresAt`).
 *
 * Rows re-fetched more than a week before the freshest one belong to an
 * earlier episode (a June "Out" is not this week's) and are ignored. Pure.
 */

export type InjuryRowLike = {
  status: string | null
  description: string | null
  date: Date | null
  fetchedAt: Date
  /** When the feed's word lapses. A row past it is history: it dates an episode, it is not the word. */
  expiresAt?: Date | null
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

export function designationOnset(rows: readonly InjuryRowLike[], now: Date = new Date()): DesignationOnset | null {
  if (rows.length === 0) return null
  /*
   * 🛑 THE CURRENT WORD IS THE NEWEST *CLAIM* STILL ON A FEED (2026-10-11). This took the freshest
   * row by `fetchedAt` and never looked at `expiresAt`, so:
   *   - a player who dropped off every report kept his last "Out" for good — the feeds stop
   *     listing a healed player, they do not write him a clean row; and
   *   - Rolling Insights re-pulling Friday's "Questionable" every 30 minutes out-ranked ESPN's
   *     Sunday "Active", so a cleared starter flipped between the two with every cron run.
   * Expired rows still date the episode below; they just cannot be the word.
   */
  const sorted = [...rows].sort((a, b) => {
    const byClaim = injuryClaimAsOf(b).getTime() - injuryClaimAsOf(a).getTime()
    return byClaim !== 0 ? byClaim : b.fetchedAt.getTime() - a.fetchedAt.getTime()
  })
  const top = sorted.find((r) => !r.expiresAt || r.expiresAt.getTime() > now.getTime())
  if (!top) return null
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
