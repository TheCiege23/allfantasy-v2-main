/**
 * Where a commissioner goes to move an imported league (Sleeper, ESPN, …) onto AllFantasy: the "Switch to AllFantasy"
 * card in the league's own Commissioner tab (components/league-home/NativeReadinessCard.tsx), which switches the
 * league IN PLACE — same league, link, teams, chat and history — and can be undone until its first season on
 * AllFantasy starts. docs/league-import/IN_PLACE_NATIVE_CONVERSION_PLAN.md, step 7.
 *
 * ⚠ This used to open `/create-league?fromLeague=`, which COPIED the import into a second, new league. That copy flow
 * is retired (owner decision Q9, 2026-11-26): the route now redirects here, and nothing links to it.
 *
 * One builder so every entry point (League home's "What's next?", the Commissioner tab) leads to the same place.
 */
export const NATIVE_SWITCH_ANCHOR = 'native-switch'

export function makeNativeLeagueHref(leagueId: string): string {
  return `/league/${encodeURIComponent(leagueId)}?view=commissioner#${NATIVE_SWITCH_ANCHOR}`
}

export const MAKE_NATIVE_LABEL = 'Switch to AllFantasy'
