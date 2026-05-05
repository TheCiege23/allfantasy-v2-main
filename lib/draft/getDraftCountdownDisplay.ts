import { computeDraftCountdownSeconds } from '@/lib/draft/computeDraftCountdownSeconds'

export type DraftCountdownPhase =
  | 'complete'
  | 'running_with_end'
  | 'running_soft_anchor'
  | 'paused'
  | 'expired'
  | 'none_idle'

export type DraftCountdownDisplay = {
  remainingSeconds: number | null
  phase: DraftCountdownPhase
  /** True when in-progress draft is missing both timerEndAt and usable remainingSeconds (UI shows "—"). */
  missingTimerAnchor: boolean
}

/**
 * Deterministic timer display DTO for DraftTopBar / mobile chrome tests.
 * Does not mutate draft state — **`draftStatus`** and **`timer`** come from **`GET /draft/session`** / live-sync.
 */
export function getDraftCountdownDisplay(input: {
  draftStatus: string
  timerStatus: 'running' | 'paused' | 'expired' | 'none'
  timerEndAtIso?: string | null
  serverRemainingSeconds?: number | null
  nowMs: number
  /** Soft anchor when server omits `timerEndAt` but sent positive `remainingSeconds` (matches hook behavior). */
  softDeadlineMs?: number | null
  /** When true and timer missing anchor: in-progress board still open — surfaces resync hint in client. */
  boardHasOpenPicks?: boolean
}): DraftCountdownDisplay {
  const {
    draftStatus,
    timerStatus,
    timerEndAtIso,
    serverRemainingSeconds,
    nowMs,
    softDeadlineMs,
    boardHasOpenPicks,
  } = input

  if (draftStatus === 'completed') {
    return { remainingSeconds: null, phase: 'complete', missingTimerAnchor: false }
  }

  const remainingSeconds = computeDraftCountdownSeconds(
    timerStatus,
    timerEndAtIso,
    serverRemainingSeconds,
    nowMs,
    softDeadlineMs ?? null,
  )

  let phase: DraftCountdownPhase = 'none_idle'
  if (timerStatus === 'expired') phase = 'expired'
  else if (timerStatus === 'paused') phase = 'paused'
  else if (timerStatus === 'running' && timerEndAtIso) phase = 'running_with_end'
  else if (timerStatus === 'running') phase = 'running_soft_anchor'
  else phase = 'none_idle'

  const missingTimerAnchor =
    draftStatus === 'in_progress' &&
    Boolean(boardHasOpenPicks) &&
    timerStatus === 'none' &&
    !(timerEndAtIso && String(timerEndAtIso).length > 0)

  return { remainingSeconds, phase, missingTimerAnchor }
}
