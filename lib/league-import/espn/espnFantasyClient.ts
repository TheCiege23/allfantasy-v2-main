/**
 * ESPN fantasy API transport — THE one place that talks HTTP to `lm-api-reads.fantasy.espn.com`.
 *
 * ESPN's v3 league API is unofficial: no docs, no rate limits, no notice before it changes. So every
 * ESPN league read (import, preview, test-connection, sync, the legacy guest read) goes through
 * here, and a future ESPN change is a fix in this file rather than a hunt across the repo:
 *
 *   - per-request timeout, bounded retries with exponential backoff + jitter on TRANSIENT failures
 *     only (network, timeout, 5xx, 429 — honouring a short `Retry-After`);
 *   - definitive statuses (401/403/404/other 4xx) thrown immediately as `EspnApiResponseError`, so
 *     the public→private detection in callers keeps exact semantics;
 *   - a response that is not a JSON object becomes `EspnFormatChangedError` ("ESPN import
 *     temporarily unavailable") instead of a parser crash three files away;
 *   - a short-lived in-process cache with in-flight de-duplication, so one import — which reads the
 *     same league in the commissioner gate and again in the pipeline — costs ESPN one request.
 *
 * 🛑 THE COOKIES ARE A LOGGED-IN ESPN SESSION. Treat them like a password:
 *   - they travel ONLY as a `Cookie` header, never in a URL (`espnFantasyLeagueUrl` refuses nothing
 *     because nothing secret is ever passed to it);
 *   - no error message built here contains them, or ESPN's raw response body — the body can echo
 *     request data, and these messages reach users and Sentry. A redacted, truncated snippet is kept
 *     on `.bodySnippet` for server-side diagnosis only;
 *   - the cache key holds a one-way fingerprint of the cookie header, never the header.
 *   `redactEspnSecrets` is exported for any caller that has to log something near them.
 */

import { createHash } from 'crypto'

import { espnFantasyLeagueUrl, type EspnFantasyGame } from '@/lib/providers/espnUrls'

export type EspnCredentials = {
  swid: string | null
  espnS2: string | null
}

/** Plain-English, user-safe. Every message below is shown to users as-is. */
export const ESPN_UNAVAILABLE_MESSAGE =
  'ESPN import is temporarily unavailable — ESPN is not responding right now. Please try again in a few minutes.'
export const ESPN_FORMAT_CHANGED_MESSAGE =
  'ESPN import is temporarily unavailable — ESPN changed how it sends league data. Please try again later; your saved leagues are not affected.'

/** A definitive (non-retryable) HTTP status from ESPN. The message is safe to show. */
export class EspnApiResponseError extends Error {
  readonly status: number
  /** Redacted, truncated response body — server-side diagnosis only, never sent to a client. */
  readonly bodySnippet: string

  constructor(status: number, bodySnippet = '') {
    super(`ESPN responded with HTTP ${status}.`)
    this.name = 'EspnApiResponseError'
    this.status = status
    this.bodySnippet = bodySnippet
  }
}

/** Network failure, timeout, 5xx or 429 that survived every retry. Retryable later. */
export class EspnUnavailableError extends Error {
  readonly attempts: number
  readonly lastStatus: number | null

  constructor(attempts: number, lastStatus: number | null) {
    super(ESPN_UNAVAILABLE_MESSAGE)
    this.name = 'EspnUnavailableError'
    this.attempts = attempts
    this.lastStatus = lastStatus
  }
}

/** ESPN answered 200 with something that is not the league object we parse. */
export class EspnFormatChangedError extends Error {
  readonly detail: string

  constructor(detail: string) {
    super(ESPN_FORMAT_CHANGED_MESSAGE)
    this.name = 'EspnFormatChangedError'
    this.detail = detail
  }
}

/* ── Secret handling ──────────────────────────────────────────────────────────────────────── */

const GUID_RE = /\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?/gi
const COOKIE_PAIR_RE = /\b(espn_s2|swid|cookie)\s*[=:]\s*("[^"]*"|[^;\s,&"'}]+)/gi
/** An `espn_s2`-shaped run: long, no spaces, URL-encoded base64. */
const LONG_TOKEN_RE = /[A-Za-z0-9%+/=_\-.]{80,}/g

/**
 * Strip anything that could be an ESPN session from text before it is logged, stored or returned.
 * Removes the exact values when given, `name=value` cookie pairs, GUIDs (a SWID is one) and long
 * opaque tokens. Conservative by design: it would rather blank a harmless id than leak a cookie.
 */
export function redactEspnSecrets(text: string, credentials?: Partial<EspnCredentials> | null): string {
  if (!text) return ''
  let out = String(text)
  for (const secret of [credentials?.espnS2, credentials?.swid]) {
    const value = secret?.trim()
    if (value && value.length >= 6) {
      out = out.split(value).join('[REDACTED]')
      const encoded = encodeURIComponent(value)
      if (encoded !== value) out = out.split(encoded).join('[REDACTED]')
    }
  }
  out = out.replace(COOKIE_PAIR_RE, (_m, name: string) => `${name}=[REDACTED]`)
  out = out.replace(GUID_RE, '[REDACTED]')
  out = out.replace(LONG_TOKEN_RE, '[REDACTED]')
  return out
}

/** `SWID=…; espn_s2=…`, or null unless BOTH are present. */
export function buildEspnCookieHeader(credentials: EspnCredentials | null | undefined): string | null {
  const swid = credentials?.swid?.trim()
  const espnS2 = credentials?.espnS2?.trim()
  if (!swid || !espnS2) return null
  return `SWID=${swid}; espn_s2=${espnS2}`
}

function fingerprint(cookieHeader: string | null): string {
  if (!cookieHeader) return 'public'
  return createHash('sha256').update(cookieHeader).digest('hex').slice(0, 16)
}

/* ── Cookie input validation (what users paste) ───────────────────────────────────────────── */

type EspnCookieValidation =
  | { ok: true; swid: string; espnS2: string }
  | { ok: false; field: 'swid' | 'espnS2' | 'both'; message: string }

function stripPasteNoise(value: string, cookieName: string): string {
  const unquote = (s: string) => s.replace(/^["'\s]+|["';\s]+$/g, '')
  // A whole "name=value" copied out of devtools, quoted either outside or inside the prefix.
  const prefix = new RegExp(`^${cookieName}\\s*[=:]\\s*`, 'i')
  return unquote(unquote(String(value ?? '')).replace(prefix, ''))
}

/**
 * Check pasted cookie values BEFORE anything is saved or sent to ESPN, and say exactly what is
 * wrong. Format only — whether ESPN accepts them is what the test connection answers. The common
 * failures this catches: the two boxes swapped, a `espn_s2=` prefix copied along with the value,
 * a selection cut short, and SWID pasted without its braces (which ESPN needs).
 */
export function validateEspnCookieInput(input: { swid?: string | null; espnS2?: string | null }): EspnCookieValidation {
  const swidRaw = stripPasteNoise(input.swid ?? '', 'SWID')
  const s2Raw = stripPasteNoise(input.espnS2 ?? '', 'espn_s2')
  if (!swidRaw && !s2Raw) return { ok: false, field: 'both', message: 'Paste both the SWID and espn_s2 values.' }
  if (!swidRaw) return { ok: false, field: 'swid', message: 'Paste the SWID value too — both cookies are needed.' }
  if (!s2Raw) return { ok: false, field: 'espnS2', message: 'Paste the espn_s2 value too — both cookies are needed.' }

  const guid = /^\{?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}?$/i
  const swidMatch = swidRaw.match(guid)
  if (!swidMatch) {
    if (s2Raw.match(guid)) {
      return { ok: false, field: 'both', message: 'The two values look swapped — SWID is the short one in {curly braces}.' }
    }
    return {
      ok: false,
      field: 'swid',
      message: 'SWID should look like {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}, including the curly braces.',
    }
  }
  if (/\s/.test(s2Raw) || s2Raw.includes('…')) {
    return { ok: false, field: 'espnS2', message: 'espn_s2 should be one unbroken value. Double-click the Value cell to select all of it, then copy again.' }
  }
  if (s2Raw.length < 100) {
    return {
      ok: false,
      field: 'espnS2',
      message: 'That espn_s2 value looks cut short — it is usually several hundred characters. Double-click the Value cell to select all of it.',
    }
  }
  if (!/^[A-Za-z0-9%+/=_\-.]+$/.test(s2Raw)) {
    return { ok: false, field: 'espnS2', message: 'That espn_s2 value has characters a cookie cannot contain — copy just the Value cell.' }
  }
  // Braces restored if they were dropped; case left exactly as ESPN issued it.
  return { ok: true, swid: `{${swidMatch[1]}}`, espnS2: s2Raw }
}

/* ── Transport ────────────────────────────────────────────────────────────────────────────── */

const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_RETRIES = 3
const BASE_BACKOFF_MS = 400
const MAX_RETRY_AFTER_MS = 5_000
const DEFAULT_CACHE_TTL_MS = 45_000
const MAX_CACHE_ENTRIES = 200

/**
 * The User-Agent the NFL fantasy reads have always sent. Kept byte-identical so moving them onto this
 * client changes nothing ESPN sees. The MLB contract was captured WITHOUT one (`contracts/espn/README.md`:
 * "send Accept: application/json and nothing that imitates a browser"), so its reads pass
 * `userAgent: null` and send exactly the captured headers.
 */
const ESPN_LEGACY_USER_AGENT = 'Mozilla/5.0 (compatible; AllFantasy/1.0)'

type CacheEntry = { expiresAt: number; value: Promise<unknown> }
const responseCache = new Map<string, CacheEntry>()

/** Test seam. */
export function clearEspnResponseCache(): void {
  responseCache.clear()
}

export type EspnFetchJsonOptions = {
  cookieHeader?: string | null
  extraHeaders?: Record<string, string>
  /** Defaults to `ESPN_LEGACY_USER_AGENT`; null sends none. */
  userAgent?: string | null
  timeoutMs?: number
  retries?: number
  /** 0 disables caching for this call. */
  cacheTtlMs?: number
  /** Expect a JSON object (league reads). Arrays and primitives become EspnFormatChangedError. */
  expectObject?: boolean
  /** Injected for tests. */
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function backoffMs(attempt: number): number {
  const base = BASE_BACKOFF_MS * 2 ** attempt
  return base + Math.floor(Math.random() * base * 0.25)
}

/** Parse a 200's body. A body that is not JSON is ESPN changing shape, not a crash. */
async function readJsonBody(response: Response): Promise<unknown> {
  // Some test doubles (and some runtimes' mocks) expose only `.json()`.
  if (typeof response.text !== 'function') {
    try {
      return await response.json()
    } catch {
      throw new EspnFormatChangedError('non-JSON body')
    }
  }
  const text = await response.text().catch(() => null)
  if (text == null) throw new EspnFormatChangedError('unreadable body')
  try {
    return JSON.parse(text)
  } catch {
    throw new EspnFormatChangedError(`non-JSON body (${response.headers?.get?.('content-type') ?? 'no content-type'})`)
  }
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers?.get?.('retry-after')
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
  return null
}

async function readBodySnippet(response: Response, cookieHeader: string | null): Promise<string> {
  const text = typeof response.text === 'function' ? await response.text().catch(() => '') : ''
  return redactEspnSecrets(text.slice(0, 400), cookieHeaderToCredentials(cookieHeader)).slice(0, 200)
}

function cookieHeaderToCredentials(cookieHeader: string | null): EspnCredentials | null {
  if (!cookieHeader) return null
  const swid = cookieHeader.match(/SWID=([^;]+)/)?.[1] ?? null
  const espnS2 = cookieHeader.match(/espn_s2=([^;]+)/)?.[1] ?? null
  return { swid, espnS2 }
}

async function fetchUncached(url: string, opts: EspnFetchJsonOptions): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? defaultSleep
  const retries = Math.max(1, opts.retries ?? DEFAULT_RETRIES)
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const cookieHeader = opts.cookieHeader ?? null
  const userAgent = opts.userAgent === undefined ? ESPN_LEGACY_USER_AGENT : opts.userAgent
  const headers: Record<string, string> = { Accept: 'application/json', ...(userAgent ? { 'User-Agent': userAgent } : {}), ...opts.extraHeaders }
  if (cookieHeader) headers.Cookie = cookieHeader

  let lastStatus: number | null = null
  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: Response
    try {
      response = await fetchImpl(url, { headers, cache: 'no-store', signal: controller.signal })
    } catch {
      clearTimeout(timer)
      // Never surface the thrown error: undici's can carry request details.
      if (attempt < retries - 1) {
        await sleep(backoffMs(attempt))
        continue
      }
      break
    }
    clearTimeout(timer)

    if (response.ok) {
      const parsed = await readJsonBody(response)
      if (opts.expectObject && (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))) {
        throw new EspnFormatChangedError(Array.isArray(parsed) ? 'array where a league object was expected' : 'non-object JSON')
      }
      return parsed
    }

    lastStatus = response.status
    const transient = response.status >= 500 || response.status === 429
    if (transient && attempt < retries - 1) {
      await Promise.resolve(response.body?.cancel?.()).catch(() => {})
      await sleep(retryAfterMs(response) ?? backoffMs(attempt))
      continue
    }
    if (transient) break
    throw new EspnApiResponseError(response.status, await readBodySnippet(response, cookieHeader))
  }

  throw new EspnUnavailableError(retries, lastStatus)
}

/**
 * GET an ESPN fantasy URL and return parsed JSON. Successful responses are cached briefly per
 * (url, credential fingerprint); failures are never cached.
 */
export async function fetchEspnFantasyJson(url: string, opts: EspnFetchJsonOptions = {}): Promise<unknown> {
  /*
   * ⚠ OFF BY DEFAULT UNDER TEST. Suites here stub `fetch` per test with the SAME league URL and a
   * different response each time; a cache shared across those tests would hand one test the
   * previous test's league and pass or fail for the wrong reason. A test that wants the cache
   * asks for it with an explicit `cacheTtlMs`.
   */
  const ttl = opts.cacheTtlMs ?? (process.env.NODE_ENV === 'test' ? 0 : DEFAULT_CACHE_TTL_MS)
  if (ttl <= 0) return fetchUncached(url, opts)

  const key = `${url}|${fingerprint(opts.cookieHeader ?? null)}|${JSON.stringify(opts.extraHeaders ?? {})}`
  const now = Date.now()
  const hit = responseCache.get(key)
  if (hit && hit.expiresAt > now) return hit.value

  const value = fetchUncached(url, opts)
  responseCache.set(key, { expiresAt: now + ttl, value })
  value.catch(() => {
    if (responseCache.get(key)?.value === value) responseCache.delete(key)
  })
  // Map iteration is insertion order, so the first key is the oldest entry.
  while (responseCache.size > MAX_CACHE_ENTRIES) {
    const oldest = responseCache.keys().next().value
    if (oldest === undefined || oldest === key) break
    responseCache.delete(oldest)
  }
  return value
}

/**
 * Every ESPN fantasy read in the repo goes through this, and it is the ONLY place a URL is built —
 * so the DB-first guard has exactly one ESPN fantasy call site to report, and a moved endpoint is a
 * one-line change.
 *
 *   league        `/leagues/{id}?view=...`
 *   communication `/leagues/{id}/communication/?view=kona_league_communication` (activity feed)
 */
export function fetchEspnLeagueJson(
  args: {
    game?: EspnFantasyGame
    season: number
    leagueId: string
    views: readonly string[]
    subPath?: 'communication/'
  },
  opts: EspnFetchJsonOptions = {},
): Promise<unknown> {
  const url = espnFantasyLeagueUrl({ // db-first-exception: authorized league import ingestion; the single ESPN fantasy adapter (see header)
    game: args.game ?? 'ffl',
    season: args.season,
    leagueId: args.leagueId,
    views: args.views,
    subPath: args.subPath,
  })
  return fetchEspnFantasyJson(url, { expectObject: true, ...opts })
}

/**
 * Seasons to try, in order, when nobody told us which one. ESPN keys an NFL fantasy league on the
 * year its season STARTS, and that season runs September to January:
 *
 *   January        → last year first (the playoffs may still be on), then this year.
 *   rest of year   → this year first (a renewed league), then last year (not renewed yet).
 *
 * Guessing the calendar year alone 404s a league that has not been renewed for most of the
 * offseason, and in January it reads the wrong season outright.
 */
export function espnDefaultSeasonCandidates(now: Date = new Date()): number[] {
  const year = now.getFullYear()
  return now.getMonth() === 0 ? [year - 1, year] : [year, year - 1]
}

/** The season an NFL fantasy league is "in" right now — the first of the default candidates. */
export function espnCurrentFantasySeason(now: Date = new Date()): number {
  return espnDefaultSeasonCandidates(now)[0]
}

/**
 * `fetchEspnLeagueJson` across several seasons: a 404 moves on to the next one, anything else
 * (401/403, unavailable, format change) is a real answer and is thrown as-is. When every season
 * 404s the LAST 404 is thrown, so callers keep their existing "not found" handling.
 */
export async function fetchEspnLeagueJsonFirstSeason(
  args: {
    game?: EspnFantasyGame
    seasons: readonly number[]
    leagueId: string
    views: readonly string[]
  },
  opts: EspnFetchJsonOptions = {},
): Promise<{ season: number; raw: unknown }> {
  if (args.seasons.length === 0) throw new Error('fetchEspnLeagueJsonFirstSeason needs at least one season.')
  let lastNotFound: EspnApiResponseError | null = null
  for (const season of args.seasons) {
    try {
      const raw = await fetchEspnLeagueJson(
        { game: args.game, season, leagueId: args.leagueId, views: args.views },
        opts,
      )
      return { season, raw }
    } catch (error) {
      if (error instanceof EspnApiResponseError && error.status === 404) {
        lastNotFound = error
        continue
      }
      throw error
    }
  }
  throw lastNotFound!
}

/**
 * Minimal structural check on a league object: it must carry at least one of the keys every view
 * we request returns. Deliberately loose — the contract has no NFL capture yet (`GAPS.md`), so this
 * catches "ESPN sent something else entirely" without guessing at fields it may legitimately omit.
 */
export function assertEspnLeagueObject(raw: unknown): asserts raw is Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new EspnFormatChangedError('league response is not an object')
  }
  const obj = raw as Record<string, unknown>
  const known = ['id', 'seasonId', 'settings', 'teams', 'members', 'schedule', 'status']
  if (!known.some((k) => k in obj)) {
    throw new EspnFormatChangedError('league response has none of the expected keys')
  }
  if ('teams' in obj && obj.teams != null && !Array.isArray(obj.teams)) {
    throw new EspnFormatChangedError('teams is not an array')
  }
}

/* ── Public / private detection ───────────────────────────────────────────────────────────── */

type EspnAccessProbe =
  | { access: 'public'; raw: Record<string, unknown> }
  | { access: 'private_ok'; raw: Record<string, unknown> }
  | { access: 'private_needs_cookies' }
  | { access: 'private_cookies_rejected' }
  | { access: 'not_found' }

/**
 * Try the league WITHOUT cookies first; on 401/403 try the given cookies (if any). Never throws
 * for 401/403/404 — those are answers, not errors. Unavailable/format errors still throw.
 */
export async function probeEspnLeagueAccess(
  args: {
    game?: EspnFantasyGame
    season: number
    leagueId: string
    views: readonly string[]
    credentials?: EspnCredentials | null
  },
  opts: EspnFetchJsonOptions = {},
): Promise<EspnAccessProbe> {
  try {
    const raw = await fetchEspnLeagueJson(args, { ...opts, cookieHeader: null })
    assertEspnLeagueObject(raw)
    return { access: 'public', raw }
  } catch (error) {
    if (!(error instanceof EspnApiResponseError)) throw error
    if (error.status === 404) return { access: 'not_found' }
    if (error.status !== 401 && error.status !== 403) throw error
  }

  const cookieHeader = buildEspnCookieHeader(args.credentials)
  if (!cookieHeader) return { access: 'private_needs_cookies' }
  try {
    const raw = await fetchEspnLeagueJson(args, { ...opts, cookieHeader })
    assertEspnLeagueObject(raw)
    return { access: 'private_ok', raw }
  } catch (error) {
    if (!(error instanceof EspnApiResponseError)) throw error
    if (error.status === 404) return { access: 'not_found' }
    if (error.status === 401 || error.status === 403) return { access: 'private_cookies_rejected' }
    throw error
  }
}
