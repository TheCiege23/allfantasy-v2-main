import { designationKey } from './designationOnset'

/**
 * The injury timeline beside a player's status on the card: which designation he had before this one
 * (so "Questionable" reads as trending up from Out, or down from healthy), and ESPN's estimated return.
 * The current designation and when it started are the card's own (designationOnset.ts); this only adds
 * what came before it and what is expected next.
 *
 * Pure, client-safe. Built in playerFinder.ts from the same guarded injury rows the card trusts.
 *
 * ⚠ NO PRACTICE CODES. "DNP Wed / LP Thu" was the idea; measured 2026-09-29, practice participation is
 * stored nowhere — `injury_reports.practice` is empty on all 901 rows this season and
 * `sports_core_injury_reports` holds none. ESPN's comments sometimes MENTION practice in free text, and
 * parsing prose into a status would be inventing a fact, so the timeline says nothing about practice.
 *
 * ⚠ AN ESTIMATE IS LABELLED AS ONE, WITH ITS SOURCE. ESPN's `details.returnDate` is a projection (for IR
 * it is usually the eligibility date), so it reads "ESPN est. return", only while it is still ahead, and
 * only from a row of the current episode. Measured: 332 of 423 currently hurt NFL players carry one.
 */

export type TimelineRow = {
  status: string | null
  date: Date | null
  fetchedAt: Date
  source: string
  /** ESPN `raw.details.returnDate`, YYYY-MM-DD, when the row carries one. */
  returnDate: string | null
}

export type InjuryTimeline = {
  /** The designation before the current one, and the last day it was reported. */
  previous: { status: string; lastReported: string } | null
  /** Better (up) or worse (down) than before; null when there is no previous or they rank the same. */
  trend: 'up' | 'down' | null
  /** ESPN's estimated return, YYYY-MM-DD, still ahead. */
  estReturn: string | null
}

/** How far back a previous designation is still part of this story. */
export const PREVIOUS_WINDOW_DAYS = 21
/** Rows fetched this long before the freshest belong to another episode (designationOnset's rule). */
const EPISODE_MS = 7 * 86_400_000

/** A designation's severity: healthy 0 … season-ending lists 4. Null when the word is not one we rank. */
export function severity(status: string | null | undefined): number | null {
  const k = designationKey(status)
  if (!k) return null
  if (/^(active|healthy|probable|full)/.test(k)) return 0
  // Feeds spell the same designation differently ("Q", "Questionable"): the short forms rank the same.
  if (/^(questionable|q$|day to day|dtd|game time)/.test(k)) return 1
  if (/^(doubtful|d$)/.test(k)) return 2
  if (/^out/.test(k)) return 3
  if (/^(injured reserve|ir\b|ir$|pup|physically unable|reserve|suspended|sus$|nfi|non football)/.test(k)) return 4
  return null
}

const day = (d: Date) => d.toISOString().slice(0, 10)

/** ESPN's `details.returnDate` from a raw injury row, when it is a plain YYYY-MM-DD. */
export function espnReturnDate(raw: unknown): string | null {
  const details = raw && typeof raw === 'object' ? (raw as { details?: unknown }).details : null
  const v = details && typeof details === 'object' ? (details as { returnDate?: unknown }).returnDate : null
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

/** The timeline from `SportsInjury` rows as selected (raw included) — what playerFinder.ts calls. */
export function injuryTimelineFromRows(args: {
  rows: ReadonlyArray<{ status: string | null; date: Date | null; fetchedAt: Date; source: string; raw: unknown }>
  current: { status: string | null; reportedAt: Date | null }
  now: Date
}): InjuryTimeline | null {
  return buildInjuryTimeline({
    rows: args.rows.map((r) => ({ status: r.status, date: r.date, fetchedAt: r.fetchedAt, source: r.source, returnDate: espnReturnDate(r.raw) })),
    current: args.current,
    now: args.now,
  })
}

export function buildInjuryTimeline(args: {
  rows: readonly TimelineRow[]
  /** The card's current designation and its onset (designationOnset). */
  current: { status: string | null; reportedAt: Date | null }
  now: Date
}): InjuryTimeline | null {
  const currentKey = designationKey(args.current.status)
  const currentSev = severity(args.current.status)
  if (!currentKey || currentSev == null) return null

  // Previous: the latest dated report of a DIFFERENT designation before this one began.
  const onset = args.current.reportedAt?.getTime() ?? null
  const windowStart = (onset ?? args.now.getTime()) - PREVIOUS_WINDOW_DAYS * 86_400_000
  let previous: InjuryTimeline['previous'] = null
  let previousSev: number | null = null
  const dated = args.rows.filter((r) => r.date).sort((a, b) => b.date!.getTime() - a.date!.getTime())
  for (const r of dated) {
    const t = r.date!.getTime()
    if (onset != null && t >= onset) continue
    if (t < windowStart) break
    // A different designation means a different SEVERITY — "Q" after "Questionable" is not a change.
    const sev = severity(r.status)
    if (sev == null || sev === currentSev) continue
    previous = { status: r.status!.trim(), lastReported: day(r.date!) }
    previousSev = sev
    break
  }
  const trend = previousSev == null || previousSev === currentSev ? null : previousSev > currentSev ? 'up' : 'down'

  // Estimated return: ESPN, this episode, still ahead — and never for a player who is healthy now.
  let estReturn: string | null = null
  if (currentSev > 0) {
    const freshest = Math.max(...args.rows.map((r) => r.fetchedAt.getTime()), 0)
    const today = day(args.now)
    const candidates = args.rows
      .filter((r) => r.source === 'espn' && r.returnDate && /^\d{4}-\d{2}-\d{2}$/.test(r.returnDate) && freshest - r.fetchedAt.getTime() <= EPISODE_MS)
      .filter((r) => severity(r.status) === currentSev)
      .sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime())
    const latest = candidates[0]?.returnDate ?? null
    if (latest && latest >= today) estReturn = latest
  }

  if (!previous && !estReturn) return null
  return { previous, trend, estReturn }
}
