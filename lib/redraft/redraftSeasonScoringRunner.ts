/**
 * Pure orchestrator for the scheduled redraft scoring pass.
 *
 * Extracted from the score-sync route so the failure-isolation and
 * sport-skipping logic is unit-testable without Prisma. The route injects the
 * real scoring functions; this module only orchestrates: for each active
 * redraft season, run sync → recalc matchups → update standings, isolating
 * per-season failures and reporting honest data warnings (no false success).
 *
 * Weekly stat sync is currently wired for NFL only (the underlying service
 * throws for other sports), so NCAAF/other seasons are skipped with a
 * dataWarning rather than crashing the whole run.
 */

export type ScoringSeason = {
  id: string
  leagueId: string
  sport: string | null
  currentWeek: number | null
}

export type SeasonSyncResult = {
  seasonId: string
  week: number
  scoresUpserted: number
  warnings: string[]
}

export type ScoringDeps = {
  syncSeason: (season: ScoringSeason) => Promise<SeasonSyncResult>
  recalcMatchups: (seasonId: string, week: number) => Promise<unknown>
  updateStandings: (seasonId: string, week: number) => Promise<unknown>
}

export type ProcessedSeason = {
  seasonId: string
  leagueId: string
  sport: string
  week: number
  scoresUpserted: number
  status: 'synced' | 'no_data'
}

export type FailedSeason = {
  seasonId: string
  leagueId: string
  sport: string
  error: string
}

export type ScoringDataWarning = {
  seasonId: string
  leagueId: string
  sport: string
  week: number | null
  warning: string
}

export type RedraftScoringReport = {
  ok: boolean
  processedCount: number
  failedCount: number
  skippedCount: number
  dataWarningCount: number
  totalScoresUpserted: number
  processed: ProcessedSeason[]
  failed: FailedSeason[]
  dataWarnings: ScoringDataWarning[]
}

/** Sports whose weekly stat sync is wired today. */
export const SCORING_SUPPORTED_SPORTS = new Set(['NFL'])

/**
 * Runs the scoring pipeline for each active redraft season. Pure: all DB/scoring
 * access is injected via `deps`. One season's failure never aborts the rest.
 */
export async function runRedraftSeasonScoring(
  seasons: ScoringSeason[],
  deps: ScoringDeps,
): Promise<RedraftScoringReport> {
  const processed: ProcessedSeason[] = []
  const failed: FailedSeason[] = []
  const dataWarnings: ScoringDataWarning[] = []
  let skipped = 0

  for (const season of seasons) {
    const sport = String(season.sport || 'NFL').toUpperCase()

    if (!SCORING_SUPPORTED_SPORTS.has(sport)) {
      skipped += 1
      dataWarnings.push({
        seasonId: season.id,
        leagueId: season.leagueId,
        sport,
        week: season.currentWeek ?? null,
        warning: `Weekly scoring is wired for NFL only; ${sport} season skipped (not marked successful).`,
      })
      continue
    }

    try {
      const sync = await deps.syncSeason(season)
      // Recalc + standings recompute from current state → idempotent on repeat.
      await deps.recalcMatchups(sync.seasonId, sync.week)
      await deps.updateStandings(sync.seasonId, sync.week)

      const status: ProcessedSeason['status'] = sync.scoresUpserted > 0 ? 'synced' : 'no_data'
      processed.push({
        seasonId: season.id,
        leagueId: season.leagueId,
        sport,
        week: sync.week,
        scoresUpserted: sync.scoresUpserted,
        status,
      })

      if (status === 'no_data') {
        dataWarnings.push({
          seasonId: season.id,
          leagueId: season.leagueId,
          sport,
          week: sync.week,
          warning: 'No cached weekly stats were available to sync; run the provider/cache job first.',
        })
      }
      for (const w of sync.warnings ?? []) {
        dataWarnings.push({ seasonId: season.id, leagueId: season.leagueId, sport, week: sync.week, warning: w })
      }
    } catch (err) {
      failed.push({
        seasonId: season.id,
        leagueId: season.leagueId,
        sport,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
      })
    }
  }

  return {
    ok: failed.length === 0,
    processedCount: processed.length,
    failedCount: failed.length,
    skippedCount: skipped,
    dataWarningCount: dataWarnings.length,
    totalScoresUpserted: processed.reduce((sum, p) => sum + p.scoresUpserted, 0),
    processed,
    failed,
    dataWarnings,
  }
}
