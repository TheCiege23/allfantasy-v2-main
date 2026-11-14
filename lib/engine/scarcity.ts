export interface PositionalScarcity {
  position: string
  replacementLevel: number
  scarcityMultiplier: number
  availableStarters: number
  tier: 'abundant' | 'balanced' | 'scarce' | 'desert'
}

