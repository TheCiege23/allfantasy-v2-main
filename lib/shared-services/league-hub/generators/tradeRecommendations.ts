/**
 * User OS League-Specific Intelligence Wiring phase — Part 7, trade domain.
 *
 * Deliberately does NOT hand-construct `TradeDecisionContextV1`
 * (`lib/trade-engine/trade-decision-context.ts`) or call
 * `generateTradeCandidates` (`lib/trade-finder`) directly this phase. Both
 * are real, production-wired (per this phase's Part 1 inventory), but
 * `TradeDecisionContextV1` is a fully-assembled, Zod-validated context
 * object (team snapshots, valuation, manager preferences, competitor
 * data) — safely re-deriving it here would mean re-implementing player
 * valuation, which is exactly what "reuse the existing Trade Decision OS
 * rather than rebuilding trade evaluation" warns against. Building a
 * shallow, partially-populated context object to force the signature would
 * risk silently-wrong deterministic output — worse than not calling it.
 *
 * Instead: this generator surfaces a real, honest, non-fabricated pointer
 * recommendation — framed by the real `strategy` domain's classification
 * (contender → buy-low framing, retool/rebuild → sell-high framing) —
 * directing the user to the real, authoritative trade surfaces
 * (`/dynasty-trade-analyzer`, `/trade-finder`) rather than inventing
 * player-level trade math this generator has no safe way to compute.
 * `executionCapability` is honestly `open_provider`/`recommendation_only`
 * for every provider — this generator never claims a trade was evaluated
 * or proposed on the user's behalf.
 */
import type { UserOsContext } from '../userOsContext'
import { classifyStrategy } from './strategyRecommendations'
import { buildRecommendation, isFreshnessSafeForPriority } from '../userOsRecommendationHelpers'
import type { LeagueRecommendation } from '../types'

export function generateTradeRecommendations(context: UserOsContext, generatedAt: string): LeagueRecommendation[] {
  if (context.unavailableDomains.includes('trade') || !context.teamId) return []

  const strategy = classifyStrategy(context)
  if (!strategy || strategy.classification === 'insufficient_evidence') return []

  const priority = 'low' as const
  if (!isFreshnessSafeForPriority(context.syncFreshness, priority)) return []

  const isBuyPosture = strategy.classification === 'strong_contender' || strategy.classification === 'contender'
  const isSellPosture = strategy.classification === 'retool' || strategy.classification === 'rebuild'

  const title = isBuyPosture
    ? 'Your record supports exploring buy-low trade targets'
    : isSellPosture
      ? 'Your record suggests sell-high trade opportunities may be worth exploring'
      : 'Evaluate trade opportunities to solidify your playoff push'

  return [
    buildRecommendation({
      leagueId: context.canonicalLeagueId,
      teamId: context.teamId,
      rosterId: context.rosterId ?? undefined,
      domain: 'trade',
      type: isBuyPosture ? 'buy_low_posture' : isSellPosture ? 'sell_high_posture' : 'fringe_posture',
      key: `trade-posture-${strategy.classification}`,
      priority,
      title,
      summary: `${strategy.posture} Trade Finder can surface realistic partners for your roster, and the Trade Analyzer can evaluate any specific deal deterministically.`,
      rationale: [`Strategy classification: ${strategy.classification} (confidence ${(strategy.confidence * 100).toFixed(0)}%).`, ...strategy.evidence],
      evidence: strategy.evidence.map((detail, i) => ({ label: `Evidence ${i + 1}`, detail, source: 'LeagueTeam' })),
      confidence: strategy.confidence,
      sourceFreshness: context.syncFreshness,
      // Never claims a trade was evaluated/proposed here — points to the real engines.
      executionCapability: 'recommendation_only',
      action: { label: 'Open Trade Finder', href: '/trade-finder', payloadType: 'trade_finder_open' },
      generatedAt,
    }),
  ]
}
