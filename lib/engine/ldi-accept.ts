import type { EngineManagerProfile, ArchetypeId, TeamPhase } from './types'
import type { PositionalScarcity } from './scarcity'
import { archetypeAcceptanceModifier } from './archetypes'

interface LDIAcceptInput {
  sender: EngineManagerProfile
  receiver: EngineManagerProfile
  senderArchetype: ArchetypeId
  receiverArchetype: ArchetypeId
  offeredPositions: string[]
  requestedPositions: string[]
  fairnessScore: number
  scarcity: Record<string, PositionalScarcity>
}

export interface LDIAcceptResult {
  probability: number
  drivers: AcceptDriver[]
  counterRequired: boolean
  explanation: string
}

interface AcceptDriver {
  id: string
  label: string
  impact: number
  direction: 'positive' | 'negative' | 'neutral'
}

export function computeLDIAcceptance(input: LDIAcceptInput): LDIAcceptResult {
  const drivers: AcceptDriver[] = []
  let baseProbability = 0.45

  const fairnessImpact = (input.fairnessScore - 50) * 0.008
  baseProbability += fairnessImpact
  drivers.push({
    id: 'fairness',
    label: 'Trade Fairness',
    impact: Math.round(fairnessImpact * 100) / 100,
    direction: fairnessImpact >= 0 ? 'positive' : 'negative',
  })

  let needsImpact = 0
  for (const pos of input.offeredPositions) {
    if (input.receiver.needs.includes(pos)) {
      needsImpact += 0.06
    }
  }
  for (const pos of input.requestedPositions) {
    if (!input.receiver.surplus.includes(pos)) {
      needsImpact -= 0.04
    }
  }
  baseProbability += needsImpact
  if (Math.abs(needsImpact) > 0.01) {
    drivers.push({
      id: 'needs_fit',
      label: 'Needs Alignment',
      impact: Math.round(needsImpact * 100) / 100,
      direction: needsImpact >= 0 ? 'positive' : 'negative',
    })
  }

  let scarcityImpact = 0
  for (const pos of input.offeredPositions) {
    const sc = input.scarcity[pos]
    if (sc && (sc.tier === 'scarce' || sc.tier === 'desert')) {
      scarcityImpact += 0.04
    }
  }
  for (const pos of input.requestedPositions) {
    const sc = input.scarcity[pos]
    if (sc && (sc.tier === 'scarce' || sc.tier === 'desert')) {
      scarcityImpact -= 0.03
    }
  }
  baseProbability += scarcityImpact
  if (Math.abs(scarcityImpact) > 0.01) {
    drivers.push({
      id: 'scarcity',
      label: 'Positional Scarcity',
      impact: Math.round(scarcityImpact * 100) / 100,
      direction: scarcityImpact >= 0 ? 'positive' : 'negative',
    })
  }

  const archetypeMod = archetypeAcceptanceModifier(input.senderArchetype, input.receiverArchetype)
  baseProbability += archetypeMod
  if (Math.abs(archetypeMod) > 0.01) {
    drivers.push({
      id: 'archetype',
      label: 'Manager Archetype Match',
      impact: archetypeMod,
      direction: archetypeMod >= 0 ? 'positive' : 'negative',
    })
  }

  const phaseMod = phaseCompatibilityModifier(input.sender.phase, input.receiver.phase)
  baseProbability += phaseMod
  if (Math.abs(phaseMod) > 0.01) {
    drivers.push({
      id: 'phase',
      label: 'Team Direction Alignment',
      impact: phaseMod,
      direction: phaseMod >= 0 ? 'positive' : 'negative',
    })
  }

  const probability = Math.max(0.05, Math.min(0.95, baseProbability))

  const topPositive = drivers.filter(d => d.direction === 'positive').sort((a, b) => b.impact - a.impact)[0]
  const topNegative = drivers.filter(d => d.direction === 'negative').sort((a, b) => a.impact - b.impact)[0]

  let explanation = `Acceptance probability: ${Math.round(probability * 100)}%.`
  if (topPositive) explanation += ` Main positive: ${topPositive.label}.`
  if (topNegative) explanation += ` Main concern: ${topNegative.label}.`

  return {
    probability: Math.round(probability * 1000) / 1000,
    drivers,
    counterRequired: probability < 0.25,
    explanation,
  }
}

function phaseCompatibilityModifier(senderPhase: TeamPhase, receiverPhase: TeamPhase): number {
  if (senderPhase === 'contender' && receiverPhase === 'rebuild') return 0.08
  if (senderPhase === 'rebuild' && receiverPhase === 'contender') return 0.06
  if (senderPhase === receiverPhase) return -0.02
  return 0
}
