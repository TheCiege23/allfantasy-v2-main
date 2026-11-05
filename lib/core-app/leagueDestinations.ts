/**
 * The one list of where the /core navigation can take you, and which group each destination sits in.
 *
 * Before 2026-11-05 two lists answered that question: the rail's (AfCoreShell `NAV_SECTIONS`, which
 * the tablet icon nav and the phone More sheet also read) and the in-league tab row's own `TABS`
 * (LeagueTabs.tsx). They disagreed — Schedule and Moves lived only in the tab row, Draft HQ was
 * gated in one and not the other — so the tab row could not be dropped without losing destinations,
 * and every page carried both. Every surface now reads the groups and the gates from here.
 *
 * ⚠ AN ENTRY'S PRESENCE HERE IS NOT A PROMISE THE ROW RENDERS. Labels, hrefs, badges and the
 * per-prop visibility (Devy, Admin, Commissioner) stay with the shell's `navItems`, which knows the
 * selected league. This file owns ORDER, GROUP and the league-capability gates both surfaces share.
 */

/** Rail section ids. `now` and `league` keep their ids so the Survivor theme's renames still apply. */
export type NavSectionId = 'top' | 'now' | 'league' | 'plan' | 'commish' | 'all' | 'manage'

/**
 * The rail's sections, in order. The league-scoped groups come first: with a league held — which
 * is how most sessions run — those are the destinations a visit is for. "All leagues" follows.
 *
 * Headings are English and pass through `coreUiCopy`, like every rail label.
 */
export const NAV_SECTION_ORDER: ReadonlyArray<{ id: NavSectionId; heading: string | null; keys: readonly string[] }> = [
  { id: 'top', heading: null, keys: ['home'] },
  { id: 'now', heading: 'This week', keys: ['my-team', 'matchup', 'live', 'waivers'] },
  { id: 'league', heading: 'League', keys: ['standings', 'schedule', 'trades', 'moves'] },
  {
    id: 'plan',
    heading: 'Plan ahead',
    keys: ['season-outlook', 'war-room', 'players', 'draft-hq', 'defense-hub', 'devy-league'],
  },
  { id: 'commish', heading: 'Commish', keys: ['commissioner'] },
  {
    id: 'all',
    heading: 'All leagues',
    keys: ['week', 'my-leagues', 'portfolio', 'rankings', 'career', 'devy', 'brackets', 'find-league'],
  },
  { id: 'manage', heading: 'Manage', keys: ['notifications', 'settings', 'plans', 'tools', 'admin'] },
]

/** The section the rail names the selected league above — the first league-scoped one. */
export const LEAGUE_CHIP_SECTION: NavSectionId = 'now'

/**
 * What a league's data can support, as the shell and the tab row each read it.
 *
 * ⚠ ONLY A MEASURED `false` HIDES. `undefined` and `null` mean "not determined" — no coverage block
 * on file, or a read that failed — and hiding on an unknown would take a working league's views away.
 */
export type LeagueCapabilities = {
  hasScoredWeek?: boolean | null
  trades?: boolean
  draft?: boolean
}

/** Which capability a destination needs. A destination absent from this map has no gate here. */
export const LEAGUE_DESTINATION_GATES: Readonly<Record<string, keyof LeagueCapabilities>> = {
  matchup: 'hasScoredWeek',
  week: 'hasScoredWeek',
  standings: 'hasScoredWeek',
  'season-outlook': 'hasScoredWeek',
  trades: 'trades',
  'draft-hq': 'draft',
}

/** True when this league's measured capabilities rule the destination out. */
export function leagueDestinationHidden(key: string, caps: LeagueCapabilities | null | undefined): boolean {
  const gate = LEAGUE_DESTINATION_GATES[key]
  if (!gate || !caps) return false
  return caps[gate] === false
}

/** The section a key belongs to, or null for one no section names (it renders in a trailing group). */
export function navSectionFor(key: string): NavSectionId | null {
  for (const section of NAV_SECTION_ORDER) if (section.keys.includes(key)) return section.id
  return null
}
