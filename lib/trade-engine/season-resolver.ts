/**
 * Decision OS — Trade Learning Phase 10: Canonical Season Resolution.
 *
 * The single source of truth for "what season should trade-learning
 * calibration operate on right now." Replaces five independent hardcoded
 * `2025` constants/defaults previously scattered across
 * lib/trade-engine/{accept-calibration,auto-recalibration,isotonic-calibrator,
 * drift-detection,diagnostics,trade-event-logger}.ts and lib/trade-learning.ts.
 *
 * Discovered via real staging validation (Trade Learning Phase 9,
 * docs/TRADE_LEARNING_PRE_ENABLEMENT_AUDIT.md §10.4): real trade capture
 * correctly writes `League.season` (currently 2026), while every
 * calibration function still defaulted to a hardcoded `2025` — meaning real
 * captured data would silently never be found by any calibration query
 * invoked without an explicit season override.
 *
 * Primary source: the freshest real season seen across `League` rows.
 * `League.season` is already the canonical, per-league value every real
 * trade capture writes (see lib/league-trade-engine/tradeLearningCapture.ts).
 * Taking `MAX(League.season)` reflects whatever season the platform is
 * actually operating in, right now, with zero manual updates ever needed as
 * real seasons roll over — new leagues get created with the new season
 * value, and this resolver picks it up automatically. This is a
 * long-lived-platform property this Phase is specifically about
 * establishing, not a one-time fix.
 *
 * Fallback (cold start only — no `League` rows exist at all, e.g. a brand
 * new environment before any league has ever been created): a
 * deterministic, provider-agnostic date-based computation. Also used if the
 * database query itself fails for any reason (fails safe, never throws,
 * matching this workstream's established convention).
 */
import { prisma } from '../prisma'

/**
 * Deterministic, database-free fallback. Exported for direct testing and
 * for any caller that cannot or should not query the database.
 *
 * NFL-style season-year convention: a season "belongs" to the calendar year
 * it starts in (September), through the following year's offseason
 * (August) — so January–August resolves to the PRIOR calendar year's
 * season number. This is a documented convention, not a guess: it matches
 * how `League.season` is already used elsewhere in the platform (a season
 * that started in September 2026 and runs through early 2027 is still
 * "season 2026").
 */
export function computeSeasonFromDate(date: Date = new Date()): number {
  const month = date.getUTCMonth() // 0 = January ... 11 = December
  const year = date.getUTCFullYear()
  return month >= 8 ? year : year - 1
}

let cachedSeason: number | null = null
let cachedAt = 0
const CACHE_TTL_MS = 60 * 60 * 1000 // matches accept-calibration.ts's own CACHE_TTL_MS convention

/**
 * The one canonical season-resolution path for all of trade-learning.
 * Every function that used to default to a hardcoded season constant now
 * calls this when no explicit season is passed. Cached for an hour — real
 * `League.season` data changes far less often than every calibration call.
 */
export async function resolveCurrentTradeLearningSeason(): Promise<number> {
  const now = Date.now()
  if (cachedSeason !== null && now - cachedAt < CACHE_TTL_MS) {
    return cachedSeason
  }

  try {
    const result = await prisma.league.aggregate({ _max: { season: true } })
    const resolved = typeof result._max.season === 'number' ? result._max.season : computeSeasonFromDate()
    cachedSeason = resolved
    cachedAt = now
    return resolved
  } catch (err) {
    console.error(
      '[SeasonResolver] Failed to resolve season from League data, falling back to date-based computation:',
      err,
    )
    return computeSeasonFromDate()
  }
}

/** Test/ops utility — forces the next resolution to re-query rather than use the cached value. */
export function invalidateSeasonResolverCache(): void {
  cachedSeason = null
  cachedAt = 0
}
