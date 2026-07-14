/**
 * User OS League-Specific Intelligence Wiring phase — Part 5, lineup domain.
 *
 * Deliberately built directly from canonical `Roster.playerData.lineup_sections`
 * + live `InjuryReportRecord` rather than deep-integrating
 * `lib/lineup-decision-engine/build-premium-lineup-decision.ts` (the
 * richer, real, production-wired optimizer found in this phase's Part 1
 * inventory). That engine's full input contract (snap counts, weather,
 * matchup-adjusted projections) is substantial; safely re-wiring it inside
 * this phase's remaining budget risked a shallow, fragile integration. This
 * generator instead computes a smaller set of genuinely real, safe,
 * testable conditions from data already in `UserOsContext`. The optimizer
 * remains the authoritative full lineup-optimization surface
 * (`/api/lineup/optimize`) — this generator's job is a lightweight, honest
 * signal in the League Hub feed, not a replacement.
 *
 * NFL-only this phase (see `unavailableDomains` in `userOsContext.ts`) —
 * other sports return no lineup recommendations rather than NFL-shaped
 * fabrications.
 */
import type { UserOsContext, RosterPlayerEntry } from '../userOsContext'
import { buildRecommendation, isFreshnessSafeForPriority } from '../userOsRecommendationHelpers'
import type { LeagueRecommendation } from '../types'

const OUT_STATUSES = ['out', 'ir', 'injured reserve', 'suspended', 'doubtful']

function isLikelyOut(injuryStatus: string | undefined, cachedStatus: string): boolean {
  const s = (injuryStatus ?? cachedStatus ?? '').toLowerCase()
  return OUT_STATUSES.some((needle) => s.includes(needle))
}

export function generateLineupRecommendations(context: UserOsContext, generatedAt: string): LeagueRecommendation[] {
  if (context.unavailableDomains.includes('lineup') || !context.lineup || !context.teamId) {
    return []
  }

  const recommendations: LeagueRecommendation[] = []

  for (const starter of context.lineup.starters) {
    const injury = context.injuryByPlayerId.get(starter.id)
    if (!isLikelyOut(injury?.status, starter.status)) continue

    const priority = 'critical' as const
    if (!isFreshnessSafeForPriority(context.syncFreshness, priority)) continue

    recommendations.push(
      buildRecommendation({
        leagueId: context.canonicalLeagueId,
        teamId: context.teamId,
        rosterId: context.rosterId ?? undefined,
        domain: 'lineup',
        type: 'injured_starter',
        key: starter.id,
        priority,
        title: `${starter.name} is starting while ${(injury?.status ?? starter.status).toLowerCase()}`,
        summary: `${starter.name} (${starter.position}) is in your starting lineup but is currently listed as ${injury?.status ?? starter.status}.`,
        rationale: [
          injury
            ? `Live injury report (${injury.reportDate.slice(0, 10)}): ${injury.status}${injury.gameStatus ? ` — ${injury.gameStatus}` : ''}.`
            : `Roster-cached status: ${starter.status}.`,
        ],
        evidence: [
          {
            label: 'Injury status',
            detail: injury?.status ?? starter.status,
            source: injury ? 'InjuryReportRecord' : 'Roster.playerData',
          },
        ],
        playerIds: [starter.id],
        sourceFreshness: context.syncFreshness,
        // Neither branch executes anything on the user's behalf this phase — both link
        // to a real page for the user to act on themselves. `open_provider` for
        // non-native providers (nowhere in-product to send them); native leagues get
        // `recommendation_only` too, since this generator has no real mutation path
        // yet (see USER_OS_EXECUTION_CAPABILITY_MATRIX.md).
        executionCapability: context.provider === 'allfantasy' ? 'recommendation_only' : 'open_provider',
        action:
          context.provider === 'allfantasy'
            ? { label: 'Review lineup', href: `/league/${context.canonicalLeagueId}?tab=team`, payloadType: 'lineup_review' }
            : undefined,
        generatedAt,
      })
    )
  }

  const totalStarters = context.lineup.starters.length
  if (totalStarters === 0 && (context.lineup.bench.length > 0 || context.lineup.ir.length > 0)) {
    recommendations.push(
      buildRecommendation({
        leagueId: context.canonicalLeagueId,
        teamId: context.teamId,
        rosterId: context.rosterId ?? undefined,
        domain: 'lineup',
        type: 'empty_slot',
        key: 'all-starters-empty',
        priority: 'critical',
        title: 'Your starting lineup is empty',
        summary: 'No players are currently assigned to a starting slot for this roster.',
        rationale: ['Roster has bench/IR players but zero starters assigned.'],
        evidence: [
          { label: 'Starters assigned', detail: '0', source: 'Roster.playerData.lineup_sections' },
        ],
        sourceFreshness: context.syncFreshness,
        // Neither branch executes anything on the user's behalf this phase — both link
        // to a real page for the user to act on themselves. `open_provider` for
        // non-native providers (nowhere in-product to send them); native leagues get
        // `recommendation_only` too, since this generator has no real mutation path
        // yet (see USER_OS_EXECUTION_CAPABILITY_MATRIX.md).
        executionCapability: context.provider === 'allfantasy' ? 'recommendation_only' : 'open_provider',
        action:
          context.provider === 'allfantasy'
            ? { label: 'Set your lineup', href: `/league/${context.canonicalLeagueId}?tab=team`, payloadType: 'lineup_set' }
            : undefined,
        generatedAt,
      })
    )
  }

  return recommendations
}

/** Exposed for tests — not part of the public generator contract. */
export const __test = { isLikelyOut }
export type { RosterPlayerEntry }
