/**
 * Decision OS Replay Framework Phase 13 — manually invokable Sleeper lineup
 * ingestion for a single league. Mirrors `ingestSleeperTradesForLeague.ts`'s
 * exact orchestration shape: fetch real provider data -> normalize -> write
 * -> backtest -> write, looped. Per this workstream's established discipline:
 * NOT wired to any route, cron, or scheduler — calling code (a future,
 * separately-approved script) invokes this per league it wants to ingest.
 *
 * Reuses `lib/sleeper-client.ts`'s existing `getLeagueMatchups()` — nothing
 * new was built for real Sleeper API access. Unlike trades (where
 * `getAllLeagueTrades()` already filters to real, completed transactions),
 * Sleeper's matchups endpoint returns a placeholder row (all-zero points)
 * for every week/roster regardless of whether that week has actually been
 * played — so this driver filters to weeks with real recorded scoring
 * before calling the normalizer, a filtering concern specific to lineup
 * data that trade ingestion never needed.
 */
import {
  getAllPlayers,
  getLeagueInfo,
  getLeagueMatchups,
  getLeagueRosters,
  getLeagueUsers,
} from '@/lib/sleeper-client'
import { normalizeSleeperLineup } from '../normalize/lineupSleeperNormalizer'
import { runLineupBacktest } from '../backtest/lineupBacktestExecutor'
import { upsertBacktestResult, upsertReplayImport } from '../writer'

export interface IngestSleeperLineupsResult {
  leagueId: string
  weeksScanned: number
  weeksSkippedUnscored: number
  replaysWritten: number
  backtestsWritten: number
  errors: Array<{ providerTransactionId: string; error: string }>
}

/** A matchup row with no real recorded scoring yet (future/unplayed week) — never a real lineup decision to replay. */
function hasRealScoring(points: number, startersPoints: number[]): boolean {
  return points > 0 || startersPoints.some((p) => p > 0)
}

export async function ingestSleeperLineupsForLeague(
  sleeperLeagueId: string,
  ingestSourceUserId: string,
  totalWeeks = 18,
): Promise<IngestSleeperLineupsResult> {
  const league = await getLeagueInfo(sleeperLeagueId)
  if (!league) {
    return { leagueId: sleeperLeagueId, weeksScanned: 0, weeksSkippedUnscored: 0, replaysWritten: 0, backtestsWritten: 0, errors: [{ providerTransactionId: '', error: 'league not found' }] }
  }

  const [rosters, users, players] = await Promise.all([
    getLeagueRosters(sleeperLeagueId),
    getLeagueUsers(sleeperLeagueId),
    getAllPlayers(),
  ])

  let weeksScanned = 0
  let weeksSkippedUnscored = 0
  let replaysWritten = 0
  let backtestsWritten = 0
  const errors: Array<{ providerTransactionId: string; error: string }> = []

  for (let week = 1; week <= totalWeeks; week++) {
    const matchups = await getLeagueMatchups(sleeperLeagueId, week)
    if (matchups.length === 0) continue
    weeksScanned++

    for (const matchup of matchups) {
      if (!hasRealScoring(matchup.points, matchup.starters_points ?? [])) {
        weeksSkippedUnscored++
        continue
      }

      const providerTransactionId = `lineup-${sleeperLeagueId}-roster${matchup.roster_id}-week${week}`
      try {
        const normalized = normalizeSleeperLineup({
          matchup,
          league,
          rosters,
          users,
          players: players as any,
          ingestSourceUserId,
          week,
        })

        const replayId = await upsertReplayImport(normalized)
        replaysWritten++

        const backtestInput = await runLineupBacktest({
          replayId,
          season: normalized.season,
          payload: normalized.payload as any,
          sport: league.sport,
        })
        await upsertBacktestResult(backtestInput)
        backtestsWritten++
      } catch (err) {
        errors.push({ providerTransactionId, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  return {
    leagueId: sleeperLeagueId,
    weeksScanned,
    weeksSkippedUnscored,
    replaysWritten,
    backtestsWritten,
    errors,
  }
}
