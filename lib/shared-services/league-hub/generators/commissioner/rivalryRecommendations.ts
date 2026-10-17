/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Part 9,
 * rivalry domain.
 *
 * Reuses `lib/rivalry-engine/`'s already-persisted `RivalryRecord`/
 * `RivalryEvent` rows — the CANONICAL rivalry engine (real,
 * production-wired, manager-id-keyed). This phase's Part 1 inventory found
 * a second, legacy, roster_id-keyed module at `lib/rivalry-engine.ts`
 * (singular file) — deliberately NOT used here; only `lib/rivalry-engine/`
 * (directory) is read. This generator never calls `runRivalryEngine`
 * itself and never fabricates a rivalry when the league has no real
 * recorded history — `context.unavailableDomains` already marks
 * `'rivalries_history'` when `RivalryRecord` has zero rows for this league.
 */
import type { CommissionerOsContext } from '../../commissionerOsContext'
import { buildRecommendation, isFreshnessSafeForPriority } from '../../userOsRecommendationHelpers'
import { buildCopyReadyContent } from './copyReadyContent'
import type { LeagueRecommendation } from '../../types'

const TOP_RIVALRY_COUNT = 3

export function generateRivalryRecommendations(
  context: CommissionerOsContext,
  generatedAt: string
): LeagueRecommendation[] {
  if (context.unavailableDomains.includes('rivalries_history')) return []

  const priority = 'low' as const
  if (!isFreshnessSafeForPriority(context.syncFreshness, priority)) return []

  return context.rivalries.slice(0, TOP_RIVALRY_COUNT).map((rivalry) => {
    // A real RivalryRecord row with zero timeline events means the engine detected the pairing
    // but has no notable-moment history to cite — never presented as a "complete" record.
    const sourceHistoryConfidence: LeagueRecommendation['sourceHistoryConfidence'] =
      rivalry.eventCount === 0 ? 'unknown' : rivalry.eventCount < 3 ? 'partial' : 'complete'

    const title = `Rivalry: ${rivalry.rivalryTier} tier (score ${rivalry.rivalryScore.toFixed(0)})`
    const summary = rivalry.latestEvent
      ? `Most recent notable moment: ${rivalry.latestEvent.eventType}${rivalry.latestEvent.season ? ` (${rivalry.latestEvent.season})` : ''}.`
      : 'No notable timeline moments recorded yet for this rivalry.'

    return buildRecommendation({
      leagueId: context.canonicalLeagueId,
      domain: 'commissioner',
      type: 'rivalry_spotlight',
      key: rivalry.id,
      priority,
      title,
      summary,
      rationale: [
        `Rivalry score ${rivalry.rivalryScore.toFixed(0)}, tier "${rivalry.rivalryTier}".`,
        `${rivalry.eventCount} recorded timeline event(s).`,
      ],
      evidence: [
        { label: 'Rivalry score', detail: rivalry.rivalryScore.toFixed(0), source: 'RivalryRecord' },
        { label: 'Recorded events', detail: String(rivalry.eventCount), source: 'RivalryEvent' },
      ],
      affectedManagerIds: [rivalry.managerAId, rivalry.managerBId],
      sourceHistoryConfidence,
      sourceFreshness: context.syncFreshness,
      executionCapability: 'copy_action',
      commissionerScope: 'single_matchup',
      publicationAudience: 'league_wide',
      publicationChannel: 'league_chat',
      governanceSeverity: 'none',
      copyReadyContent: buildCopyReadyContent(title, summary, ['league_chat', 'social_caption']),
      generatedAt,
    })
  })
}
