/**
 * What a draft seat is called when nobody holds it.
 *
 * An imported Sleeper league keeps its empty teams (Sleeper's orphan rosters: no owner, no user), and
 * the import names each one "Unknown" — the string `SleeperRosterMapper` falls back to when a roster
 * has no user. On a draft board that reads as broken data rather than as a seat waiting for a manager.
 * Measured 2026-11-17: 11 of 12 seats on the KBI Tournament Waiting List board and 2 of 8 on the KBI
 * Championship board were empty Sleeper teams labelled "Unknown".
 *
 * The stored "Unknown" is left alone on purpose: `ImportedLeaguePreviewBuilder` reads it as the
 * "no user on this team" sentinel. This only changes what a draft surface shows.
 *
 * Pure: safe from server and client.
 */
export const OPEN_SEAT_LABEL = 'Open seat'

/** True for a name that only stands in for a missing manager. */
export function isPlaceholderSeatName(name: string | null | undefined): boolean {
  const t = typeof name === 'string' ? name.trim() : ''
  return t.length === 0 || /^unknown(\s+(team|manager|owner))?$/i.test(t)
}

/** The first real name among the candidates, in order, or "Open seat" when there is none. */
export function seatDisplayName(...candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    if (!isPlaceholderSeatName(c)) return (c as string).trim()
  }
  return OPEN_SEAT_LABEL
}
