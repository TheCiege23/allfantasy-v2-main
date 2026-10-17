/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Part 12,
 * integrity domain.
 *
 * Deliberately does NOT call `lib/integrity/TankingDetectionEngine.ts` or
 * `lib/integrity/CollusionDetectionEngine.ts` this phase. This phase's Part 1
 * inventory found both have a real, deterministic evidence-gathering layer
 * but a final verdict produced by an LLM call
 * (`runClaudeTankingPrompt`/equivalent) — and, critically, found that
 * `lib/shared-services/commissioner/README.md` **already documents an
 * explicit architectural decision** to exclude these from the shared
 * Commissioner Intelligence Service specifically because blending an
 * AI-adjudicated verdict into "deterministic facts" would violate its own
 * design principle. This generator follows that same precedent rather than
 * re-litigating it: it surfaces ONLY real, already-verified
 * `LeagueHealthAssessment.issues` text that indicates a real activity/
 * abandonment concern, using the phase brief's own required cautious
 * language, and never states tanking or collusion as fact. Full
 * tanking/collusion detection remains a real, disclosed, deferred
 * integration — not silently dropped, not fabricated here.
 *
 * Part 18 — every concern keyword below ('abandon'/'inactive'/'missed'/
 * 'orphan') describes a *repeated or ongoing* pattern, which a single
 * point-in-time CSV snapshot (Fantrax) can never actually prove — it can
 * only show one moment. Rather than phrase a one-time observation as an
 * activity trend, this generator returns no integrity recommendations at
 * all for a snapshot-only league; the honest state is "insufficient
 * evidence," not a downgraded claim.
 */
import type { CommissionerOsContext } from '../../commissionerOsContext'
import { buildRecommendation, isFreshnessSafeForPriority } from '../../userOsRecommendationHelpers'
import type { LeagueRecommendation } from '../../types'

const CONCERN_KEYWORDS = ['abandon', 'inactive', 'missed', 'orphan']

export function generateIntegrityRecommendations(
  context: CommissionerOsContext,
  generatedAt: string
): LeagueRecommendation[] {
  const priority = 'medium' as const
  if (!isFreshnessSafeForPriority(context.syncFreshness, priority)) return []
  if (context.isSnapshotOnly) return []

  const concerns = context.health.issues.filter((issue) =>
    CONCERN_KEYWORDS.some((kw) => issue.toLowerCase().includes(kw))
  )
  if (concerns.length === 0) return []

  return concerns.map((issue, i) =>
    buildRecommendation({
      leagueId: context.canonicalLeagueId,
      domain: 'commissioner',
      type: 'integrity_review_recommended',
      key: `health-issue-${i}`,
      priority,
      title: 'Review recommended',
      summary: `Possible integrity concern: ${issue}`,
      rationale: [
        issue,
        'Insufficient evidence for enforcement — this signal is a real, evidence-backed prompt to review, not an accusation.',
      ],
      evidence: [{ label: 'League health issue', detail: issue, source: 'monitorLeagueHealth' }],
      confidence: context.health.confidence / 100,
      sourceFreshness: context.syncFreshness,
      executionCapability: 'recommendation_only',
      commissionerScope: 'league_wide',
      publicationAudience: 'commissioner_only',
      governanceSeverity: 'review_recommended',
      humanReviewRequired: true,
      generatedAt,
    })
  )
}
