/**
 * Where a "Needs you first" row goes from the War Room.
 *
 * ⚠ NOT THE WAR ROOM. PickALeague's default sends a row to the tab you are on, in the issue's
 * league — and the War Room's league view is Scout, which fixes neither of the two things the
 * queue can detect (`deriveOutstandingIssues`: stale syncs and upcoming drafts). A stale sync is
 * fixed on Sync; an upcoming draft lives in Draft HQ. Any other issue keeps the default rather
 * than being guessed at.
 *
 * Keyed on the id suffixes `outstandingIssues.ts` writes (`<leagueId>:stale`, `<leagueId>:draft`).
 */
export function warRoomIssueHref(issue: { id: string; leagueId: string }): string {
  const league = encodeURIComponent(issue.leagueId)
  if (issue.id.endsWith(':stale')) return `/core/sync?league=${league}`
  if (issue.id.endsWith(':draft')) return `/core/draft-hq?league=${league}`
  return `/core/war-room?league=${league}`
}
