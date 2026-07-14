/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Part 8,
 * storyline domain.
 *
 * Reuses `lib/drama-engine/`'s already-persisted `DramaEvent` rows — a
 * real, production-wired, deterministic candidate detector
 * (`DramaEventDetector.ts::detectDramaEvents`, confirmed by this phase's
 * Part 1 inventory to already run and persist for real leagues). This
 * generator never calls `runLeagueDramaEngine` itself and never generates
 * new narrative text beyond what's already in the real `headline`/`summary`
 * fields — deterministic candidates first, copy-ready text built from them
 * via `copyReadyContent.ts` (template-based, grounded in the real record).
 * NFL-only this phase (weekly-cadence storyline types don't map cleanly to
 * daily-cadence sports without real per-sport adapters — disclosed, not
 * built this phase).
 */
import type { CommissionerOsContext } from '../../commissionerOsContext'
import { buildRecommendation, isFreshnessSafeForPriority } from '../../userOsRecommendationHelpers'
import { buildCopyReadyContent } from './copyReadyContent'
import type { LeagueRecommendation } from '../../types'

const HIGH_SCORE_THRESHOLD = 70

export function generateStorylineRecommendations(
  context: CommissionerOsContext,
  generatedAt: string
): LeagueRecommendation[] {
  if (context.unavailableDomains.includes('storylines_weekly_cadence')) return []
  if (context.dramaEvents.length === 0) return []

  const priority = 'low' as const
  if (!isFreshnessSafeForPriority(context.syncFreshness, priority)) return []

  return context.dramaEvents.map((event) => {
    const isHeadline = event.dramaScore >= HIGH_SCORE_THRESHOLD
    return buildRecommendation({
      leagueId: context.canonicalLeagueId,
      domain: 'commissioner',
      type: `storyline_${event.dramaType.toLowerCase()}`,
      key: event.id,
      priority: isHeadline ? 'medium' : 'low',
      title: event.headline,
      summary: event.summary ?? event.headline,
      rationale: [`Real ${event.dramaType} event detected by the league drama engine (score ${event.dramaScore.toFixed(0)}).`],
      evidence: [{ label: 'Drama score', detail: event.dramaScore.toFixed(0), source: 'DramaEvent' }],
      relatedTeamIds: event.relatedTeamIds,
      affectedManagerIds: event.relatedManagerIds,
      confidence: Math.min(1, event.dramaScore / 100),
      sourceFreshness: context.syncFreshness,
      executionCapability: 'copy_action',
      commissionerScope: 'single_matchup',
      publicationAudience: 'league_wide',
      publicationChannel: 'league_chat',
      governanceSeverity: 'none',
      copyReadyContent: buildCopyReadyContent(event.headline, event.summary ?? event.headline, [
        'league_chat',
        'discord',
        'social_caption',
      ]),
      generatedAt,
    })
  })
}
