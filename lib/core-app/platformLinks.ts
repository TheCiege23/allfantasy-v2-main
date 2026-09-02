import {
  isSafeProviderUrl,
  normalizeSourcePlatform,
  PROVIDER_ALLOWED_HOSTS,
  resolveSourceLink,
} from '@/lib/league-links/sourceLinkResolver'

/**
 * "Open in <platform>" — where a Player Finder move is actually made.
 *
 * AllFantasy is read-only. Every recommendation on the screen ends in a link to
 * the platform and screen where the user makes the change, and this module is
 * the one place those links are built so the lineup card, the league table and
 * the verdict cannot disagree about where "fix it" goes.
 *
 * ⚠ CLIENT-SAFE ON PURPOSE: no prisma, no 'server-only'. The screen component
 * is a client component and builds these at render time from fields the loader
 * already returned. `lib/shared-services/league-hub/replacementOptions.ts` has
 * `resolveLineupTarget` with the same Sleeper paths, but it imports prisma and
 * cannot be reached from the client bundle — see `playerRef.ts` for the build
 * failure that shape produces.
 *
 * ⚠ NEVER AN INVENTED ROUTE. Sleeper's `/team` and `/players` pages are the
 * ones the replacement engine already links to; ESPN and Yahoo have a VERIFIED
 * league-page format in `sourceLinkResolver` and nothing deeper, so those land
 * on the league page and say so in `screen`. Every external href passes the
 * resolver's exact-hostname HTTPS allowlist.
 */

export type PlatformLink = {
  href: string
  /** Button text — "Open in Sleeper", "Open in ESPN". */
  label: string
  /** Human name of the platform — "Sleeper", "ESPN", "Yahoo", "AllFantasy". */
  platformLabel: string
  /** The screen the link lands on — "Lineup", "Players", "League", "Trades". */
  screen: string
  external: boolean
}

export type LinkLeague = {
  id: string
  platform: string | null | undefined
  platformLeagueId?: string | null
  season?: number | string | null
  name?: string | null
}

const SHORT_LABEL: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  mfl: 'MFL',
  fantrax: 'Fantrax',
  fleaflicker: 'Fleaflicker',
}

/** "Sleeper", "ESPN", "Yahoo" — or "AllFantasy" for a native league. */
export function platformLabel(platform: string | null | undefined): string {
  const key = (platform ?? '').trim().toLowerCase()
  if (!key) return 'AllFantasy'
  if (SHORT_LABEL[key]) return SHORT_LABEL[key]
  const source = normalizeSourcePlatform(key)
  if (source) return SHORT_LABEL[source] ?? source
  return 'AllFantasy'
}

/** "Sleeper › Dynasty Dragons › Lineup" */
export function movePath(league: LinkLeague, screen: string): string {
  return [platformLabel(league.platform), (league.name ?? '').trim() || 'League', screen].join(' › ')
}

function external(href: string, platform: string, screen: string): PlatformLink {
  const label = platformLabel(platform)
  return { href, label: `Open in ${label}`, platformLabel: label, screen, external: true }
}

function internal(href: string, screen: string): PlatformLink {
  return { href, label: 'Open in AllFantasy', platformLabel: 'AllFantasy', screen, external: false }
}

/**
 * The provider's league page — the closest RELIABLE destination for ESPN and
 * Yahoo, and the fallback for any Sleeper league we hold no platform id for.
 */
function leaguePage(league: LinkLeague, screen: string): PlatformLink | null {
  const link = resolveSourceLink({
    platform: league.platform,
    sourceLeagueId: league.platformLeagueId ?? null,
    leagueName: league.name ?? null,
    season: league.season ?? null,
  })
  if (!link) return null
  // A homepage fallback is not "the league" — say where it actually lands.
  return external(link.href, link.provider, link.isFallback ? `${link.providerLabel} home` : screen)
}

/*
 * ⚠ ONLY THE TWO SLEEPER PATHS THE REPLACEMENT ENGINE ALREADY LINKS TO. A
 * trades path was drafted here and removed: nothing in the repo has verified
 * it, and the module rule is that a link we cannot vouch for lands on the
 * league page rather than on a guess.
 */
function sleeperPage(league: LinkLeague, path: 'team' | 'players', screen: string): PlatformLink | null {
  const id = (league.platformLeagueId ?? '').trim()
  if (!id) return null
  const href = `https://sleeper.com/leagues/${encodeURIComponent(id)}/${path}`
  return isSafeProviderUrl(href, PROVIDER_ALLOWED_HOSTS.sleeper) ? external(href, 'sleeper', screen) : null
}

/** Where a lineup change is made — the "Where to fix it" destination. */
export function lineupLink(league: LinkLeague): PlatformLink | null {
  const platform = normalizeSourcePlatform(league.platform)
  if (!platform) return internal(`/core/my-team?league=${encodeURIComponent(league.id)}`, 'My team')
  if (platform === 'sleeper') return sleeperPage(league, 'team', 'Lineup') ?? leaguePage(league, 'League')
  return leaguePage(league, 'League')
}

/** Where a free agent is claimed. */
export function claimLink(league: LinkLeague): PlatformLink | null {
  const platform = normalizeSourcePlatform(league.platform)
  if (!platform) return internal(`/waiver-wire?leagueId=${encodeURIComponent(league.id)}`, 'Waivers')
  if (platform === 'sleeper') return sleeperPage(league, 'players', 'Players') ?? leaguePage(league, 'League')
  return leaguePage(league, 'League')
}

/**
 * Where a trade for a player another manager owns starts.
 *
 * Always AllFantasy's own trade screen for that league — it is the one that
 * grades the offer — with the platform's page as the place the trade is
 * actually sent, when we can name it.
 */
export function tradeLink(league: LinkLeague): { here: PlatformLink; there: PlatformLink | null } {
  const here = internal(`/core/trades?league=${encodeURIComponent(league.id)}`, 'Trades')
  const there = normalizeSourcePlatform(league.platform) ? leaguePage(league, 'League') : null
  return { here, there }
}
