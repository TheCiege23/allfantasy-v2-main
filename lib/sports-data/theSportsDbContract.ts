/**
 * TheSportsDB v1 response contract — pure parsing, no network, no DB.
 *
 * This exists because v1's envelope is hostile in three specific ways that a
 * naive `body[key] ?? []` gets wrong, all of them silently:
 *
 *   1. Errors come back as HTTP 200.
 *   2. The error message REPLACES the data array — `{"events":"Invalid League
 *      ID passed"}`. There is no `Message` key. `(body.events ?? []).length`
 *      therefore returns 24, the length of the string, reported as a row count.
 *   3. `null` means "no data", and a bogus-but-numeric league id also returns
 *      `null` — so an invalid request is indistinguishable from an empty one.
 *
 * Ground truth for all three is committed in
 * `contracts/thesportsdb/fixtures/`. See GAPS.md R-07 / R-18.
 *
 * Pure by construction: no imports, no `server-only`, no fetch. Safe to unit
 * test against fixtures and safe to import from either side of the boundary.
 */

/** League ids. Verified live — see GAPS.md R-05 / R-06. */
export const TSDB_LEAGUE = {
  NFL: { id: 4391, strLeague: 'NFL' },
  /**
   * ⚠️ `strLeague` is "NCAA Division 1", NOT "NCAA Football". Searching the
   * obvious name returns `{"teams":null}` — which reads as "no such league"
   * rather than "wrong name". Prefer the numeric id; where an endpoint keys
   * off the name (search_all_teams), use this exact string.
   */
  NCAAF: { id: 4479, strLeague: 'NCAA Division 1' },
} as const

export type TsdbLeagueKey = keyof typeof TSDB_LEAGUE

/** The two CDN hosts. Both appear within the SAME response (GAPS.md R-12). */
export const TSDB_CDN_HOSTS = ['r2.thesportsdb.com', 'www.thesportsdb.com'] as const

export type TsdbFailure =
  /** Data slot held a string. The request was rejected; the message is it. */
  | { ok: false; reason: 'api_error'; key: string; message: string }
  /** Data slot was null. Either genuinely empty OR a silently-rejected id. */
  | { ok: false; reason: 'no_data'; key: string }
  /** Dead/retired endpoints answer with an HTML error page. */
  | { ok: false; reason: 'html_error_page' }
  | { ok: false; reason: 'empty_body' }
  | { ok: false; reason: 'invalid_json'; snippet: string }
  | { ok: false; reason: 'unrecognized_envelope'; keys: string[] }

export type TsdbResult<T> = { ok: true; key: string; rows: T[] } | TsdbFailure

/**
 * Parse a raw v1 response body.
 *
 * `expectedKey` pins the envelope key (e.g. 'events'). Omit it and the sole
 * key of a single-key object is used, which is the normal v1 shape.
 *
 * Deliberately does NOT collapse `no_data` into an empty success. Those are
 * different facts and the caller is the only one that knows which matters:
 * "this league has no upcoming events" and "that league id does not exist"
 * both arrive as `{"events":null}`.
 */
export function parseV1Body<T = Record<string, unknown>>(
  raw: string,
  expectedKey?: string
): TsdbResult<T> {
  if (!raw || !raw.trim()) return { ok: false, reason: 'empty_body' }

  // Retired endpoints (latestamericanfootball.php, lookup_all_teams.php) serve
  // an HTML error page. JSON.parse would throw; this is not a crash, it is a
  // 404 wearing a 200. See GAPS.md R-14 / R-15.
  if (raw.trimStart().startsWith('<')) return { ok: false, reason: 'html_error_page' }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'invalid_json', snippet: raw.slice(0, 120) }
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, reason: 'unrecognized_envelope', keys: [] }
  }

  const obj = body as Record<string, unknown>
  const keys = Object.keys(obj)
  const key = expectedKey ?? (keys.length === 1 ? keys[0] : undefined)
  if (!key || !(key in obj)) return { ok: false, reason: 'unrecognized_envelope', keys }

  const value = obj[key]

  // THE trap. A string in the data slot is an error message, not a row and not
  // a value. Check this BEFORE any truthiness or length test.
  if (typeof value === 'string') {
    return { ok: false, reason: 'api_error', key, message: value }
  }

  if (value === null || value === undefined) return { ok: false, reason: 'no_data', key }

  if (Array.isArray(value)) return { ok: true, key, rows: value as T[] }

  // Some lookups return a bare object rather than a one-element array.
  if (typeof value === 'object') return { ok: true, key, rows: [value as T] }

  return { ok: false, reason: 'unrecognized_envelope', keys }
}

/** Rows, or [] for every failure. Only use where the distinction truly is noise. */
export function rowsOrEmpty<T>(result: TsdbResult<T>): T[] {
  return result.ok ? result.rows : []
}

/** A one-line reason for logs. Never includes the API key. */
export function describeFailure(f: TsdbFailure): string {
  switch (f.reason) {
    case 'api_error':
      return `provider rejected the request: "${f.message}" (returned as HTTP 200 under .${f.key})`
    case 'no_data':
      return `.${f.key} was null — no data, or an id the provider silently rejected`
    case 'html_error_page':
      return 'provider served an HTML error page (endpoint likely retired)'
    case 'empty_body':
      return 'provider returned an empty body'
    case 'invalid_json':
      return `response was not JSON: ${f.snippet}`
    case 'unrecognized_envelope':
      return `unrecognized envelope, keys: [${f.keys.join(', ')}]`
  }
}

/**
 * v1 puts the API key in the URL PATH, so any logged URL is a credential leak.
 * Run every URL through this before it reaches a log, span, or error message.
 */
export function redactV1Url(url: string): string {
  return url.replace(
    /(\/api\/v1\/json\/)[^/?#]+/i,
    (_m, prefix: string) => `${prefix}***REDACTED***`
  )
}

/**
 * Normalize an artwork URL's host. Both CDN hosts appear in the same response,
 * so the same asset can arrive under two URLs and dedupe by URL fails.
 */
export function normalizeCdnUrl(url: string | null | undefined): string | null {
  if (!url || !url.trim()) return null
  try {
    const u = new URL(url.trim())
    if (u.hostname === 'r2.thesportsdb.com') u.hostname = 'www.thesportsdb.com'
    return u.toString()
  } catch {
    return null
  }
}

/** Image size suffixes. `/preview` is NOT documented — do not use it (G-10). */
export const TSDB_IMAGE_SIZES = { medium: '/medium', small: '/small', tiny: '/tiny' } as const

/** `strCreativeCommons === 'Yes'` is the ONLY licence signal, and only on players. */
export function isCcLicensed(player: Record<string, unknown>): boolean {
  return String(player.strCreativeCommons ?? '').trim().toLowerCase() === 'yes'
}
