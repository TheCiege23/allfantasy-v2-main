import type { ArchetypeId } from './types'

export interface ArchetypeClassification {
  archetype: ArchetypeId
  confidence: number
  signals: string[]
  negotiationTips: string[]
}

export function archetypeAcceptanceModifier(
  senderArchetype: ArchetypeId,
  receiverArchetype: ArchetypeId
): number {
  if (receiverArchetype === 'passive') return -0.15
  if (receiverArchetype === 'hoarder') return -0.10
  if (receiverArchetype === 'shark' && senderArchetype === 'fair_dealer') return -0.05
  if (receiverArchetype === 'gambler') return 0.05
  if (receiverArchetype === 'rebuilder' && senderArchetype === 'win_now') return 0.08
  if (receiverArchetype === 'win_now' && senderArchetype === 'rebuilder') return 0.05
  return 0
}
