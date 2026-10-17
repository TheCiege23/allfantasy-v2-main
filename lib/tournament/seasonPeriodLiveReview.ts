import 'server-only'
import { riFetchRows } from '@/lib/workers/providers/rollingInsightsRest'
import { BlueprintOperationError } from './seasonBlueprintStore'
import { fetchSeasonCalendarGames } from './seasonCalendarVerification'
import { loadPublishedScheduleContract } from './seasonScheduleReview'
import { collectSeasonPeriodLiveSnapshot } from './seasonPeriodLiveSnapshot'
import { readSeasonOpeningLockedProviderPairs } from './seasonScoreLedger'
import { compareSeasonLockedPlayerCoverage } from './seasonLockedPlayerCoverage'
import { seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
import { readSeasonOutcomeCandidates } from './seasonOutcomeEvidenceStore'
import { summarizeSeasonOutcomeCandidates } from './seasonOutcomeEvidence'

/** Owner-triggered, read-only whole-period feed check. No stat ingestion or activation. */
export async function reviewSeasonPeriodLiveFeed(userId: string, tournamentId: string, freezeId: string, period: number, leagueKey?: string) {
  const { manifest, calendar } = await loadPublishedScheduleContract(userId, tournamentId, freezeId)
  if (!manifest.config.rules?.calendar.periods.some(item => item.number === period)) throw new BlueprintOperationError('Choose a published scoring period.', 409)
  const pool = leagueKey ? manifest.leagues.find(item => item.key === leagueKey) : null
  if (leagueKey && !pool) throw new BlueprintOperationError('Choose a frozen opening league.', 409)
  const { games } = await fetchSeasonCalendarGames(manifest.config)
  try {
    const { report, rawGames } = await collectSeasonPeriodLiveSnapshot({
      period, sport: manifest.config.sport, rules: manifest.config.rules!, assignments: calendar.assignments, currentSchedule: games, observedAt: new Date(),
      fetchDay: async date => riFetchRows('live', { sport: manifest.config.sport, date, timeoutMs: 5000 }),
    })
    if (!pool) return report
    const locked = await readSeasonOpeningLockedProviderPairs(seasonResourceId(freezeId, pool.key), period, userId)
    const candidateHistory = await readSeasonOutcomeCandidates(userId, tournamentId, freezeId, pool.key, period)
    return { ...report, outcomeEvidence: summarizeSeasonOutcomeCandidates(candidateHistory.claims),
      lockedCoverage: { leagueKey: pool.key, leagueName: pool.name, ...compareSeasonLockedPlayerCoverage({ sport: manifest.config.sport, ...locked, rawGames,
      publishedGameIds: calendar.assignments.filter(item => item.period === period).map(item => item.gameId), futureGameIds: report.futureGameIds }) } }
  } catch (error) {
    throw new BlueprintOperationError(error instanceof Error ? error.message : 'Provider period review failed.', 409)
  }
}
