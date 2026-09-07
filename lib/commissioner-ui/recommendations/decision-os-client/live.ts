import { callDecisionOS } from '../../adapter/transport'
import { isLiveReady } from '../../liveReadiness'
import { resolveActiveLeagueId } from '../../resolveActiveLeagueId'
import type { CommissionerErrorContract, CommissionerRecommendationContract } from '../../contracts'
import type { SeverityTier } from '../../tokens/colors'
import type { RecommendationsClient } from './types'

/**
 * Recommendations Center — live, and no longer discarding its own answer.
 *
 * ── WHAT THIS FILE USED TO DO, AND WHY IT WAS BOTH RIGHT AND WRONG ──────────────────────────
 *
 * It made the real call, received real recommendations, and returned an honest "the backend does
 * not expose title/confidence/impact/action/status" error — throwing every one away. Given a
 * contract that REQUIRED those five, that was the correct refusal: inventing a confidence level
 * for a recommendation nothing scored is exactly the fabrication this program has never done.
 *
 * The mistake was upstream of the refusal. Four of those five fields were required by a contract
 * written against a demo fixture, not against anything that computes them, and the fifth (`title`)
 * is derivable from a stable id the contract does guarantee. So a complete, useful recommendation
 * — what is wrong, how urgent, and why — was being withheld to protect four fields that do not
 * exist anywhere. Measured on a real league: 2 critical retention recommendations dropped, and
 * with them the Activity Stream and Notification Center, which compose over this client and were
 * therefore permanently empty too.
 *
 * `confidence`, `expectedImpact`, `primaryActionLabel` and `status` are now optional on
 * `CommissionerRecommendationContract` and are OMITTED here, never defaulted. `status` in
 * particular stays absent on principle rather than convenience: recommendations are recomputed
 * fresh from the current event window on every request, so there is no persisted lifecycle for a
 * status to describe. It becomes real when something persists one.
 *
 * ⚠ EVERY FIELD BELOW IS READ FROM `LeagueRecommendationV1` IN `behavioral/api/contracts.ts`, NOT
 * FROM WHAT THE PIPELINE COMPUTES. The two differ — the derivation emits a `signal` the route
 * strips — and a probe run against the in-process pipeline will not show you that.
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

/**
 * Exactly `LeagueRecommendationV1`. Verified against
 * `lib/decision-os/behavioral/api/contracts.ts` rather than against what the pipeline computes —
 * ⚠ the derivation layer also emits a `signal` field and the API contract STRIPS it, so a title
 * keyed on `signal` would have been `undefined` for every recommendation over the wire while
 * working perfectly against the in-process pipeline in a probe.
 */
interface LeagueRecommendationShape {
  recommendationId: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  category: 'retention' | 'engagement' | 'activity' | 'moderation'
  message: string
}
/** The route's envelope: `derivedAt` is in `meta`, NOT in `data`. */
interface LeagueIntelligenceRecommendationsShape {
  data: { recommendations: LeagueRecommendationShape[] }
  meta?: { derivedAt?: string }
}

/**
 * Human titles for the backend's stable `recommendationId`s.
 *
 * Keyed on the id because that IS the contract — five ids, all guaranteed present. This is
 * presentation of a real field, not invention: the same treatment `managers/live.ts` already gives
 * `ManagerIdentityLabel` when it renders an archetype. The id says what was detected; this is what
 * a commissioner calls it.
 */
const RECOMMENDATION_TITLES: Record<string, string> = {
  rec_follow_up_critical_risk: 'Managers at risk of leaving',
  rec_contact_inactive_managers: 'Inactive managers need outreach',
  rec_spark_trade_activity: 'Trade activity has stalled',
  rec_announce_waiver_wire: 'Waiver wire is going unused',
  rec_post_weekly_recap: 'Weekly recap would lift engagement',
}

function titleFor(rec: LeagueRecommendationShape): string {
  const mapped = RECOMMENDATION_TITLES[rec.recommendationId]
  if (mapped) return mapped
  /*
   * An id this build has not seen renders as ITSELF, humanised, rather than as a generic
   * "Recommendation" — a new backend signal should be visibly new, not silently indistinguishable
   * from the five above. `rec_` is dropped because it is a namespace, not a word.
   */
  const words = rec.recommendationId.replace(/^rec_/, '').replace(/_/g, ' ').trim()
  if (words) return words.charAt(0).toUpperCase() + words.slice(1)
  const firstSentence = rec.message.split(/(?<=\.)\s/)[0] ?? rec.message
  return firstSentence.length > 80 ? `${firstSentence.slice(0, 77)}…` : firstSentence
}

/**
 * Backend priority → `SeverityTier`. Written out because the two vocabularies genuinely differ.
 *
 * ⚠ DO NOT ROUTE THIS THROUGH `normalizeSeverity`. That helper validates against `SeverityTier`
 * (`critical | elevated | standard | advisory | positive`) and falls back to `standard` for
 * anything else — so `high`, `medium` and `low` would ALL land on `standard`, collapsing three
 * distinct priorities into one and silently downgrading every high-priority recommendation. The
 * fallback is correct for a field that is already in the target vocabulary; this one is not.
 */
const PRIORITY_TO_SEVERITY: Record<string, SeverityTier> = {
  critical: 'critical',
  high: 'elevated',
  medium: 'standard',
  low: 'advisory',
}

/**
 * The backend's category vocabulary (`retention` | `activity` | `engagement`) mapped onto the
 * contract's. `retention` is a health-and-risk concern, not an engagement one — a manager about to
 * quit is a different problem from a quiet league, and collapsing them would lose that.
 */
function categoryFor(category: LeagueRecommendationShape['category']): CommissionerRecommendationContract['category'] {
  switch (category) {
    case 'retention':
      return 'health_and_risk'
    case 'activity':
    case 'engagement':
      return 'engagement'
    case 'moderation':
      // Moderation is an integrity concern, not an engagement one.
      return 'competitive_integrity'
    default:
      return 'administrative'
  }
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

    /*
     * 🛑 THIS USED TO DISCARD THE ANSWER IT HAD JUST FETCHED. The call above returns real
     * recommendations — id, priority, category, signal, message — and the old code threw every one
     * away because it could not populate `confidence`, `expectedImpact`, `primaryActionLabel` and
     * `status`. Those four are now optional on the contract (see `contracts/recommendations.ts`),
     * so a complete, useful recommendation is no longer withheld to protect four fields nothing
     * computes. Measured on a real league: 2 critical retention recommendations were being
     * dropped, and with them the Activity Stream and Notification Center that compose over this.
     *
     * Nothing here is fabricated. Every rendered field traces to a backend value: the four
     * unsourced ones are OMITTED, not defaulted.
     */
    const recommendations = data.data?.recommendations ?? []
    // `derivedAt` is in the envelope's `meta`, not in `data` — the request timestamp is the
    // honest fallback, never a fabricated earlier one.
    const createdAt = data.meta?.derivedAt ?? timestamp

    const queue: CommissionerRecommendationContract[] = recommendations.map((rec) => ({
      id: rec.recommendationId,
      title: titleFor(rec),
      rationale: rec.message,
      severity: PRIORITY_TO_SEVERITY[rec.priority] ?? 'standard',
      category: categoryFor(rec.category),
      sourceModuleId: 'recommendations',
      createdAt,
    }))

    return { data: queue, error: null, source: 'live', timestamp }
  },
}
