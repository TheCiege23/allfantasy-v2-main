/**
 * G15.12 — Story Context Builder.
 *
 * Produces the single privacy-safe StoryContext consumed by every story generator. The ONLY data
 * source is the IntelligenceQueryService (activity summary, health snapshot, commissioner action
 * items, audit feed). It strips anything unsafe (action-item `meta` may hold league-internal user
 * ids) and never throws: feature-gate/access errors degrade to a 'restricted' context; no recorded
 * activity degrades to an 'empty' context. Mirrors the G15.9 grounding adapter's contract.
 */
import {
  IntelligenceAccessError,
  type IntelligenceQueryService,
  type CommissionerActionItem,
} from '../intelligence/IntelligenceQueryService'
import type { FeatureGatePrincipal } from '../intelligence/featureGate'
import type { StoryContext, StorySafeActionItem } from './types'

/** Only the read methods the Story Engine is allowed to touch. No raw DB / provider / payload access. */
export type StoryDataSource = Pick<
  IntelligenceQueryService,
  'getLeagueActivitySummary' | 'getLeagueHealthSnapshot' | 'getCommissionerActionItems' | 'getLeagueAuditFeed'
>

/** Drop `meta` (may contain league-internal user ids) — keep only safe label fields. */
function toSafeActionItems(items: CommissionerActionItem[]): StorySafeActionItem[] {
  return items.map((i) => ({ kind: i.kind, severity: i.severity, message: i.message }))
}

function emptyContext(leagueId: string, status: StoryContext['status'], now: Date): StoryContext {
  return {
    status,
    leagueId,
    sport: null,
    leagueConcept: null,
    generatedAt: now.toISOString(),
    activity: { totalEvents: 0, firstEventAt: null, lastActivityAt: null, openTradeProposals: 0, counts: {} },
    health: { score: 0, status: 'unknown', activeManagers: 0, totalManagers: 0, daysSinceLastActivity: null },
    actionItems: [],
    recent: [],
  }
}

/**
 * Build the privacy-safe story context for a league. Never throws.
 * `recentLimit` caps the timeline entries pulled from the audit feed.
 */
export async function buildStoryContext(args: {
  source: StoryDataSource
  leagueId: string
  principal?: FeatureGatePrincipal
  recentLimit?: number
  now?: Date
}): Promise<StoryContext> {
  const { source, leagueId, principal } = args
  const now = args.now ?? new Date()
  try {
    const [activity, health, actionItems, feed] = await Promise.all([
      source.getLeagueActivitySummary(leagueId, principal),
      source.getLeagueHealthSnapshot(leagueId, principal),
      source.getCommissionerActionItems(leagueId, principal),
      source.getLeagueAuditFeed(leagueId, { limit: args.recentLimit ?? 8 }, principal),
    ])

    if (activity.totalEvents === 0) {
      return { ...emptyContext(leagueId, 'empty', now), sport: activity.sport, leagueConcept: activity.leagueConcept }
    }

    return {
      status: 'ok',
      leagueId,
      sport: activity.sport,
      leagueConcept: activity.leagueConcept,
      generatedAt: now.toISOString(),
      activity: {
        totalEvents: activity.totalEvents,
        firstEventAt: activity.firstEventAt,
        lastActivityAt: activity.lastActivityAt,
        openTradeProposals: activity.openTradeProposals,
        counts: activity.counts as unknown as Record<string, number>,
      },
      health: {
        score: health.healthScore,
        status: health.status,
        activeManagers: health.activeManagers,
        totalManagers: health.totalManagers,
        daysSinceLastActivity: health.daysSinceLastActivity,
      },
      actionItems: toSafeActionItems(actionItems),
      recent: feed.items.map((i) => ({ type: i.type, summary: i.summary, occurredAt: i.occurredAt })),
    }
  } catch (err) {
    if (err instanceof IntelligenceAccessError) return emptyContext(leagueId, 'restricted', now)
    // Any other failure degrades to empty rather than breaking the caller.
    return emptyContext(leagueId, 'empty', now)
  }
}
