import 'server-only'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { riFetchRows } from '@/lib/workers/providers/rollingInsightsRest'
import { seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
import { BlueprintOperationError } from './seasonBlueprintStore'
import { fetchSeasonCalendarGames, seasonContractHash } from './seasonCalendarVerification'
import { loadPublishedScheduleContract } from './seasonScheduleReview'
import { readSeasonOpeningLockedProviderPairs } from './seasonScoreLedger'
import { latestSeasonOutcomeClaims } from './seasonOutcomeEvidence'
import { readSeasonOutcomeCandidates, recordSeasonOutcomeCandidate } from './seasonOutcomeEvidenceStore'
import { planSeasonObservedBoxCandidates } from './seasonObservedBoxCandidate'

const easternDay = (value: string) => easternCalendarDay(new Date(value))?.toISOString().slice(0, 10) ?? null

/** Internal, one-day bounded capture of positive box-line presence only; no DNP/no-game or scoring inference. */
export async function captureSeasonObservedBoxCandidates(userId: string, tournamentId: string, freezeId: string,
  leagueKey: string, period: number, sourceDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate)) throw new BlueprintOperationError('Choose one Eastern game day.', 409)
  const { manifest, calendar } = await loadPublishedScheduleContract(userId, tournamentId, freezeId)
  const pool = manifest.leagues.find(item => item.key === leagueKey)
  if (!pool || !manifest.config.rules?.calendar.periods.some(item => item.number === period)) throw new BlueprintOperationError('Choose a frozen league and period.', 409)
  const selected = calendar.assignments.filter(item => item.period === period && easternDay(item.startsAt) === sourceDate)
  if (!selected.length || selected.length > 30 || new Set(selected.map(item => item.gameId)).size !== selected.length) throw new BlueprintOperationError('The published game day is missing or exceeds the capture limit.', 409)
  const checkedAt = new Date()
  if (selected.some(item => Date.parse(item.startsAt) > checkedAt.getTime())) throw new BlueprintOperationError('The game day still has future published games.', 409)
  const schedule = await fetchSeasonCalendarGames(manifest.config)
  for (const item of selected) {
    const matches = schedule.games.filter(game => game.gameId === item.gameId)
    if (matches.length !== 1 || matches[0]!.seasonType !== 'regular' || matches[0]!.startTime !== item.startsAt ||
      matches[0]!.replacedBy || /^(cancell?ed|postponed|delayed|replaced)$/i.test(matches[0]!.status ?? '')) {
      throw new BlueprintOperationError('Current schedule differs from the published game day; review drift first.', 409)
    }
  }
  const leagueId = seasonResourceId(freezeId, leagueKey)
  const locked = await readSeasonOpeningLockedProviderPairs(leagueId, period, userId)
  const selectedIds = new Set(selected.map(item => item.gameId))
  const selectedProviderIds = new Set(locked.gameBindings
    .filter(binding => selectedIds.has(binding.gameId) && binding.providerGameId)
    .map(binding => binding.providerGameId!))
  if (selectedProviderIds.size !== locked.gameBindings.filter(binding => selectedIds.has(binding.gameId) && binding.providerGameId).length) {
    throw new BlueprintOperationError('Verified game identities are ambiguous for the published game day.', 409)
  }
  // Vendor asks clients to space calls by at least five seconds. This path fetches schedule then live exactly once.
  await new Promise(resolve => setTimeout(resolve, 6000))
  const feed = await riFetchRows('live', { sport: manifest.config.sport, date: sourceDate, timeoutMs: 15000 })
  if (feed.error || feed.notModified || feed.unsupported) throw new BlueprintOperationError('A fresh entitled live slate is unavailable.', 409)
  const observedAt = new Date()
  const rawGames = new Map<string, Record<string, unknown>>()
  for (const providerGameId of selectedProviderIds) {
    const matches = feed.rows.filter(row => row && typeof row === 'object' && String((row as Record<string, unknown>).game_ID ?? '') === providerGameId)
    if (matches.length > 1) throw new BlueprintOperationError('The provider returned duplicate rows for a published game.', 409)
    if (matches.length === 1) rawGames.set(providerGameId, matches[0] as Record<string, unknown>)
  }
  const history = await readSeasonOutcomeCandidates(userId, tournamentId, freezeId, leagueKey, period)
  const latestClaims = latestSeasonOutcomeClaims(history.claims)
  const latestObservedArtifacts = new Map([...latestClaims].filter(([, claim]) => claim.outcome === 'box_line_present')
    .map(([key, claim]) => [key, claim.source.artifactDigest]))
  const suppressedSubjects = new Set([...latestClaims].filter(([, claim]) => claim.outcome !== 'box_line_present').map(([key]) => key))
  const plan = planSeasonObservedBoxCandidates({ sport: manifest.config.sport, sourceDate, observedAt: observedAt.toISOString(), rawGames,
    lockedPairs: locked.pairs.filter(pair => !pair.providerGameId || selectedProviderIds.has(pair.providerGameId)),
    latestObservedArtifacts, suppressedSubjects, maxCandidates: 10 })
  let revision = history.revision, saved = 0
  for (const candidate of plan.candidates) {
    const requestId = `boxline-${seasonContractHash({ base: candidate.requestId, afterRevision: revision })}`
    const receipt = await recordSeasonOutcomeCandidate(userId, tournamentId, freezeId, leagueKey, period,
      requestId, candidate.claim, candidate.artifact)
    revision = receipt.revision
    if (!receipt.existing) saved++
  }
  return { sport: manifest.config.sport, sourceDate, leagueKey, period, publishedGames: selected.length, fetchedGames: rawGames.size,
    saved, revision, deferredByLimit: plan.deferredByLimit, unchangedPairs: plan.unchangedPairs, suppressedPairs: plan.suppressedPairs,
    missingGamePairs: plan.missingGamePairs, nonFinalPairs: plan.nonFinalPairs, unverifiedBoxPairs: plan.unverifiedBoxPairs,
    absentPlayerPairs: plan.absentPlayerPairs, unresolvedPairs: plan.unresolvedPairs,
    contractVerified: false as const, scoringCertified: false as const, launchReady: false as const }
}
