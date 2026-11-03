/**
 * The island theme for a Survivor league, applied when the shell holds one.
 *
 * Survivor leagues rename the league's tabs after the show (the owner's choice, 2026-10-31): the
 * tab still opens the same screen, only its name changes, and only while a Survivor league is the
 * one selected. Every other league, and the cross-league screens, keep the standard names.
 *
 * Defense Hub is hidden in a Survivor league. Brackets is not league-scoped and stays.
 */

export type LeagueTheme = 'survivor'

/** Standard nav label → its Survivor name. Keys are nav keys, so a renamed standard label cannot orphan one. */
export const SURVIVOR_NAV_LABELS: Readonly<Record<string, string>> = {
  home: 'Camp',
  'my-team': 'Your shelter',
  matchup: 'Immunity challenge',
  'war-room': 'Strategy hut',
  waivers: 'Supply drop',
  trades: 'Beach deals',
  'draft-hq': 'The marooning',
  week: 'This episode',
  live: 'Challenge feed',
  standings: 'Tribe standings',
  'season-outlook': 'Island map',
  commissioner: 'Island control',
}

/** Section headings in the rail. `null` headings stay unheaded. */
export const SURVIVOR_SECTION_HEADINGS: Readonly<Record<string, string>> = {
  league: 'The island',
  now: 'This episode',
}

/** Nav keys a Survivor league does not offer. */
export const SURVIVOR_HIDDEN_NAV_KEYS: ReadonlySet<string> = new Set(['defense-hub'])

/**
 * The theme for the selected league, from its resolved type key (`resolveLeagueCardTypeKey`).
 * Null for every other league and for no league at all.
 */
export function leagueThemeForTypeKey(typeKey: string | null | undefined): LeagueTheme | null {
  return typeKey === 'survivor' ? 'survivor' : null
}

/** Rename and filter nav items for a theme. Items are returned in the same order; nothing else changes. */
export function themeNavItems<T extends { key: string; label: string }>(items: T[], theme: LeagueTheme | null | undefined): T[] {
  if (theme !== 'survivor') return items
  return items
    .filter((item) => !SURVIVOR_HIDDEN_NAV_KEYS.has(item.key))
    .map((item) => (SURVIVOR_NAV_LABELS[item.key] ? { ...item, label: SURVIVOR_NAV_LABELS[item.key] } : item))
}

export function themeSectionHeading(id: string, heading: string | null, theme: LeagueTheme | null | undefined): string | null {
  if (theme !== 'survivor' || heading === null) return heading
  return SURVIVOR_SECTION_HEADINGS[id] ?? heading
}

/**
 * The league tabs that open with the compact island banner in a Survivor league, besides the three
 * that place it themselves (Camp in full; Tribe standings, Immunity challenge and Island control
 * compact). Each is still the same screen underneath.
 */
export const SURVIVOR_BANNER_TABS: ReadonlySet<string> = new Set([
  'my-team', 'war-room', 'waivers', 'trades', 'players', 'draft-hq', 'week', 'live', 'season-outlook', 'notifications',
])
