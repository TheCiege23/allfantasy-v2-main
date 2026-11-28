/**
 * The draft room's "Starts in …" countdown to `LeagueSettings.draftDateUtc`, shown before the draft.
 *
 * Pure and client-safe (no prisma, no server-only). The seconds come from `useDraftCountdownSeconds`
 * anchored to the scheduled ISO time; this module only decides what the top bar says about them.
 */

import { startsAtScheduledTimeRegardlessOfAutostart, type ScheduledStartLeague } from '@/lib/draft/redraftScheduledStart'
import { resolveWriteAuthority } from '@/lib/league/write-authority'

/**
 * How long past the scheduled time the room still says "Starting…". The minute draft tick starts the
 * draft, and it retries a draft it cannot start yet (pool not ready, an empty seat) for days, so the
 * label is dropped after this rather than left on a draft that is not starting.
 */
export const SCHEDULED_START_GRACE_MS = 10 * 60 * 1000

/**
 * Seconds until the scheduled start, as the top bar shows them:
 * under an hour `12:34`, under a day `2h 05m`, a day or more `3d 4h`.
 * Hours and days round down, so the label never claims more time than is left.
 */
export function formatScheduledStartRemaining(totalSeconds: number): string {
  const seconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return `${hours}h ${String(minutes).padStart(2, '0')}m`
  }
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  return `${days}d ${hours}h`
}

/**
 * True when the server starts this league's draft at its scheduled time, so "Starting…" is honest
 * once the time has passed. Mirrors the three starters on the minute draft tick:
 *  - `startScheduledRedraftDrafts`: native redraft / Classic Best Ball in its sports, whatever the toggle says;
 *  - `startScheduledDynastyDrafts`: native dynasty, devy and C2C leagues with Autostart on;
 *  - `startScheduledSurvivorDrafts`: native Survivor and Guillotine leagues with Autostart on.
 * Anything else (an imported league, a redraft sport outside the list) reads false: the
 * commissioner presses Start, and the room must not promise otherwise.
 */
export function scheduledDraftAutoStarts(
  autostartEnabled: boolean,
  league: ScheduledStartLeague | null | undefined,
): boolean {
  if (startsAtScheduledTimeRegardlessOfAutostart(league)) return true
  if (!autostartEnabled || !league) return false
  if (resolveWriteAuthority(league) !== 'NATIVE') return false
  if (league.survivorMode === true || league.guillotineMode === true || league.leagueVariant === 'guillotine') return true
  const type = String(league.leagueType ?? '').toLowerCase()
  return league.isDynasty === true || type === 'dynasty' || type === 'devy' || type === 'c2c'
}

export type ScheduledStartCountdown =
  /** Nothing to show: no scheduled time, not before the draft, or the time passed and nothing is starting it. */
  | { phase: 'none' }
  /** Before the scheduled time. `time` is `formatScheduledStartRemaining(remainingSeconds)`. */
  | { phase: 'counting'; remainingSeconds: number; time: string }
  /** The time has passed and the server is about to start the draft. Never a negative number. */
  | { phase: 'starting' }

export function resolveScheduledStartCountdown(input: {
  draftStatus: string
  scheduledStartIso: string | null | undefined
  nowMs: number
  /** `scheduledDraftAutoStarts(...)`; false keeps "Starting…" off a draft the commissioner must start. */
  autoStarts: boolean
  /** Ticking seconds from `useDraftCountdownSeconds`, when the caller has them; else derived from `nowMs`. */
  remainingSeconds?: number | null
}): ScheduledStartCountdown {
  if (input.draftStatus !== 'pre_draft' || !input.scheduledStartIso) return { phase: 'none' }
  const startMs = Date.parse(input.scheduledStartIso)
  if (!Number.isFinite(startMs)) return { phase: 'none' }
  const msLeft = startMs - input.nowMs
  if (msLeft > 0) {
    const fromClock = Math.ceil(msLeft / 1000)
    const remainingSeconds =
      input.remainingSeconds != null && Number.isFinite(input.remainingSeconds) && input.remainingSeconds > 0
        ? Math.floor(input.remainingSeconds)
        : fromClock
    return { phase: 'counting', remainingSeconds, time: formatScheduledStartRemaining(remainingSeconds) }
  }
  if (input.autoStarts && -msLeft <= SCHEDULED_START_GRACE_MS) return { phase: 'starting' }
  return { phase: 'none' }
}
