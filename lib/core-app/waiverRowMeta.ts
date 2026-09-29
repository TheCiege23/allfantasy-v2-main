/**
 * The small, sport-free facts every cross-league waiver row prints about its league — shared by
 * the NFL rows and the season-rate sections of `waiversBoard.ts`, so the two cannot describe the
 * same league two ways. Moved here verbatim from `waiversBoard.ts`; the NFL golden test
 * (`waivers-board-nfl-golden.test.ts`) pins that nothing it prints moved with them.
 */

const DAY_LABEL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "Dynasty · Superflex" from what the league actually declares. */
export function formatOf(leagueType: string | null, scoringType: string | null): string | null {
  const parts = [leagueType, scoringType]
    .map((x) => (x ?? '').trim())
    .filter((x) => x.length > 0)
    .map((x) => x.charAt(0).toUpperCase() + x.slice(1))
  return parts.length > 0 ? parts.join(' · ') : null
}

/** "Wednesday 09:00 UTC", when the league publishes a processing day and time. */
export function runsAtLabel(
  w: { processingDayOfWeek: number | null; processingTimeUtc: string | null } | null | undefined,
): string | null {
  return w && w.processingDayOfWeek != null && w.processingTimeUtc
    ? `${DAY_LABEL[w.processingDayOfWeek] ?? 'Unknown day'} ${w.processingTimeUtc} UTC`
    : null
}

/** FAAB left, only when the league runs FAAB. */
export function faabRemainingOf(
  w: { waiverType: string | null } | null | undefined,
  roster: { faabRemaining: number | null },
): number | null {
  return w && String(w.waiverType ?? '').toLowerCase() === 'faab' ? (roster.faabRemaining ?? null) : null
}
