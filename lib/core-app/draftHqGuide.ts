/**
 * The top of the cross-league Draft HQ (/core/draft-hq with no league held) in plain words (2026-11-13).
 * The owner's ask: users should know what the page is for. People open it to answer one question —
 * "does a draft need me right now?" — and the rows the board already loads (lib/core-app/draftHqAll.ts)
 * hold the answer: whose pick it is, which drafts are running, which have not started.
 *
 * Pure, so the rules are testable and the board stays a renderer.
 */
import type { DraftHqAllRow } from '@/lib/core-app/draftHqAll'

type Row = Pick<DraftHqAllRow, 'leagueName' | 'phase' | 'rawStatus' | 'yoursOnClock'> &
  Partial<Pick<DraftHqAllRow, 'yourSlot' | 'draftAt'>>

const isPaused = (r: Pick<DraftHqAllRow, 'rawStatus'>) => r.rawStatus === 'paused'

/**
 * ⚠ A PAUSED DRAFT IS NOT "YOUR PICK NOW", EVEN WITH YOU ON THE CLOCK. The timer is stopped, so nothing
 * is forcing a decision; the live board ranked one first in red ("ON CLOCK You") above a draft that
 * was genuinely running. It sorts with the running drafts and says it is paused.
 */
export function isYourPickNow(r: Pick<DraftHqAllRow, 'rawStatus' | 'yoursOnClock'>): boolean {
  return r.yoursOnClock && !isPaused(r)
}

/** Your pick first, then running (paused among them), then not started, then unreadable, then done. */
export function draftUrgency(r: Pick<DraftHqAllRow, 'phase' | 'rawStatus' | 'yoursOnClock'>): number {
  if (isYourPickNow(r)) return 0
  if (r.phase === 'live') return isPaused(r) ? 2 : 1
  if (r.phase === 'upcoming') return 3
  if (r.phase === 'unknown') return 4
  return 5
}

export type DraftHqHeadline =
  /** No draft on any of your leagues. */
  | { kind: 'none' }
  | { kind: 'yourPick'; league: string; n: number }
  /**
   * Running drafts, none of them on you. `known` is false when your slot in one of them cannot be read —
   * then the headline does not claim "not your pick". `pausedYours` names a paused draft where you pick next.
   */
  | { kind: 'running'; league: string; n: number; known: boolean; pausedYours: string | null }
  /** Nothing running, but a draft is paused. `yours` when the paused pick is yours. */
  | { kind: 'paused'; league: string; n: number; yours: boolean }
  /** Nothing running or paused; drafts that have not started. */
  | { kind: 'upcoming'; n: number }
  /** Every draft we can read is finished (or reads as an unrecognised status). */
  | { kind: 'allDone' }

/** Decided from EVERY row, not the ten the board shows — a headline must not depend on the cap. */
export function draftHqHeadline(rows: ReadonlyArray<Row>): DraftHqHeadline {
  const byName = (a: Row, b: Row) => a.leagueName.localeCompare(b.leagueName)
  const yours = rows.filter(isYourPickNow).sort(byName)
  if (yours.length > 0) return { kind: 'yourPick', league: yours[0]!.leagueName, n: yours.length }
  const running = rows.filter((r) => r.phase === 'live' && !isPaused(r)).sort(byName)
  const paused = rows.filter((r) => r.phase === 'live' && isPaused(r)).sort((a, b) => Number(b.yoursOnClock) - Number(a.yoursOnClock) || byName(a, b))
  /*
   * ⚠ A PAUSED DRAFT WHERE YOU PICK NEXT IS SAID EVEN WHEN ANOTHER DRAFT IS RUNNING (2026-11-13). The
   * live page read "KBI North Black is drafting — it's not your pick yet" over a paused draft whose card
   * said "On the clock: You": the running draft won the headline and the one waiting on you vanished.
   *
   * ⚠ AND "NOT YOUR PICK" IS ONLY SAID WHEN YOUR SLOT IS KNOWN. With your team missing from the order,
   * `yoursOnClock` is false by construction, not by measurement.
   */
  if (running.length > 0) {
    const pausedYours = paused.find((r) => r.yoursOnClock)?.leagueName ?? null
    const known = running.every((r) => r.yourSlot != null)
    return { kind: 'running', league: running[0]!.leagueName, n: running.length, known, pausedYours }
  }
  if (paused.length > 0) return { kind: 'paused', league: paused[0]!.leagueName, n: paused.length, yours: paused[0]!.yoursOnClock }
  const upcoming = rows.filter((r) => r.phase === 'upcoming').length
  if (upcoming > 0) return { kind: 'upcoming', n: upcoming }
  return rows.length > 0 ? { kind: 'allDone' } : { kind: 'none' }
}

type DraftGroups<R> = { yourPick: R[]; drafting: R[]; comingUp: R[]; finished: R[] }

/**
 * The board's sections, in urgency order, from the `limit` most urgent rows.
 *
 * Full cards are for drafts with a clock (your pick, drafting now); a draft that has not started or has
 * finished has nothing ticking, so it gets a one-line row — six stat boxes of "—" said nothing.
 */
/**
 * Within not-started drafts: the soonest dated draft first, then the undated (2026-11-13). Only an
 * AllFantasy league stores a draft date (`DraftHqAllRow.draftAt`); before this, eight undated rows in
 * alphabetical order could not say which draft came next.
 */
function byDate(a: Row, b: Row): number {
  const ta = a.draftAt ? Date.parse(a.draftAt) : Number.POSITIVE_INFINITY
  const tb = b.draftAt ? Date.parse(b.draftAt) : Number.POSITIVE_INFINITY
  return ta === tb ? 0 : ta < tb ? -1 : 1
}

export function groupDrafts<R extends Row>(rows: ReadonlyArray<R>, limit = 10): { groups: DraftGroups<R>; shown: number } {
  const ranked = [...rows]
    .sort((a, b) => draftUrgency(a) - draftUrgency(b) || (a.phase === 'upcoming' ? byDate(a, b) : 0) || a.leagueName.localeCompare(b.leagueName))
    .slice(0, limit)
  const groups: DraftGroups<R> = { yourPick: [], drafting: [], comingUp: [], finished: [] }
  for (const r of ranked) {
    if (isYourPickNow(r)) groups.yourPick.push(r)
    else if (r.phase === 'live') groups.drafting.push(r)
    else if (r.phase === 'done') groups.finished.push(r)
    else groups.comingUp.push(r)
  }
  return { groups, shown: ranked.length }
}
