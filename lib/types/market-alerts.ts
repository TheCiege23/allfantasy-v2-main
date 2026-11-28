export type MarketSignal = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL'

export interface MarketAlert {
  id: string
  name: string
  position: string
  team: string | null
  signal: MarketSignal
  signalStrength: number
  category: 'nfl' | 'devy'
  dynastyValue: number
  trend30Day: number
  trendPercent: number
  rank: number
  positionRank: number
  volatility: number | null
  sleeperId: string | null
  school: string | null
  classYear: number | null
  projectedRound: number | null
  headline: string
  reasoning: string
  tags: string[]
  updatedAt: string
}

export interface MarketAlertResponse {
  alerts: MarketAlert[]
  summary: {
    totalAlerts: number
    strongBuys: number
    buys: number
    sells: number
    strongSells: number
    topMover: string | null
    marketSentiment: 'bullish' | 'bearish' | 'neutral'
  }
  generatedAt: string
  /**
   * Set when Chimmy's headlines were NOT written for this response (2026-11-28): the signals are public, the
   * model write-up needs sign-in and has a daily cap. `message` says what to do next.
   */
  narrativesWithheld?: { reason: 'sign_in' | 'daily' | 'rate' | 'plan'; message: string; upgradePath?: string | null }
}
