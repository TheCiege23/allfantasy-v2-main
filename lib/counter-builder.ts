import { acceptanceProbability, type AcceptanceFeatures } from './acceptance-model'

export interface TradeShape {
  features: AcceptanceFeatures
  sideAValue: number
  sideBValue: number
}

export interface Sweetener {
  type: 'PICK' | 'PLAYER' | 'FAAB'
  name: string
  value: number
  round?: number
  year?: number
  position?: string
}

export interface CounterOption {
  sweetener: Sweetener
  acceptProb: number
  champDelta: number
  valueCost: number
  score: number
  explanation: string
}

/**
 * Slice 16 honesty pass: `AcceptanceFeatures` fields are now `number | null`
 * (a missing feature is no longer silently 50). A sweetener can only adjust a
 * feature that actually has a value — nudging `null` would re-introduce the
 * fabricated baseline this pass removed, so missing features stay missing.
 */
function bump(value: number | null, delta: number): number | null {
  return value == null ? null : value + delta
}

function addSweetenerToFeatures(
  base: AcceptanceFeatures,
  sweetenerValue: number,
  tradeTotal: number
): AcceptanceFeatures {
  const valueRatio = tradeTotal > 0 ? sweetenerValue / tradeTotal : 0
  return {
    ...base,
    fairnessScore: bump(base.fairnessScore, valueRatio * 2),
    dealShapeScore: bump(base.dealShapeScore, valueRatio * 1.5),
    volatilityDelta:
      base.volatilityDelta == null
        ? null
        : Math.max(0, base.volatilityDelta - valueRatio * 0.5),
  }
}

export interface CounterContext {
  tradeTotal: number
  riskWeight?: number
  champDeltaEstimator?: (sweetenerValue: number) => number
}

export function generateOptimalCounters(
  baseTrade: TradeShape,
  availableSweeteners: Sweetener[],
  context: CounterContext
): CounterOption[] {
  const counters: CounterOption[] = []
  const riskWeight = context.riskWeight ?? 0.3

  for (const sweetener of availableSweeteners) {
    const modifiedFeatures = addSweetenerToFeatures(
      baseTrade.features,
      sweetener.value,
      context.tradeTotal
    )

    const acceptProb = acceptanceProbability(modifiedFeatures)

    const champDelta = context.champDeltaEstimator
      ? context.champDeltaEstimator(sweetener.value)
      : estimateChampDelta(sweetener.value, context.tradeTotal)

    const valueLoss = sweetener.value / Math.max(1, context.tradeTotal)
    const score = acceptProb * champDelta - valueLoss * riskWeight

    const explanation = buildExplanation(sweetener, acceptProb, champDelta, valueLoss)

    counters.push({
      sweetener,
      acceptProb: Math.round(acceptProb * 1000) / 1000,
      champDelta: Math.round(champDelta * 1000) / 1000,
      valueCost: Math.round(valueLoss * 1000) / 1000,
      score: Math.round(score * 1000) / 1000,
      explanation,
    })
  }

  return counters.sort((a, b) => b.score - a.score).slice(0, 3)
}

function estimateChampDelta(sweetenerValue: number, tradeTotal: number): number {
  const impact = tradeTotal > 0 ? sweetenerValue / tradeTotal : 0
  return impact * 0.15
}

function buildExplanation(
  sweetener: Sweetener,
  acceptProb: number,
  champDelta: number,
  valueLoss: number
): string {
  const probLabel = acceptProb >= 0.6 ? 'likely accepted' : acceptProb >= 0.35 ? 'moderate chance' : 'tough sell'
  const costLabel = valueLoss >= 0.3 ? 'significant cost' : valueLoss >= 0.15 ? 'moderate cost' : 'minimal cost'

  if (sweetener.type === 'PICK') {
    return `Adding ${sweetener.name} (${probLabel}, ${costLabel}) improves championship odds by ${(champDelta * 100).toFixed(1)}%`
  }
  if (sweetener.type === 'FAAB') {
    return `Adding $${sweetener.value} FAAB (${probLabel}, ${costLabel}) — low-cost sweetener`
  }
  return `Adding ${sweetener.name} (${probLabel}, ${costLabel}) shifts championship odds by ${(champDelta * 100).toFixed(1)}%`
}

export function buildAvailableSweeteners(
  benchPlayers: Array<{ name: string; value: number; position: string }>,
  availablePicks: Array<{ round: number; year: number; value: number }>,
  faabRemaining: number
): Sweetener[] {
  const sweeteners: Sweetener[] = []

  for (const player of benchPlayers.slice(0, 8)) {
    sweeteners.push({
      type: 'PLAYER',
      name: player.name,
      value: player.value,
      position: player.position,
    })
  }

  for (const pick of availablePicks) {
    sweeteners.push({
      type: 'PICK',
      name: `${pick.year} Round ${pick.round}`,
      value: pick.value,
      round: pick.round,
      year: pick.year,
    })
  }

  if (faabRemaining > 0) {
    const faabSteps = [
      Math.round(faabRemaining * 0.1),
      Math.round(faabRemaining * 0.25),
      Math.round(faabRemaining * 0.5),
    ].filter(v => v > 0)

    for (const amount of faabSteps) {
      sweeteners.push({
        type: 'FAAB',
        name: `$${amount} FAAB`,
        value: amount,
      })
    }
  }

  return sweeteners
}
