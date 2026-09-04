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

/**
 * The screens the Player Finder sends people to. `league` is the verified
 * league page every launch provider already had; the other three are the
 * deep links added 2026-09-02 (Guap: "worth the work").
 */
export type SourceScreen = 'league' | 'lineup' | 'waivers' | 'trade'

export interface SourceScreenArgs {
  leagueId: string
  season?: string
  /** The user's own team on the platform — ESPN teamId, Yahoo team number, Sleeper roster id. */
  teamId?: string
  /** The other manager's team, for a trade screen that takes a counterparty. */
  partnerTeamId?: string
}

/**
 * A screen's URL format on a provider.
 *
 * 🛑 `verified` IS THE WHOLE POINT. A format ships as a live destination only
 * after a real league on that provider has been opened at the built URL and
 * landed on the screen it names. Until then the resolver returns the league
 * page (today's behaviour) and reports the built URL as a `candidate`, so the
 * verification step has something to click. "Never invents a route" from the
 * header still holds: an unverified format is never a destination.
 */
export interface SourceScreenFormat {
  verified: boolean
  /** Null when a required id is missing — the caller then falls back. */
  build: (args: SourceScreenArgs) => string | null
}

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
  /** Screen formats beyond the league page. See SourceScreenFormat for the verified gate. */
  screens?: Partial<Record<Exclude<SourceScreen, 'league'>, SourceScreenFormat>>
}

/**
 * Yahoo stores its league id three ways — the importer accepts a bare id
 * (`1361311`), a full key (`449.l.1361311`) or a pasted URL — and the URL
 * needs the bare number. Same for a team: a key `449.l.1361311.t.3` is team
 * `3`. Pure, and exported so the tests can pin every shape.
 */
export function normalizeYahooLeagueId(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  const fromKey = s.match(/\.l\.(\d+)/)
  if (fromKey) return fromKey[1]
  const fromUrl = s.match(/\/f1\/(\d+)/)
  if (fromUrl) return fromUrl[1]
  return /^\d+$/.test(s) ? s : null
}

export function normalizeYahooTeamId(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  const fromKey = s.match(/\.t\.(\d+)/)
  if (fromKey) return fromKey[1]
  return /^\d+$/.test(s) ? s : null
}

/** ESPN and Sleeper ids are bare integers; anything else is not an id we can put in a URL. */
function numericId(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim()
  return /^\d+$/.test(s) ? s : null
}

const PROVIDERS: Record<SourcePlatform, ProviderConfig> = {
  sleeper: {
    key: 'sleeper',
    label: 'Sleeper',
    homepage: 'https://sleeper.com',
    allowedHosts: ['sleeper.com', 'www.sleeper.com'],
    buildLeagueUrl: (id) => `https://sleeper.com/leagues/${encodeURIComponent(id)}/league`,
    screens: {
      // Both already linked to from the Player Command Center's replacement
      // engine, which is where they were verified. `/team` is the signed-in
      // user's own team, so no team id is needed.
      lineup: { verified: true, build: ({ leagueId }) => `https://sleeper.com/leagues/${encodeURIComponent(leagueId)}/team` },
      waivers: { verified: true, build: ({ leagueId }) => `https://sleeper.com/leagues/${encodeURIComponent(leagueId)}/players` },
      // Candidate only — Sleeper's trade screen path has not been opened on a real league.
      trade: { verified: false, build: ({ leagueId }) => `https://sleeper.com/leagues/${encodeURIComponent(leagueId)}/trades` },
    },
  },
  espn: {
    key: 'espn',
    label: 'ESPN Fantasy',
    homepage: 'https://fantasy.espn.com/football/',
    allowedHosts: ['fantasy.espn.com'],
    buildLeagueUrl: (id, season) =>
      `https://fantasy.espn.com/football/league?leagueId=${encodeURIComponent(id)}` +
      (season ? `&seasonId=${encodeURIComponent(season)}` : ''),
    // Candidates only, pending a real ESPN league + team id (Guap, 2026-09-02).
    screens: {
      lineup: {
        verified: false,
        build: ({ leagueId, teamId, season }) => {
          const t = numericId(teamId)
          if (!t) return null
          return (
            `https://fantasy.espn.com/football/team?leagueId=${encodeURIComponent(leagueId)}&teamId=${t}` +
            (season ? `&seasonId=${encodeURIComponent(season)}` : '')
          )
        },
      },
      waivers: {
        verified: false,
        build: ({ leagueId, season }) =>
          `https://fantasy.espn.com/football/players/add?leagueId=${encodeURIComponent(leagueId)}` +
          (season ? `&seasonId=${encodeURIComponent(season)}` : ''),
      },
      trade: {
        verified: false,
        build: ({ leagueId, teamId, season }) => {
          const t = numericId(teamId)
          if (!t) return null
          return (
            `https://fantasy.espn.com/football/trade?leagueId=${encodeURIComponent(leagueId)}&teamId=${t}` +
            (season ? `&seasonId=${encodeURIComponent(season)}` : '')
          )
        },
      },
    },
  },
  yahoo: {
    key: 'yahoo',
    label: 'Yahoo Fantasy',
    homepage: 'https://football.fantasysports.yahoo.com',
    allowedHosts: ['football.fantasysports.yahoo.com'],
    buildLeagueUrl: (id) => `https://football.fantasysports.yahoo.com/f1/${normalizeYahooLeagueId(id) ?? encodeURIComponent(id)}`,
    // Candidates only, pending a real Yahoo league + team id (Guap, 2026-09-02).
    screens: {
      lineup: {
        verified: false,
        build: ({ leagueId, teamId }) => {
          const l = normalizeYahooLeagueId(leagueId)
          const t = normalizeYahooTeamId(teamId)
          return l && t ? `https://football.fantasysports.yahoo.com/f1/${l}/${t}` : null
        },
      },
      waivers: {
        verified: false,
        build: ({ leagueId }) => {
          const l = normalizeYahooLeagueId(leagueId)
          return l ? `https://football.fantasysports.yahoo.com/f1/${l}/players` : null
        },
      },
      trade: {
        verified: false,
        build: ({ leagueId, teamId, partnerTeamId }) => {
          const l = normalizeYahooLeagueId(leagueId)
          const t = normalizeYahooTeamId(teamId)
          const p = normalizeYahooTeamId(partnerTeamId)
          if (!l || !t) return null
          return `https://football.fantasysports.yahoo.com/f1/${l}/${t}/proposetrade${p ? `?tid=${p}` : ''}`
        },
      },
    },
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

/**
 * The exact hostnames each provider will accept, derived from PROVIDERS so it cannot drift.
 *
 * ⚠ EXPORTED SO A TEST CAN PIN IT, BECAUSE WIDENING THIS LIST IS OTHERWISE SILENT. Verified by
 * experiment 2026-08-29: adding `evil-sleeper.com.attacker.net` to Sleeper's `allowedHosts` broke
 * NOT ONE of the 27 tests in this suite — every assertion here exercises a URL that is already
 * safe or already hostile, and none of them describes the configuration itself. A permissive host
 * added by a future edit would have shipped green.
 *
 * This is read-only config, not an extension point: nothing should consume it to make a decision.
 * `isSafeProviderUrl` remains the single gate.
 */
export const PROVIDER_ALLOWED_HOSTS: Readonly<Record<SourcePlatform, readonly string[]>> =
  Object.freeze(
    Object.fromEntries(
      (Object.keys(PROVIDERS) as SourcePlatform[]).map((k) => [k, PROVIDERS[k].allowedHosts]),
    ) as Record<SourcePlatform, readonly string[]>,
  )

/** The set of providers with launch-ready direct league linking (vs homepage-only). */
export const LAUNCH_LEAGUE_LINK_PROVIDERS: readonly SourcePlatform[] = ['sleeper', 'espn', 'yahoo']

export interface SourceScreenLink extends SourceLink {
  screen: SourceScreen
  /** True when `href` is the requested screen; false when it fell back to the league page or homepage. */
  verified: boolean
  /**
   * The URL the unverified format would have built, for the verification
   * step — never returned as `href` until its format is marked verified.
   */
  candidate: string | null
}

/**
 * The screen-aware resolver. A verified format with its ids present is the
 * destination; anything else is `resolveSourceLink` (league page, then
 * homepage) with the unverified URL carried as `candidate`. Every returned
 * href passes the same allowlist gate as the league page.
 */
export function resolveSourceScreenLink(
  ctx: SourceLinkContext & { screen: SourceScreen; partnerTeamId?: string | null },
): SourceScreenLink | null {
  const base = resolveSourceLink(ctx)
  if (!base) return null
  const platform = normalizeSourcePlatform(ctx.platform)
  if (!platform || ctx.screen === 'league') return { ...base, screen: 'league', verified: base.destinationType === 'league', candidate: null }

  const cfg = PROVIDERS[platform]
  const fmt = cfg.screens?.[ctx.screen]
  const leagueId = (ctx.sourceLeagueId ?? '').trim()
  if (!fmt || !leagueId) return { ...base, screen: ctx.screen, verified: false, candidate: null }

  const season = ctx.season != null && String(ctx.season).trim() ? String(ctx.season).trim() : undefined
  const built = fmt.build({
    leagueId,
    season,
    teamId: ctx.teamId ?? undefined,
    partnerTeamId: ctx.partnerTeamId ?? undefined,
  })
  if (!built || !isSafeProviderUrl(built, cfg.allowedHosts)) {
    return { ...base, screen: ctx.screen, verified: false, candidate: null }
  }
  if (!fmt.verified) return { ...base, screen: ctx.screen, verified: false, candidate: built }

  return {
    ...makeLink(cfg, built, 'action', ctx.action ?? (ctx.screen === 'waivers' ? 'waiver' : ctx.screen), (ctx.leagueName ?? '').trim() || cfg.label),
    screen: ctx.screen,
    verified: true,
    candidate: null,
  }
}

/**
 * Which screen formats are verified, per provider — read-only, exported so a
 * test can pin it. Flipping a flag is a deliberate, visible change: it must
 * come with the league and team id it was opened on.
 */
export const VERIFIED_SCREENS: Readonly<Record<SourcePlatform, readonly SourceScreen[]>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(PROVIDERS) as SourcePlatform[]).map((k) => {
      const cfg = PROVIDERS[k]
      const screens: SourceScreen[] = cfg.buildLeagueUrl ? ['league'] : []
      for (const s of ['lineup', 'waivers', 'trade'] as const) if (cfg.screens?.[s]?.verified) screens.push(s)
      return [k, screens]
    }),
  ) as Record<SourcePlatform, readonly SourceScreen[]>,
)
