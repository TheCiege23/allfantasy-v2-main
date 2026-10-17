/**
 * The channel between the Career screen and the shell's rail — no imports, on purpose. The shell
 * renders on every /core screen; it must not pull the career model into every page's bundle just to
 * listen for a map of strings. The lines themselves are built in `railCareer.ts`, by the screen.
 *
 * ⚠ THE LATEST VALUE IS KEPT, NOT ONLY ANNOUNCED. React runs a child's effects BEFORE its parent's,
 * and the Career screen renders inside the shell — so on a first load Career publishes before the
 * shell has subscribed, and an event alone would be lost. The shell reads `currentRailCareerLines()`
 * when it mounts, then listens for changes.
 */

export const RAIL_CAREER_EVENT = 'af:rail-career-lines'
export type RailCareerDetail = { lines: Record<string, string> | null }

let latest: Record<string, string> | null = null

export function publishRailCareerLines(lines: Record<string, string> | null): void {
  latest = lines
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<RailCareerDetail>(RAIL_CAREER_EVENT, { detail: { lines } }))
}

export function currentRailCareerLines(): Record<string, string> | null {
  return latest
}

/** The Career identity of a league: its name, trimmed and lower-cased. */
export function railLeagueKey(name: string | null | undefined): string {
  return String(name ?? '').trim().toLowerCase()
}
