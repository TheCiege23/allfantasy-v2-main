/**
 * Classify a request for telemetry: which surface, which /core screen, which device class, and
 * what kind of navigation it is.
 *
 * PURE, TOTAL AND DEPENDENCY-FREE. It runs inside Sentry's sampler and event hooks, i.e. on every
 * request and in the browser, so it must never throw, never import app modules and never do I/O.
 *
 * ⚠ CARDINALITY IS THE CONSTRAINT. Every value returned here becomes a tag or span attribute that
 * Sentry indexes. An unbounded value (a league id, a player slug, a raw path segment) turns one
 * useful dimension into thousands of useless ones, so every free-form value is validated against a
 * charset and a length and collapses to `other` when it fails.
 */

export type Surface =
  | 'core'
  | 'league'
  | 'players'
  | 'landing'
  | 'auth'
  | 'admin'
  | 'page'
  | 'api'
  | 'job'
  | 'health'
  | 'asset'

export type DeviceClass = 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown'

export type NavigationKind = 'document' | 'rsc' | 'prefetch' | 'api' | 'other'

export type HeaderBag = Record<string, string | string[] | undefined> | undefined | null

export type RequestLike = {
  url?: string | null
  method?: string | null
  headers?: HeaderBag
}

export type RequestClassification = {
  surface: Surface
  /** Only for `core`: the screen segment (`home` for `/core`), or `other` when it fails validation. */
  screen: string | null
  /** Only for `job`: the job name, or `other`. */
  job: string | null
  device: DeviceClass
  nav: NavigationKind
  /** Only for `core`: whether a `?league=` scope was requested. */
  leagueScoped: boolean | null
  /** A low-cardinality key naming the route, for per-route sampling budgets. */
  routeKey: string
}

/** Railway's healthcheck and the deploy verifier poll these; they are noise for every budget. */
const HEALTH_PATHS = new Set(['/api/af-debug/sha', '/api/health', '/api/healthz', '/health', '/healthz'])

/**
 * Scheduled targets that do not live under `/api/cron/`. Mirrors the non-`/api/cron` entries of
 * `cron-schedule.json`. The dispatcher user-agent is checked FIRST, so a path missing from this
 * list is still classified correctly whenever the dispatcher calls it; the list only matters for a
 * hand-run curl.
 */
const JOB_PATHS = new Set([
  '/api/redraft/score-sync',
  '/api/redraft/waiver-process',
  '/api/keeper/session',
  '/api/redraft/ai/weekly-recap',
  '/api/redraft/ai/power-rankings',
  '/api/guillotine/ai/storyline',
  '/api/tournament/automation',
  '/api/weather/refresh-cron',
])

/** `scripts/cron-dispatch.mjs` and `scripts/cron-fast-tier-loop.mjs` both send this prefix. */
const CRON_USER_AGENT = /^allfantasy-cron-/i

const AUTH_PATHS = new Set([
  '/login',
  '/signup',
  '/register',
  '/choose-username',
  '/forgot-password',
  '/reset-password',
  '/verify',
  '/verify-email',
])

const ASSET_EXTENSION = /\.(?:png|jpe?g|gif|svg|ico|webp|avif|css|js|mjs|map|woff2?|ttf|otf|txt|xml|json|webmanifest)$/i

/** A safe, bounded segment: lowercase letters, digits and dashes, starting with a letter or digit. */
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9-]{0,39}$/

const BOT_USER_AGENT =
  /bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|embedly|preview|headless|lighthouse|pingdom|uptime|monitor|curl\/|wget\/|python-requests|python-urllib|axios\/|node-fetch|undici|^node$|go-http-client|okhttp|java\/|libwww|httpclient|allfantasy-cron-/i

const TABLET_USER_AGENT = /ipad|tablet|kindle|silk\/|playbook|nexus (?:7|9|10)|sm-t\d|android(?!.*mobile)/i

const MOBILE_USER_AGENT = /mobi|iphone|ipod|android.*mobile|windows phone|iemobile|opera mini|blackberry/i

const DESKTOP_USER_AGENT = /windows nt|macintosh|mac os x|x11|linux|cros/i

/** Case-insensitive header read that tolerates arrays, missing bags and non-string values. */
export function readHeader(headers: HeaderBag, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null
  const wanted = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== wanted) continue
    const value = headers[key]
    if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null
    return typeof value === 'string' ? value : value == null ? null : String(value)
  }
  return null
}

/** Pathname and search params from an absolute or relative URL. Never throws. */
export function parseRequestUrl(url: string | null | undefined): { pathname: string; searchParams: URLSearchParams } {
  const raw = typeof url === 'string' ? url.trim() : ''
  if (!raw) return { pathname: '/', searchParams: new URLSearchParams() }
  try {
    const parsed = new URL(raw, 'http://placeholder.invalid')
    return { pathname: normalizePathname(parsed.pathname), searchParams: parsed.searchParams }
  } catch {
    const [pathPart, queryPart = ''] = raw.split('?', 2)
    return { pathname: normalizePathname(pathPart), searchParams: new URLSearchParams(queryPart) }
  }
}

function normalizePathname(pathname: string): string {
  let path = pathname || '/'
  if (!path.startsWith('/')) path = `/${path}`
  // Collapse repeated slashes and drop a trailing slash, except for the root itself.
  path = path.replace(/\/{2,}/g, '/')
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  return path.toLowerCase()
}

function safeSegment(value: string | undefined): string {
  if (!value) return 'other'
  return SAFE_SEGMENT.test(value) ? value : 'other'
}

/**
 * Device class from a user-agent, with the `Sec-CH-UA-Mobile` client hint taking precedence when a
 * browser sends it.
 *
 * ⚠ iPadOS sends a desktop Safari user-agent, so an iPad reads as `desktop` here. The browser side
 * corrects for that with touch points; the server cannot.
 */
export function classifyDevice(userAgent: string | null | undefined, clientHintMobile?: string | null): DeviceClass {
  const ua = typeof userAgent === 'string' ? userAgent.trim() : ''
  if (!ua) return 'unknown'
  if (BOT_USER_AGENT.test(ua)) return 'bot'
  if (clientHintMobile === '?1') return 'mobile'
  if (TABLET_USER_AGENT.test(ua)) return 'tablet'
  if (MOBILE_USER_AGENT.test(ua)) return 'mobile'
  if (clientHintMobile === '?0' || DESKTOP_USER_AGENT.test(ua)) return 'desktop'
  return 'unknown'
}

function jobNameFromPath(pathname: string): string {
  if (pathname.startsWith('/api/cron/')) return safeSegment(pathname.slice('/api/cron/'.length).split('/')[0])
  const segments = pathname.split('/').filter(Boolean)
  // `/api/brackets/playoffs/cron/refresh-schedule` → `refresh-schedule`; `/api/redraft/score-sync` → `score-sync`.
  return safeSegment(segments[segments.length - 1])
}

function isJobPath(pathname: string): boolean {
  return pathname.startsWith('/api/cron/') || pathname.includes('/cron/') || JOB_PATHS.has(pathname)
}

function classifySurface(pathname: string, userAgent: string): Surface {
  if (HEALTH_PATHS.has(pathname)) return 'health'
  if (pathname.startsWith('/_next/') || pathname === '/sw.js' || pathname.startsWith('/icons/')) return 'asset'
  if (CRON_USER_AGENT.test(userAgent) || isJobPath(pathname)) return 'job'
  if (pathname === '/api' || pathname.startsWith('/api/')) return 'api'
  if (ASSET_EXTENSION.test(pathname)) return 'asset'
  if (pathname === '/core' || pathname.startsWith('/core/')) return 'core'
  if (pathname === '/') return 'landing'
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin'
  if (pathname.startsWith('/league/') || pathname === '/leagues' || pathname.startsWith('/leagues/')) return 'league'
  if (pathname === '/players' || pathname.startsWith('/players/')) return 'players'
  if (AUTH_PATHS.has(pathname) || pathname.startsWith('/auth/')) return 'auth'
  return 'page'
}

/**
 * A stable, bounded name for a route, used to give each route its own sampling budget.
 *
 * ⚠ PAGES KEEP ONLY THEIR FIRST SEGMENT. A crawler walking `/players/<slug>` presents thousands of
 * distinct paths, and a slug without digits does not look like an id. Keyed by full path, every
 * slug would get its own budget, which is the same as sampling the crawl at 100%.
 * API routes keep three segments (with id-looking ones collapsed to `:id`) because their second and
 * third segments name a resource, not a record.
 */
export function routeKeyFor(surface: Surface, pathname: string, screen: string | null, job: string | null): string {
  if (surface === 'core') return `core:${screen ?? 'other'}`
  if (surface === 'job') return `job:${job ?? 'other'}`
  if (surface === 'health' || surface === 'asset' || surface === 'landing') return surface
  const collapse = (segment: string) =>
    /\d/.test(segment) || segment.length > 24 || !SAFE_SEGMENT.test(segment) ? ':id' : segment
  const segments = pathname.split('/').filter(Boolean)
  const kept = surface === 'api' ? segments.slice(0, 3) : segments.slice(0, 1)
  return `${surface}:/${kept.map(collapse).join('/')}`
}

export function classifyNavigation(surface: Surface, headers: HeaderBag, searchParams: URLSearchParams): NavigationKind {
  if (surface === 'api' || surface === 'job' || surface === 'health') return 'api'
  if (surface === 'asset') return 'other'
  const prefetch = readHeader(headers, 'next-router-prefetch')
  const purpose = (readHeader(headers, 'sec-purpose') ?? readHeader(headers, 'purpose') ?? '').toLowerCase()
  if (prefetch === '1' || purpose.includes('prefetch')) return 'prefetch'
  if (readHeader(headers, 'rsc') === '1' || searchParams.has('_rsc')) return 'rsc'
  return 'document'
}

export function classifyRequest(request: RequestLike | null | undefined): RequestClassification {
  const headers = request?.headers ?? null
  const userAgent = readHeader(headers, 'user-agent') ?? ''
  const { pathname, searchParams } = parseRequestUrl(request?.url)
  const surface = classifySurface(pathname, userAgent)

  let screen: string | null = null
  let leagueScoped: boolean | null = null
  if (surface === 'core') {
    const segment = pathname === '/core' ? 'home' : pathname.slice('/core/'.length).split('/')[0]
    screen = safeSegment(segment)
    const league = searchParams.get('league')
    leagueScoped = typeof league === 'string' && league.trim().length > 0
  }

  const job = surface === 'job' ? jobNameFromPath(pathname) : null

  return {
    surface,
    screen,
    job,
    device: classifyDevice(userAgent, readHeader(headers, 'sec-ch-ua-mobile')),
    nav: classifyNavigation(surface, headers, searchParams),
    leagueScoped,
    routeKey: routeKeyFor(surface, pathname, screen, job),
  }
}

/** The classification as flat, string-valued telemetry tags. Absent dimensions are omitted, never `null`. */
export function requestTags(classification: RequestClassification): Record<string, string> {
  const tags: Record<string, string> = {
    'af.surface': classification.surface,
    'af.device': classification.device,
    'af.nav': classification.nav,
  }
  if (classification.screen) tags['af.screen'] = classification.screen
  if (classification.job) tags['af.job'] = classification.job
  if (classification.leagueScoped !== null) tags['af.league_scoped'] = classification.leagueScoped ? 'yes' : 'no'
  return tags
}
