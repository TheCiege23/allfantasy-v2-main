/**
 * Decision OS Replay Framework Phase 17 — Manager OS Replay Insight contract.
 *
 * Turns the Phase 16 *validated* Decision Replay Correlation finding into a
 * backend-ready, user-safe insight contract for a future Manager OS / Chimmy
 * surface. This is a CONTRACT + DETERMINISTIC FORMATTER only — like every
 * other module under lib/replay-framework/, it is NOT wired into any live
 * route, cron, or recommendation path, and it changes no production behavior.
 *
 * Design discipline (mirrors lib/decision-os/behavioral/api/contracts.ts and
 * presentation-adapters.ts):
 *   - The public shape is a curated V1 subset — it deliberately excludes all
 *     raw replay internals: no `tradeReplayId`, `providerLeagueId`,
 *     `receivingRosterId`, `providerAssetId`, `approximateTradeWeek`,
 *     `engineVersionHash`, verdict strings, or per-trade rows leak into it.
 *   - The formatter reads ONLY the aggregate fields of a
 *     `DecisionReplayCorrelationSummary` (never `perTradeImpacts`), so
 *     per-trade internal identifiers are structurally incapable of reaching
 *     the output. (An isolation test poisons `perTradeImpacts` with a
 *     sentinel and asserts it never appears in any produced string.)
 *   - The formatter is pure and deterministic: identical inputs → byte-
 *     identical `insights` copy. `derivedAt` is injected (not read from a
 *     clock inside the copy path) so the user-facing strings never depend on
 *     wall-clock time.
 *   - Confidence is driven by real sample size; a low-sample caveat is
 *     attached whenever the backing sample is too small to trust on its own,
 *     and the caveat cites the platform-validated baseline as the more
 *     reliable anchor.
 *
 * No import from any production engine, Trade Learning, or calibration code —
 * only the Phase 16 correlation *type* from within this same framework.
 *
 * ADR: docs/DECISION_OS_MANAGER_REPLAY_INSIGHT_ADR.md
 */
import type { DecisionReplayCorrelationSummary } from '../metrics/decisionReplayCorrelation'

/**
 * Convenience re-export of the only input type this formatter consumes, so a
 * downstream Manager OS wiring layer imports a single path. Aliased (not a
 * structural copy) so the formatter can never silently drift from the Phase 16
 * summary shape it reads.
 */
export type DecisionReplayCorrelationSummaryLike = DecisionReplayCorrelationSummary

/** Stable version stamp for this contract. A breaking change requires a V2 shape, per contracts.ts convention. */
export const REPLAY_INSIGHT_VERSION = 'replay-insight-v1'

/**
 * The Phase 16 platform-validated baselines (docs/DECISION_OS_DECISION_REPLAY_CORRELATION_REPORT.md
 * §11.2, Finding B). These are the real, measured aggregate outcomes across
 * the 141-trade / 5-league validation corpus — used ONLY as the honest anchor
 * cited in low-sample caveats, never as a per-manager prediction. Frozen
 * constants: if a future phase re-measures on a larger corpus, this bumps to
 * a V2 baseline set rather than silently changing.
 */
export const REPLAY_VALIDATED_BASELINES_V1 = {
  /** Matched-window lineup-efficiency delta for starter-impact trades: +1.4 percentage points. */
  starterImpactEfficiencyDeltaPts: 1.4,
  /** Matched-window lineup-efficiency delta for bench-depth trades: -1.1 percentage points. */
  benchDepthEfficiencyDeltaPts: -1.1,
  /** Wasted-acquisition (retained-but-never-started) rate for starter-impact trades. */
  starterImpactWastedAcquisitionRate: 0.076,
  /** Wasted-acquisition rate for bench-depth trades. */
  benchDepthWastedAcquisitionRate: 0.114,
  /** Real trades the finding was validated on. */
  validationCorpusTrades: 141,
  validationSource: 'Phase 16 Decision Replay Correlation (matched-window)',
} as const

export type ReplayInsightScope = 'manager' | 'league' | 'platform'

export type ReplayInsightCategory =
  | 'starter_impact_trades'
  | 'bench_depth_trades'
  | 'wasted_acquisitions'
  | 'lineup_efficiency_impact'

export type ReplayInsightSentiment = 'positive' | 'neutral' | 'caution'

/** Same four-level shape as `contracts.ts`'s `trendConfidence` — driven by real backing sample size. */
export type ReplayInsightConfidence = 'high' | 'moderate' | 'low' | 'insufficient'

/**
 * A single user-safe replay-backed insight.
 *
 * Field selection rationale (what is deliberately NOT here):
 * - No replay row IDs, league IDs, roster IDs, player IDs, or week numbers.
 * - No raw internal metric field names (`avgDeltaEfficiency`, `deltaThem`, …).
 * - No `verdict`/`acceptProb`/`confidenceScore` engine internals — those are
 *   translated into the user-safe `category` + `sentiment` vocabulary.
 * `insightId` is a deterministic category slug, never derived from any
 * replay record.
 */
export interface ManagerReplayInsightV1 {
  insightId: string
  category: ReplayInsightCategory
  /** Short user-facing headline. Deterministic. No internal terminology. */
  headline: string
  /** One-to-two sentence user-facing explanation. Deterministic. No internal terminology. */
  detail: string
  /** Compact user-safe metric string, e.g. "+1.4 pts efficiency" or "11% unused". */
  displayValue: string
  sentiment: ReplayInsightSentiment
  confidence: ReplayInsightConfidence
  /** Number of real trades backing this specific insight. */
  sampleSize: number
  /** Non-null exactly when `confidence` is 'low' or 'insufficient' — cites the platform baseline as the reliable anchor. */
  caveat: string | null
}

/**
 * The full insight set for one scope (a manager, a league, or the platform).
 * `derivedAt` is injected by the caller so the copy path stays clock-free and
 * fully deterministic.
 */
export interface ManagerReplayInsightSetV1 {
  scope: ReplayInsightScope
  insights: ManagerReplayInsightV1[]
  /** How many real trades were considered for this scope. */
  tradesAnalyzed: number
  /** How many of those had usable subsequent lineup data. */
  tradesWithLineupData: number
  /** Always this literal — signals the provenance without exposing internals. */
  validationSource: 'decision_replay_correlation'
  version: string
  /** ISO 8601. Injected, not internally generated. */
  derivedAt: string
}

// ── deterministic formatting helpers ──────────────────────────────────────────

/** Signed percentage-point string from a 0–1 efficiency-fraction delta. e.g. 0.013825 → "+1.4", -0.010969 → "-1.1". */
function formatSignedEffPts(fraction: number | null): string {
  if (fraction === null) return 'n/a'
  const pts = Math.round(fraction * 1000) / 10 // fraction→pp, 1 decimal
  const sign = pts > 0 ? '+' : ''
  return `${sign}${pts.toFixed(1)}`
}

/** Whole-percent string from a 0–1 rate. e.g. 0.0758 → "8%". */
function formatPercent(fraction: number | null): string {
  if (fraction === null) return 'n/a'
  return `${Math.round(fraction * 100)}%`
}

/** Absolute percentage-point magnitude (for "essentially unchanged" thresholding). */
function absEffPts(fraction: number | null): number {
  if (fraction === null) return 0
  return Math.abs(fraction * 100)
}

// ── confidence + caveat ───────────────────────────────────────────────────────

/** Same thresholds spirit as contracts.ts's trend confidence: real backing sample gates trust. */
function confidenceFromSample(n: number): ReplayInsightConfidence {
  if (n >= 30) return 'high'
  if (n >= 10) return 'moderate'
  if (n >= 3) return 'low'
  return 'insufficient'
}

function caveatForCategory(confidence: ReplayInsightConfidence, sampleSize: number, category: ReplayInsightCategory): string | null {
  if (confidence !== 'low' && confidence !== 'insufficient') return null
  const b = REPLAY_VALIDATED_BASELINES_V1
  const tradeWord = sampleSize === 1 ? 'trade' : 'trades'
  const base = `Based on only ${sampleSize} of your ${tradeWord} — treat as directional, not conclusive.`
  if (category === 'starter_impact_trades') {
    return `${base} Across ${b.validationCorpusTrades} real validated trades, starter-impact deals gained about +${b.starterImpactEfficiencyDeltaPts} pts of lineup efficiency.`
  }
  if (category === 'bench_depth_trades') {
    return `${base} Across ${b.validationCorpusTrades} real validated trades, bench-depth deals changed lineup efficiency by about ${b.benchDepthEfficiencyDeltaPts} pts.`
  }
  if (category === 'wasted_acquisitions') {
    return `${base} Across the validated corpus, roughly ${formatPercent(b.benchDepthWastedAcquisitionRate)} of bench-depth acquisitions and ${formatPercent(b.starterImpactWastedAcquisitionRate)} of starter-impact acquisitions went unused.`
  }
  return `${base} Overall trade impact on lineup efficiency was near zero across the validated corpus.`
}

// ── per-category insight builders ─────────────────────────────────────────────

function buildStarterImpactInsight(count: number, deltaEff: number | null, wastedRate: number | null): ManagerReplayInsightV1 {
  const confidence = confidenceFromSample(count)
  const improved = (deltaEff ?? 0) > 0
  return {
    insightId: 'replay_insight_starter_impact_trades',
    category: 'starter_impact_trades',
    headline: improved ? 'Your starter-impact trades paid off' : 'Your starter-impact trades held steady',
    detail: `Trades that upgraded your active starting lineup changed your lineup efficiency by about ${formatSignedEffPts(deltaEff)} pts and left roughly ${formatPercent(wastedRate)} of acquired players unused.`,
    displayValue: `${formatSignedEffPts(deltaEff)} pts efficiency`,
    sentiment: improved ? 'positive' : 'neutral',
    confidence,
    sampleSize: count,
    caveat: caveatForCategory(confidence, count, 'starter_impact_trades'),
  }
}

function buildBenchDepthInsight(count: number, deltaEff: number | null, wastedRate: number | null): ManagerReplayInsightV1 {
  const confidence = confidenceFromSample(count)
  const declined = (deltaEff ?? 0) < 0
  return {
    insightId: 'replay_insight_bench_depth_trades',
    category: 'bench_depth_trades',
    headline: declined ? "Bench-depth trades didn't move your lineup" : 'Your bench-depth trades were roughly neutral',
    detail: `Depth-for-depth swaps changed your lineup efficiency by about ${formatSignedEffPts(deltaEff)} pts and left roughly ${formatPercent(wastedRate)} of acquired players unused — typically more than starter-focused deals.`,
    displayValue: `${formatSignedEffPts(deltaEff)} pts efficiency`,
    sentiment: declined ? 'caution' : 'neutral',
    confidence,
    sampleSize: count,
    caveat: caveatForCategory(confidence, count, 'bench_depth_trades'),
  }
}

function buildWastedAcquisitionInsight(sampleSize: number, retainedUnusedRate: number | null, churnedRate: number | null): ManagerReplayInsightV1 {
  const confidence = confidenceFromSample(sampleSize)
  const rate = retainedUnusedRate ?? 0
  const sentiment: ReplayInsightSentiment = rate > 0.1 ? 'caution' : rate > 0.05 ? 'neutral' : 'positive'
  return {
    insightId: 'replay_insight_wasted_acquisitions',
    category: 'wasted_acquisitions',
    headline: `${formatPercent(retainedUnusedRate)} of acquired players never started`,
    detail: `Across your trades, about ${formatPercent(retainedUnusedRate)} of the players you brought in were kept but never entered your starting lineup, and about ${formatPercent(churnedRate)} left your roster before contributing.`,
    displayValue: `${formatPercent(retainedUnusedRate)} unused`,
    sentiment,
    confidence,
    sampleSize,
    caveat: caveatForCategory(confidence, sampleSize, 'wasted_acquisitions'),
  }
}

function buildLineupEfficiencyImpactInsight(sampleSize: number, matchedDeltaEff: number | null): ManagerReplayInsightV1 {
  const confidence = confidenceFromSample(sampleSize)
  const magnitude = absEffPts(matchedDeltaEff)
  const essentiallyUnchanged = magnitude < 0.5
  const improved = (matchedDeltaEff ?? 0) > 0
  const headline = essentiallyUnchanged
    ? "Trading didn't measurably change your overall lineup efficiency"
    : improved
      ? 'Your trades improved your overall lineup efficiency'
      : 'Your trades lowered your overall lineup efficiency'
  return {
    insightId: 'replay_insight_lineup_efficiency_impact',
    category: 'lineup_efficiency_impact',
    headline,
    detail: `Comparing the weeks just before and after each trade, your overall lineup efficiency changed by about ${formatSignedEffPts(matchedDeltaEff)} pts${essentiallyUnchanged ? ' — essentially unchanged. Individual starter-impact trades can still help (see above).' : '.'}`,
    displayValue: `${formatSignedEffPts(matchedDeltaEff)} pts`,
    sentiment: essentiallyUnchanged ? 'neutral' : improved ? 'positive' : 'caution',
    confidence,
    sampleSize,
    caveat: caveatForCategory(confidence, sampleSize, 'lineup_efficiency_impact'),
  }
}

/**
 * Builds the user-safe replay insight set for one scope from a Phase 16
 * correlation summary. Pure and deterministic: only aggregate fields are
 * read (never `perTradeImpacts`), and no clock is consulted for the copy.
 *
 * `now` is injected purely to stamp `derivedAt` — it never influences any
 * insight string, so the `insights` array is identical across calls with
 * identical `summary`/`scope`.
 */
export function buildManagerReplayInsights(
  summary: DecisionReplayCorrelationSummary,
  options: { scope: ReplayInsightScope; now?: Date },
): ManagerReplayInsightSetV1 {
  const starterGroup = summary.byLineupInvolvement.find((g) => g.involvement === 'starter_involved')
  const benchGroup = summary.byLineupInvolvement.find((g) => g.involvement === 'bench_depth')

  const insights: ManagerReplayInsightV1[] = []

  if (starterGroup && starterGroup.count > 0) {
    insights.push(buildStarterImpactInsight(starterGroup.count, starterGroup.avgDeltaEfficiency, starterGroup.avgRetainedButUnusedRate))
  }
  if (benchGroup && benchGroup.count > 0) {
    insights.push(buildBenchDepthInsight(benchGroup.count, benchGroup.avgDeltaEfficiency, benchGroup.avgRetainedButUnusedRate))
  }
  if (summary.totalTradesConsidered > 0) {
    insights.push(buildWastedAcquisitionInsight(summary.totalTradesConsidered, summary.avgRetainedButUnusedRate, summary.avgChurnedAwayRate))
  }
  if (summary.matchedWindowAggregate.tradesWithMatchedData > 0) {
    insights.push(buildLineupEfficiencyImpactInsight(summary.matchedWindowAggregate.tradesWithMatchedData, summary.matchedWindowAggregate.avgDeltaEfficiency))
  }

  return {
    scope: options.scope,
    insights,
    tradesAnalyzed: summary.totalTradesConsidered,
    tradesWithLineupData: summary.totalTradesWithLineupData,
    validationSource: 'decision_replay_correlation',
    version: REPLAY_INSIGHT_VERSION,
    derivedAt: (options.now ?? new Date()).toISOString(),
  }
}
