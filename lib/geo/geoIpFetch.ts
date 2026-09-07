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
 * must show `lib/geo/detectUserState.ts` and test files, and nothing else. A
 * request path importing this directly is the thing the guard exists to catch.
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
 * Raw proxycheck.io response for one IP, or `null` on any failure.
 *
 * Returns `null` rather than throwing: a VPN check that cannot run must not
 * block a user, and an outage here is not evidence about the client.
 */
export async function fetchProxycheck(
  ip: string,
  key: string,
): Promise<Record<string, unknown> | null> {
  try {
    const url = `https://proxycheck.io/v2/${encodeURIComponent(ip)}?key=${encodeURIComponent(key)}&vpn=1&asn=1`
    const res = await fetch(url, { cache: "no-store", next: { revalidate: 0 } })
    if (!res.ok) return null
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
): Promise<Record<string, unknown> | null> {
  try {
    const url = `https://ipapi.co/${encodeURIComponent(ip)}/json/?key=${encodeURIComponent(key)}`
    const res = await fetch(url, { cache: "no-store", next: { revalidate: 0 } })
    if (!res.ok) return null
    return (await res.json()) as Record<string, unknown>
  } catch {
    return null
  }
}
