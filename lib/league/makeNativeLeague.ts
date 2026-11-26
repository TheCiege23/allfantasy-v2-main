/**
 * Where a commissioner goes to turn an imported league (Sleeper, ESPN, …) into a native AllFantasy
 * league. The flow itself lives in /create-league: `?fromLeague=` prefills the wizard from the import,
 * carries teams, rosters and history over, and refuses anyone who is not the league's commissioner
 * (app/create-league/page.tsx). The import is left as it is.
 *
 * One builder so every entry point (League home's "What's next?", the Commissioner tab) links the
 * same place.
 */
export function makeNativeLeagueHref(leagueId: string): string {
  return `/create-league?fromLeague=${encodeURIComponent(leagueId)}`
}

export const MAKE_NATIVE_LABEL = 'Make it a native league'
