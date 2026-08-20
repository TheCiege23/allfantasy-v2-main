/**
 * Client-side timer-expired → POST /draft/autopick-expired is a UX fast-path only.
 * Server cron (`processExpiredDraftTimersBatch`) is authoritative for progression.
 *
 * Set `NEXT_PUBLIC_DRAFT_CLIENT_AUTOPICK_FAST_PATH=false` to rely on server-only
 * autopick when the on-clock user's browser is closed.
 */
export function isDraftClientAutopickFastPathEnabled(): boolean {
  if (typeof process === 'undefined') return true
  return process.env.NEXT_PUBLIC_DRAFT_CLIENT_AUTOPICK_FAST_PATH !== 'false'
}
