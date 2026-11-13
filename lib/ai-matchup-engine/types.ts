/**
 * AllFantasy AI Matchup & Start/Sit — response contracts (all sports).
 * Providers synthesize from deterministic context only; no invented stats.
 */

type AiProviderStatus = 'ok' | 'error' | 'skipped'

export type LeagueMatchupAiResult = {
  summary: string
  edge: {
    side: 'left' | 'right' | 'even'
    confidencePct: number
    headline: string
  }
  keyPlayers: Array<{ name: string; note: string }>
  upsetProbability: number
  xFactors: string[]
  scenarios: {
    ifNeedFloor: string
    ifNeedUpside: string
  }
  winProbabilityNotes: string
  dataNotes: string
  providers: {
    openai: AiProviderStatus
    deepseek: AiProviderStatus
    grok: AiProviderStatus
  }
}

export type StartSitAiResult = {
  recommendation: 'playerA' | 'playerB' | 'even'
  confidencePct: number
  reasoning: {
    matchup: string
    usage: string
    injuries: string
    weather: string
  }
  playerOutlook: {
    playerA: { restOfGame: string; volatility: 'low' | 'medium' | 'high'; trend: 'hot' | 'cold' | 'neutral' }
    playerB: { restOfGame: string; volatility: 'low' | 'medium' | 'high'; trend: 'hot' | 'cold' | 'neutral' }
  }
  scenarios: {
    ifNeedFloor: string
    ifNeedUpside: string
  }
  winProbabilityInfluence: string
  dataNotes: string
  providers: {
    openai: AiProviderStatus
    deepseek: AiProviderStatus
    grok: AiProviderStatus
  }
}
