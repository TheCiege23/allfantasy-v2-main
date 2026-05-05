/**
 * Pure countdown math shared by **`useDraftCountdownSeconds`** and **`getDraftCountdownDisplay`**.
 * Server **`timerEndAt`** is authoritative; client only recomputes remaining seconds from wall clock.
 */

export function computeDraftCountdownSeconds(
  timerStatus: 'running' | 'paused' | 'expired' | 'none',
  timerEndAtIso: string | null | undefined,
  serverRemainingSeconds: number | null | undefined,
  nowMs: number,
  softDeadlineMs: number | null | undefined,
): number | null {
  if (timerStatus === 'paused') return serverRemainingSeconds ?? null
  if (timerStatus === 'expired') return 0
  if (timerStatus === 'none') return serverRemainingSeconds ?? null
  if (timerStatus === 'running' && timerEndAtIso) {
    const end = new Date(timerEndAtIso).getTime()
    if (!Number.isFinite(end)) return serverRemainingSeconds ?? null
    return Math.max(0, Math.ceil((end - nowMs) / 1000))
  }
  if (
    timerStatus === 'running' &&
    !timerEndAtIso &&
    softDeadlineMs != null &&
    Number.isFinite(softDeadlineMs)
  ) {
    return Math.max(0, Math.ceil((softDeadlineMs - nowMs) / 1000))
  }
  return serverRemainingSeconds ?? null
}
