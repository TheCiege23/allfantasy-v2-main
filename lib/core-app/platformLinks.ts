import {
  normalizeSourcePlatform,
  resolveSourceScreenLink,
  type SourceScreen,
  type SourceScreenLink,
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
 * already returned.
 *
 * ⚠ THE URL FORMATS LIVE IN ONE PLACE — `sourceLinkResolver`'s per-provider
 * screen table — and a format is a live destination only once it is marked
 * verified there. Until then this returns the league page (labelled as such in
 * `screen`) and carries the unverified URL as `candidate`, which is what the
 * verification pass clicks. Nothing here invents a route.
 */

export type PlatformLink = {
  href: string
  /** Button text — "Open in Sleeper", "Open in ESPN". */
  label: string
  /** Human name of the platform — "Sleeper", "ESPN", "Yahoo", "AllFantasy". */
  platformLabel: string
  /** The screen the link lands on — "Lineup", "Waivers", "Trade", "League", or "<Provider> home". */
  screen: string
  external: boolean
  /** The deep-link URL an unverified format would use; null when verified or absent. */
  candidate?: string | null
}

export type LinkLeague = {
  id: string
  platform: string | null | undefined
  platformLeagueId?: string | null
  season?: number | string | null
  name?: string | null
  /** The user's own team id on the platform (LeagueTeam.externalId), when known. */
  teamId?: string | null
  /** The counterparty's team id on the platform, for a trade screen. */
  partnerTeamId?: string | null
}

const SHORT_LABEL: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  mfl: 'MFL',
  fantrax: 'Fantrax',
  fleaflicker: 'Fleaflicker',
}

const SCREEN_LABEL: Record<SourceScreen, string> = {
  league: 'League',
  lineup: 'Lineup',
  waivers: 'Waivers',
  trade: 'Trade',
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

function internal(href: string, screen: string): PlatformLink {
  return { href, label: 'Open in AllFantasy', platformLabel: 'AllFantasy', screen, external: false, candidate: null }
}

function fromResolved(link: SourceScreenLink, platform: string | null | undefined): PlatformLink {
  const label = platformLabel(platform)
  const screen = link.verified
    ? SCREEN_LABEL[link.screen]
    : link.destinationType === 'homepage'
      ? `${link.providerLabel} home`
      : 'League'
  return {
    href: link.href,
    label: `Open in ${label}`,
    platformLabel: label,
    screen,
    external: true,
    candidate: link.candidate,
  }
}

function screenLink(league: LinkLeague, screen: SourceScreen): PlatformLink | null {
  const resolved = resolveSourceScreenLink({
    platform: league.platform,
    sourceLeagueId: league.platformLeagueId ?? null,
    leagueName: league.name ?? null,
    season: league.season ?? null,
    teamId: league.teamId ?? null,
    partnerTeamId: league.partnerTeamId ?? null,
    screen,
  })
  return resolved ? fromResolved(resolved, league.platform) : null
}

/** Where a lineup change is made — the "Where to fix it" destination. */
export function lineupLink(league: LinkLeague): PlatformLink | null {
  if (!normalizeSourcePlatform(league.platform)) {
    return internal(`/core/my-team?league=${encodeURIComponent(league.id)}`, 'My team')
  }
  return screenLink(league, 'lineup')
}

/** Where a free agent is claimed. */
export function claimLink(league: LinkLeague): PlatformLink | null {
  if (!normalizeSourcePlatform(league.platform)) {
    return internal(`/waiver-wire?leagueId=${encodeURIComponent(league.id)}`, 'Waivers')
  }
  return screenLink(league, 'waivers')
}

/**
 * Where a trade for a player another manager owns starts.
 *
 * Always AllFantasy's own trade screen for that league — it is the one that
 * grades the offer — with the platform's trade screen as the place the trade
 * is sent. Every launch provider's trade format is verified as of 2026-09-06
 * (Sleeper was the last); an unverified one would fall back to its league
 * page with the candidate carried, per the resolver's gate.
 */
export function tradeLink(league: LinkLeague): { here: PlatformLink; there: PlatformLink | null } {
  const here = internal(`/core/trades?league=${encodeURIComponent(league.id)}`, 'Trades')
  const there = normalizeSourcePlatform(league.platform) ? screenLink(league, 'trade') : null
  return { here, there }
}

/**
 * A handoff to the provider — only when it LANDS where it says.
 *
 * User decision, 2026-09-14 (one-tap provider handoff): Core triage, notification
 * rows, the since-last-visit brief and the matchup screen send the user to the
 * provider screen that acts on what they are looking at. A destination the resolver
 * cannot verify returns null — a homepage fallback, a missing league or team id, or
 * MFL / Fantrax / Fleaflicker, whose per-league URLs cannot be built from what is
 * stored — and the surface keeps its in-app destination. A button that promises
 * "your lineup" and opens a homepage is worse than no button.
 *
 * ⚠ UNLIKE `lineupLink` / `claimLink` ABOVE, THIS NEVER RETURNS THE LEAGUE PAGE UNDER
 * ANOTHER SCREEN'S NAME. Those fall back to the league page (labelled "League") so
 * Player Finder always has somewhere to point; a handoff is either the named screen
 * or nothing. `handoffFor` makes the league-page fallback an explicit, labelled choice.
 */
export function verifiedHandoff(league: LinkLeague, screen: SourceScreen): PlatformLink | null {
  if (!normalizeSourcePlatform(league.platform)) return null
  const resolved = resolveSourceScreenLink({
    platform: league.platform,
    sourceLeagueId: league.platformLeagueId ?? null,
    leagueName: league.name ?? null,
    season: league.season ?? null,
    teamId: league.teamId ?? null,
    partnerTeamId: league.partnerTeamId ?? null,
    screen,
  })
  if (!resolved || !resolved.verified) return null
  return fromResolved(resolved, league.platform)
}

/** The verified screen for the job, else that league's verified page (labelled "League"), else nothing. */
export function handoffFor(league: LinkLeague, screen: SourceScreen): PlatformLink | null {
  return verifiedHandoff(league, screen) ?? (screen === 'league' ? null : verifiedHandoff(league, 'league'))
}

/**
 * Every screen for a league, with what the link resolves to today and the
 * unverified URL each format would build — the verification pass's worksheet.
 */
export function deepLinkCandidates(league: LinkLeague): Array<{ screen: SourceScreen; href: string; verified: boolean; candidate: string | null }> {
  const out: Array<{ screen: SourceScreen; href: string; verified: boolean; candidate: string | null }> = []
  for (const screen of ['league', 'lineup', 'waivers', 'trade'] as const) {
    const resolved = resolveSourceScreenLink({
      platform: league.platform,
      sourceLeagueId: league.platformLeagueId ?? null,
      leagueName: league.name ?? null,
      season: league.season ?? null,
      teamId: league.teamId ?? null,
      partnerTeamId: league.partnerTeamId ?? null,
      screen,
    })
    if (resolved) out.push({ screen, href: resolved.href, verified: resolved.verified, candidate: resolved.candidate })
  }
  return out
}
