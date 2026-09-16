/**
 * The /core screens that can be shown for ONE league — the in-league tab bar's screens
 * (components/core-app/LeagueTabs.tsx), keyed the way the shell names its active screen (`home` for
 * the tab whose path segment is empty).
 *
 * The scope switcher keeps you on the current screen when you pick a league only if the screen is
 * one of these. `CORE_SURFACE_KEYS` is not this list: it also holds Portfolio, Notifications, Tools
 * and the rest, which are cross-league — picking a league there used to put a league's tab bar over
 * a screen that shows every league.
 *
 * ⚠ KEPT IN STEP WITH `LeagueTabs`' OWN LIST BY A TEST (`league-screens.test.tsx`), which renders the
 * tab bar and compares its links to this set. LeagueTabs is a server component, so the client shell
 * cannot import its list directly.
 */
export const LEAGUE_SCREEN_KEYS: ReadonlySet<string> = new Set([
  'home',
  'my-team',
  'matchup',
  'trades',
  'waivers',
  'players',
  'war-room',
  'draft-hq',
  'week',
  'live',
  'standings',
  'season-outlook',
])

export function isLeagueScreen(activeKey: string): boolean {
  return LEAGUE_SCREEN_KEYS.has(activeKey)
}
