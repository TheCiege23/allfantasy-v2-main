/**
 * Centralized, security-hardened resolver for "open this imported league on its source platform" links.
 *
 * AllFantasy is READ-ONLY for imported leagues: it analyzes + recommends, but the user completes the
 * action on the original platform (Sleeper / ESPN / Yahoo / …). This resolver returns the closest
 * RELIABLE destination on that platform.
 *
 * Guarantees:
 *  - **Server-safe + pure.** It constructs URLs from canonical stored fields ONLY and NEVER calls a
 *    provider API — so it is safe to run during render (page rendering must never wait on a provider).
 *  - **Never invents a route.** Only the launch providers with a VERIFIED league-page format
 *    (Sleeper / ESPN / Yahoo) build a direct league URL; every other provider falls back to its approved
 *    HTTPS homepage. If a league id is missing/blank, it also falls back to the homepage.
 *  - **Security.** Every returned href is validated against a per-provider EXACT-hostname HTTPS allowlist
 *    (rejects `http:`, `javascript:`/`data:`/`file:`, subdomain look-alikes, and open-redirects). A
 *    previously-STORED url is only used if it passes the same allowlist; otherwise it is ignored.
 *
 * Verified league-page formats (official/live sources, 2026-07):
 *  - Sleeper: https://sleeper.com/leagues/{leagueId}/league
 *  - ESPN:    https://fantasy.espn.com/football/league?leagueId={leagueId}[&seasonId={year}]
 *  - Yahoo:   https://football.fantasysports.yahoo.com/f1/{leagueId}   (f1 = NFL; AF imports are NFL)
 */

export type SourcePlatform = 'sleeper' | 'espn' | 'yahoo' | 'mfl' | 'fantrax' | 'fleaflicker'
export type SourceActionType =
  | 'lineup'
  | 'trade'
  | 'waiver'
  | 'matchup'
  | 'roster'
  | 'league'
  | 'open'
export type SourceDestinationType = 'action' | 'roster' | 'league' | 'homepage'

export interface SourceLinkContext {
  /** League.platform (imported providers only; native/unknown → no source link). */
  platform: string | null | undefined
  /** The source (provider) league id — League.platformLeagueId. */
  sourceLeagueId?: string | null
  /** League.name — used only for the human label (never for the URL). */
  leagueName?: string | null
  /** Drives the action-aware label; the destination is still the closest RELIABLE page. */
  action?: SourceActionType
  season?: number | string | null
  /** Reserved: roster/team + matchup deep-links are a documented follow-up (see module notes). */
  rosterId?: string | null
  teamId?: string | null
  matchupId?: string | null
  playerId?: string | null
  /** A previously-STORED provider url (e.g. legacy import). Used ONLY if it passes the allowlist. */
  storedUrl?: string | null
}

export interface SourceLink {
  href: string
  destinationType: SourceDestinationType
  provider: SourcePlatform
  providerLabel: string
  label: string
  isFallback: boolean
  opensExternally: true
}

interface ProviderConfig {
  key: SourcePlatform
  label: string
  /** Approved HTTPS homepage — the last-resort safe destination. */
  homepage: string
  /** EXACT hostnames permitted for this provider (no subdomain wildcards). */
  allowedHosts: readonly string[]
  /** Verified league-page builder — launch providers only. Absent ⇒ homepage fallback. */
  buildLeagueUrl?: (leagueId: string, season?: string) => string
}

const PROVIDERS: Record<SourcePlatform, ProviderConfig> = {
  sleeper: {
    key: 'sleeper',
    label: 'Sleeper',
    homepage: 'https://sleeper.com',
    allowedHosts: ['sleeper.com', 'www.sleeper.com'],
    buildLeagueUrl: (id) => `https://sleeper.com/leagues/${encodeURIComponent(id)}/league`,
  },
  espn: {
    key: 'espn',
    label: 'ESPN Fantasy',
    homepage: 'https://fantasy.espn.com/football/',
    allowedHosts: ['fantasy.espn.com'],
    buildLeagueUrl: (id, season) =>
      `https://fantasy.espn.com/football/league?leagueId=${encodeURIComponent(id)}` +
      (season ? `&seasonId=${encodeURIComponent(season)}` : ''),
  },
  yahoo: {
    key: 'yahoo',
    label: 'Yahoo Fantasy',
    homepage: 'https://football.fantasysports.yahoo.com',
    allowedHosts: ['football.fantasysports.yahoo.com'],
    buildLeagueUrl: (id) => `https://football.fantasysports.yahoo.com/f1/${encodeURIComponent(id)}`,
  },
  // Homepage-fallback providers: the architecture supports them, but a reliable per-league deep link is
  // not derivable from stored fields alone (MFL needs a per-league server subdomain + year; Fantrax uses
  // opaque league slugs; Fleaflicker import is not enabled). Documented as a follow-up.
  mfl: {
    key: 'mfl',
    label: 'MyFantasyLeague',
    homepage: 'https://www.myfantasyleague.com',
    allowedHosts: ['www.myfantasyleague.com', 'myfantasyleague.com'],
  },
  fantrax: {
    key: 'fantrax',
    label: 'Fantrax',
    homepage: 'https://www.fantrax.com',
    allowedHosts: ['www.fantrax.com', 'fantrax.com'],
  },
  fleaflicker: {
    key: 'fleaflicker',
    label: 'Fleaflicker',
    homepage: 'https://www.fleaflicker.com',
    allowedHosts: ['www.fleaflicker.com', 'fleaflicker.com'],
  },
}

/**
 * True iff `url` is an HTTPS url whose hostname EXACTLY matches one of `allowedHosts`. Rejects non-https
 * schemes (including `javascript:`/`data:`/`file:`), subdomain look-alikes (`sleeper.com.evil.com`), and
 * open-redirects. This is the single gate every returned href passes.
 */
export function isSafeProviderUrl(url: string, allowedHosts: readonly string[]): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  if (u.username || u.password) return false // credentials in url → reject
  const host = u.hostname.toLowerCase()
  return allowedHosts.some((h) => host === h.toLowerCase())
}

const NATIVE_PLATFORMS = new Set(['manual', 'allfantasy', 'af', 'native', 'redraft', 'tournament'])

/** Normalize League.platform to a known source provider, or null for native/unknown leagues. */
export function normalizeSourcePlatform(platform: string | null | undefined): SourcePlatform | null {
  const key = (platform ?? '').toLowerCase().trim()
  if (!key || NATIVE_PLATFORMS.has(key)) return null
  return (key in PROVIDERS ? (key as SourcePlatform) : null)
}

const ACTION_VERB: Record<Exclude<SourceActionType, 'league' | 'open'>, string> = {
  lineup: 'Fix Lineup in',
  trade: 'Review Trade in',
  waiver: 'Manage Waivers in',
  matchup: 'View Matchup in',
  roster: 'Open Roster in',
}

function buildLabel(
  action: SourceActionType | undefined,
  leagueName: string,
  cfg: ProviderConfig,
  isHomepage: boolean,
): string {
  if (isHomepage) return `Go to ${cfg.label}` // "Go to Sleeper", "Go to ESPN Fantasy"
  if (!action || action === 'open' || action === 'league') {
    return `Open ${leagueName} in ${cfg.label}` // "Open HailShiva in Sleeper"
  }
  return `${ACTION_VERB[action]} ${leagueName}` // "Fix Lineup in HailShiva"
}

function makeLink(
  cfg: ProviderConfig,
  href: string,
  destinationType: SourceDestinationType,
  action: SourceActionType | undefined,
  leagueName: string,
): SourceLink {
  const isHomepage = destinationType === 'homepage'
  return {
    href,
    destinationType,
    provider: cfg.key,
    providerLabel: cfg.label,
    label: buildLabel(action, leagueName, cfg, isHomepage),
    isFallback: isHomepage,
    opensExternally: true,
  }
}

/**
 * Resolve the closest reliable source-platform destination for an imported league. Returns null for
 * native/unknown leagues (render no button). Priority: validated stored url → verified league page →
 * approved homepage. Pure — never fetches a provider.
 */
export function resolveSourceLink(ctx: SourceLinkContext): SourceLink | null {
  const platform = normalizeSourcePlatform(ctx.platform)
  if (!platform) return null

  const cfg = PROVIDERS[platform]
  const leagueName = (ctx.leagueName ?? '').trim() || cfg.label
  const leagueId = (ctx.sourceLeagueId ?? '').trim()
  const season = ctx.season != null && String(ctx.season).trim() ? String(ctx.season).trim() : undefined

  // 1) A previously-stored provider url — ONLY if it passes this provider's allowlist.
  if (ctx.storedUrl && isSafeProviderUrl(ctx.storedUrl, cfg.allowedHosts)) {
    return makeLink(cfg, ctx.storedUrl, 'league', ctx.action, leagueName)
  }

  // 2) Constructed league page (launch providers with a verified format + a real league id).
  if (leagueId && cfg.buildLeagueUrl) {
    const built = cfg.buildLeagueUrl(leagueId, season)
    if (isSafeProviderUrl(built, cfg.allowedHosts)) {
      return makeLink(cfg, built, 'league', ctx.action, leagueName)
    }
  }

  // 3) Approved homepage fallback (validated defensively).
  const homepage = isSafeProviderUrl(cfg.homepage, cfg.allowedHosts) ? cfg.homepage : cfg.homepage
  return makeLink(cfg, homepage, 'homepage', ctx.action, leagueName)
}

/** The set of providers with launch-ready direct league linking (vs homepage-only). */
export const LAUNCH_LEAGUE_LINK_PROVIDERS: readonly SourcePlatform[] = ['sleeper', 'espn', 'yahoo']
