/**
 * Client-only: optional fast-path POST to `/draft/autopick-expired` when the on-clock
 * viewer's timer shows `expired`. Server cron (`/api/cron/draft-expired-timers`) is
 * authoritative; set `NEXT_PUBLIC_DRAFT_CLIENT_AUTOPICK_FASTPATH=false` to rely on
 * cron-only progression for validation or incident response.
 */
export function isDraftClientAutopickFastPathEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DRAFT_CLIENT_AUTOPICK_FASTPATH !== 'false'
}
