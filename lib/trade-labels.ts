type TradeLabel = {
  id: string
  name: string
  type: 'positive' | 'warning' | 'neutral'
  emoji: string
  description: string
}

const TRADE_LABELS: Record<string, TradeLabel> = {
  ELITE_ASSET_THEFT: {
    id: 'elite_asset_theft',
    name: 'Elite Asset Theft',
    type: 'positive',
    emoji: '🟣',
    description: 'You acquired a top-tier cornerstone at a significant discount.'
  },
  TIER_JUMP_WIN: {
    id: 'tier_jump_win',
    name: 'Tier Jump Win',
    type: 'positive',
    emoji: '🟢',
    description: 'You upgraded into a higher dynasty tier.'
  },
  POSITIONAL_ARBITRAGE: {
    id: 'positional_arbitrage',
    name: 'Positional Arbitrage',
    type: 'positive',
    emoji: '🔵',
    description: 'You converted fragile RB value into long-term assets.'
  },
  SMART_CONSOLIDATION: {
    id: 'smart_consolidation',
    name: 'Smart Consolidation',
    type: 'positive',
    emoji: '🟡',
    description: 'You consolidated depth into a premium asset.'
  },
  OVERPAY_RISK: {
    id: 'overpay_risk',
    name: 'Overpay Risk',
    type: 'warning',
    emoji: '🔥',
    description: 'You paid premium future capital without gaining value.'
  },
  PICK_BURN: {
    id: 'pick_burn',
    name: 'Pick Burn',
    type: 'warning',
    emoji: '⚠️',
    description: 'A 1st-round pick was used without upgrading tiers.'
  },
  RB_VALUE_TRAP: {
    id: 'rb_value_trap',
    name: 'RB Value Trap',
    type: 'warning',
    emoji: '🧨',
    description: 'You paid future capital for a volatile RB asset.'
  },
  FALSE_FAIRNESS: {
    id: 'false_fairness',
    name: 'False Fairness',
    type: 'warning',
    emoji: '❄️',
    description: 'Trade looks fair now but likely loses value over time.'
  }
}

interface AssetValueRef {
  marketValue: number
  impactValue: number
  vorpValue: number
  volatility: number
}

export interface TradeAsset {
  name: string
  position?: string
  age?: number
  tier?: 'Elite' | 'Tier1' | 'Tier2' | 'Tier3' | 'Tier4' | 'Depth'
  value?: number
  assetValue?: AssetValueRef
  isPick?: boolean
  pickRound?: number
  pickYear?: number
}

interface TradeLabelsInput {
  givenAssets: TradeAsset[]
  receivedAssets: TradeAsset[]
  fairnessScore: number
  givenValue: number
  receivedValue: number
}

function getHighestTier(assets: TradeAsset[]): string | null {
  const tierOrder = ['Elite', 'Tier1', 'Tier2', 'Tier3', 'Tier4', 'Depth']
  let highestTier: string | null = null
  let highestIdx = Infinity
  
  for (const asset of assets) {
    if (asset.tier) {
      const idx = tierOrder.indexOf(asset.tier)
      if (idx >= 0 && idx < highestIdx) {
        highestIdx = idx
        highestTier = asset.tier
      }
    }
  }
  return highestTier
}

function hasTierJump(given: TradeAsset[], received: TradeAsset[]): boolean {
  const tierOrder = ['Elite', 'Tier1', 'Tier2', 'Tier3', 'Tier4', 'Depth']
  const givenHighest = getHighestTier(given)
  const receivedHighest = getHighestTier(received)
  
  if (!givenHighest || !receivedHighest) return false
  
  const givenIdx = tierOrder.indexOf(givenHighest)
  const receivedIdx = tierOrder.indexOf(receivedHighest)
  
  return receivedIdx < givenIdx
}

function hasFirstRoundPick(assets: TradeAsset[]): boolean {
  return assets.some(a => a.isPick && a.pickRound === 1)
}

function getAverageAge(assets: TradeAsset[]): number {
  const playersWithAge = assets.filter(a => !a.isPick && a.age)
  if (playersWithAge.length === 0) return 0
  return playersWithAge.reduce((sum, a) => sum + (a.age || 0), 0) / playersWithAge.length
}

function hasPosition(assets: TradeAsset[], pos: string): boolean {
  return assets.some(a => a.position?.toUpperCase() === pos.toUpperCase())
}

export function detectTradeLabels(input: TradeLabelsInput): TradeLabel[] {
  const labels: TradeLabel[] = []
  const { givenAssets, receivedAssets, fairnessScore } = input
  
  const receivedHighestTier = getHighestTier(receivedAssets)
  const tierJump = hasTierJump(givenAssets, receivedAssets)
  const included1st = hasFirstRoundPick(givenAssets)
  const givenAvgAge = getAverageAge(givenAssets)
  const receivedAvgAge = getAverageAge(receivedAssets)
  
  if (receivedHighestTier === 'Elite' && fairnessScore >= 70) {
    labels.push(TRADE_LABELS.ELITE_ASSET_THEFT)
  }
  
  if (tierJump && fairnessScore >= 52) {
    labels.push(TRADE_LABELS.TIER_JUMP_WIN)
  }
  
  const gaveRB = hasPosition(givenAssets, 'RB')
  const receivedWRorTE = hasPosition(receivedAssets, 'WR') || hasPosition(receivedAssets, 'TE')
  const ageDelta = givenAvgAge - receivedAvgAge
  if (gaveRB && receivedWRorTE && ageDelta >= 2) {
    labels.push(TRADE_LABELS.POSITIONAL_ARBITRAGE)
  }
  
  const playersGiven = givenAssets.filter(a => !a.isPick).length + givenAssets.filter(a => a.isPick).length
  const playersReceived = receivedAssets.filter(a => !a.isPick).length + receivedAssets.filter(a => a.isPick).length
  if (playersGiven >= 3 && playersReceived === 1 && fairnessScore >= 50) {
    labels.push(TRADE_LABELS.SMART_CONSOLIDATION)
  }
  
  if (included1st && fairnessScore < 45) {
    labels.push(TRADE_LABELS.OVERPAY_RISK)
  }
  
  if (included1st && !tierJump) {
    labels.push(TRADE_LABELS.PICK_BURN)
  }
  
  const receivedRB = receivedAssets.find(a => a.position?.toUpperCase() === 'RB')
  if (receivedRB && (receivedRB.age || 0) >= 25 && included1st) {
    labels.push(TRADE_LABELS.RB_VALUE_TRAP)
  }
  
  const ageLoss = receivedAvgAge - givenAvgAge
  if (fairnessScore >= 45 && fairnessScore <= 55 && ageLoss >= 3) {
    labels.push(TRADE_LABELS.FALSE_FAIRNESS)
  }
  
  return labels
}

export function getPositiveLabels(labels: TradeLabel[]): TradeLabel[] {
  return labels.filter(l => l.type === 'positive')
}

export function getWarningLabels(labels: TradeLabel[]): TradeLabel[] {
  return labels.filter(l => l.type === 'warning')
}
