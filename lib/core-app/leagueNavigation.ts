/** Preserve league context when older roster links reach the Core catch-all. */
const SCREEN_ALIASES: Record<string, string> = {
  roster: 'my-team', team: 'my-team', 'my-roster': 'my-team',
  scores: 'live', 'live-scores': 'live', draft: 'draft-hq',
}
export function canonicalCoreScreen(segment: string): string {
  const key = segment.toLowerCase()
  return Object.hasOwn(SCREEN_ALIASES, key) ? SCREEN_ALIASES[key] : key
}

/** A league change starts at the current league view, with obsolete team/game filters removed. */
export function coreLeagueHref(pathname: string, leagueId: string, leagueScreen: boolean): string {
  const segment = pathname.replace(/^\/core\/?/, '').split('/')[0]
  const screen = leagueScreen ? canonicalCoreScreen(segment) : ''
  return `/core${screen ? `/${screen}` : ''}?league=${encodeURIComponent(leagueId)}`
}
