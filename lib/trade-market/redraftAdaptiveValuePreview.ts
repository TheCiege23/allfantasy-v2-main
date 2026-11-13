/**
 * T6 — Adaptive AllFantasy player value PREVIEW. Pure, deterministic, READ-ONLY. Derives a small
 * demand/friction-weighted preview adjustment around a real observed `baseValue` from completed
 * trade-market data. NEVER mutates canonical values (SportsPlayer / projections / ADP / T2 snapshots),
 * no AI, no external calls, no recommendations. See docs/trade-adaptive-value-preview-t6.md.
 */

const PREVIEW_MIN_SAMPLE = 3
export const PREVIEW_MAX_ADJUSTMENT = 15
const PREVIEW_CONFIDENCE_MIN = 40
const PER_UNIT = 1.5
const RECENT_WINDOW_DAYS = 30

type PreviewDirection = 'rising' | 'falling' | 'stable' | 'insufficient'

/** One per-proposal observation for a player (deduped by proposalId upstream). */
export interface PreviewObservation {
  terminal: 'accepted' | 'rejected' | 'vetoed' | 'canceled' | 'expired' | 'pending'
  observedValue: number | null
  confidenceScore: number | null
  createdAt: string | Date
}

interface AdaptiveValuePreview {
  playerId: string
  playerName: string | null
  position: string | null
  baseValue: number | null
  marketPreviewValue: number | null
  adjustmentPercent: number
  adjustmentPoints: number
  confidence: number
  sampleSize: number
  acceptedTradeCount: number
  rejectedSignalCount: number
  vetoedSignalCount: number
  recentTradeCount: number
  direction: PreviewDirection
  reasons: string[]
  generatedAt: string
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}
function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2)
}

export function computeAdaptiveValuePreview(input: {
  playerId: string
  playerName?: string | null
  position?: string | null
  observations: PreviewObservation[]
}): AdaptiveValuePreview {
  const generatedAt = new Date().toISOString()
  const withValue = input.observations.filter((o) => typeof o.observedValue === 'number')
  const sampleSize = withValue.length

  const accepted = input.observations.filter((o) => o.terminal === 'accepted')
  const rejected = input.observations.filter((o) => o.terminal === 'rejected' || o.terminal === 'canceled' || o.terminal === 'expired')
  const vetoed = input.observations.filter((o) => o.terminal === 'vetoed')
  const cutoff = Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const recentTradeCount = input.observations.filter((o) => new Date(o.createdAt).getTime() >= cutoff).length

  const base = {
    playerId: input.playerId,
    playerName: input.playerName ?? null,
    position: input.position ?? null,
    acceptedTradeCount: accepted.length,
    rejectedSignalCount: rejected.length,
    vetoedSignalCount: vetoed.length,
    recentTradeCount,
    generatedAt,
  }

  const baseValue = median(withValue.map((o) => o.observedValue as number))

  // Insufficient sample (or no observed values) ⇒ no adjustment, no market claim.
  if (sampleSize < PREVIEW_MIN_SAMPLE || baseValue == null) {
    return {
      ...base,
      baseValue,
      marketPreviewValue: baseValue,
      adjustmentPercent: 0,
      adjustmentPoints: 0,
      confidence: 0,
      sampleSize,
      direction: 'insufficient',
      reasons: ['Not enough AllFantasy trade history yet to adjust this player'],
    }
  }

  const avgSnapConfidence =
    withValue.reduce((s, o) => s + (o.confidenceScore ?? 0), 0) / Math.max(withValue.length, 1)

  const confidence = clamp(
    Math.round(40 + 8 * accepted.length + 0.3 * avgSnapConfidence - 12 * vetoed.length - 4 * rejected.length),
    0,
    100,
  )

  const tierCap = sampleSize < 10 ? 5 : sampleSize < 25 ? 10 : 15
  const recencyMult = clamp(0.8 + 0.2 * (recentTradeCount / Math.max(sampleSize, 1)), 0.8, 1.0)
  const rawSignal = accepted.length - 0.5 * rejected.length - 1.0 * vetoed.length

  const reasons: string[] = []
  let adjustmentPercent = 0
  if (confidence < PREVIEW_CONFIDENCE_MIN) {
    reasons.push('Confidence too low to adjust — preview held at base value')
  } else {
    adjustmentPercent = clamp(
      clamp(rawSignal * PER_UNIT * (confidence / 100) * recencyMult, -tierCap, tierCap),
      -PREVIEW_MAX_ADJUSTMENT,
      PREVIEW_MAX_ADJUSTMENT,
    )
    adjustmentPercent = Math.round(adjustmentPercent * 10) / 10
    reasons.push(`Based on ${accepted.length} completed trade${accepted.length === 1 ? '' : 's'} (sample ${sampleSize})`)
    if (vetoed.length || rejected.length) reasons.push('Vetoes/rejections reduced the signal')
    if (sampleSize < 10) reasons.push('Limited sample — adjustment capped')
  }

  const marketPreviewValue = Math.round(baseValue * (1 + adjustmentPercent / 100))
  const adjustmentPoints = marketPreviewValue - baseValue
  const direction: PreviewDirection =
    adjustmentPercent > 0.5 ? 'rising' : adjustmentPercent < -0.5 ? 'falling' : 'stable'

  return {
    ...base,
    baseValue,
    marketPreviewValue,
    adjustmentPercent,
    adjustmentPoints,
    confidence,
    sampleSize,
    direction,
    reasons,
  }
}
