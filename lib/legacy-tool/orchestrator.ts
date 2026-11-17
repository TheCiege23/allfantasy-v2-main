import type { LegacyOrchestratorPlan, LegacyPriority, LegacyTaskType } from '@/lib/legacy-tool/contracts'

const KEYWORD_TASK_MAP: Array<{ keywords: string[]; task: LegacyTaskType }> = [
  { keywords: ['trade', 'counter', 'offer'], task: 'trade_analysis' },
  { keywords: ['waiver', 'faab', 'claim'], task: 'waiver_analysis' },
  { keywords: ['add/drop', 'add drop', 'drop'], task: 'add_drop_analysis' },
  { keywords: ['lineup', 'start', 'sit'], task: 'lineup_optimization' },
  { keywords: ['draft', 'pick', 'rookie'], task: 'draft_pick' },
  { keywords: ['rank', 'tier', 'power'], task: 'ranking_explanation' },
  { keywords: ['strategy', 'rebuild', 'contend', 'window'], task: 'roster_strategy' },
  { keywords: ['collusion', 'fairness', 'commissioner', 'veto'], task: 'league_fairness_review' },
  { keywords: ['alert', 'notify', 'notification'], task: 'notification_generation' },
]

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((k) => text.includes(k))
}

function inferTaskTypesFromText(input?: string | null): LegacyTaskType[] {
  const text = (input || '').toLowerCase()
  const matches = KEYWORD_TASK_MAP.filter((row) => includesAny(text, row.keywords)).map((row) => row.task)
  if (matches.length > 0) return [...new Set(matches)]
  return ['ranking_explanation', 'roster_strategy']
}

export function buildLegacyOrchestratorPlan(args: {
  requestText?: string | null
  hasLeagueContext: boolean
  hasRosterContext: boolean
  hasPlayerStates: boolean
  hasTeamStates: boolean
  needsGrokOverlay?: boolean
  needsSimulation?: boolean
  needsCommissionerAlertCheck?: boolean
  priority?: LegacyPriority
}): LegacyOrchestratorPlan {
  const taskTypes = inferTaskTypesFromText(args.requestText)

  const requiredContext = new Set<string>()
  if (args.hasLeagueContext) requiredContext.add('league_context')
  if (args.hasRosterContext) requiredContext.add('roster_context_team_a')
  if (args.hasPlayerStates) requiredContext.add('player_states')
  if (args.hasTeamStates) requiredContext.add('team_states')

  const engines = new Set<string>(['coaching-engine'])
  if (taskTypes.some((t) => t === 'trade_analysis' || t === 'trade_counter')) engines.add('trade-engine')
  if (taskTypes.some((t) => t === 'waiver_analysis' || t === 'add_drop_analysis')) engines.add('waiver-engine')
  if (taskTypes.some((t) => t === 'lineup_optimization' || t === 'start_sit')) engines.add('lineup-engine')
  if (taskTypes.includes('draft_pick')) engines.add('draft-engine')
  if (taskTypes.includes('ranking_explanation') || taskTypes.includes('roster_strategy')) engines.add('ranking-engine')
  if (taskTypes.some((t) => t === 'league_fairness_review' || t === 'commissioner_review' || t === 'admin_risk_review')) {
    engines.add('league-intelligence')
  }

  return {
    task_types: taskTypes,
    required_context: [...requiredContext],
    engines: [...engines],
    priority: args.priority || 'medium',
    needs_grok_overlay: Boolean(args.needsGrokOverlay),
    needs_simulation: Boolean(args.needsSimulation),
    needs_commissioner_alert_check: Boolean(args.needsCommissionerAlertCheck),
  }
}
