/**
 * One name per /core destination.
 *
 * ⚠ THE SAME SCREEN WAS CALLED DIFFERENT THINGS DEPENDING ON WHERE YOU LOOKED. The shell nav,
 * the in-league tab strip and the "did not load" panel each spelled their own labels, so one
 * destination read "My team" in the nav, "My Team" in the phone tab strip, "Trade Center" when
 * it failed, and "Your Week" in one error but "Your week" everywhere else. A manager reasonably
 * wonders whether those are different screens.
 *
 * `label` is the full name (nav column, More sheet, error panels). `short` is for the tight
 * in-league tab strip only, and exists only where the full name does not fit. Both are English
 * keys into `coreUiCopy`, which supplies the Spanish — so a rename here is a rename in both
 * languages, provided the new string has a `coreUiCopy` entry.
 *
 * `home` and the league overview are deliberately two entries: "Home" is the cross-league
 * screen, "Overview" is one league's dashboard, and the in-league strip only ever shows the
 * second.
 */
export const CORE_NAV_LABELS = {
  home: { label: 'Home' },
  overview: { label: 'Overview' },
  'my-team': { label: 'My team' },
  matchup: { label: 'Matchup' },
  trades: { label: 'Trades' },
  waivers: { label: 'Waivers' },
  players: { label: 'Player Finder', short: 'Players' },
  'war-room': { label: 'War Room' },
  'draft-hq': { label: 'Draft HQ' },
  week: { label: 'Your week' },
  live: { label: 'Live scores', short: 'Live' },
  standings: { label: 'Standings' },
  'season-outlook': { label: 'Season Outlook', short: 'Outlook' },
  moves: { label: 'Moves' },
  schedule: { label: 'Schedule' },
} as const satisfies Record<string, { label: string; short?: string }>

export type CoreNavLabelKey = keyof typeof CORE_NAV_LABELS

/** The English name for a destination; pass it through `coreUiCopy` to render. */
export function navLabel(key: CoreNavLabelKey, form: 'full' | 'short' = 'full'): string {
  const entry: { label: string; short?: string } = CORE_NAV_LABELS[key]
  return form === 'short' ? (entry.short ?? entry.label) : entry.label
}
