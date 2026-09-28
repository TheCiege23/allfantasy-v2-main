/**
 * WHEN a trade letter was taken, in a manager's words. PURE and client-safe.
 *
 * A completed provider trade's letter is its FROZEN ORIGINAL (`frozenCompletedGrade.ts`) — taken the
 * first time AllFantasy graded it — and every surface that used to say "on this league's values
 * today" was, from 2026-09-28, printing a claim about the wrong moment. A live grade is still today's.
 */
export function gradeMoment(grade: { frozenAt?: string | null } | null | undefined): string {
  const at = grade?.frozenAt ? Date.parse(grade.frozenAt) : NaN
  if (!Number.isFinite(at)) return 'today'
  return `when first graded ${new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}`
}

/** Today's letter for the side that sends `give`, when a frozen original has since moved — else null. */
export function movedLetter(
  grade: { letter?: string; current?: { letter: string } | null } | null | undefined,
): string | null {
  const now = grade?.current?.letter
  return now && now !== grade?.letter ? now : null
}
