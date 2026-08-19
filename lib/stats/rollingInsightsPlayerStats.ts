import 'server-only'

/**
 * Phase 1 of the AF Projections Engine (AF_PROJECTIONS_ENGINE_BRIEF.md):
 * Rolling Insights `player-stats` -> `FantasyStatLine`.
 *
 * WHY: `fantasy_stat_lines` has NEVER been written to (0 rows, measured
 * 2026-08-10). `sports-data-importer.ts` fetches `projections` and `rankings`
 * but its only persistent write is `sportsPlayerRecord.upsert` — everything
 * else was transient enrichment, discarded. Paying for Rolling Insights does
 * not create rows; this writer is what does.
 *
 * VERIFIED PROVIDER FACTS (probed 2026-08-10, not assumed):
 *   - `player-stats/{season}/NFL` on
 *     `https://rest.datafeeds.rolling-insights.com/api/v1` with `?RSC_token=`
 *     returns 2,182 rows for 2025, shape
 *     `{ data: { NFL: [ { player_id, player, team, team_id, regular_season{...}, postseason } ] } }`.
 *   - Season 2026 returns HTTP 304 — the season has not kicked off. The engine
 *     bootstraps from the PRIOR season, so this module falls back explicitly
 *     (recorded on the result, never silent).
 *   - `player-stats` carries NO `position` field. Position comes from
 *     `player-info/{SPORT}` (9,548 rows).
 *
 * NOTE this is NOT the severed `projections -> player-stats` mapping the brief
 * forbids. That mapping presented historical production AS a forecast. This
 * module stores historical production AS historical production — an INPUT the
 * Phase 2 engine computes forecasts from, labelled `source: 'rolling_insights'`
 * in a stat-line table, never a projection table.
 *
 * HIGHEST RISK — THE ID NAMESPACE. RI player ids are NOT canonical AF ids. A
 * naive write reproduces exactly the failure production already measured: rows
 * that exist and join to nothing (`fantasyProjection`'s 43 seed fixtures).
 * Every row therefore resolves through `PlayerIdentityMap`:
 *   1. direct `rollingInsightsId` hit, else
 *   2. verified name match (slice 15): position/team must verify, ambiguity is
 *      REFUSED — never resolved by map order.
 * Unresolved/ambiguous rows are NOT written; their rate is reported so a high
 * rate stops the rollout instead of silently thinning the data.
 */

import { prisma } from '@/lib/prisma'
import { buildNameIndex, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

const RI_SOURCE = 'rolling_insights'
/** Season aggregates refreshed daily by cron; a week of TTL tolerates cron
 *  outages without letting a dead feed masquerade as live for long. */
const STAT_LINE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * `FantasyStatLine.week` is an Int and RI `player-stats/{season}` is a SEASON
 * aggregate. Week 0 is the documented convention for "season total" — no real
 * NFL week is 0, so aggregates can never collide with a future weekly ingest.
 */
export const SEASON_AGGREGATE_WEEK = 0

export interface RiPlayerStatsRow {
  providerPlayerId: string
  playerName: string
  teamName: string | null
  teamId: string | null
  regularSeason: Record<string, unknown> | null
  postseason: Record<string, unknown> | null
}

/** Pure: flatten `{data:{NFL:[...]}}` into rows. Exported for tests. */
export function normalizeRiPlayerStats(payload: unknown, sport = 'NFL'): RiPlayerStatsRow[] {
  const data = (payload as { data?: Record<string, unknown> })?.data ?? payload
  const bySport = (data as Record<string, unknown>)?.[sport] ?? data
  const rows: unknown[] = Array.isArray(bySport)
    ? bySport
    : bySport && typeof bySport === 'object'
      ? Object.values(bySport)
      : []

  const out: RiPlayerStatsRow[] = []
  const seen = new Set<string>()
  for (const raw of rows) {
    const r = raw as Record<string, unknown>
    const providerPlayerId = String(r?.player_id ?? '').trim()
    const playerName = String(r?.player ?? '').trim()
    if (!providerPlayerId || !playerName) continue
    if (seen.has(providerPlayerId)) continue
    seen.add(providerPlayerId)
    const regular = r.regular_season
    const post = r.postseason
    out.push({
      providerPlayerId,
      playerName,
      teamName: String(r.team ?? '').trim() || null,
      teamId: r.team_id != null ? String(r.team_id) : null,
      regularSeason: regular && typeof regular === 'object' ? (regular as Record<string, unknown>) : null,
      postseason: post && typeof post === 'object' ? (post as Record<string, unknown>) : null,
    })
  }
  return out
}

export interface RiPlayerInfo {
  position: string | null
  teamName: string | null
}

/**
 * Pure: `player-info/{SPORT}` -> riPlayerId -> {position, team}. Tolerant of
 * field-name drift (`position`/`pos`, `team`/`team_name`) because the endpoint
 * shape was probed for existence, not exhaustively for vocabulary.
 */
export function normalizeRiPlayerInfo(payload: unknown, sport = 'NFL'): Map<string, RiPlayerInfo> {
  const data = (payload as { data?: Record<string, unknown> })?.data ?? payload
  const bySport = (data as Record<string, unknown>)?.[sport] ?? data
  const rows: unknown[] = Array.isArray(bySport)
    ? bySport
    : bySport && typeof bySport === 'object'
      ? Object.values(bySport)
      : []

  const map = new Map<string, RiPlayerInfo>()
  for (const raw of rows) {
    const r = raw as Record<string, unknown>
    const id = String(r?.player_id ?? '').trim()
    if (!id || map.has(id)) continue
    const position = String(r?.position ?? r?.pos ?? '').trim() || null
    const teamName = String(r?.team ?? r?.team_name ?? '').trim() || null
    map.set(id, { position, teamName })
  }
  return map
}

export interface RiStatSyncResult {
  sport: string
  seasonRequested: number
  /** The season actually ingested — differs from requested when the bootstrap
   *  fallback fired (e.g. 2026 pre-kickoff -> 2025). Never silent. */
  seasonUsed: number | null
  seasonFellBack: boolean
  fetched: number
  resolvedDirect: number
  resolvedByName: number
  /** Confident name matches whose `rollingInsightsId` was backfilled onto the
   *  identity map so future runs resolve directly. */
  backfilledIds: number
  written: number
  /** Refused: name collision that position/team could not split. */
  ambiguous: number
  /** No identity-map candidate at all. */
  unresolved: number
  /** unresolved+ambiguous over fetched — the stop-the-rollout signal. */
  unresolvedRate: number
  sampleUnresolved: string[]
  errors: string[]
}

function currentSeason(now: Date): number {
  // NFL convention used across the codebase: Aug (month 8) onward = new season.
  return now.getUTCMonth() + 1 >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
}

function riCredentials(): { token: string | null; base: string } {
  const token =
    process.env.ROLLING_INSIGHTS_RSC_TOKEN?.trim() ||
    process.env.ROLLING_INSIGHTS_RSC_TOKEN2?.trim() ||
    process.env.ROLLING_INSIGHTS_CLIENT_SECRET?.trim() ||
    null
  const rawBase =
    process.env.ROLLING_INSIGHTS_REST_BASE_URL?.trim() ||
    process.env.ROLLING_INSIGHTS_REST_BASE?.trim() ||
    'https://rest.datafeeds.rolling-insights.com/api/v1'
  const trimmed = rawBase.replace(/\/+$/, '')
  const base = /\/api\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/api/v1`
  return { token, base }
}

async function fetchRiJson(
  url: string,
  doFetch: typeof fetch,
): Promise<{ payload: unknown; status: number } | { error: string }> {
  try {
    const res = await doFetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(45_000),
    })
    // RI answers 304 for a season that has not kicked off — not an error, but
    // not data either. Surface the status so the caller can fall back.
    if (res.status === 304) return { payload: null, status: 304 }
    if (!res.ok) return { error: `HTTP ${res.status}` }
    return { payload: await res.json(), status: res.status }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Fetch + resolve + persist. Writes `FantasyStatLine` rows keyed by CANONICAL
 * `PlayerIdentityMap.id`, `week: 0` (season aggregate), `source:
 * 'rolling_insights'`. `fantasyPointsByScoringPreset` is written as `{}` —
 * scoring is Phase 2/4's job and pre-filling it here would fabricate numbers.
 */
export async function syncRollingInsightsPlayerStatsToDb(opts?: {
  sport?: string
  /** Explicit season disables the bootstrap fallback. */
  season?: number
  fetchImpl?: typeof fetch
  now?: Date
}): Promise<RiStatSyncResult> {
  const sport = (opts?.sport ?? 'NFL').toUpperCase()
  const now = opts?.now ?? new Date()
  const seasonRequested = opts?.season ?? currentSeason(now)
  const result: RiStatSyncResult = {
    sport,
    seasonRequested,
    seasonUsed: null,
    seasonFellBack: false,
    fetched: 0,
    resolvedDirect: 0,
    resolvedByName: 0,
    backfilledIds: 0,
    written: 0,
    ambiguous: 0,
    unresolved: 0,
    unresolvedRate: 0,
    sampleUnresolved: [],
    errors: [],
  }

  const { token, base } = riCredentials()
  if (!token) {
    result.errors.push('Rolling Insights RSC token not configured')
    return result
  }
  const doFetch = opts?.fetchImpl ?? fetch

  // --- player-stats, with explicit prior-season bootstrap ---
  const statsUrl = (season: number) =>
    `${base}/player-stats/${season}/${sport}?RSC_token=${encodeURIComponent(token)}`

  let rows: RiPlayerStatsRow[] = []
  for (const season of opts?.season != null ? [seasonRequested] : [seasonRequested, seasonRequested - 1]) {
    const res = await fetchRiJson(statsUrl(season), doFetch)
    if ('error' in res) {
      result.errors.push(`player-stats/${season}: ${res.error}`)
      continue
    }
    const normalized = res.status === 304 ? [] : normalizeRiPlayerStats(res.payload, sport)
    if (normalized.length > 0) {
      rows = normalized
      result.seasonUsed = season
      result.seasonFellBack = season !== seasonRequested
      break
    }
    result.errors.push(`player-stats/${season}: 0 rows${res.status === 304 ? ' (HTTP 304 — season not started)' : ''}`)
  }
  result.fetched = rows.length
  if (rows.length === 0) return result

  // --- player-info for positions (best effort — stats rows carry none) ---
  let infoById = new Map<string, RiPlayerInfo>()
  {
    const res = await fetchRiJson(`${base}/player-info/${sport}?RSC_token=${encodeURIComponent(token)}`, doFetch)
    if ('error' in res) {
      result.errors.push(`player-info: ${res.error} — matching proceeds on name+team only`)
    } else if (res.payload != null) {
      infoById = normalizeRiPlayerInfo(res.payload, sport)
    }
  }

  // --- identity candidates ---
  interface IdentityRow {
    id: string
    name: string
    position: string | null
    team: string | null
    rollingInsightsId: string | null
  }
  let identityRows: IdentityRow[] = []
  try {
    const raw = await prisma.playerIdentityMap.findMany({
      where: { sport },
      select: { id: true, canonicalName: true, position: true, currentTeam: true, rollingInsightsId: true },
    })
    identityRows = raw.map((r) => ({
      id: r.id,
      name: r.canonicalName,
      position: r.position,
      team: normalizeTeamAbbrev(r.currentTeam) ?? r.currentTeam,
      rollingInsightsId: r.rollingInsightsId,
    }))
  } catch (e) {
    result.errors.push(`identity map load failed: ${e instanceof Error ? e.message : String(e)}`)
    return result
  }
  if (identityRows.length === 0) {
    result.errors.push('identity map empty for sport — refusing to write provider-keyed rows')
    return result
  }

  const byRiId = new Map<string, IdentityRow>()
  for (const r of identityRows) {
    if (r.rollingInsightsId && !byRiId.has(r.rollingInsightsId)) byRiId.set(r.rollingInsightsId, r)
  }
  const nameIndex = buildNameIndex(identityRows)

  const seasonUsed = result.seasonUsed as number
  const expiresAt = new Date(now.getTime() + STAT_LINE_TTL_MS)

  for (const row of rows) {
    const info = infoById.get(row.providerPlayerId)
    const teamAbbrev = normalizeTeamAbbrev(row.teamName ?? info?.teamName ?? null)

    // 1) direct provider-id hit
    let identity: IdentityRow | null = byRiId.get(row.providerPlayerId) ?? null
    let viaName = false

    // 2) verified name match — ambiguity refused, never guessed
    if (!identity) {
      const res = resolveVerifiedMatch(nameIndex, {
        name: row.playerName,
        position: info?.position ?? null,
        team: teamAbbrev,
      })
      if (res.reason === 'ambiguous') {
        result.ambiguous += 1
        if (result.sampleUnresolved.length < 20) result.sampleUnresolved.push(`AMBIGUOUS ${row.playerName}`)
        continue
      }
      if (!res.match) {
        result.unresolved += 1
        if (result.sampleUnresolved.length < 20) result.sampleUnresolved.push(row.playerName)
        continue
      }
      identity = res.match
      viaName = true
    }

    if (viaName) {
      result.resolvedByName += 1
      // Backfill the provider id so future runs resolve directly. Guarded so a
      // row that already carries a DIFFERENT RI id is never overwritten — that
      // disagreement is a signal, not a race to win.
      if (!identity.rollingInsightsId) {
        try {
          const updated = await prisma.playerIdentityMap.updateMany({
            where: { id: identity.id, rollingInsightsId: null },
            data: { rollingInsightsId: row.providerPlayerId },
          })
          if (updated.count > 0) result.backfilledIds += 1
        } catch {
          // Backfill is an optimization; its failure must not block the write.
        }
      }
    } else {
      result.resolvedDirect += 1
    }

    try {
      const stats = {
        riPlayerId: row.providerPlayerId,
        riPlayerName: row.playerName,
        riTeam: row.teamName,
        position: info?.position ?? null,
        regular_season: row.regularSeason,
        postseason: row.postseason,
      }
      const data = {
        team: teamAbbrev ?? row.teamName,
        opponent: null,
        stats: stats as never,
        // Phase 2/4 computes scoring from the components. An empty object is
        // "not scored yet"; pre-filling would fabricate numbers.
        fantasyPointsByScoringPreset: {} as never,
        fetchedAt: now,
        expiresAt,
      }
      await prisma.fantasyStatLine.upsert({
        where: {
          uniq_fantasy_stat_line_player_week_source: {
            playerId: identity.id,
            sport,
            season: String(seasonUsed),
            week: SEASON_AGGREGATE_WEEK,
            source: RI_SOURCE,
          },
        },
        update: data,
        create: {
          playerId: identity.id,
          sport,
          season: String(seasonUsed),
          week: SEASON_AGGREGATE_WEEK,
          source: RI_SOURCE,
          ...data,
        },
      })
      result.written += 1
    } catch (e) {
      result.errors.push(`upsert ${row.playerName}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  result.unresolvedRate = result.fetched > 0 ? (result.unresolved + result.ambiguous) / result.fetched : 0
  return result
}
