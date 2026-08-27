/**
 * Bounded stat refresh for the DevyPlayer pool, riding inside the
 * import-players cron's run budget alongside refreshDevyPoolSlice.
 *
 * WHY THIS EXISTS. `ingestCFBDStats` had no scheduled caller. It was reachable
 * only through `runFullDevySync` (zero callers) and `seedCollegePlayers` (the
 * Redis worker and routes excluded from the production build), so in production
 * nothing ever wrote `DevyPlayer.passingYards` and its siblings on a schedule.
 * The roster phase kept the pool structurally current while every stat column
 * on it stayed as stale as whenever someone last ran a seed by hand.
 *
 * That is why `/api/market-alerts` was fetching CFBD live on the request path:
 * the DB columns it needed were not being kept true, so reading them would have
 * returned nulls. Moving that surface to a DB read is only correct once this
 * phase actually runs — the two changes belong together and are worthless apart.
 *
 * Scope matches the roster phase exactly (same rotating slice, same schools),
 * so a school seeded this fire gets its stat line the same fire.
 */

import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { CFBD_ENV_VARS, hasCfbdApiKey } from '@/lib/cfbd-env'
import { CfbdUnavailableError } from '@/lib/cfb-player-data'
import { ingestCFBDStats, TOP_CFB_TEAMS } from '@/lib/devy-classification'
import { currentDevyTeamSlice } from '@/lib/devy-pool-refresh'
import type { RunBudget } from '@/lib/cron/runBudget'

const SCOPE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface DevyStatsRefreshSummary {
  /** null when the phase could not run at all (see `skipped`). */
  season: number | null
  teamsAttempted: number
  teamsProcessed: number
  teamsTotal: number
  playersUpdated: number
  /** Present ONLY when nothing ran — a labeled absence, never a fake zero. */
  skipped?: string
  errors: number
}

export function devyStatsRefreshCacheKey(season: number): string {
  return `devy_stats_refresh:${season}`
}

/**
 * CFBD publishes a season's stats as it is played, but a completed season is
 * the safe default: asking for the current calendar year in, say, March returns
 * an empty set for every school, which would overwrite nothing but would record
 * "0 updated" as though the schools had no players.
 */
export function defaultStatSeason(now: Date = new Date()): number {
  // Month is 0-indexed; from September onward the current season has real games.
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1
}

export async function refreshDevyStatsSlice(budget: RunBudget): Promise<DevyStatsRefreshSummary> {
  if (!hasCfbdApiKey()) {
    // getCFBPlayerStats silently returns [] without a key, which would report
    // "0 players updated" as if every school were already current. Say what
    // actually happened — same contract as the roster phase.
    return {
      season: null,
      teamsAttempted: 0,
      teamsProcessed: 0,
      teamsTotal: TOP_CFB_TEAMS.length,
      playersUpdated: 0,
      skipped: `no CFBD key (${CFBD_ENV_VARS.join(' / ')} all unset)`,
      errors: 0,
    }
  }

  const season = defaultStatSeason()
  const slice = currentDevyTeamSlice()

  let result: Awaited<ReturnType<typeof ingestCFBDStats>>
  try {
    result = await ingestCFBDStats(season, {
      teams: slice,
      shouldStop: () => budget.exhausted(),
    })
  } catch (err) {
    // Same contract as the no-key branch above and as refreshDevyPoolSlice: a
    // provider refusal is a labeled absence, never a clean zero. Without this,
    // a quota-exhausted key produced `playersUpdated: 0, errors: 0` — which is
    // indistinguishable from "every school was already current".
    if (err instanceof CfbdUnavailableError) {
      console.error(`[devy-stats-refresh] provider unavailable: ${err.message}`)
      return {
        season: null,
        teamsAttempted: 0,
        teamsProcessed: 0,
        teamsTotal: TOP_CFB_TEAMS.length,
        playersUpdated: 0,
        skipped: err.message,
        errors: 0,
      }
    }
    throw err
  }

  // Every attempted school failed and none succeeded — the provider is refusing
  // us, not telling us the schools are current. `ingestCFBDStats` catches per
  // team so the refusal never reaches the catch above, which would otherwise
  // leave this phase reporting `errors: 8` where the roster phase reports a
  // labeled `skipped` for the identical condition. Same condition, same shape.
  if (result.teamsProcessed.length === 0 && result.errors.length >= slice.length && slice.length > 0) {
    console.error(`[devy-stats-refresh] every school in the slice failed: ${result.errors[0]}`)
    return {
      season: null,
      teamsAttempted: slice.length,
      teamsProcessed: 0,
      teamsTotal: TOP_CFB_TEAMS.length,
      playersUpdated: 0,
      skipped: `all ${slice.length} schools failed — ${result.errors[0]}`,
      errors: result.errors.length,
    }
  }

  // Durable coverage record, merged per run so `teamsCovered` converges on
  // TOP_CFB_TEAMS.length and a school whose stats went stale is visible by its
  // own timestamp rather than inferred from an aggregate.
  const cacheKey = devyStatsRefreshCacheKey(season)
  const now = new Date()
  const prior = await prisma.sportsDataCache.findUnique({ where: { cacheKey } }).catch(() => null)
  const priorTeams =
    prior && typeof prior.data === 'object' && prior.data !== null && !Array.isArray(prior.data)
      ? (((prior.data as Record<string, unknown>).teams as Record<string, string> | undefined) ?? {})
      : {}
  const teams: Record<string, string> = { ...priorTeams }
  for (const team of result.teamsProcessed) teams[team] = now.toISOString()

  const payload = toPrismaJsonInput({
    season,
    scope: {
      schools: TOP_CFB_TEAMS.length,
      note: 'TOP_CFB_TEAMS schools only — a devy player at any other school has no stat line',
    },
    teams,
    teamsCovered: Object.keys(teams).length,
    lastRun: {
      at: now.toISOString(),
      teamsAttempted: slice,
      teamsProcessed: result.teamsProcessed.length,
      playersUpdated: result.updated,
      errors: result.errors.length,
    },
  })
  const expiresAt = new Date(Date.now() + SCOPE_CACHE_TTL_MS)

  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey },
      update: { data: payload, expiresAt },
      create: { cacheKey, data: payload, expiresAt },
    })
    .catch((cacheErr) => {
      // The ingest itself succeeded; a failed scope write must not fail the run
      // — but it must be loud, because this key is the freshness evidence that
      // `/api/market-alerts` now depends on being able to trust.
      console.error(
        '[devy-stats-refresh] scope cache write failed:',
        cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
      )
    })

  console.log(
    `[devy-stats-refresh] season=${season} teams=${result.teamsProcessed.length}/${slice.length} attempted ` +
      `(coverage ${Object.keys(teams).length}/${TOP_CFB_TEAMS.length} schools) ` +
      `updated=${result.updated} errors=${result.errors.length}`,
  )
  if (result.errors.length) {
    console.error('[devy-stats-refresh] errors:', result.errors.slice(0, 5).join(' | '))
  }

  return {
    season,
    teamsAttempted: slice.length,
    teamsProcessed: result.teamsProcessed.length,
    teamsTotal: TOP_CFB_TEAMS.length,
    playersUpdated: result.updated,
    errors: result.errors.length,
  }
}
