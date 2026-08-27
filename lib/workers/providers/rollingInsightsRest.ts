import 'server-only'

import { redactSecrets } from '@/lib/security/redactSecrets'
import {
  getRollingInsightsSportCode,
  type RollingInsightsVendorSport,
} from '@/lib/providers/rollingInsightsFieldMaps'
import {
  normalizeSoccerLeague,
  type RollingInsightsSoccerLeagueCode,
} from '@/lib/providers/rollingInsightsSoccerLeague'
import {
  resolveRiEnvelope,
  riSeasonArg,
  riSupports,
  type RiEndpoint,
} from '@/lib/sports-data/rollingInsightsSupport'

/**
 * ONE Rolling Insights REST transport, shared by every sport.
 *
 * WHY THIS EXISTS. Three call sites were each hand-rolling the same request and each getting a
 * different part of `contracts/rolling-insights/ENDPOINTS.yaml` wrong:
 *
 *   lib/workers/providers/rolling-insights.ts   probes ~6 speculative paths per data type
 *   lib/injuries/rollingInsightsInjuries.ts     no cache-buster, no no-cache headers
 *   lib/stats/rollingInsightsPlayerStats.ts     treats 304 as an empty result set
 *
 * None of them sent the cache-buster or the no-cache headers the contract makes mandatory, and
 * two of them turned a 304 into `[]` — which CLAUDE.md names as the one response that is wrong
 * under BOTH readings of the unresolved `304_conflict`, because "no data" and "cache hit" become
 * indistinguishable.
 *
 * WHAT THIS GUARANTEES, per call:
 *   1. `Cache-Control: no-cache, no-store` + `Pragma: no-cache`   (transport.required_live_headers)
 *   2. `_=<epoch milliseconds>` on EVERY endpoint, not just /live (transport.cache_buster)
 *   3. A 304 is retried ONCE with a fresh buster, and if it persists it surfaces as its own
 *      outcome kind — never as an empty array. See `RiOutcome`.
 *   4. `RSC_token` never reaches a log line: no URL is ever logged, and every error string is
 *      pushed through `redactSecrets` before it leaves this module.
 *   5. Endpoint x sport combinations the vendor does not document are refused BEFORE the request,
 *      so an unsupported sport reads as `unsupported`, not as a mysterious 404.
 *
 * WHY IT LIVES IN lib/workers/providers/ RATHER THAN lib/sports-data/.
 * That directory is the DB-first boundary guard's audited home for provider adapters, and the
 * guard's warning on the pattern is the test this file has to pass: the exemption "is intended for
 * adapters and wrong for anything a page can reach". Its runtime importers are, in full:
 *
 *   lib/injuries/rollingInsightsInjuries.ts        ingestion writer -> sports_injuries
 *   lib/stats/rollingInsightsPlayerStats.ts        ingestion writer -> fantasy_stat_lines
 *   lib/sports-data/rollingInsightsDepthCharts.ts  ingestion writer -> depth_charts
 *   lib/sports-data/rollingInsightsTeamsPlayers.ts ingestion writer -> SportsTeam / SportsPlayer
 *   lib/sports-data/rollingInsightsGameLogs.ts     ingestion writer -> player_game_stats
 *
 * Every one is fetch-then-upsert with no read API, and every one is reached only from a cron
 * handler. The cron handlers themselves import `riSupports` from
 * `lib/sports-data/rollingInsightsSupport.ts` — a pure predicate over a committed constant with
 * no URL and no credentials — precisely so that asking "is this sport supported?" never drags the
 * transport into a route's module graph. That split is what keeps this census true rather than
 * merely asserted; re-run it by callers, with a positive control, before adding anything here.
 */

export type RiOutcome =
  /** `credential` names WHICH of the two accounts answered — the only way entitlement is observable. */
  | { ok: true; payload: unknown; status: number; credential?: 'primary' | 'secondary' }
  /**
   * A 304 that SURVIVED a cache-busted retry.
   *
   * Deliberately NOT `ok: true` with an empty payload. `304_conflict` in the contract is
   * unresolved — the skill repo calls it a cache artifact, the OpenAPI spec calls it an empty
   * result set — so this transport refuses to decide. Callers must report "unchanged/unknown"
   * and leave prior rows alone; anything that writes an emptiness on the strength of this is
   * choosing one reading of a documented dispute.
   */
  | { ok: false; kind: 'not_modified'; error: string }
  | { ok: false; kind: 'unsupported' | 'no_token' | 'bad_request' | 'http' | 'network'; error: string }

export interface RiRequest {
  /** App sport code (NFL/NBA/MLB/NHL/NCAAB/NCAAF/SOCCER) or a vendor code. */
  sport: string
  /** `YYYY` for season endpoints, `YYYY-MM-DD` for date endpoints. */
  season?: number | string
  date?: string
  /** Required for SOCCER — EPL | LALIGA | SERIEA. */
  league?: string
  teamId?: string
  playerId?: string
  gameId?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Epoch-ms source, injectable so tests can assert the buster changes between attempts. */
  now?: () => number
}

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Base URL resolution.
 *
 * CLAUDE.md records five observed spellings for the token and four for the base, because the env
 * names drifted across sessions. Reading all of them here is not tidiness — setting only the
 * contract's documented name (`ROLLING_INSIGHTS_BASE_URL`) is a MINORITY spelling in this repo,
 * so a single-name reader silently no-ops on most deployments.
 */
export function riRestBase(): string {
  const raw =
    process.env.ROLLING_INSIGHTS_REST_BASE_URL?.trim() ||
    process.env.ROLLING_INSIGHTS_REST_BASE?.trim() ||
    process.env.ROLLING_INSIGHTS_BASE_URL?.trim() ||
    process.env.ROLLING_INSIGHTS_API_BASE?.trim() ||
    // db-first-exception: provider ingestion transport — the vendor base URL from
    // contracts/rolling-insights/ENDPOINTS.yaml meta.base_url, used only when every env spelling
    // above is unset. This module fetches and hands rows to ingestion writers; no read path
    // reaches it (see the caller census in the module header).
    'https://rest.datafeeds.rolling-insights.com/api/v1'
  // A comma-separated list is legal in ROLLING_INSIGHTS_REST_BASE_URL elsewhere in the repo.
  const first = raw.split(',')[0]!.trim().replace(/\/+$/, '')
  return /\/api\/v\d+$/.test(first) ? first : `${first}/api/v1`
}

/**
 * The RSC token, under any of the spellings this repo has used. Never logged.
 *
 * @deprecated Prefer {@link riCredentialsFor} — there are TWO Rolling Insights accounts and this
 * returns whichever is listed first, which is how every non-NFL sport silently 304'd. Kept only
 * for callers that genuinely need "is any credential configured at all".
 */
export function riToken(): string | null {
  return riCredentialsFor('NFL')[0]?.token ?? null
}

export interface RiCredential {
  token: string
  /** Which account answered. Reported on the outcome so entitlement is observable, never logged with the token. */
  label: 'primary' | 'secondary'
}

/**
 * ⚠ THERE ARE TWO ROLLING INSIGHTS ACCOUNTS AND THEY COVER DIFFERENT SPORTS.
 *
 * Rolling Insights bills additively per sport, and this deployment holds two subscriptions whose
 * coverage is DISJOINT. Measured directly against `team-info` on 2026-08-27, same URL, same
 * headers, same millisecond buster — only the credential differed:
 *
 *              NFL   MLB   NBA   NHL   NCAABB   NCAAFB   SOCCER(EPL/LALIGA/SERIEA)
 *   primary    200   304   304   304    304      304      304
 *   secondary  304   200   200   200    200      200      200
 *
 * That table is also the cleanest possible evidence for what a 304 means here: the SAME request
 * returns 200 on one token and 304 on the other, so on this vendor a 304 can mean
 * **"this account is not subscribed to this sport"** — a third reading neither the skill repo nor
 * the OpenAPI spec documents. See `contracts/rolling-insights/GAPS.md`.
 *
 * ⚠ WHAT THIS REPLACED, AND WHY IT MATTERED. The previous reader returned the first token present
 * and stopped. Since `ROLLING_INSIGHTS_RSC_TOKEN` is set, `..._TOKEN2` was NEVER tried, so all six
 * sports on the second account answered 304 forever and the whole multi-sport pipeline wrote
 * nothing while reporting itself healthy. The 304 rule kept it honest — it refused to write an
 * emptiness — but honest about the wrong cause.
 *
 * `ROLLING_INSIGHTS_PRIMARY_SPORTS` overrides which sports prefer the first account (comma
 * separated, default `NFL`). Preference only: BOTH credentials are always tried, so a subscription
 * moving between accounts degrades to one extra request rather than to silence.
 */
export function riCredentialsFor(sport: string): RiCredential[] {
  const primary =
    process.env.ROLLING_INSIGHTS_RSC_TOKEN?.trim() ||
    process.env.RSC_TOKEN?.trim() ||
    process.env.ROLLING_INSIGHTS_CLIENT_SECRET?.trim() ||
    process.env.ROLLING_INSIGHTS_API_KEY?.trim() ||
    process.env.ROLLING_INSIGHTS_KEY?.trim() ||
    null
  const secondary =
    process.env.ROLLING_INSIGHTS_RSC_TOKEN2?.trim() ||
    process.env.ROLLING_INSIGHTS_CLIENT_SECRET2?.trim() ||
    null

  const primarySports = (process.env.ROLLING_INSIGHTS_PRIMARY_SPORTS?.trim() || 'NFL')
    .split(',')
    .map((s) => getRollingInsightsSportCode(s.trim()))
    .filter(Boolean)

  const prefersPrimary = primarySports.includes(getRollingInsightsSportCode(sport))

  const ordered: Array<RiCredential | null> = prefersPrimary
    ? [primary ? { token: primary, label: 'primary' } : null, secondary ? { token: secondary, label: 'secondary' } : null]
    : [secondary ? { token: secondary, label: 'secondary' } : null, primary ? { token: primary, label: 'primary' } : null]

  // Dedupe by token: a deployment with only one account set must not pay for two identical calls.
  const seen = new Set<string>()
  return ordered.filter((c): c is RiCredential => {
    if (!c || seen.has(c.token)) return false
    seen.add(c.token)
    return true
  })
}

function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/**
 * Path for an endpoint. Paths are taken from `endpoints:` in ENDPOINTS.yaml and nothing else —
 * the previous provider speculatively probed `projections/`, `average-draft-position/` and four
 * other invented segments per call, none of which the vendor documents.
 */
function buildPath(endpoint: RiEndpoint, req: RiRequest, code: RollingInsightsVendorSport): string | null {
  const season = riSeasonArg(req.season)
  const date = req.date?.trim() || todayUtc()

  switch (endpoint) {
    case 'schedule':        return `/schedule/${date}/${code}`
    case 'schedule_week':   return `/schedule-week/${date}/${code}`
    case 'schedule_season': return `/schedule-season/${season}/${code}`
    case 'live':            return `/live/${date}/${code}`
    case 'play_by_play':    return `/play-by-play/${code}`
    case 'team_info':       return `/team-info/${code}`
    case 'team_stats':      return `/team-stats/${season}/${code}`
    case 'player_info':     return `/player-info/${code}`
    case 'player_stats':    return `/player-stats/${season}/${code}`
    case 'injuries':        return `/injuries/${code}`
    case 'depth_charts':    return `/depth-charts/${code}`
    default:                return null
  }
}

/**
 * Fetch one documented Rolling Insights endpoint.
 *
 * Applies the contract's transport rules in full. The returned payload is the RAW body — call
 * `resolveRiEnvelope` to unwrap it, because the envelope key is sport-dependent and getting it
 * wrong is the single highest-risk parsing trap in this API (`soccer_trap`).
 */
export async function riFetch(endpoint: RiEndpoint, req: RiRequest): Promise<RiOutcome> {
  const code = getRollingInsightsSportCode(req.sport)

  if (!riSupports(endpoint, req.sport)) {
    return {
      ok: false,
      kind: 'unsupported',
      error: `Rolling Insights does not document ${endpoint} for ${code}`,
    }
  }

  const credentials = riCredentialsFor(req.sport)
  if (credentials.length === 0) {
    return { ok: false, kind: 'no_token', error: 'Rolling Insights RSC token not configured' }
  }

  // SOCCER keys its response by LEAGUE and requires the league param on every call. Without it
  // the request is not merely degraded, it is malformed — refuse rather than send it.
  let league: RollingInsightsSoccerLeagueCode | null = null
  if (code === 'SOCCER') {
    league = normalizeSoccerLeague(req.league ?? '')
    if (!league) {
      return {
        ok: false,
        kind: 'bad_request',
        error: 'SOCCER requires league (EPL | LALIGA | SERIEA) — soccer_league_param_required',
      }
    }
  }

  if (endpoint === 'play_by_play' && !req.gameId?.trim()) {
    return { ok: false, kind: 'bad_request', error: 'play_by_play requires game_id' }
  }

  const path = buildPath(endpoint, req, code)
  if (!path) return { ok: false, kind: 'bad_request', error: `no path for ${endpoint}` }

  const doFetch = req.fetchImpl ?? fetch
  const now = req.now ?? Date.now
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const attempt = async (credential: RiCredential): Promise<RiOutcome> => {
    const url = new URL(`${riRestBase()}${path}`)
    url.searchParams.set('RSC_token', credential.token)
    if (league) url.searchParams.set('league', league)
    if (req.teamId) url.searchParams.set('team_id', req.teamId)
    if (req.playerId) url.searchParams.set('player_id', req.playerId)
    if (req.gameId) url.searchParams.set('game_id', req.gameId)
    // Millisecond precision is REQUIRED: a seconds-precision buster does not defeat caching on
    // sub-second polling, and this is applied to ALL endpoints, not just /live.
    url.searchParams.set('_', String(now()))

    try {
      const res = await doFetch(url.toString(), {
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache, no-store',
          Pragma: 'no-cache',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (res.status === 304) {
        return { ok: false, kind: 'not_modified', error: `HTTP 304 ${endpoint}/${code}` }
      }
      if (!res.ok) {
        // Status and endpoint only. The URL carries the token and must never be interpolated.
        return { ok: false, kind: 'http', error: `HTTP ${res.status} ${endpoint}/${code}` }
      }
      return { ok: true, payload: await res.json(), status: res.status, credential: credential.label }
    } catch (e) {
      return { ok: false, kind: 'network', error: redactSecrets(e instanceof Error ? e.message : String(e)) }
    }
  }

  /*
   * TWO NESTED ESCALATIONS, and they answer two DIFFERENT meanings of the same status code.
   *
   *   inner — retry once with a fresh millisecond buster, same credential.
   *           Defeats 304-as-cache-artifact (the skill repo's reading).
   *   outer — on a 304 that survived that, try the OTHER account.
   *           Defeats 304-as-not-subscribed (measured 2026-08-27; see riCredentialsFor).
   *
   * Only when every credential has 304'd through its own busted retry do we say `not_modified` —
   * which by then can only mean genuinely-unchanged or not-yet-started, e.g. `player-stats/2026`
   * for NBA and NHL in August, where the prior-season bootstrap is the correct response.
   *
   * Cost in the normal case is ONE request: the sport's own account is tried first. The extra
   * calls are paid only when a feed really is unchanged, and the vendor confirmed no rate limit.
   */
  let lastNotModified: RiOutcome | null = null

  for (const credential of credentials) {
    const first = await attempt(credential)
    if (first.ok) return first
    if (first.kind !== 'not_modified') {
      // A real error (401/404/network) on the preferred account is worth reporting as itself
      // rather than masking behind a second account's 304.
      if (credentials.length === 1) return first
      lastNotModified = lastNotModified ?? first
      continue
    }

    const second = await attempt(credential)
    if (second.ok) return second
    if (second.ok === false && second.kind !== 'not_modified') {
      lastNotModified = lastNotModified ?? second
      continue
    }
    lastNotModified = {
      ok: false,
      kind: 'not_modified',
      error: `HTTP 304 after cache-busted retry ${endpoint}/${code} — treat as UNCHANGED, not empty`,
    }
  }

  return (
    lastNotModified ?? {
      ok: false,
      kind: 'not_modified',
      error: `HTTP 304 on every configured credential ${endpoint}/${code} — UNCHANGED or not subscribed`,
    }
  )
}

/**
 * Fetch + unwrap in one step, for the common case.
 *
 * `notModified` is carried separately from `rows` on purpose: a caller that collapses the two
 * writes an emptiness it was never told about.
 */
export async function riFetchRows(
  endpoint: RiEndpoint,
  req: RiRequest,
): Promise<{
  rows: unknown[]
  notModified: boolean
  unsupported: boolean
  error: string | null
  /** Which account served this, so a run report can show entitlement without exposing a token. */
  credential?: 'primary' | 'secondary'
}> {
  const out = await riFetch(endpoint, req)
  if (out.ok) {
    return {
      rows: resolveRiEnvelope(out.payload, { sport: req.sport, league: req.league }),
      notModified: false,
      unsupported: false,
      error: null,
      credential: out.credential,
    }
  }
  return {
    rows: [],
    notModified: out.kind === 'not_modified',
    unsupported: out.kind === 'unsupported',
    error: redactSecrets(out.error),
  }
}

export type { RiEndpoint }
