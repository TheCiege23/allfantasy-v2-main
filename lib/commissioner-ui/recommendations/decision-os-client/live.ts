import { callDecisionOS } from '../../adapter/transport'
import { isLiveReady } from '../../liveReadiness'
import { resolveActiveLeagueId } from '../../resolveActiveLeagueId'
import type { CommissionerErrorContract } from '../../contracts'
import type { RecommendationsClient } from './types'

/**
 * Phase 3.7 — Recommendations Center's first real (gated) integration
 * attempt, following the established pattern (Mission Control, League
 * Health, Manager Intelligence). `getQueue()` shares the exact same
 * `CommissionerRecommendationContract` League Health's `getRecommendations()`
 * needed in Phase 3.5 — and cannot be honestly completed for the identical
 * reasons, re-verified here rather than assumed:
 *
 * - `title`, `confidence`, `expectedImpact`, `primaryActionLabel` have no
 *   analog in the currently-ported `/league` route's
 *   `recommendations: LeagueRecommendationV1[]` (only `recommendationId`,
 *   `priority`, `category`, `message` — one string, not a title+rationale
 *   split, and no confidence/impact/action-label fields at all).
 * - `status` has NO analog anywhere in Decision OS, ported or not —
 *   recommendations are recomputed fresh from the current event window on
 *   every request; there is no persisted lifecycle (`new`/`in_progress`/
 *   `automated`/`deferred`, per this module's own demo fixture) anywhere
 *   in the behavioral intelligence pipeline.
 *
 * `lib/decision-os/phase6/recommendations/` on `g15-event-foundation` (the
 * Phase 6.4 "Recommendation Engine") was checked before concluding this —
 * its own `Recommendation` type does carry `confidence`/`expectedImpact`/
 * `recommendedActions` (which could satisfy `primaryActionLabel`), genuinely
 * closer to this contract than the base `/league` route. But it still has
 * no `title` or `status` field either, it was deliberately excluded from
 * the Phase 3.1 port manifest (grouped with the rest of `phase6/` as
 * "richer classifiers... confirmed not imported by the approved
 * Intelligence API path"), and it has no exposed route today. Porting it
 * would be introducing a new backend capability — forbidden this phase,
 * per instruction, regardless of how close a match it is. Documented, not
 * built. See RECOMMENDATIONS_CENTER_LIVE_INTEGRATION_REPORT.md.
 *
 * The real call below still runs and its result is still used to prove the
 * pipeline (league resolution, the `/league` call, raw recommendation
 * extraction) — nothing here is dead code once either gap closes.
 */
function notYetIntegrated(): CommissionerErrorContract {
  return {
    category: 'upstream_unavailable',
    message: 'The live Decision OS backend is not yet integrated in this environment.',
    moduleId: 'recommendations',
    retryable: false,
    timestamp: new Date().toISOString(),
  }
}

/** A specific, honest degradation — the backend is reachable and has recommendations, but not in the shape this queue's contract requires. */
function recommendationLifecycleUnavailable(): CommissionerErrorContract {
  return {
    category: 'upstream_unavailable',
    message: 'The Decision OS backend does not yet expose recommendation title, confidence, impact, action, or lifecycle status data.',
    moduleId: 'recommendations',
    retryable: false,
    timestamp: new Date().toISOString(),
  }
}

interface LeagueRecommendationShape {
  recommendationId: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  category: string
  message: string
}
interface LeagueIntelligenceRecommendationsShape {
  data: { recommendations: LeagueRecommendationShape[] }
}

export const liveRecommendationsClient: RecommendationsClient = {
  async getQueue() {
    if (!(await isLiveReady('recommendations'))) {
      return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
    }
    const timestamp = new Date().toISOString()
    const leagueId = await resolveActiveLeagueId()
    if (!leagueId) {
      return { data: null, error: notYetIntegrated(), source: 'live', timestamp }
    }

    const { data, error } = await callDecisionOS<LeagueIntelligenceRecommendationsShape>(
      'recommendations',
      `/api/v1/intelligence/league?leagueId=${encodeURIComponent(leagueId)}`,
    )
    if (error || !data) {
      return { data: null, error: error ?? notYetIntegrated(), source: 'live', timestamp }
    }

    // The call above already proves the real pipeline works (league
    // resolution, the /league call, a well-formed response). What it
    // returns — data.data.recommendations — is discarded here:
    // title/confidence/expectedImpact/primaryActionLabel/status cannot be
    // honestly constructed from it.
    return { data: null, error: recommendationLifecycleUnavailable(), source: 'live', timestamp }
  },
}
