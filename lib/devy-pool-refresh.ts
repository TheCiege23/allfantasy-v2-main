/**
 * Bounded structural refresh of the DevyPlayer pool, riding inside the
 * import-players cron's run budget (the platform edge severs the whole handler
 * at ~300s, so this phase checks the budget between teams and never overruns).
 *
 * Scope is deliberately NOT "any college player": TOP_CFB_TEAMS schools and
 * QB/RB/WR/TE only — exactly what lib/devy-classification ingests today. Every
 * run records that scope durably in SportsDataCache under
 * `devy_pool_refresh:{season}` so coverage is verified, never assumed.
 */

import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { CFBD_ENV_VARS, hasCfbdApiKey } from '@/lib/cfbd-env'
import { ingestCFBDRosters, TOP_CFB_TEAMS } from '@/lib/devy-classification'
import { rotateForFairness, type RunBudget } from '@/lib/cron/runBudget'

// Matches the cron's "0 */6 * * *" schedule in cron-schedule.json.
const CRON_PERIOD_MS = 6 * 60 * 60 * 1000
// 8 teams x (~1s fetch + 200ms pacing) is ~10-15s per slice — small next to the
// importer's 240s self-budget. Full coverage of all TOP_CFB_TEAMS takes
// ceil(49 / 8) = 7 scheduled fires (~42h at 4 fires/day).
export const DEVY_POOL_TEAMS_PER_RUN = 8

const DEVY_POOL_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const
const SCOPE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface DevyPoolRefreshSummary {
  /** null when the phase could not run at all (see `skipped`). */
  season: number | null
  teamsAttempted: number
  teamsProcessed: number
  teamsTotal: number
  playersUpserted: number
  /** Present ONLY when nothing ran — a labeled absence, never a fake zero. */
  skipped?: string
  errors: number
}

export function devyPoolRefreshCacheKey(season: number): string {
  return `devy_pool_refresh:${season}`
}

export async function refreshDevyPoolSlice(budget: RunBudget): Promise<DevyPoolRefreshSummary> {
  if (!hasCfbdApiKey()) {
    // getCFBTeamRoster silently returns [] without a key, which would report
    // "0 new players" as if the pool were complete. Say what actually happened.
    return {
      season: null,
      teamsAttempted: 0,
      teamsProcessed: 0,
      teamsTotal: TOP_CFB_TEAMS.length,
      playersUpserted: 0,
      skipped: `no CFBD key (${CFBD_ENV_VARS.join(' / ')} all unset)`,
      errors: 0,
    }
  }

  // rotateForFairness advances the lead by one position per period, so a period
  // of CRON_PERIOD_MS / TEAMS_PER_RUN advances the window by a FULL slice each
  // cron fire — consecutive fires cover disjoint slices instead of re-treading
  // 7 of 8 teams (full coverage in 7 fires, not 49).
  const slice = rotateForFairness(TOP_CFB_TEAMS, CRON_PERIOD_MS / DEVY_POOL_TEAMS_PER_RUN)
    .slice(0, DEVY_POOL_TEAMS_PER_RUN)

  const result = await ingestCFBDRosters(undefined, {
    teams: slice,
    shouldStop: () => budget.exhausted(),
  })

  // Durable coverage record: which season, which schools, which positions.
  // Merged per run so `teamsCovered` converges on TOP_CFB_TEAMS.length and a
  // stale team is visible by its timestamp.
  const cacheKey = devyPoolRefreshCacheKey(result.rosterYear)
  const now = new Date()
  const prior = await prisma.sportsDataCache.findUnique({ where: { cacheKey } }).catch(() => null)
  const priorTeams =
    prior && typeof prior.data === 'object' && prior.data !== null && !Array.isArray(prior.data)
      ? (((prior.data as Record<string, unknown>).teams as Record<string, string> | undefined) ?? {})
      : {}
  const teams: Record<string, string> = { ...priorTeams }
  for (const team of result.teamsProcessed) teams[team] = now.toISOString()

  await prisma.sportsDataCache.upsert({
    where: { cacheKey },
    update: {
      data: toPrismaJsonInput({
        season: result.rosterYear,
        scope: {
          schools: TOP_CFB_TEAMS.length,
          positions: [...DEVY_POOL_POSITIONS],
          note: 'TOP_CFB_TEAMS schools + fantasy positions only — NOT every college player',
        },
        teams,
        teamsCovered: Object.keys(teams).length,
        lastRun: {
          at: now.toISOString(),
          teamsAttempted: slice,
          teamsProcessed: result.teamsProcessed.length,
          playersUpserted: result.ingested,
          errors: result.errors.length,
        },
      }),
      expiresAt: new Date(Date.now() + SCOPE_CACHE_TTL_MS),
    },
    create: {
      cacheKey,
      data: toPrismaJsonInput({
        season: result.rosterYear,
        scope: {
          schools: TOP_CFB_TEAMS.length,
          positions: [...DEVY_POOL_POSITIONS],
          note: 'TOP_CFB_TEAMS schools + fantasy positions only — NOT every college player',
        },
        teams,
        teamsCovered: Object.keys(teams).length,
        lastRun: {
          at: now.toISOString(),
          teamsAttempted: slice,
          teamsProcessed: result.teamsProcessed.length,
          playersUpserted: result.ingested,
          errors: result.errors.length,
        },
      }),
      expiresAt: new Date(Date.now() + SCOPE_CACHE_TTL_MS),
    },
  }).catch((cacheErr) => {
    // The seed itself succeeded; a failed scope write must not fail the run —
    // but it must be loud, because the cache key is the freshness evidence.
    console.error('[devy-pool-refresh] scope cache write failed:', cacheErr instanceof Error ? cacheErr.message : String(cacheErr))
  })

  console.log(
    `[devy-pool-refresh] season=${result.rosterYear} teams=${result.teamsProcessed.length}/${slice.length} attempted ` +
      `(coverage ${Object.keys(teams).length}/${TOP_CFB_TEAMS.length} schools, ${DEVY_POOL_POSITIONS.join('/')} only) ` +
      `upserted=${result.ingested} errors=${result.errors.length}`,
  )
  if (result.errors.length) {
    console.error('[devy-pool-refresh] errors:', result.errors.slice(0, 5).join(' | '))
  }

  return {
    season: result.rosterYear,
    teamsAttempted: slice.length,
    teamsProcessed: result.teamsProcessed.length,
    teamsTotal: TOP_CFB_TEAMS.length,
    playersUpserted: result.ingested,
    errors: result.errors.length,
  }
}
