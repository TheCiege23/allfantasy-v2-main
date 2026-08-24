/**
 * ESPN public site-API base. One constant, because the host moved once and will move again.
 *
 * ⚠ THE HOST IS `site.web.api.espn.com`, NOT `site.api.espn.com`. Getting this wrong does not
 * fail loudly — it returns 403 on every path, which reads like an outage.
 *
 * WHAT HAPPENED (2026-08-22). `site.api.espn.com` began returning `403 Access Denied` from
 * `AkamaiGHost` on EVERY path — scoreboard, news, teams, standings, injuries alike. Reproduced
 * from two unrelated networks (a local machine and the Railway production egress), so it is not an
 * IP ban, and a full browser header set including `referer` and `origin` changes nothing: Akamai
 * fingerprints the client below the HTTP layer, and browsers pass where fetch and curl do not.
 *
 * `site.web.api.espn.com` serves the SAME API, same paths, same response shapes, and is not behind
 * that block. Verified across every path this repo uses:
 *
 *   football/nfl/scoreboard              200   16 events, STATUS_IN_PROGRESS, scores present
 *   football/college-football/scoreboard 200   25 events
 *   football/nfl/injuries                200   32 team blocks, 800 injuries
 *   football/college-football/injuries   200    3 team blocks,   3 injuries
 *   football/nfl/news                    200
 *   football/nfl/teams                   200
 *   basketball/nba/scoreboard            200
 *   hockey/nhl/scoreboard                200
 *
 * The injury counts match the numbers `lib/injuries/espnInjuries.ts` recorded when it was written
 * against the old host, which is the check that proves this is the same feed rather than a
 * lookalike endpoint.
 *
 * ⚠ DO NOT "FIX" A FUTURE 403 BY SPOOFING BOT DETECTION. That is circumventing an access control
 * ESPN put up deliberately, and it breaks again the moment they tune it. If this host is blocked
 * too, the options are `sports.core.api.espn.com` (still served, but its data is behind `$ref`
 * links — 70 for a single NFL team, so ~2,240 requests to cover the league) or a contracted
 * provider. Rolling Insights already supplies NFL scores and injuries; per
 * `contracts/rolling-insights/ENDPOINTS.yaml` its `/live/{date}/{SPORT}` is the primary game-day
 * endpoint, though NHL/NCAAFB/NCAABB live field names there are `confidence: none`.
 *
 * This module builds strings only. It performs no HTTP and holds no credentials — ESPN's public
 * site API needs no key.
 */

export const ESPN_SITE_API_BASE = 'https://site.web.api.espn.com/apis/site/v2/sports'

/**
 * The host that is blocked, kept as a named value so a check for it reads as intent rather than a
 * magic string. Nothing should build a URL from this.
 */
export const ESPN_BLOCKED_SITE_API_HOST = 'site.api.espn.com'

/** `sport/league` path segments, e.g. `football/nfl`. */
export function espnSiteApiUrl(pathSegment: string, query?: Record<string, string | number>): string {
  const url = new URL(`${ESPN_SITE_API_BASE}/${pathSegment.replace(/^\/+/, '')}`)
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v))
  return url.toString()
}
