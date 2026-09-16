/**
 * Deterministic confidence rubric for Chimmy AI answer contracts.
 *
 * Scores are computed from observable server-side signals only.
 * Model-reported confidence (from PECR) is used as a bounded modifier
 * (+/- 10 pts max) — it cannot solely drive the final score.
 *
 * Score band → level:
 *   ≥ 82  → high
 *   ≥ 62  → medium
 *   < 62  → low
 *
 * Chimmy's track record (brief item 10) is a second bounded modifier (+/- 10): how calls shown at
 * this band actually turned out. It is inert until the outcome loop has enough resolved calls.
 */

import type { ChimmyAnswerType, ChimmyConfidenceBlock } from './response-contract'

export type ChimmyConfidenceLevel = ChimmyConfidenceBlock['level']

/** The one rule mapping a 0–100 confidence to its band — shared with the outcome loop. */
export function confidenceLevelFor(score: number): ChimmyConfidenceLevel {
  return score >= 82 ? 'high' : score >= 62 ? 'medium' : 'low'
}

/** How past calls shown at one band turned out (`lib/chimmy-outcomes/adviceLearning.ts`). */
export type ChimmyTrackRecordBand = {
  /** Share of resolved calls that were right, shrunk toward `shownRate` — 0–1. */
  observedRate: number
  /** The mean confidence those calls were shown with — 0–1. */
  shownRate: number
  /** Resolved calls behind it. */
  n: number
}

export type ChimmyTrackRecord = Partial<Record<ChimmyConfidenceLevel, ChimmyTrackRecordBand>>

/** The most the track record can move a score, either way. */
export const TRACK_RECORD_MAX_DELTA = 10

// ---------------------------------------------------------------------------
// Input signals
// ---------------------------------------------------------------------------

export type ChimmyConfidenceSignals = {
  /** Raw model-reported confidence percentage (0–100), if any. */
  modelReportedPct: number | null
  /** Whether a staleness warning was generated for this response. */
  hasStalenessWarning: boolean
  /** Minutes since data was last synced (null if unknown). */
  staleMinutes: number | null
  /** Freshness threshold in minutes for this data domain. */
  thresholdMinutes: number | null
  /** Whether the league context was loaded for this request. */
  hasLeagueContext: boolean
  /** Number of distinct data sources referenced. */
  dataSourceCount: number
  /** Number of source links included. */
  sourceLinkCount: number
  /** Populated fields from the PECR response structure. */
  responseStructurePopulated: {
    shortAnswer: boolean
    whatDataSays: boolean
    whatItMeans: boolean
    recommendedAction: boolean
    caveatsCount: number
  }
  /** Detected answer type (affects base score). */
  answerType: ChimmyAnswerType
  /** How past calls of this answer type turned out, per band. Absent or empty → no effect. */
  trackRecord?: ChimmyTrackRecord | null
}

// ---------------------------------------------------------------------------
// Rubric output
// ---------------------------------------------------------------------------

export type ChimmyConfidenceRubricResult = {
  /** Final bounded score 0–100. */
  score: number
  /** Derived level band. */
  level: ChimmyConfidenceBlock['level']
  /** Human-readable explanation of which signals drove the score. */
  rationale: string
  /** Derived freshness label. */
  freshness: ChimmyConfidenceBlock['freshness']
  /** List of signals that contributed positively (for basedOn). */
  positiveSignals: string[]
  /** List of missing signals that would have raised the score (for missing). */
  missingSignals: string[]
  /** Derived league context label. */
  leagueContext: ChimmyConfidenceBlock['leagueContext']
  /** Breakdown of individual signal deltas for debugging. */
  breakdown: Record<string, number>
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const BASE_BY_ANSWER_TYPE: Record<ChimmyAnswerType, number> = {
  start_sit: 70,
  waiver: 70,
  trade: 70,
  draft: 68,
  injury: 68,
  commissioner: 62,
  general: 62,
}

function deriveFreshness(
  hasStalenessWarning: boolean,
  staleMinutes: number | null,
  thresholdMinutes: number | null,
): ChimmyConfidenceBlock['freshness'] {
  if (!hasStalenessWarning && staleMinutes == null) return 'fresh'
  if (!hasStalenessWarning) return 'fresh'
  if (staleMinutes != null && thresholdMinutes != null && staleMinutes > thresholdMinutes * 2) return 'stale'
  return 'partial'
}

// ---------------------------------------------------------------------------
// Core rubric function
// ---------------------------------------------------------------------------

export function computeChimmyConfidenceRubric(signals: ChimmyConfidenceSignals): ChimmyConfidenceRubricResult {
  const breakdown: Record<string, number> = {}

  // 1. Base score by answer type
  const base = BASE_BY_ANSWER_TYPE[signals.answerType]
  breakdown.base = base
  let score = base

  // 2. League context signal (+10 available, +4 partial, 0 missing)
  const leagueContext: ChimmyConfidenceBlock['leagueContext'] = signals.hasLeagueContext
    ? 'available'
    : 'missing'
  const leagueDelta = signals.hasLeagueContext ? 10 : 0
  breakdown.leagueContext = leagueDelta
  score += leagueDelta

  // 3. Freshness penalty (0 fresh, -8 partial/warning, -18 stale > 2x threshold)
  const freshness = deriveFreshness(
    signals.hasStalenessWarning,
    signals.staleMinutes,
    signals.thresholdMinutes,
  )
  const freshnessDelta =
    freshness === 'fresh' ? 0
    : freshness === 'partial' ? -8
    : freshness === 'stale' ? -18
    : -5 // unknown
  breakdown.freshness = freshnessDelta
  score += freshnessDelta

  // 4. Data source count (+3 per source, capped at +12 for 4+ sources)
  const sourceDelta = Math.min(signals.dataSourceCount * 3, 12)
  breakdown.dataSources = sourceDelta
  score += sourceDelta

  // 5. Source links present (+3 if at least 1 link)
  const linkDelta = signals.sourceLinkCount > 0 ? 3 : 0
  breakdown.sourceLinks = linkDelta
  score += linkDelta

  // 6. Response structure completeness
  const struct = signals.responseStructurePopulated
  let structDelta = 0
  if (struct.shortAnswer) structDelta += 3
  if (struct.whatDataSays) structDelta += 4
  if (struct.whatItMeans) structDelta += 3
  if (struct.recommendedAction) structDelta += 3
  if (struct.caveatsCount > 0) structDelta += 2
  breakdown.responseStructure = structDelta
  score += structDelta

  // 7. Model-reported confidence modifier (bounded ± 10, relative to neutral 72)
  let modelDelta = 0
  if (signals.modelReportedPct != null) {
    const raw = (signals.modelReportedPct - 72) * 0.15
    modelDelta = Math.max(-10, Math.min(10, Math.round(raw)))
  }
  breakdown.modelModifier = modelDelta
  score += modelDelta

  /*
   * 8. Track record (bounded ± 10). The band is the one this answer would have been shown at, and
   * the delta is half the gap between how often those calls were right and how confident they were
   * shown as. `observedRate` arrives already shrunk toward `shownRate`, so thin evidence moves the
   * score by almost nothing — one bad week cannot swing it.
   */
  const band = signals.trackRecord?.[confidenceLevelFor(score)]
  let trackDelta = 0
  if (band && band.n > 0 && Number.isFinite(band.observedRate) && Number.isFinite(band.shownRate)) {
    const raw = (band.observedRate - band.shownRate) * 100 * 0.5
    trackDelta = Math.max(-TRACK_RECORD_MAX_DELTA, Math.min(TRACK_RECORD_MAX_DELTA, Math.round(raw)))
    breakdown.trackRecord = trackDelta
    score += trackDelta
  }

  // Final clamp
  score = Math.max(0, Math.min(100, Math.round(score)))

  // Level band
  const level = confidenceLevelFor(score)

  // Positive signals (contributed ≥ 1 pt)
  const positiveSignals: string[] = []
  if (leagueDelta > 0) positiveSignals.push('league_context')
  if (sourceDelta > 0) positiveSignals.push('data_sources')
  if (linkDelta > 0) positiveSignals.push('source_links')
  if (structDelta > 0) positiveSignals.push('response_structure')
  if (modelDelta > 0) positiveSignals.push('model_confidence')
  if (trackDelta > 0) positiveSignals.push('track_record')
  if (positiveSignals.length === 0) positiveSignals.push('base_policy')

  // Missing signals (would raise score)
  const missingSignals: string[] = []
  if (!signals.hasLeagueContext) missingSignals.push('league scoring settings')
  if (freshness !== 'fresh') missingSignals.push('fresh data sync')
  if (signals.dataSourceCount === 0) missingSignals.push('additional data sources')
  if (!struct.whatDataSays) missingSignals.push('detailed data evidence')
  if (!struct.recommendedAction) missingSignals.push('recommended action from model')

  // Rationale string
  const rationaleFragments: string[] = []
  if (signals.hasLeagueContext) {
    rationaleFragments.push('league context loaded')
  } else {
    rationaleFragments.push('no league context')
  }
  if (freshness === 'fresh') {
    rationaleFragments.push('data is fresh')
  } else if (freshness === 'partial') {
    rationaleFragments.push('data freshness is limited')
  } else if (freshness === 'stale') {
    rationaleFragments.push('data is stale — treat advice with caution')
  }
  if (signals.dataSourceCount > 0) {
    rationaleFragments.push(`${signals.dataSourceCount} data source${signals.dataSourceCount > 1 ? 's' : ''} referenced`)
  }
  if (struct.whatDataSays && struct.whatItMeans) {
    rationaleFragments.push('full structured reasoning available')
  } else if (struct.shortAnswer) {
    rationaleFragments.push('partial structure available')
  }
  if (modelDelta !== 0) {
    rationaleFragments.push(
      modelDelta > 0
        ? `model-reported confidence raised score by ${modelDelta}`
        : `model-reported confidence lowered score by ${Math.abs(modelDelta)}`
    )
  }
  if (band && trackDelta !== 0) {
    rationaleFragments.push(
      `past calls at this confidence were right ${Math.round(band.observedRate * 100)}% of the time ` +
        `(${band.n} checked), so the score was ${trackDelta > 0 ? 'raised' : 'lowered'} by ${Math.abs(trackDelta)}`,
    )
  }

  const rationale = rationaleFragments.length > 0
    ? rationaleFragments.join('; ') + '.'
    : 'Confidence based on available context signals.'

  return {
    score,
    level,
    rationale,
    freshness,
    positiveSignals,
    missingSignals,
    leagueContext,
    breakdown,
  }
}

// ---------------------------------------------------------------------------
// Build a ChimmyConfidenceBlock from rubric result + data sources
// ---------------------------------------------------------------------------

export function buildConfidenceBlockFromRubric(
  result: ChimmyConfidenceRubricResult,
  dataSources: string[],
): ChimmyConfidenceBlock {
  return {
    level: result.level,
    rationale: result.rationale,
    freshness: result.freshness,
    basedOn: result.positiveSignals.length > 0
      ? result.positiveSignals
      : dataSources.length > 0
        ? dataSources.slice(0, 4)
        : ['base_policy'],
    missing: result.missingSignals,
    leagueContext: result.leagueContext,
  }
}
