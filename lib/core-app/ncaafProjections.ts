import 'server-only'

import { prisma } from '@/lib/prisma'
import type { PlayerProjection } from './playerProjections'

/**
 * College weekly projections for `/core`, read from `AFProjectionSnapshot`.
 *
 * 🛑 THE PROJECTIONS ALWAYS EXISTED. THE JOIN DID NOT. `import-stat-lines` pulls
 * NCAAF season lines from CFBD, `compute-projections` runs every sport, and
 * `AFProjectionSnapshot` holds thousands of NCAAF rows — while `fantasy_projections`,
 * which every `/core` surface reads, holds zero for the sport. So a college manager
 * saw a lineup with no numbers next to it, and the cause was never the projection
 * engine:
 *
 *   - the AF mirror into `fantasy_projections` keys on a Sleeper id, and college
 *     players have none, so every mirror write is skipped as `mirrorSkippedNoSleeperId`
 *   - and every `/core` reader excludes `source: 'allfantasy'` anyway, deliberately,
 *     because mirror rows carry no component line to rescore
 *
 * Reading the snapshot directly answers both objections at once: it is not a mirror
 * row, and `adjustmentFactors` carries the per-game component rates precisely so a
 * league can rescore from components. The writer's own header says so.
 *
 * ⚠ EVERY HOP HERE IS AN ID. The CFBD-to-identity link is resolved by name exactly
 * once, in `lib/sports-data/cfbdIdentityBridge.ts`, offline, where ambiguity is
 * dropped and counted. Nothing on this read path matches a name — it looks up
 * `PlayerIdentityMap` by whichever provider id the roster already carries and takes
 * that row's `cfbdId`. Same discipline as `rosterIdCrosswalk.ts`.
 *
 * ⚠ REQUIRES THE `cfbdId` COLUMN — see
 * `prisma/migrations/20260830150000_player_identity_cfbd_id`. This code must not
 * deploy ahead of that migration: a client that selects a column production lacks
 * raises P2022 rather than degrading quietly.
 */

/** The latest college baseline season. Null week denotes row scope, not point units. */
export async function latestNcaafProjectionSeason(): Promise<{ season: string } | null> {
  const row = await prisma.aFProjectionSnapshot
    .findFirst({
      where: { sport: 'NCAAF', week: null },
      orderBy: { season: 'desc' },
      select: { season: true },
    })
    .catch(() => null)
  return row ? { season: String(row.season) } : null
}

/**
 * `rosterId` → `cfbdId`, by id hop through `PlayerIdentityMap`.
 *
 * A college roster id may be a Rolling-Insights id (the id space `SportsPlayer`
 * carries for NCAAF), an ESPN athlete id, or already a CFBD id. All three are tried
 * in one read rather than making the caller state which platform it is holding.
 *
 * ⚠ AN ID MATCHING TWO ROWS IS DROPPED, not resolved to the first. Only `sleeperId`
 * is unique on `PlayerIdentityMap`; the provider columns are not, and a wrong link
 * here puts a stranger's projection on somebody's starter.
 */
async function resolveCfbdIds(rosterIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(rosterIds.map((id) => String(id).trim()).filter(Boolean))]
  if (ids.length === 0) return new Map()

  const rows = await prisma.playerIdentityMap
    .findMany({
      where: {
        sport: 'NCAAF',
        OR: [{ rollingInsightsId: { in: ids } }, { espnId: { in: ids } }, { cfbdId: { in: ids } }],
      },
      select: { rollingInsightsId: true, espnId: true, cfbdId: true },
    })
    .catch(() => [])

  const claims = new Map<string, string | null>()
  const claim = (from: string | null, to: string | null) => {
    if (!from || !to) return
    if (!claims.has(from)) {
      claims.set(from, to)
      return
    }
    // Null is the tombstone for a contradicted id, same rule as reduceCrosswalk.
    if (claims.get(from) !== to) claims.set(from, null)
  }

  const wanted = new Set(ids)
  for (const r of rows) {
    if (r.rollingInsightsId && wanted.has(r.rollingInsightsId)) claim(r.rollingInsightsId, r.cfbdId)
    if (r.espnId && wanted.has(r.espnId)) claim(r.espnId, r.cfbdId)
    if (r.cfbdId && wanted.has(r.cfbdId)) claim(r.cfbdId, r.cfbdId)
  }

  const out = new Map<string, string>()
  for (const [from, to] of claims) if (to) out.set(from, to)
  return out
}

/** The component rates the snapshot stores so a league can rescore from them. */
function readComponentStats(adjustmentFactors: unknown): Record<string, unknown> | null {
  if (!adjustmentFactors || typeof adjustmentFactors !== 'object' || Array.isArray(adjustmentFactors)) return null
  const f = adjustmentFactors as Record<string, unknown>
  const rates = f.perGameRates ?? f.componentRates ?? null
  if (rates && typeof rates === 'object' && !Array.isArray(rates)) return rates as Record<string, unknown>
  return null
}

/**
 * College projections keyed by the ROSTER id the caller passed in.
 *
 * Keyed on the caller's own id rather than the CFBD id on purpose: every `/core`
 * surface indexes its lineup by roster id, and handing back a map in a different id
 * space would make each of them re-derive the mapping.
 *
 * A player with no link, or no snapshot row, is simply absent — never a zero. A
 * zero-point projection and an unprojected player are different claims, and only one
 * of them is true here.
 */
export async function lookupNcaafProjections(
  rosterIds: readonly string[],
  at?: { season: string } | null
): Promise<Map<string, PlayerProjection>> {
  const ids = rosterIds.filter((id) => typeof id === 'string' && id.length > 0 && !id.startsWith('name:'))
  if (ids.length === 0) return new Map()

  /*
   * The caller's WEEK is ignored on purpose — see `latestNcaafProjectionSeason`. Only
   * the season is used, and a caller that passes the NFL's current week (which every
   * `/core` surface does, because that is what `latestProjectionWeek()` returns) gets
   * the college season baseline rather than an empty map.
   */
  const when = at ?? (await latestNcaafProjectionSeason())
  if (!when) return new Map()

  const season = Number.parseInt(when.season, 10)
  if (!Number.isFinite(season)) return new Map()

  const cfbdByRosterId = await resolveCfbdIds(ids)
  if (cfbdByRosterId.size === 0) return new Map()

  const rows = await prisma.aFProjectionSnapshot
    .findMany({
      where: {
        sport: 'NCAAF',
        season,
        week: null,
        playerId: { in: [...new Set(cfbdByRosterId.values())] },
      },
      select: { playerId: true, playerName: true, position: true, afProjection: true, adjustmentFactors: true },
    })
    .catch(() => [])

  const byCfbdId = new Map(rows.map((r) => [r.playerId, r]))

  const out = new Map<string, PlayerProjection>()
  for (const rosterId of ids) {
    const cfbdId = cfbdByRosterId.get(rosterId)
    if (!cfbdId) continue
    const row = byCfbdId.get(cfbdId)
    if (!row) continue
    out.set(rosterId, {
      playerId: rosterId,
      projectedPoints: row.afProjection,
      name: row.playerName ?? null,
      position: row.position ?? null,
      // AFProjectionSnapshot carries no club. Null rather than an invented value —
      // the surfaces already resolve team from the roster row.
      team: null,
      componentStats: readComponentStats(row.adjustmentFactors),
      // A null week identifies the baseline row, not the unit of afProjection.
      perGame: true,
    })
  }
  return out
}
