import {
  getRollingInsightsSportCode,
  type RollingInsightsVendorSport,
} from '@/lib/providers/rollingInsightsFieldMaps'
import { normalizeSoccerLeague } from '@/lib/providers/rollingInsightsSoccerLeague'

/**
 * Rolling Insights capability facts and envelope parsing — PURE, no network, no credentials.
 *
 * WHY THIS IS SEPARATE FROM THE TRANSPORT. `riSupports()` answers a question every caller has a
 * legitimate reason to ask, including cron handlers deciding whether a sport is worth a run at
 * all. The transport that actually calls the vendor lives in `lib/workers/providers/`, which the
 * DB-first boundary guard allowlists as the audited home for provider adapters. Keeping the
 * predicate here means a caller can ask "is this supported?" without importing a module that
 * holds a vendor base URL — so the guard's caller census for the transport stays honest, and
 * nothing outside ingestion has a reason to reach the fetch.
 *
 * Everything in this file is derived from `contracts/rolling-insights/ENDPOINTS.yaml`. Nothing
 * here was probed.
 */

/** Endpoints the transport can build. Names match `endpoints:` in ENDPOINTS.yaml. */
export type RiEndpoint =
  | 'schedule'
  | 'schedule_week'
  | 'schedule_season'
  | 'live'
  | 'play_by_play'
  | 'team_info'
  | 'team_stats'
  | 'player_info'
  | 'player_stats'
  | 'injuries'
  | 'depth_charts'

/**
 * `support_matrix` from ENDPOINTS.yaml, verbatim for the seven sports this product carries.
 *
 * `false` means the VENDOR DOES NOT DOCUMENT IT and instructs agents not to call it. Per GAPS.md
 * that is not a 404 guarantee — but calling anyway costs a request and returns nothing useful,
 * and the honest product answer for those cells is "not available from this provider", which is
 * what refusing lets callers report.
 */
const SUPPORT: Record<RiEndpoint, Record<RollingInsightsVendorSport, boolean>> = {
  schedule:        { NFL: true, NBA: true, MLB: true, NHL: true,  NCAABB: true,  NCAAFB: true,  SOCCER: true },
  schedule_week:   { NFL: true, NBA: true, MLB: true, NHL: true,  NCAABB: true,  NCAAFB: true,  SOCCER: true },
  schedule_season: { NFL: true, NBA: true, MLB: true, NHL: true,  NCAABB: true,  NCAAFB: true,  SOCCER: true },
  live:            { NFL: true, NBA: true, MLB: true, NHL: true,  NCAABB: true,  NCAAFB: true,  SOCCER: true },
  play_by_play:    { NFL: true, NBA: true, MLB: true, NHL: false, NCAABB: false, NCAAFB: false, SOCCER: false },
  team_info:       { NFL: true, NBA: true, MLB: true, NHL: true,  NCAABB: true,  NCAAFB: true,  SOCCER: true },
  team_stats:      { NFL: true, NBA: true, MLB: true, NHL: true,  NCAABB: true,  NCAAFB: true,  SOCCER: true },
  player_info:     { NFL: true, NBA: true, MLB: true, NHL: true,  NCAABB: true,  NCAAFB: true,  SOCCER: true },
  /** SOCCER has no player season stats — see `support_consequences` in the contract. */
  player_stats:    { NFL: true, NBA: true, MLB: true, NHL: true,  NCAABB: true,  NCAAFB: true,  SOCCER: false },
  /** College has no injuries feed at all, and neither does soccer. */
  injuries:        { NFL: true, NBA: true, MLB: true, NHL: true,  NCAABB: false, NCAAFB: false, SOCCER: false },
  depth_charts:    { NFL: true, NBA: true, MLB: true, NHL: true,  NCAABB: false, NCAAFB: false, SOCCER: false },
}

/** Does the vendor document this endpoint for this sport? Accepts app or vendor sport codes. */
export function riSupports(endpoint: RiEndpoint, sport: string): boolean {
  return SUPPORT[endpoint]?.[getRollingInsightsSportCode(sport)] === true
}

/** Every endpoint the vendor documents for a sport, for capability reporting. */
export function riSupportedEndpoints(sport: string): RiEndpoint[] {
  const code = getRollingInsightsSportCode(sport)
  return (Object.keys(SUPPORT) as RiEndpoint[]).filter((e) => SUPPORT[e][code])
}

/** Year the season STARTED — the only form `season` may take (`identifiers.season_arg`). */
export function riSeasonArg(input: number | string | undefined, now = new Date()): string {
  if (input != null) {
    const s = String(input).trim()
    if (/^\d{4}/.test(s)) return s.slice(0, 4)
  }
  // Aug onward belongs to the season named for the current year; before that, the previous one.
  // Correct for NFL/NBA/NHL/NCAA (all span a new year) and harmless for MLB, whose season sits
  // wholly inside one calendar year and so is never asked for in Jan-Jul anyway.
  const y = now.getUTCFullYear()
  return String(now.getUTCMonth() + 1 >= 8 ? y : y - 1)
}

/**
 * Unwrap `{ "data": { "<KEY>": [...] } }`.
 *
 * ⚠ THE KEY IS NOT THE PATH SEGMENT FOR SOCCER. You request `/…/SOCCER?league=EPL` and the
 * response comes back keyed `data.EPL`. A parser that keys off the request path returns empty for
 * every soccer call and looks like a provider outage. That is `soccer_trap`, named in the contract
 * as its highest-risk parsing trap.
 *
 * Falls back to any array found under `data` so a vendor key we have not seen still yields rows
 * rather than silence — but only after the documented keys have been tried in order.
 */
export function resolveRiEnvelope(
  payload: unknown,
  opts: { sport: string; league?: string },
): unknown[] {
  if (payload == null) return []
  if (Array.isArray(payload)) return payload

  const root = payload as Record<string, unknown>
  const data = (root.data ?? root) as unknown
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return []

  const bag = data as Record<string, unknown>
  const code = getRollingInsightsSportCode(opts.sport)

  const keys: string[] = []
  if (code === 'SOCCER') {
    const league = normalizeSoccerLeague(opts.league ?? '')
    if (league) keys.push(league)
    keys.push('EPL', 'LALIGA', 'SERIEA')
  }
  keys.push(code)

  for (const key of keys) {
    const v = bag[key]
    if (Array.isArray(v)) return v
    // Some endpoints return an object map keyed by team/player id rather than an array.
    if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>)
  }

  for (const v of Object.values(bag)) {
    if (Array.isArray(v)) return v
  }
  return []
}
