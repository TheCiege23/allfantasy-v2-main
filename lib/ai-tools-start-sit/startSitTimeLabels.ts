import type { AiTimeContextPayload } from '@/lib/time-engine/types'

/**
 * Human-readable lock / timing line for Start/Sit UI — uses server-backed time payload only.
 */
export function formatStartSitLockStatusLabel(tc: AiTimeContextPayload | null | undefined): string | null {
  if (!tc) return null
  const parts: string[] = []
  if (tc.timeUntilNextLockMs != null && tc.timeUntilNextLockMs >= 0 && tc.nextLockTimeUTC) {
    const m = Math.floor(tc.timeUntilNextLockMs / 60000)
    if (m <= 0) parts.push('Lineup lock: imminently — check your platform.')
    else if (m < 60 * 72) parts.push(`Next lock in ~${m}m (${tc.userLocalTime} local).`)
  }
  if (tc.lockWindowStatus === 'locked') parts.push('Lock window: closed for this period.')
  if (tc.freshnessSummary) parts.push(tc.freshnessSummary)
  return parts.length ? parts.join(' ') : null
}

