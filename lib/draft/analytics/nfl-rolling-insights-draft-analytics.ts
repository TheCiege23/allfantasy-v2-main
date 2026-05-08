/**
 * Merge `PlayerAnalyticsSnapshot` (default) with Rolling Insights season stats when identity + freshness rules pass.
 * Single resolved analytics object per player for draft pool rows — no silent field-by-field mixing.
 */

import { prisma } from '@/lib/prisma'
import { looksLikeSleeperExternalId } from '@/lib/draft-sports-models/player-asset-resolver'
import { canonicalName } from '@/lib/draft-room/player-canonical-identity'

/** RI must be at least this many ms newer than snapshot.updatedAt to replace PPG (default 60s). */
export const RI_MIN_LEAD_OVER_SNAPSHOT_MS = Number(
  process.env.DRAFT_RI_MIN_LEAD_MS ?? 60_000,
)

/** Minimum games played on RI row before FPPG can replace snapshot (default 1). */
export const RI_MIN_GAMES_PLAYED = Number(process.env.DRAFT_RI_MIN_GAMES ?? 1)

export type SnapshotAnalyticsSlice = {
  fantasyPointsPerGame: number | null
  lifetimeValue: number | null
  updatedAt: Date | null
}

export type RollingInsightsSeasonSlice = {
  fantasyPointsPerGame: number | null
  fantasyPointsSeason: number | null
  gamesPlayed: number | null
  season: string | null
  updatedAt: Date
}

export type ResolvedNflDraftPoolAnalytics = {
  fantasyPointsPerGame: number | null
  lifetimeValue: number | null
  primarySource: 'snapshot' | 'rolling_insights'
  /** When RI did not win override, optional RI numbers for UI/debug (supplemental only). */
  rollingInsightsSupplemental?: {
    fantasyPointsPerGame?: number | null
    gamesPlayed?: number | null
    season?: string | null
  }
}

/** Default NFL season key for stats rows (e.g. training camp through draft). */
export function defaultNflPlayerStatsSeason(): string {
  const y = new Date()
  const yy = y.getFullYear()
  const m = y.getMonth()
  return m >= 6 ? String(yy) : String(yy - 1)
}

function seasonAllowedForStatsOverride(
  riSeason: string | null,
  currentStatsSeason: string,
): boolean {
  if (!riSeason) return false
  const prev = String(Number(currentStatsSeason) - 1)
  return riSeason === currentStatsSeason || riSeason === prev
}

/**
 * Resolve one player’s displayed PPG/LTV for the draft pool.
 * LTV stays on snapshot unless a future RI metric is wired; not mixed from RI in v1.
 */
export function resolveNflDraftPoolAnalytics(params: {
  snapshot: SnapshotAnalyticsSlice | null
  rollingInsights: RollingInsightsSeasonSlice | null
  identityMatchConfidence: 'high' | 'none'
  currentStatsSeason: string
}): ResolvedNflDraftPoolAnalytics {
  const fppgSnap = params.snapshot?.fantasyPointsPerGame ?? null
  const ltv = params.snapshot?.lifetimeValue ?? null
  const snapAt = params.snapshot?.updatedAt?.getTime() ?? 0

  const ri = params.rollingInsights
  if (!ri || params.identityMatchConfidence !== 'high') {
    if (ri && params.identityMatchConfidence === 'none') {
      return {
        fantasyPointsPerGame: fppgSnap,
        lifetimeValue: ltv,
        primarySource: 'snapshot',
        rollingInsightsSupplemental:
          ri.fantasyPointsPerGame != null
            ? {
                fantasyPointsPerGame: ri.fantasyPointsPerGame,
                gamesPlayed: ri.gamesPlayed,
                season: ri.season,
              }
            : undefined,
      }
    }
    return {
      fantasyPointsPerGame: fppgSnap,
      lifetimeValue: ltv,
      primarySource: 'snapshot',
    }
  }

  const riFppg = ri.fantasyPointsPerGame
  const gamesOk = (ri.gamesPlayed ?? 0) >= RI_MIN_GAMES_PLAYED
  const riFppgOk = riFppg != null && Number.isFinite(Number(riFppg))
  const seasonOk = seasonAllowedForStatsOverride(ri.season, params.currentStatsSeason)
  const riNewer = params.snapshot
    ? ri.updatedAt.getTime() >= snapAt + RI_MIN_LEAD_OVER_SNAPSHOT_MS
    : true

  const supplemental =
    riFppgOk || ri.gamesPlayed != null
      ? {
          fantasyPointsPerGame: riFppgOk ? riFppg : null,
          gamesPlayed: ri.gamesPlayed,
          season: ri.season,
        }
      : undefined

  if (riNewer && gamesOk && riFppgOk && seasonOk) {
    return {
      fantasyPointsPerGame: Number(riFppg),
      lifetimeValue: ltv,
      primarySource: 'rolling_insights',
      rollingInsightsSupplemental: supplemental,
    }
  }

  return {
    fantasyPointsPerGame: fppgSnap,
    lifetimeValue: ltv,
    primarySource: 'snapshot',
    rollingInsightsSupplemental: supplemental,
  }
}

export type DraftPoolRiLookupKey = string

export type RollingInsightsDraftIdentity = {
  rollingInsightsPlayerId: string
  confidence: 'high'
}

/**
 * Batch-load Rolling Insights season rows for NFL draft pool rows (identity via PlayerIdentityMap).
 */
export async function loadRollingInsightsSeasonByDraftPoolKey(options: {
  rows: Array<{
    nk: string
    pk: string
    sleeperCandidate: string | null
  }>
}): Promise<{
  identityByPoolKey: Map<DraftPoolRiLookupKey, RollingInsightsDraftIdentity>
  riSeasonByPlayerId: Map<string, RollingInsightsSeasonSlice>
}> {
  const sport = 'NFL'
  const identityByPoolKey = new Map<DraftPoolRiLookupKey, RollingInsightsDraftIdentity>()

  const sleeperIds = [
    ...new Set(
      options.rows
        .map((r) => r.sleeperCandidate)
        .filter((id): id is string => Boolean(id && looksLikeSleeperExternalId(id))),
    ),
  ]

  /**
   * G.1 — Asymmetric-normalization fix.
   *
   * The pool side runs every name through `canonicalName` (strips Jr/Sr/III suffixes,
   * apostrophes, dots, collapses single-letter token pairs), but PlayerIdentityMap
   * stores `normalizedName` in its raw, suffix-preserving form ("brian thomas jr.").
   * A `WHERE normalizedName IN (nkSet)` filter therefore misses every suffix-bearing
   * player — Brian Thomas Jr., Patrick Mahomes II, Marvin Harrison Jr., etc. — and
   * those players silently fall back to `snapshot_projection` (no per-stat splits).
   *
   * Fix is read-only: pull every NFL identity row that has `rollingInsightsId`, then
   * canonicalize the DB-side name in memory before keying the lookup map. The pool
   * row's `r.nk` is already canonical, so post-fix both sides agree on the same key.
   * NFL identity table is small (~2k rows) — single cold-path query, no migration.
   */
  const [bySleeper, byName] = await Promise.all([
    sleeperIds.length
      ? prisma.playerIdentityMap.findMany({
          where: { sport, sleeperId: { in: sleeperIds }, rollingInsightsId: { not: null } },
          select: { sleeperId: true, rollingInsightsId: true },
        })
      : [],
    prisma.playerIdentityMap.findMany({
      where: { sport, rollingInsightsId: { not: null } },
      select: {
        normalizedName: true,
        position: true,
        rollingInsightsId: true,
      },
    }),
  ])

  const sleeperToRi = new Map<string, string>()
  for (const m of bySleeper) {
    if (m.sleeperId && m.rollingInsightsId) sleeperToRi.set(m.sleeperId, m.rollingInsightsId)
  }

  // E.3: detect ambiguous (name, position) pairs in PlayerIdentityMap to skip collisions.
  // If multiple RI players match the same canonical (name, position), skip to avoid silent data loss.
  const namePosToRi = new Map<string, string>()
  const namePosAmbiguous = new Set<string>()
  for (const m of byName) {
    /** G.1: canonicalize DB-side name to match the pool-side key built from `canonicalName`.
     * Previous body used `(m.normalizedName ?? '').trim().toLowerCase()` which left suffix-bearing
     * names ("brian thomas jr.") un-canonical and never matched pool keys ("brian thomas").
     * Position handling preserves the E.2 bug fix — pool callers normalize pk via toLowerCase()
     * (see getResolvedDraftPoolForLeague.ts `normalizeKeyPart`), so we must lowercase here too. */
    const nk = canonicalName(m.normalizedName ?? '')
    const pk = (m.position ?? '').trim().toLowerCase()
    if (nk && pk && m.rollingInsightsId) {
      const k = `${nk}|${pk}`
      if (namePosToRi.has(k)) {
        // Collision: multiple identity rows share this (name, position) key.
        // Mark ambiguous and remove from map to prevent silent data loss.
        namePosAmbiguous.add(k)
        namePosToRi.delete(k)
      } else if (!namePosAmbiguous.has(k)) {
        // Safe to add (no collision yet known).
        namePosToRi.set(k, m.rollingInsightsId)
      }
    }
  }

  let exactIdHits = 0
  let nameFallbackHits = 0
  let ambiguousSkips = 0

  for (const r of options.rows) {
    const key = `${r.nk}|${r.pk}`
    let riId: string | null = null
    if (r.sleeperCandidate && looksLikeSleeperExternalId(r.sleeperCandidate)) {
      riId = sleeperToRi.get(r.sleeperCandidate) ?? null
      if (riId) exactIdHits += 1
    }
    if (!riId) {
      if (namePosAmbiguous.has(`${r.nk}|${r.pk}`)) {
        ambiguousSkips += 1
      } else {
        riId = namePosToRi.get(`${r.nk}|${r.pk}`) ?? null
        if (riId) nameFallbackHits += 1
      }
    }
    if (riId) {
      identityByPoolKey.set(key, { rollingInsightsPlayerId: riId, confidence: 'high' })
    }
  }

  const riPlayerIds = [...new Set([...identityByPoolKey.values()].map((v) => v.rollingInsightsPlayerId))]
  const riSeasonByPlayerId = new Map<string, RollingInsightsSeasonSlice>()

  if (riPlayerIds.length === 0) {
    return { identityByPoolKey, riSeasonByPlayerId }
  }

  const statsRows = await prisma.playerSeasonStats.findMany({
    where: {
      sport,
      source: 'rolling_insights',
      seasonType: 'regular',
      playerId: { in: riPlayerIds },
    },
    select: {
      playerId: true,
      season: true,
      fantasyPointsPerGame: true,
      fantasyPoints: true,
      gamesPlayed: true,
      updatedAt: true,
    },
  })

  const sorted = [...statsRows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  for (const row of sorted) {
    if (riSeasonByPlayerId.has(row.playerId)) continue
    riSeasonByPlayerId.set(row.playerId, {
      fantasyPointsPerGame: row.fantasyPointsPerGame ?? null,
      fantasyPointsSeason: row.fantasyPoints ?? null,
      gamesPlayed: row.gamesPlayed ?? null,
      season: row.season ?? null,
      updatedAt: row.updatedAt,
    })
  }

  return { identityByPoolKey, riSeasonByPlayerId }
}

export type RollingInsightsStatsDetailRow = {
  stats: unknown
  fantasyPoints: number | null
  fantasyPointsPerGame: number | null
}

/**
 * Full RI season row (including `stats` JSON splits) keyed by Rolling Insights player id.
 * Latest row per playerId wins (same ordering rules as season slice loader).
 */
export async function loadRollingInsightsStatsDetailByPlayerIds(
  playerIds: string[],
): Promise<Map<string, RollingInsightsStatsDetailRow>> {
  const out = new Map<string, RollingInsightsStatsDetailRow>()
  if (playerIds.length === 0) return out

  const statsRows = await prisma.playerSeasonStats.findMany({
    where: {
      sport: 'NFL',
      source: 'rolling_insights',
      seasonType: 'regular',
      playerId: { in: playerIds },
    },
    select: {
      playerId: true,
      stats: true,
      fantasyPoints: true,
      fantasyPointsPerGame: true,
      updatedAt: true,
    },
  })

  const sorted = [...statsRows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  for (const row of sorted) {
    if (out.has(row.playerId)) continue
    out.set(row.playerId, {
      stats: row.stats,
      fantasyPoints: row.fantasyPoints ?? null,
      fantasyPointsPerGame: row.fantasyPointsPerGame ?? null,
    })
  }
  return out
}

/**
 * Fallback: load PlayerSeasonStats for pool rows that don't have RI identity mapping yet.
 * Uses safe heuristics: exact ID match first, then name+position (only if unambiguous).
 * Returns both season slices and diagnostic counters.
 */
export async function loadPlayerSeasonStatsFallback(options: {
  rows: Array<{
    poolKey: string
    nk: string
    pk: string
    sleeperCandidate: string | null
    existingRiId: string | null
  }>
}): Promise<{
  seasonByPoolKey: Map<string, RollingInsightsSeasonSlice>
  diagnostics: {
    exactIdHits: number
    namePositionHits: number
    ambiguousSkips: number
    misses: number
  }
}> {
  const sport = 'NFL'
  const seasonByPoolKey = new Map<string, RollingInsightsSeasonSlice>()
  const diagnostics = { exactIdHits: 0, namePositionHits: 0, ambiguousSkips: 0, misses: 0 }

  // Filter to rows without existing RI identity
  const unidentifiedRows = options.rows.filter((r) => !r.existingRiId)
  if (unidentifiedRows.length === 0) {
    return { seasonByPoolKey, diagnostics }
  }

  // Build candidate sleeper ID set for Phase 1 exact match
  const candidateSleeperIds = [
    ...new Set(
      unidentifiedRows
        .map((r) => r.sleeperCandidate)
        .filter((id): id is string => Boolean(id && looksLikeSleeperExternalId(id))),
    ),
  ]

  // Phase 1: Sleeper ID → rollingInsightsId via PlayerIdentityMap → PlayerSeasonStats
  const sleeperToRi = new Map<string, string>()
  if (candidateSleeperIds.length > 0) {
    const identityRows = await prisma.playerIdentityMap.findMany({
      where: {
        sport,
        sleeperId: { in: candidateSleeperIds },
        rollingInsightsId: { not: null },
      },
      select: { sleeperId: true, rollingInsightsId: true },
    })
    for (const row of identityRows) {
      if (row.sleeperId && row.rollingInsightsId) sleeperToRi.set(row.sleeperId, row.rollingInsightsId)
    }

    if (sleeperToRi.size > 0) {
      const riIds = [...new Set(sleeperToRi.values())]
      const statsRows = await prisma.playerSeasonStats.findMany({
        where: {
          sport,
          source: 'rolling_insights',
          seasonType: 'regular',
          playerId: { in: riIds },
        },
        select: {
          playerId: true,
          season: true,
          fantasyPointsPerGame: true,
          fantasyPoints: true,
          gamesPlayed: true,
          updatedAt: true,
        },
        orderBy: [{ playerId: 'asc' }, { season: 'desc' }, { updatedAt: 'desc' }],
      })

      const statsByRiId = new Map<string, (typeof statsRows)[0]>()
      for (const row of statsRows) {
        if (!statsByRiId.has(row.playerId)) statsByRiId.set(row.playerId, row)
      }

      for (const urow of unidentifiedRows) {
        if (!urow.sleeperCandidate) continue
        const riId = sleeperToRi.get(urow.sleeperCandidate)
        if (riId && statsByRiId.has(riId)) {
          const statsRow = statsByRiId.get(riId)!
          seasonByPoolKey.set(urow.poolKey, {
            fantasyPointsPerGame: statsRow.fantasyPointsPerGame ?? null,
            fantasyPointsSeason: statsRow.fantasyPoints ?? null,
            gamesPlayed: statsRow.gamesPlayed ?? null,
            season: statsRow.season ?? null,
            updatedAt: statsRow.updatedAt,
          })
          diagnostics.exactIdHits += 1
        }
      }
    }
  }

  // Phase 2: name+position → rollingInsightsId (unambiguous only) → PlayerSeasonStats
  const unmatched = unidentifiedRows.filter((r) => !seasonByPoolKey.has(r.poolKey))
  if (unmatched.length > 0) {
    const nkSet = [...new Set(unmatched.map((r) => r.nk).filter(Boolean))]

    if (nkSet.length > 0) {
      // G.1 — same asymmetric-normalization fix as `loadRollingInsightsSeasonByDraftPoolKey`:
      // pool-side `nk` is canonical, DB-side `normalizedName` is raw — drop the by-name WHERE
      // and canonicalize in memory so suffix-bearing names match.
      const identitiesByNamePos = await prisma.playerIdentityMap.findMany({
        where: {
          sport,
          rollingInsightsId: { not: null },
        },
        select: {
          normalizedName: true,
          position: true,
          rollingInsightsId: true,
        },
      })

      // Build name+position → rollingInsightsId lookup, detecting ambiguities
      const namePosToRiId = new Map<string, string>()
      const namePosAmbiguous = new Set<string>()
      for (const ident of identitiesByNamePos) {
        const nk = canonicalName(ident.normalizedName ?? '')
        const pk = (ident.position ?? '').trim().toLowerCase()
        if (nk && pk && ident.rollingInsightsId) {
          const key = `${nk}|${pk}`
          if (namePosToRiId.has(key)) {
            namePosAmbiguous.add(key)
            namePosToRiId.delete(key)
          } else if (!namePosAmbiguous.has(key)) {
            namePosToRiId.set(key, ident.rollingInsightsId)
          }
        }
      }

      const unambiguousRiIds = [...new Set(namePosToRiId.values())]
      if (unambiguousRiIds.length > 0) {
        const fallbackStats = await prisma.playerSeasonStats.findMany({
          where: {
            sport,
            source: 'rolling_insights',
            seasonType: 'regular',
            playerId: { in: unambiguousRiIds },
          },
          select: {
            playerId: true,
            season: true,
            fantasyPointsPerGame: true,
            fantasyPoints: true,
            gamesPlayed: true,
            updatedAt: true,
          },
          orderBy: [{ playerId: 'asc' }, { season: 'desc' }, { updatedAt: 'desc' }],
        })

        const statsByRiId = new Map<string, (typeof fallbackStats)[0]>()
        for (const row of fallbackStats) {
          if (!statsByRiId.has(row.playerId)) statsByRiId.set(row.playerId, row)
        }

        for (const urow of unmatched) {
          if (seasonByPoolKey.has(urow.poolKey)) continue
          const key = `${urow.nk}|${urow.pk}`
          if (namePosAmbiguous.has(key)) {
            diagnostics.ambiguousSkips += 1
          } else {
            const riId = namePosToRiId.get(key)
            if (riId && statsByRiId.has(riId)) {
              const statsRow = statsByRiId.get(riId)!
              seasonByPoolKey.set(urow.poolKey, {
                fantasyPointsPerGame: statsRow.fantasyPointsPerGame ?? null,
                fantasyPointsSeason: statsRow.fantasyPoints ?? null,
                gamesPlayed: statsRow.gamesPlayed ?? null,
                season: statsRow.season ?? null,
                updatedAt: statsRow.updatedAt,
              })
              diagnostics.namePositionHits += 1
            }
          }
        }
      }
    }
  }

  // Phase 3: Direct PlayerSeasonStats.playerName normalization match (bypasses PlayerIdentityMap).
  // Loads all NFL RI regular-season rows in memory, normalizes playerName with canonicalName(),
  // and matches unidentified pool rows by normalized name+position with ambiguity detection.
  const stillUnmatched = unidentifiedRows.filter((r) => !seasonByPoolKey.has(r.poolKey))
  if (stillUnmatched.length > 0) {
    const allStatsRows = await prisma.playerSeasonStats.findMany({
      where: {
        sport,
        source: 'rolling_insights',
        seasonType: 'regular',
      },
      select: {
        playerId: true,
        playerName: true,
        position: true,
        season: true,
        fantasyPointsPerGame: true,
        fantasyPoints: true,
        gamesPlayed: true,
        updatedAt: true,
      },
      orderBy: [{ playerId: 'asc' }, { season: 'desc' }, { updatedAt: 'desc' }],
    })

    // Build canonical name+position → stats row map with ambiguity detection
    // Keep only the most recent row per playerId, then index by canonical key
    const latestByPlayerId = new Map<string, (typeof allStatsRows)[0]>()
    for (const row of allStatsRows) {
      if (!latestByPlayerId.has(row.playerId)) latestByPlayerId.set(row.playerId, row)
    }

    const directNamePosMap = new Map<string, (typeof allStatsRows)[0]>()
    const directNamePosAmbiguous = new Set<string>()
    for (const row of latestByPlayerId.values()) {
      const nk = canonicalName(row.playerName)
      const pk = (row.position ?? '').trim().toLowerCase()
      if (!nk || !pk) continue
      const key = `${nk}|${pk}`
      if (directNamePosMap.has(key)) {
        directNamePosAmbiguous.add(key)
        directNamePosMap.delete(key)
      } else if (!directNamePosAmbiguous.has(key)) {
        directNamePosMap.set(key, row)
      }
    }

    for (const urow of stillUnmatched) {
      if (seasonByPoolKey.has(urow.poolKey)) continue
      const key = `${urow.nk}|${urow.pk}`
      if (directNamePosAmbiguous.has(key)) {
        diagnostics.ambiguousSkips += 1
      } else {
        const statsRow = directNamePosMap.get(key)
        if (statsRow) {
          seasonByPoolKey.set(urow.poolKey, {
            fantasyPointsPerGame: statsRow.fantasyPointsPerGame ?? null,
            fantasyPointsSeason: statsRow.fantasyPoints ?? null,
            gamesPlayed: statsRow.gamesPlayed ?? null,
            season: statsRow.season ?? null,
            updatedAt: statsRow.updatedAt,
          })
          diagnostics.namePositionHits += 1
        }
      }
    }
  }

  // Count remaining misses
  diagnostics.misses = unidentifiedRows.length - seasonByPoolKey.size

  return { seasonByPoolKey, diagnostics }
}
