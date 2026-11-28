/**
 * The "other half" question on the import confirm screen (components/import/ImportOtherHalfPicker.tsx).
 * Pure, so the screen and its tests share one rule for when to ask.
 *
 * WHY. A college + pro league is two leagues, often on two platforms (Peach Bowl on Sleeper, Cream Bowl on
 * Fantrax), and Sleeper cannot even say a league is C2C. Linking them used to be a separate page you had to
 * know about after importing both. The import is where you already have the league in front of you.
 */

/** What the commissioner chose. `later` means "it is not on AllFantasy yet, I will import it next". */
export type OtherHalfChoice =
  | { kind: 'none' }
  | { kind: 'later' }
  | { kind: 'link'; leagueId: string; name: string }

export const NO_OTHER_HALF: OtherHalfChoice = { kind: 'none' }

const PAIRED_TYPES = new Set(['c2c', 'devy'])
const PAIRABLE_SPORTS = new Set(['NFL', 'NBA', 'NCAAF', 'NCAAB'])

/**
 * Ask when the league is (or was just marked) C2C or devy, or when this import was opened to be the other
 * half of one (`/import?pairWith=`). Only sports a college + pro franchise is built from.
 */
export function asksForOtherHalf(args: { leagueType: string | null | undefined; sport: string | null | undefined; pairWith?: string | null }): boolean {
  if (!PAIRABLE_SPORTS.has(String(args.sport ?? '').trim().toUpperCase())) return false
  if (args.pairWith) return true
  return PAIRED_TYPES.has(String(args.leagueType ?? '').trim().toLowerCase())
}

/** The other half's AF League id to send with the commit, or null. */
export function pairWithLeagueIdFor(choice: OtherHalfChoice): string | null {
  return choice.kind === 'link' ? choice.leagueId : null
}

/** Where "import it next" goes: the import page, with this league waiting to be linked. */
export function importOtherHalfHref(leagueId: string): string {
  return `/import?pairWith=${encodeURIComponent(leagueId)}`
}

const PLATFORM_LABELS: Record<string, string> = {
  sleeper: 'Sleeper',
  fantrax: 'Fantrax',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  mfl: 'MFL',
  fleaflicker: 'Fleaflicker',
  ffpc: 'FFPC',
  allfantasy: 'AllFantasy',
  native: 'AllFantasy',
}

export function platformLabel(platform: string | null | undefined): string {
  const p = String(platform ?? '').trim().toLowerCase()
  return PLATFORM_LABELS[p] ?? (p ? p.charAt(0).toUpperCase() + p.slice(1) : 'AllFantasy')
}
