import { FINDER_SPORTS } from './finderSports'

/**
 * The Player Finder home's sport tabs (2026-11-11) — pure, client-safe.
 *
 * A manager with NBA, NHL and college leagues got a football-only "My players" page: every list on
 * it was read in Sleeper NFL ids. The page now scopes the home to one sport's leagues through `?sport=`
 * (the same param the rail's search already used), and these tabs switch it.
 *
 * Only sports the finder's leagues are actually in get a tab — a manager with no hockey league sees no
 * NHL tab — and with a single sport there is nothing to switch, so no row at all.
 */

export type HomeSport = { sport: string; leagues: number }

type HomeSportTab = { id: string; sport: string | null; leagues: number; href: string; active: boolean }

const ORDER: readonly string[] = FINDER_SPORTS

export function homeSportTabs(
  sports: readonly HomeSport[],
  active: string | null | undefined,
  opts: { leagueId?: string | null } = {},
): HomeSportTab[] {
  const known = sports.filter((s) => s.leagues > 0 && ORDER.includes(s.sport.toUpperCase()))
  if (known.length < 2) return []
  const sorted = [...known].sort((a, b) => ORDER.indexOf(a.sport.toUpperCase()) - ORDER.indexOf(b.sport.toUpperCase()))
  const current = active ? active.toUpperCase() : null
  const href = (sport: string | null) => {
    const params = new URLSearchParams()
    if (sport) params.set('sport', sport)
    if (opts.leagueId) params.set('league', opts.leagueId)
    const qs = params.toString()
    return `/core/players${qs ? `?${qs}` : ''}`
  }
  const total = sorted.reduce((n, s) => n + s.leagues, 0)
  return [
    { id: 'ALL', sport: null, leagues: total, href: href(null), active: !current || !sorted.some((s) => s.sport.toUpperCase() === current) },
    ...sorted.map((s) => {
      const sport = s.sport.toUpperCase()
      return { id: sport, sport, leagues: s.leagues, href: href(sport), active: current === sport }
    }),
  ]
}
