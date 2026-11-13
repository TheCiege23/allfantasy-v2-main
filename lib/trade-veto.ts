import { TradeAsset } from './trade-labels'

export interface VetoResult {
  veto: boolean
  vetoReason: string | null
  warning: boolean
  warningText: string | null
}

export interface VetoInput {
  givenAssets: TradeAsset[]
  receivedAssets: TradeAsset[]
  fairnessScore: number
  leagueType: '1QB' | 'SF' | '2QB'
  hasTierJump: boolean
}

function hasFirstRoundPick(assets: TradeAsset[]): boolean {
  return assets.some(a => a.isPick && a.pickRound === 1)
}

function getOldestReceivedPlayer(assets: TradeAsset[]): TradeAsset | null {
  const players = assets.filter(a => !a.isPick && a.age)
  if (players.length === 0) return null
  return players.reduce((oldest, p) => (p.age || 0) > (oldest.age || 0) ? p : oldest)
}

function getAverageAge(assets: TradeAsset[]): number {
  const playersWithAge = assets.filter(a => !a.isPick && a.age)
  if (playersWithAge.length === 0) return 0
  return playersWithAge.reduce((sum, a) => sum + (a.age || 0), 0) / playersWithAge.length
}

export function evaluateVeto(input: VetoInput): VetoResult {
  const { givenAssets, receivedAssets, fairnessScore, leagueType, hasTierJump } = input
  
  const included1st = hasFirstRoundPick(givenAssets)
  const receivedRB = receivedAssets.find(a => a.position?.toUpperCase() === 'RB')
  const receivedQB = receivedAssets.find(a => a.position?.toUpperCase() === 'QB')
  const oldestReceived = getOldestReceivedPlayer(receivedAssets)
  const receivedAvgAge = getAverageAge(receivedAssets)
  const givenAvgAge = getAverageAge(givenAssets)
  
  if (included1st && !hasTierJump && fairnessScore <= 52) {
    return {
      veto: true,
      vetoReason: 'First-round pick used without upgrading tiers',
      warning: false,
      warningText: null
    }
  }
  
  if (receivedRB && (receivedRB.age || 0) >= 26 && included1st) {
    return {
      veto: true,
      vetoReason: 'High-risk RB investment with premium capital',
      warning: false,
      warningText: null
    }
  }
  
  if (oldestReceived && (oldestReceived.age || 0) >= 27 && fairnessScore < 55) {
    return {
      veto: true,
      vetoReason: 'Short-term gain with long-term value loss',
      warning: false,
      warningText: null
    }
  }
  
  if (leagueType === '1QB' && receivedQB && fairnessScore < 55) {
    return {
      veto: true,
      vetoReason: 'QB value inflated in 1QB formats',
      warning: false,
      warningText: null
    }
  }
  
  const ageLoss = receivedAvgAge - givenAvgAge
  if (fairnessScore >= 45 && fairnessScore <= 55 && ageLoss >= 2) {
    return {
      veto: false,
      vetoReason: null,
      warning: true,
      warningText: 'Fair trade, but long-term value may decline within 12-18 months.'
    }
  }
  
  if (included1st && fairnessScore >= 47 && fairnessScore <= 53) {
    return {
      veto: false,
      vetoReason: null,
      warning: true,
      warningText: 'Draft capital used in a break-even trade - consider if the tier upgrade justifies the cost.'
    }
  }
  
  return {
    veto: false,
    vetoReason: null,
    warning: false,
    warningText: null
  }
}

