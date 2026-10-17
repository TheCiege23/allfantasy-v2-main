import { readPreparedSeasonRosterState } from './seasonRosterPreparation'
import 'server-only'
import { prisma } from '@/lib/prisma'
import { loadSeasonNativeSetup } from './seasonNativeProvisioning'
import { assessSeasonDraftCompletion, type SeasonDraftReviewState } from './seasonDraftReview'
import { BlueprintOperationError } from './seasonBlueprintStore'

export const seasonReleaseGates = [
  { key: 'runtime', label: 'Weekly scoring, lineups and player moves', state: 'pending' },
  { key: 'advancement', label: 'Finalized scores, cuts and subsequent drafts', state: 'pending' },
  { key: 'boundaries', label: 'Remaining tournament write protections', state: 'pending' },
  { key: 'pilot', label: 'Provider, database and mobile staging checks', state: 'pending' },
] as const

export type SeasonOpeningDraftReport = { key: string; state: SeasonDraftReviewState; blockers: string[]; filledPicks: number; totalPicks: number; completedAt?: string; rostersPrepared: boolean; launchReady: false; gates: typeof seasonReleaseGates }

/** Owner-only, one league per request. Readiness review cannot grant launch permission. */
export async function reviewSeasonOpeningDraft(userId: string, tournamentId: string, freezeId: string, key: string): Promise<SeasonOpeningDraftReport> {
  const setup = await loadSeasonNativeSetup(userId, tournamentId)
  if (!setup || setup.freezeId !== freezeId) throw new BlueprintOperationError('Reload the current frozen opening setup.', 409)
  const league = setup.leagues.find(l => l.key === key)
  if (!league) throw new BlueprintOperationError('Unknown opening league.', 404)
  if (!league.leagueId) return { key, state: 'not_started' as const, blockers: ['Create this opening league first.'], filledPicks: 0, totalPicks: 0, completedAt: undefined, rostersPrepared: false, launchReady: false, gates: seasonReleaseGates }
  try {
    const review = await prisma.$transaction(tx => assessSeasonDraftCompletion(league.leagueId!, tx))
    if (!review || review.context.tournamentId !== tournamentId || review.context.freezeId !== freezeId || review.context.pool.key !== key) throw new Error('binding')
    const rosterState = review.state === 'completed' && review.boardHash && review.session ? await readPreparedSeasonRosterState(league.leagueId!, review.context.manifestHash, review.boardHash, review.session.id) : 'not_prepared'
    if (rosterState === 'review_required') return { key, state: 'review_required' as const, blockers: ['Prepared rosters differ from their checkpoint. Review is required.'], filledPicks: review.filledPicks, totalPicks: review.totalPicks, completedAt: review.completedAt, rostersPrepared: false, launchReady: false, gates: seasonReleaseGates }
    return { key, state: review.state, blockers: review.blockers, filledPicks: review.filledPicks, totalPicks: review.totalPicks, completedAt: review.completedAt, rostersPrepared: rosterState === 'prepared', launchReady: false, gates: seasonReleaseGates }
  } catch {
    return { key, state: 'review_required' as const, blockers: ['Draft verification is unavailable. Retry or contact the platform administrator.'], filledPicks: 0, totalPicks: 0, completedAt: undefined, rostersPrepared: false, launchReady: false, gates: seasonReleaseGates }
  }
}
