/**
 * Build DeterministicContextEnvelope from TradeDecisionContextV1.
 * Used by trade analyzer so AI receives structured evidence, confidence, uncertainty, missing data.
 */

import type { TradeDecisionContextV1 } from '@/lib/trade-engine/trade-decision-context'
import { buildDeterministicIntelligence } from '@/lib/trade-engine/deterministic-intelligence'
import type { EvidenceBlock, EvidenceItem, Confidence, UncertaintyBlock, MissingDataBlock } from '../schema'

function formatVal(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`
  return v.toFixed(0)
}

/**
 * Build evidence block from trade context (deterministic only).
 */
export function buildTradeEvidenceBlock(ctx: TradeDecisionContextV1): EvidenceBlock {
  const items: EvidenceItem[] = []

  items.push({
    source: 'trade_engine',
    label: 'Value delta (favored side)',
    value: `${ctx.valueDelta.favoredSide} (${ctx.valueDelta.percentageDiff}% gap)`,
  })
  items.push({
    source: 'trade_engine',
    label: 'Side A total value',
    value: formatVal(ctx.sideA.totalValue),
  })
  items.push({
    source: 'trade_engine',
    label: 'Side B total value',
    value: formatVal(ctx.sideB.totalValue),
  })
  items.push({
    source: 'trade_engine',
    label: 'Assets covered',
    value: `${ctx.dataQuality.assetsCovered}/${ctx.dataQuality.assetsTotal} (${ctx.dataQuality.coveragePercent}%)`,
    unit: '',
  })
  if (ctx.dataQuality.adpHitRate != null) {
    items.push({
      source: 'trade_engine',
      label: 'ADP data coverage',
      value: ctx.dataQuality.adpHitRate,
      unit: '%',
    })
  }

  const det = buildDeterministicIntelligence(ctx)
  items.push({
    source: 'trade_engine',
    label: 'Deterministic confidence',
    value: det.confidence,
    unit: '%',
  })

  return {
    toolId: 'trade_analyzer',
    items,
    summaryForAI: `Value: Side ${ctx.valueDelta.favoredSide} ${ctx.valueDelta.percentageDiff}%. Coverage ${ctx.dataQuality.coveragePercent}%. Confidence ${det.confidence}%.`,
  }
}

/**
 * Build confidence from trade context; cap when data is missing.
 */
export function buildTradeConfidence(ctx: TradeDecisionContextV1): Confidence {
  const det = buildDeterministicIntelligence(ctx)
  const capped =
    ctx.dataQuality.coveragePercent < 70 ||
    ctx.missingData.valuationsMissing.length > 0 ||
    ctx.missingData.adpMissing.length > 0
  const label = det.confidence >= 70 ? 'high' : det.confidence >= 45 ? 'medium' : 'low'
  return {
    scorePct: det.confidence,
    label,
    reason: ctx.dataQuality.warnings?.[0] ?? (capped ? 'Limited data coverage' : undefined),
    cappedByData: capped,
    capReason: capped
      ? [
          ctx.dataQuality.coveragePercent < 70 && `Coverage ${ctx.dataQuality.coveragePercent}%`,
          ctx.missingData.valuationsMissing.length > 0 && 'Missing valuations',
          ctx.missingData.adpMissing.length > 0 && 'Missing ADP',
        ]
          .filter(Boolean)
          .join('; ')
      : undefined,
  }
}

/**
 * Build uncertainty block from trade context.
 */
export function buildTradeUncertainty(ctx: TradeDecisionContextV1): UncertaintyBlock {
  const items: UncertaintyBlock['items'] = []

  if (ctx.missingData.valuationsMissing.length > 0) {
    items.push({
      what: `Market valuation for: ${ctx.missingData.valuationsMissing.slice(0, 3).join(', ')}${ctx.missingData.valuationsMissing.length > 3 ? '…' : ''}`,
      impact: ctx.missingData.valuationsMissing.length > 2 ? 'high' : 'medium',
      reason: 'Values are estimated or missing.',
    })
  }
  if (ctx.missingData.adpMissing.length > 0) {
    items.push({
      what: `ADP data for ${ctx.missingData.adpMissing.length} asset(s)`,
      impact: 'medium',
      reason: 'Draft position value is uncertain.',
    })
  }
  if (ctx.missingData.injuryDataStale) {
    items.push({
      what: 'Injury status',
      impact: 'medium',
      reason: 'Injury data may be stale.',
    })
  }
  if (ctx.missingData.tradeHistoryInsufficient) {
    items.push({
      what: 'League trade history',
      impact: 'low',
      reason: 'Limited trade history for acceptance estimate.',
    })
  }

  return {
    items,
    summaryForAI: items.length ? items.map((i) => i.what).join('; ') : undefined,
  }
}

/**
 * Build missing-data block from trade context.
 */
export function buildTradeMissingData(ctx: TradeDecisionContextV1): MissingDataBlock {
  const items: MissingDataBlock['items'] = []

  for (const name of ctx.missingData.valuationsMissing.slice(0, 5)) {
    items.push({
      what: `Market valuation for ${name}`,
      impact: 'high',
      suggestedAction: 'Add player to roster or check spelling for valuation.',
    })
  }
  for (const name of ctx.missingData.adpMissing.slice(0, 3)) {
    items.push({
      what: `ADP for ${name}`,
      impact: 'medium',
      suggestedAction: 'Draft board position may be estimated.',
    })
  }
  if (ctx.missingData.analyticsMissing.length > 0) {
    items.push({
      what: `Analytics for ${ctx.missingData.analyticsMissing.slice(0, 2).join(', ')}${ctx.missingData.analyticsMissing.length > 2 ? '…' : ''}`,
      impact: 'medium',
    })
  }

  return {
    items,
    summaryForAI: items.length ? items.map((i) => i.what).join('; ') : undefined,
  }
}

