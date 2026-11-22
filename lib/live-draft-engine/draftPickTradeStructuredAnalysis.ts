/**
 * Deterministic redraft/snake-aware trade cues for pick-swap preview (overall from board order).
 * Complements narrative AI; does not replace pick ownership validation.
 */

type TradeMoveDirection = 'up' | 'down' | 'neutral'
type TradeFairnessBand = 'favorable' | 'balanced' | 'costly'
type TradeGuidanceTone = 'good_move' | 'okay_move' | 'risky_move'

type DraftPickTradeStructuredAnalysis = {
  overallDelta: number | null
  moveDirection: TradeMoveDirection
  fairnessBand: TradeFairnessBand
  guidanceTone: TradeGuidanceTone
  fairnessLabel:
    | 'strong_value'
    | 'slight_edge_you'
    | 'neutral'
    | 'slight_edge_them'
    | 'overpay'
}

export function buildDraftPickTradeStructuredAnalysis(input: {
  giveOverall: number | null
  receiveOverall: number | null
  teamCount: number
}): DraftPickTradeStructuredAnalysis {
  const tc = Math.max(2, Number(input.teamCount) || 12)
  const g = input.giveOverall
  const r = input.receiveOverall
  if (g == null || r == null || !Number.isFinite(g) || !Number.isFinite(r)) {
    return {
      overallDelta: null,
      moveDirection: 'neutral',
      fairnessBand: 'balanced',
      guidanceTone: 'okay_move',
      fairnessLabel: 'neutral',
    }
  }
  const delta = r - g
  let moveDirection: TradeMoveDirection = 'neutral'
  if (delta < 0) moveDirection = 'up'
  else if (delta > 0) moveDirection = 'down'

  const abs = Math.abs(delta)
  let fairnessBand: TradeFairnessBand = 'balanced'
  if (delta < 0) {
    if (abs >= tc * 2) fairnessBand = 'favorable'
    else if (abs <= Math.max(2, Math.floor(tc / 4))) fairnessBand = 'balanced'
    else fairnessBand = 'favorable'
  } else if (delta > 0) {
    if (abs >= tc * 2) fairnessBand = 'costly'
    else if (abs <= Math.max(2, Math.floor(tc / 4))) fairnessBand = 'balanced'
    else fairnessBand = 'costly'
  }

  let fairnessLabel: DraftPickTradeStructuredAnalysis['fairnessLabel'] = 'neutral'
  if (delta <= -Math.max(3, Math.floor(tc / 3))) fairnessLabel = 'strong_value'
  else if (delta < 0) fairnessLabel = 'slight_edge_you'
  else if (delta >= tc * 2) fairnessLabel = 'overpay'
  else if (delta > Math.max(3, Math.floor(tc / 3))) fairnessLabel = 'slight_edge_them'
  else fairnessLabel = 'neutral'

  let guidanceTone: TradeGuidanceTone = 'okay_move'
  if (fairnessBand === 'favorable' || fairnessLabel === 'strong_value') guidanceTone = 'good_move'
  else if (fairnessBand === 'costly' || fairnessLabel === 'overpay') guidanceTone = 'risky_move'

  return {
    overallDelta: delta,
    moveDirection,
    fairnessBand,
    guidanceTone,
    fairnessLabel,
  }
}
