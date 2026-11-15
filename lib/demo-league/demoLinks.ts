/**
 * Where a link inside a REAL app screen should go when that screen is shown in the demo.
 *
 * The real screens (LeagueHome and friends) link into the signed-in app — `/core/standings?league=…`,
 * `/core/trades?league=…`, `/settings?…`. A visitor following one is sent to sign in, about a league
 * id that does not exist. So the demo shell rewrites them: the pages the demo has go to the demo's
 * own page, everything that only exists for a signed-in member goes to sign-up, which is what that
 * click means for a visitor ("I want this for my league").
 *
 * Returns null for a link that should stay as it is (demo pages, public pages, other sites).
 */
const SIGNED_IN_PREFIXES = ['/core', '/settings', '/dashboard', '/league/', '/leagues', '/messages', '/notifications', '/account']

export function demoHrefFor(href: string | null | undefined, leagueHome: string): string | null {
  if (!href || !href.startsWith('/') || href.startsWith('//')) return null
  const path = href.split(/[?#]/)[0]!
  if (path === '/demo' || path.startsWith('/demo/')) return null
  if (path === '/core/trades') return '/demo/trades'
  if (path === '/core/players' || path === '/core/player-finder') return '/demo/players'
  if (path === '/core/chimmy') return '/demo/chimmy'
  if (['/core/standings', '/core/matchup', '/core/live', '/core/my-team', '/core/schedule'].includes(path)) return leagueHome
  return SIGNED_IN_PREFIXES.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`) || path.startsWith(`${p}?`))
    ? '/signup'
    : null
}
