/**
 * The IP-geolocation vendor calls, and NOTHING else.
 *
 * ⚠ WHY THIS MODULE EXISTS AT ALL. It is the inverted split this repo already
 * used for `lib/weather/openWeatherFetch.ts` and `lib/fantasycalc-fetch.ts`:
 * the fetch moves out so the module holding the LOGIC carries no provider URL
 * and needs no exemption. `lib/geo/detectUserState.ts` is reached from two
 * request paths (signup and /api/geo/check), so it can never be allowlisted;
 * this file can, because a live vendor call is its only job.
 *
 * ⚠ THE EXEMPTION IS CONDITIONAL, exactly as `lib/cfb-player-data.ts`'s is.
 * It holds only while the importer set stays small and deliberate:
 *
 *     grep -rnE "from '(@/lib/geo|\.)/geoIpFetch'|import\(.*geoIpFetch|require\(.*geoIpFetch" \
 *       --include=*.ts --include=*.tsx .
 *
 * must show `lib/geo/detectUserState.ts`, `lib/geo/geoIpCache.ts`,
 * `lib/geo/anonymizerCache.ts` and test files, and nothing else. The two caches
 * are the middleware's path to these vendors; each bounds the call count to one
 * per IP per TTL. A request path importing this directly is the thing the guard
 * exists to catch.
 *
 * ⚠ THE ALIASED FORM ALONE IS NOT THE CENSUS, and the first version of this
 * comment made exactly that mistake. `detectUserState` imports this RELATIVELY
 * (`./geoIpFetch`), so a grep for `@/lib/geo/geoIpFetch` finds the test file and
 * misses the only real caller — reporting a clean census for a module with an
 * importer. CLAUDE.md records four separate occasions of that same error;
 * check aliased, relative, dynamic and require every time.
 *
 * ⚠ AND THE HOSTS STAY IN `DATA_API_HOST_PATTERNS`. Allowlisting this FILE is
 * not the same as unwatching the HOSTS: a call to either vendor from anywhere
 * else in the tree is still reported. That distinction is the whole reason the
 * CFBD entry is the worked example it is.
 *
 * Every export here performs a live network call. Nothing here interprets a
 * response — validation and normalisation live with the logic in
 * `detectUserState.ts`, so that logic is testable without mocking `fetch`.
 */

/**
 * 🛑 `cache: "no-store"` ALONE — NEVER WITH `next: { revalidate: 0 }`. Both together make Next.js
 * warn `fetch for <url> … specified "cache: no-store" and "revalidate: 0", only one should be
 * specified`, and that warning prints the WHOLE URL — the key in the query string and the visitor's
 * IP in the path — into the server log on every /api/geo/check. Observed in production deploy logs
 * 2026-09-24; the catch blocks below were careful never to log the URL, and Next did it for them.
 * The two options mean the same thing here (never cache), so one is enough.
 */
const NO_CACHE: RequestInit = { cache: "no-store" }

/**
 * Raw proxycheck.io response for one IP, or `null` on any failure.
 *
 * Returns `null` rather than throwing: a VPN check that cannot run must not
 * block a user, and an outage here is not evidence about the client.
 */
export async function fetchProxycheck(
  ip: string,
  key: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
  try {
    const url = `https://proxycheck.io/v2/${encodeURIComponent(ip)}?key=${encodeURIComponent(key)}&vpn=1&asn=1`
    const res = await fetch(url, { ...NO_CACHE, signal })
    if (!res.ok) {
      // ⚠ A quota denial arrives as a 429/401/403 whose body says
      // `status: "denied"`. Dropping every non-2xx as `null` made an exhausted
      // quota indistinguishable from an outage, so the gate went open silently.
      // Only the status is passed on — never the message, which could echo the key.
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
      return body && typeof body.status === "string" ? { status: body.status } : null
    }
    return (await res.json()) as Record<string, unknown>
  } catch (e) {
    // ⚠ The key is in the query string, so the URL must never be logged.
    console.warn("[geo] proxycheck lookup failed:", e instanceof Error ? e.message : "unknown error")
    return null
  }
}

/**
 * Raw ipapi.co response for one IP, or `null` on any failure.
 *
 * ⚠ The API key is passed as a QUERY PARAMETER, so this must never log the URL
 * — the same trap CLAUDE.md records for Rolling Insights' `RSC_token`. The catch
 * below logs the error message only, never the request.
 */
export async function fetchIpApi(
  ip: string,
  key: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
  try {
    const url = `https://ipapi.co/${encodeURIComponent(ip)}/json/?key=${encodeURIComponent(key)}`
    const res = await fetch(url, { ...NO_CACHE, signal })
    if (!res.ok) return null
    return (await res.json()) as Record<string, unknown>
  } catch {
    return null
  }
}
