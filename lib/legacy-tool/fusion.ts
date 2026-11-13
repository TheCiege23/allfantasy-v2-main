import type { GrokCriticalEventType } from '@/lib/legacy-tool/contracts'

const CRITICAL_EVENT_TYPES: ReadonlySet<GrokCriticalEventType> = new Set([
  'injury_update',
  'trade_update',
  'suspension',
  'depth_chart_change',
])

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function resolveGrokAdjustmentCap(args: {
  eventType?: GrokCriticalEventType | null
  eventConfidence?: number | null
}): number {
  const confidence = args.eventConfidence ?? 0
  const eventType = args.eventType ?? null
  if (eventType && CRITICAL_EVENT_TYPES.has(eventType) && confidence >= 0.9) return 20
  return 12
}

export function fuseDecisionScore(args: {
  deepseekStructuredScore: number
  grokLiveOverlayAdjustment: number
  eventType?: GrokCriticalEventType | null
  eventConfidence?: number | null
}): {
  finalScore: number
  cappedGrokAdjustment: number
  grokCap: number
} {
  const cap = resolveGrokAdjustmentCap({
    eventType: args.eventType,
    eventConfidence: args.eventConfidence,
  })

  const cappedGrokAdjustment = clamp(args.grokLiveOverlayAdjustment, -cap, cap)
  const finalScore =
    0.72 * (Number.isFinite(args.deepseekStructuredScore) ? args.deepseekStructuredScore : 0) +
    0.28 * cappedGrokAdjustment

  return {
    finalScore,
    cappedGrokAdjustment,
    grokCap: cap,
  }
}
