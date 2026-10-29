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

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildNameIndex, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { riFetch } from '@/lib/workers/providers/rollingInsightsRest'
import { resolveRiEnvelope, riSupports } from '@/lib/sports-data/rollingInsightsSupport'

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

/**
 * Sports whose RI season rows are ALSO written to `player_season_stats`, keyed on RI's own player id —
 * the shape `syncNflFoundationSeasonStats` already writes for NFL.
 *
 * 🛑 WHY. The redraft roster (`loadOwnRollingInsightsSeasonStats`), the player card and Player Finder
 * all read `player_season_stats` WHERE source = 'rolling_insights' for whatever sport they are given,
 * and reach it through `rollingInsightsCrosswalk` by RI id. Measured 2026-10-17: that table held RI rows
 * for NFL only, so for these three sports every one of those reads found nothing while this module was
 * writing the same feed, daily, into `fantasy_stat_lines` — which none of them read.
 *
 * NOT NFL: it has its own writer of this exact key, and two writers would race on one row.
 * NOT NCAAB: GAPS.md N-14 — RI's NCAABB season totals stop ~mid-December and must never be presented as
 * a season. Not NCAAF (CFBD) and not SOCCER (no feed).
 */
export const PLAYER_SEASON_STATS_MIRROR_SPORTS: readonly string[] = ['MLB', 'NBA', 'NHL']

/**
 * Pure: a stat map with only scalar values. A nested group (MLB's `batting` / `pitching`) is kept under
 * qualified keys — `batting.hits` — never merged to a bare `hits`, which is the convention Player Finder
 * already documents for grouped providers and the only version that cannot conflate two stats.
 */
export function flattenRiSeasonStats(stats: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(stats)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [ik, iv] of Object.entries(v as Record<string, unknown>)) {
        if (iv === null || typeof iv !== 'object') out[`${k}.${ik}`] = iv
      }
    } else if (!Array.isArray(v)) {
      out[k] = v
    }
  }
  return out
}

const finiteOrNull = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/**
 * Write one sport's RI season rows to `player_season_stats` under RI's id (the same key and column
 * semantics as the NFL writer; `createdAt` is preserved on conflict). Independent of the identity
 * map on purpose: these readers resolve RI ids themselves, and refusing here for want of an identity row
 * would recreate the gap. Fantasy points stay NULL — RI sends none for these sports and inventing a
 * scoring would fabricate numbers (the projection engine reads a null as "no RI FPPG", not zero).
 */
async function mirrorToPlayerSeasonStats(args: {
  sport: string
  season: number
  rows: RiPlayerStatsRow[]
  infoById: Map<string, RiPlayerInfo>
  now: Date
}): Promise<{ written: number; errors: string[] }> {
  let written = 0
  const errors: string[] = []
  const expiresAt = new Date(args.now.getTime() + STAT_LINE_TTL_MS)
  const values = buildPlayerSeasonStatsMirrorValues(args)
  // The timestamp columns are WITHOUT time zone and Prisma stores UTC; a bound Date would be shifted by
  // the session zone. An ISO string cast to `timestamp` keeps the UTC wall clock exactly.
  const nowUtc = args.now.toISOString()
  const expiresUtc = expiresAt.toISOString()

  /*
   * ⚠ BATCHED, BECAUSE THIS RIDES A ROUTE WITH NO SLACK. `import-stat-lines` ran 153-270s against
   * a ~240s budget on 2026-10-16/17, and MLB alone is ~2,600 rows. One upsert per row would add
   * thousands of round trips and push whole sports out of the run. One INSERT ... ON CONFLICT per
   * 500 rows keeps the added cost to a handful of statements. `id` has no DB default (Prisma
   * generates it client-side), hence `gen_random_uuid()`.
   */
  for (let i = 0; i < values.length; i += MIRROR_BATCH) {
    const chunk = values.slice(i, i + MIRROR_BATCH)
    try {
      const n = await prisma.$executeRaw`
        INSERT INTO "player_season_stats"
          ("id", "sport", "playerId", "playerName", "season", "seasonType", "position", "team", "stats",
           "gamesPlayed", "fantasyPoints", "fantasyPointsPerGame", "source", "fetchedAt", "expiresAt",
           "createdAt", "updatedAt")
        VALUES ${Prisma.join(
          chunk.map(
            (v) => Prisma.sql`(gen_random_uuid()::text, ${args.sport}, ${v.playerId}, ${v.playerName},
              ${v.season}, 'regular', ${v.position}::text, ${v.team}::text, ${JSON.stringify(v.stats)}::jsonb,
              ${v.gamesPlayed}::integer, NULL, NULL, ${RI_SOURCE}, ${nowUtc}::timestamp, ${expiresUtc}::timestamp,
              ${nowUtc}::timestamp, ${nowUtc}::timestamp)`,
          ),
        )}
        ON CONFLICT ("sport", "playerId", "season", "seasonType", "source") DO UPDATE SET
          "playerName" = EXCLUDED."playerName",
          "position" = EXCLUDED."position",
          "team" = EXCLUDED."team",
          "stats" = EXCLUDED."stats",
          "gamesPlayed" = EXCLUDED."gamesPlayed",
          "fetchedAt" = EXCLUDED."fetchedAt",
          "expiresAt" = EXCLUDED."expiresAt",
          "updatedAt" = EXCLUDED."updatedAt"`
      written += n
    } catch (e) {
      if (errors.length < 5) {
        errors.push(`season-stats batch ${i / MIRROR_BATCH}: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`)
      }
    }
  }
  return { written, errors }
}

const MIRROR_BATCH = 500

export interface PlayerSeasonStatsMirrorValue {
  playerId: string
  playerName: string
  season: string
  position: string | null
  team: string | null
  stats: Record<string, unknown>
  gamesPlayed: number | null
}

/** Pure: the rows `mirrorToPlayerSeasonStats` writes. Rows with no regular-season stats are skipped. */
export function buildPlayerSeasonStatsMirrorValues(args: {
  season: number
  rows: RiPlayerStatsRow[]
  infoById: Map<string, RiPlayerInfo>
}): PlayerSeasonStatsMirrorValue[] {
  const out: PlayerSeasonStatsMirrorValue[] = []
  for (const row of args.rows) {
    if (!row.regularSeason || Object.keys(row.regularSeason).length === 0) continue
    const stats = flattenRiSeasonStats(row.regularSeason)
    const gamesPlayed = finiteOrNull(stats.games_played)
    const info = args.infoById.get(row.providerPlayerId)
    out.push({
      playerId: row.providerPlayerId,
      playerName: row.playerName,
      season: String(args.season),
      position: info?.position ?? null,
      // `normalizeTeamAbbrev` is NFL-only; other sports keep the provider's own team string.
      team: row.teamName ?? info?.teamName ?? null,
      stats,
      gamesPlayed: gamesPlayed != null ? Math.round(gamesPlayed) : null,
    })
  }
  return out
}

export interface RiPlayerStatsRow {
  providerPlayerId: string
  playerName: string
  teamName: string | null
  teamId: string | null
  regularSeason: Record<string, unknown> | null
  postseason: Record<string, unknown> | null
}

/**
 * Pure: flatten `{data:{NFL:[...]}}` into rows. Exported for tests.
 *
 * ⚠ THE ENVELOPE KEY IS THE VENDOR SPORT CODE, NOT THE APP ONE. `resolveRiEnvelope` translates
 * (NCAAB -> NCAABB, NCAAF -> NCAAFB) and knows that SOCCER answers under its LEAGUE key. Keying
 * off the app code directly, as this did, made `data.NCAABB` fall through to the object-of-one
 * fallback and yield an array-of-arrays — rows that parse to nothing, silently.
 */
export function normalizeRiPlayerStats(payload: unknown, sport = 'NFL'): RiPlayerStatsRow[] {
  const rows = resolveRiEnvelope(payload, { sport })

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
  const rows = resolveRiEnvelope(payload, { sport })

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
  /**
   * The vendor documents no player-stats feed for this sport (SOCCER). Not a failure to fix —
   * a capability that does not exist, which callers must report as such rather than as zero rows.
   */
  unsupported: boolean
  /**
   * A 304 survived the cache-busted retry for at least one season attempt. Under the unresolved
   * `304_conflict` that is "unchanged or not yet started", and the prior-season bootstrap is the
   * intended response — not an empty result set to write.
   */
  notModified: boolean
  /** Rows also written to `player_season_stats` (PLAYER_SEASON_STATS_MIRROR_SPORTS only). */
  seasonStatsWritten: number
  sampleUnresolved: string[]
  errors: string[]
}

function currentSeason(now: Date): number {
  // NFL convention used across the codebase: Aug (month 8) onward = new season.
  return now.getUTCMonth() + 1 >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
}

/*
 * Credentials and transport now live in `lib/workers/providers/rollingInsightsRest.ts`.
 *
 * The private `fetchRiJson` that used to sit here sent no cache-buster and no no-cache headers,
 * and read a 304 as a plain status the caller turned into `[]`. That is the ONE response the
 * contract says is wrong under both readings of the unresolved `304_conflict`: it makes "the
 * season has not kicked off" and "an intermediary served you a stale validator" indistinguishable.
 * `riFetch` retries once with a fresh millisecond buster before it will say 304 at all.
 */

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
    unsupported: false,
    notModified: false,
    seasonStatsWritten: 0,
    sampleUnresolved: [],
    errors: [],
  }

  // SOCCER is the one supported sport with NO player season stats from this vendor
  // (support_consequences). Refuse before the request so the caller can report "no source" rather
  // than a mystery 404 every night.
  if (!riSupports('player_stats', sport)) {
    result.unsupported = true
    result.errors.push(`Rolling Insights documents no player-stats feed for ${sport}`)
    return result
  }

  const doFetch = opts?.fetchImpl ?? fetch

  // --- player-stats, with explicit prior-season bootstrap ---
  let rows: RiPlayerStatsRow[] = []
  for (const season of opts?.season != null ? [seasonRequested] : [seasonRequested, seasonRequested - 1]) {
    const res = await riFetch('player_stats', { sport, season, fetchImpl: doFetch, timeoutMs: 45_000 })
    if (!res.ok) {
      // A 304 here has already survived a cache-busted retry, so it genuinely means
      // "unchanged or not yet started" — which is exactly the case the prior-season bootstrap
      // below exists to handle. Recorded, then the loop tries the earlier season.
      if (res.kind === 'not_modified') result.notModified = true
      result.errors.push(`player-stats/${season}: ${res.error}`)
      continue
    }
    const normalized = normalizeRiPlayerStats(res.payload, sport)
    if (normalized.length > 0) {
      rows = normalized
      result.seasonUsed = season
      result.seasonFellBack = season !== seasonRequested
      break
    }
    result.errors.push(`player-stats/${season}: 0 rows`)
  }
  result.fetched = rows.length
  if (rows.length === 0) return result

  // --- player-info for positions (best effort — stats rows carry none) ---
  let infoById = new Map<string, RiPlayerInfo>()
  {
    const res = await riFetch('player_info', { sport, fetchImpl: doFetch, timeoutMs: 45_000 })
    if (!res.ok) {
      result.errors.push(`player-info: ${res.error} — matching proceeds on name+team only`)
    } else {
      infoById = normalizeRiPlayerInfo(res.payload, sport)
    }
  }

  // --- player_season_stats, keyed on RI id (before identity resolution, which it does not need) ---
  if (PLAYER_SEASON_STATS_MIRROR_SPORTS.includes(sport)) {
    const mirrored = await mirrorToPlayerSeasonStats({
      sport,
      season: result.seasonUsed as number,
      rows,
      infoById,
      now,
    })
    result.seasonStatsWritten = mirrored.written
    result.errors.push(...mirrored.errors)
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
