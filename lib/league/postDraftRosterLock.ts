/**
 * Post-draft roster lock, and the derived `post_draft` → `in_season` phase.
 *
 * ── The policy (owner's default, 2026-10-19) ────────────────────────────────
 *
 * From the moment a redraft draft completes until the FIRST of
 *   (a) the first completed waiver processing run after the draft, or
 *   (b) the start of the league's week 1,
 * adds/drops, free-agent pickups and trades are refused. Lineup moves stay allowed, and waiver
 * CLAIMS may be submitted — they process at that first run, which is what ends the lock.
 *
 * Every rule lives in {@link POST_DRAFT_LOCK_POLICY}, so changing the policy is a one-line edit
 * here and nowhere else.
 *
 * ── Why the phase is DERIVED and not written ─────────────────────────────────
 *
 * `completeDraftSession` writes `post_draft`, and nothing has ever written `post_draft → in_season`
 * (see the 🛑 note in `server/services/leagueLifecycleService.ts`). A cron that writes the phase is a
 * writer that can be forgotten, fail, or run late, and the league then sits in the wrong phase with
 * nothing red. Deriving it from the season opener means there is no writer to forget: once week 1
 * has started, a stored `post_draft` READS as `in_season` to the lifecycle gate.
 *
 * This module is pure (no DB). The server-side loader that feeds it is
 * `server/services/postDraftRosterLockService.ts`.
 */
import type { LeagueLifecycleState } from '@prisma/client'
import { dailySportWeekForInstant, resolveDailySportSeasonStart, resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'

/** The refusal code every locked endpoint returns. Clients key on this. */
export const POST_DRAFT_ROSTER_LOCK_CODE = 'roster_locked_post_draft' as const

/** HTTP status for the refusal — 423 Locked, the same status the league lock uses. */
export const POST_DRAFT_ROSTER_LOCK_STATUS = 423

/** The kinds of roster move the policy distinguishes. */
export type RosterMoveKind = 'add_drop' | 'free_agent_pickup' | 'trade' | 'waiver_claim' | 'lineup'

/**
 * 🛑 THE POLICY. One table, so it can change in one place.
 * `refused` = blocked while the post-draft lock is on; `allowed` = never affected by it.
 */
export const POST_DRAFT_LOCK_POLICY: Readonly<Record<RosterMoveKind, 'refused' | 'allowed'>> = {
  add_drop: 'refused',
  free_agent_pickup: 'refused',
  trade: 'refused',
  // Claims queue during the lock and process at the first waiver run — that run is what lifts it.
  waiver_claim: 'allowed',
  lineup: 'allowed',
}

export function isMoveRefusedDuringPostDraftLock(kind: RosterMoveKind): boolean {
  return POST_DRAFT_LOCK_POLICY[kind] === 'refused'
}

/** Sports this lock is wired for. Others never lock (and never derive a phase change). */
export const POST_DRAFT_LOCK_SPORTS: ReadonlySet<string> = new Set(['NFL', 'NBA', 'NHL', 'MLB'])

export type PostDraftRosterLockInput = {
  /** Stored `League.lifecycleState`. */
  storedState: LeagueLifecycleState | string | null | undefined
  /** `DraftSession.completedAt` of the league's current session; null when there is none. */
  draftCompletedAt: Date | null
  /** `runAt` of the first COMPLETED waiver run after `draftCompletedAt` (excluding FCFS-immediate). */
  firstWaiverRunAfterDraftAt: Date | null
  /** Start of the league's week 1; null when the opener is not known. */
  week1StartsAt: Date | null
  now: Date
}

export type PostDraftRosterLockStatus =
  | {
      locked: true
      /** The week-1 start, the latest the lock can last. Null when the opener is unknown. */
      unlocksAt: Date | null
    }
  | {
      locked: false
      reason: 'not_post_draft' | 'no_draft_completion' | 'waiver_run_cleared' | 'week1_started'
    }

/**
 * Whether the post-draft lock is on right now.
 *
 * ⚠ A league stored in `post_draft` with NO completed draft session (an import, a forced
 * transition) does not lock — there is no draft moment to measure from, and locking without
 * one would last until week 1 on a guess.
 */
export function resolvePostDraftRosterLock(input: PostDraftRosterLockInput): PostDraftRosterLockStatus {
  if (input.storedState !== 'post_draft') return { locked: false, reason: 'not_post_draft' }
  if (!input.draftCompletedAt) return { locked: false, reason: 'no_draft_completion' }
  const now = input.now.getTime()
  if (input.week1StartsAt && now >= input.week1StartsAt.getTime()) return { locked: false, reason: 'week1_started' }
  if (
    input.firstWaiverRunAfterDraftAt &&
    input.firstWaiverRunAfterDraftAt.getTime() > input.draftCompletedAt.getTime() &&
    input.firstWaiverRunAfterDraftAt.getTime() <= now
  ) {
    return { locked: false, reason: 'waiver_run_cleared' }
  }
  return { locked: true, unlocksAt: input.week1StartsAt }
}

/**
 * The phase the lifecycle gate should act on. A stored `post_draft` reads as `in_season` once week 1
 * has started; every other state is returned unchanged. Null `week1StartsAt` (unknown opener) keeps
 * `post_draft` — it never guesses a transition.
 */
export function resolveEffectiveLifecyclePhase(input: {
  storedState: LeagueLifecycleState
  week1StartsAt: Date | null
  now: Date
}): LeagueLifecycleState {
  if (input.storedState !== 'post_draft') return input.storedState
  if (input.week1StartsAt && input.now.getTime() >= input.week1StartsAt.getTime()) return 'in_season'
  return 'post_draft'
}

function formatUnlock(at: Date, timeZone: string | null | undefined): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }
  try {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: timeZone || 'America/New_York' }).format(at)
  } catch {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'America/New_York' }).format(at)
  }
}

const MOVE_LABEL: Record<RosterMoveKind, string> = {
  add_drop: 'Adds and drops',
  free_agent_pickup: 'Free-agent pickups',
  trade: 'Trades',
  waiver_claim: 'Waiver claims',
  lineup: 'Lineup moves',
}

/** The human message for a refused move, naming when it unlocks. */
export function postDraftRosterLockMessage(
  kind: RosterMoveKind,
  unlocksAt: Date | null,
  timeZone?: string | null,
): string {
  const when = unlocksAt
    ? `after the first waiver run or when week 1 starts (${formatUnlock(unlocksAt, timeZone)}), whichever comes first`
    : 'after the first waiver run or when week 1 starts, whichever comes first'
  return (
    `Rosters are locked after the draft. ${MOVE_LABEL[kind]} open ${when}. ` +
    'You can still set your lineup and submit waiver claims; claims process at the first waiver run.'
  )
}

export type PostDraftRosterLockRefusal = {
  status: typeof POST_DRAFT_ROSTER_LOCK_STATUS
  code: typeof POST_DRAFT_ROSTER_LOCK_CODE
  error: string
  unlocksAt: string | null
}

/** The refusal for `kind`, or null when the move is allowed. */
export function postDraftRosterLockRefusal(
  kind: RosterMoveKind,
  lock: PostDraftRosterLockStatus | null | undefined,
  timeZone?: string | null,
): PostDraftRosterLockRefusal | null {
  if (!lock || !lock.locked || !isMoveRefusedDuringPostDraftLock(kind)) return null
  return {
    status: POST_DRAFT_ROSTER_LOCK_STATUS,
    code: POST_DRAFT_ROSTER_LOCK_CODE,
    error: postDraftRosterLockMessage(kind, lock.unlocksAt, timeZone),
    unlocksAt: lock.unlocksAt ? lock.unlocksAt.toISOString() : null,
  }
}

/**
 * For routes that catch a thrown service error (the trade engine): when it is the post-draft lock,
 * the JSON body and status to answer with; otherwise null and the route keeps its own handling.
 */
export function postDraftLockErrorResponse(e: unknown): { body: { error: string; code: string }; status: number } | null {
  if (!e || typeof e !== 'object') return null
  const err = e as { code?: unknown; message?: unknown; status?: unknown }
  if (err.code !== POST_DRAFT_ROSTER_LOCK_CODE) return null
  return {
    body: { error: String(err.message ?? ''), code: POST_DRAFT_ROSTER_LOCK_CODE },
    status: typeof err.status === 'number' ? err.status : POST_DRAFT_ROSTER_LOCK_STATUS,
  }
}

// ── Week 1 start, per sport ─────────────────────────────────────────────────

/**
 * Daily sports (NBA, NHL, MLB): the start of the first sport week that begins at or after the draft,
 * through the shared week windows in `lib/season-week/dailySportSeasonStarts.ts`. A league that drafts
 * before the opener gets the opener; a league that drafts mid-season gets the next week's start, which
 * is its own week 1. Null when that season's opener is not recorded — the caller does not guess.
 *
 * ⚠ The windows are UTC-midnight DATE keys (the convention every daily-sport consumer shares), so the
 * lock lifts at 00:00 UTC on the opener's date, a few hours before the US Eastern day begins.
 */
export function resolveDailySportWeek1Start(
  sport: string,
  season: number,
  draftCompletedAt: Date | null,
): Date | null {
  const opener = resolveDailySportSeasonStart(sport, season)
  if (!opener) return null
  const week1 = resolveDailySportWeekWindow(sport, season, 1)
  if (!week1) return null
  if (!draftCompletedAt || draftCompletedAt.getTime() < week1.start.getTime()) return week1.start
  const current = dailySportWeekForInstant(sport, season, draftCompletedAt)
  if (current == null) return null
  return resolveDailySportWeekWindow(sport, season, current + 1)?.start ?? null
}

export type NflScheduleRow = { week: number | null; seasonType: string | null; startTime: Date | null }

/**
 * NFL: from `SportsGame` rows for the season, the earliest kickoff of the first REGULAR-season week
 * whose first kickoff is at or after the draft. Rows without an explicit `regular` season type are
 * ignored — NFL's NULL-typed rows mix preseason and postseason (see `seasonWeekService.ts`).
 */
export function resolveNflWeek1Start(rows: readonly NflScheduleRow[], draftCompletedAt: Date | null): Date | null {
  const weekStart = new Map<number, number>()
  for (const row of rows) {
    if (String(row.seasonType ?? '').trim().toLowerCase() !== 'regular') continue
    const week = Number(row.week)
    const t = row.startTime ? row.startTime.getTime() : NaN
    if (!Number.isInteger(week) || week < 1 || !Number.isFinite(t)) continue
    const prev = weekStart.get(week)
    if (prev == null || t < prev) weekStart.set(week, t)
  }
  const from = draftCompletedAt ? draftCompletedAt.getTime() : -Infinity
  const starts = [...weekStart.entries()].sort((a, b) => a[0] - b[0])
  for (const [, t] of starts) {
    if (t >= from) return new Date(t)
  }
  return null
}
