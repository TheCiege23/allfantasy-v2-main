import type { StartVsCoachLens } from '@/lib/player-comparison-lab'

/** Context lens tabs — Weekly uses live projection weighting; others use same data with different emphasis copy. */
export type PlayerComparisonTabId =
  | 'weekly'
  | 'ros'
  | 'dynasty'
  | 'draft'
  | 'waiver'
  | 'trade_fit'

type PlayerComparisonLaunchSource =
  | 'draft'
  | 'waiver'
  | 'trade'
  | 'lineup'
  | 'chimmy'
  | 'manual'
  | 'tool_page'

export type OpenPlayerComparisonPayload = {
  playerA: string
  playerB: string
  sport: string
  leagueId?: string | null
  teamId?: string | null
  weekOrPeriod?: string | null
  source?: PlayerComparisonLaunchSource
}

type PlayerComparisonApiBase = {
  playerA: import('@/lib/player-comparison-lab/types').ResolvedPlayerStats
  playerB: import('@/lib/player-comparison-lab/types').ResolvedPlayerStats
  sport: string
  chartSeries: import('@/lib/player-comparison-lab/types').ComparisonChartSeries[]
  summaryLines: string[]
  deterministic: import('@/lib/player-comparison-lab/types').TwoPlayerComparisonDeterministicOutput
  explanation: { source: string; text: string }
  explanationGate?: { requiredPlan: string | null; message: string; upgradePath: string } | null
}

export type PlayerComparisonPremiumSnapshot = PlayerComparisonApiBase & {
  coach_lens: StartVsCoachLens | null
  /** Present when loaded via league start-vs route */
  start_vs_extras?: {
    risk_flags: string[]
    news_flags: string[]
    missing_data: string[]
    actions?: {
      set_lineup: { href: string; label: string }
      compare_again: { href: string; label: string }
      ask_chimmy: { href: string; label: string }
    }
  } | null
}
