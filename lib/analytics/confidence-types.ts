export type TrustState = 'high' | 'medium' | 'learning'

export interface TrustData {
  state: TrustState
  score: number
  riskChips: TrustRiskChip[]
  explanation: string
  dataSources?: DataSource[]
  knownUnknowns?: string[]
  improvementHints?: string[]
}

export interface TrustRiskChip {
  tag: string
  label: string
  category: 'age' | 'injury' | 'market' | 'role' | 'coaching' | 'pick' | 'depth' | 'schedule' | 'trend' | 'data' | 'other'
  tooltip: string
}

export interface DataSource {
  name: string
  icon: 'history' | 'market' | 'league' | 'dna' | 'news' | 'excel' | 'api'
  available: boolean
}

export interface TrustTimelinePoint {
  label: string
  score: number
  phase: 'before' | 'after' | 'longterm'
  date?: string
}

export type GuardianBehavior = 'strong' | 'advisory' | 'informational'

const TAG_TO_CATEGORY: Record<string, TrustRiskChip['category']> = {
  aging_asset: 'age',
  rb_cliff: 'age',
  injury_risk: 'injury',
  thin_market: 'market',
  high_value_swing: 'market',
  role_uncertainty: 'role',
  qb_dependency: 'role',
  position_scarcity: 'market',
  future_pick_variance: 'pick',
  consolidation_risk: 'depth',
  rookie_unknown: 'data',
  schedule_volatility: 'schedule',
  low_data: 'data',
  small_sample: 'data',
  negative_trend: 'trend',
}

const TAG_TOOLTIPS: Record<string, string> = {
  aging_asset: 'Player is 30+ years old — value decline is likely.',
  rb_cliff: 'Running back aged 27+ — historical cliff in production.',
  injury_risk: 'Active injury concern detected.',
  thin_market: 'Limited free agent pool in this league.',
  high_value_swing: 'Asset value has been volatile recently.',
  role_uncertainty: 'Snap share or role is not secured.',
  qb_dependency: 'Value depends heavily on quarterback situation.',
  position_scarcity: 'Few quality options at this position.',
  future_pick_variance: 'Future picks carry inherent uncertainty.',
  consolidation_risk: 'Combining many assets into fewer — depth risk.',
  rookie_unknown: 'Limited NFL data available for this player.',
  schedule_volatility: 'Upcoming schedule may impact production.',
  low_data: 'Insufficient historical data for confident analysis.',
  small_sample: 'Analysis based on limited sample size.',
  negative_trend: 'Recent performance trending downward.',
}

const TAG_LABELS: Record<string, string> = {
  aging_asset: 'Age',
  rb_cliff: 'RB Cliff',
  injury_risk: 'Injury',
  thin_market: 'Market',
  high_value_swing: 'Volatility',
  role_uncertainty: 'Role',
  qb_dependency: 'QB Dep.',
  position_scarcity: 'Scarcity',
  future_pick_variance: 'Pick',
  consolidation_risk: 'Depth',
  rookie_unknown: 'Rookie',
  schedule_volatility: 'Schedule',
  low_data: 'Low Data',
  small_sample: 'Sample',
  negative_trend: 'Trend',
}

function confidenceLevelToTrustState(level: 'high' | 'learning' | 'evolving'): TrustState {
  if (level === 'high') return 'high'
  if (level === 'evolving') return 'medium'
  return 'learning'
}

function mapRiskTagToChip(tag: string): TrustRiskChip {
  return {
    tag,
    label: TAG_LABELS[tag] || tag.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    category: TAG_TO_CATEGORY[tag] || 'other',
    tooltip: TAG_TOOLTIPS[tag] || `Risk factor: ${tag.replace(/_/g, ' ')}`,
  }
}

export function getGuardianBehavior(state: TrustState): GuardianBehavior {
  if (state === 'high') return 'strong'
  if (state === 'medium') return 'advisory'
  return 'informational'
}

export function buildDataSources(params: {
  hasHistorical?: boolean
  hasMarket?: boolean
  hasLeagueContext?: boolean
  hasDNA?: boolean
  hasNews?: boolean
  hasExcel?: boolean
  hasAPI?: boolean
}): DataSource[] {
  const sources: DataSource[] = [
    { name: 'Historical Values', icon: 'history' as const, available: params.hasHistorical ?? false },
    { name: 'Market Pricing', icon: 'market' as const, available: params.hasMarket ?? false },
    { name: 'League Context', icon: 'league' as const, available: params.hasLeagueContext ?? false },
    { name: 'Manager DNA', icon: 'dna' as const, available: params.hasDNA ?? false },
  ]
  return sources
}

function buildImprovementHints(state: TrustState, riskTags: string[]): string[] {
  const hints: string[] = []
  if (state === 'learning') {
    hints.push('More historical trade data would improve accuracy.')
    hints.push('Playing more seasons helps the AI learn your patterns.')
  }
  if (state === 'medium') {
    hints.push('Simulating outcomes can help clarify edge cases.')
  }
  if (riskTags.includes('low_data') || riskTags.includes('small_sample')) {
    hints.push('Additional league data would strengthen this analysis.')
  }
  if (riskTags.includes('rookie_unknown')) {
    hints.push('Rookie values stabilize after first NFL snaps — revisit mid-season.')
  }
  return hints
}

function buildKnownUnknowns(riskTags: string[]): string[] {
  const unknowns: string[] = []
  if (riskTags.includes('injury_risk')) unknowns.push('Injury timeline and recovery trajectory.')
  if (riskTags.includes('role_uncertainty')) unknowns.push('Final depth chart and snap share allocation.')
  if (riskTags.includes('rookie_unknown')) unknowns.push('How rookie talent translates to NFL production.')
  if (riskTags.includes('schedule_volatility')) unknowns.push('Strength of upcoming schedule matchups.')
  if (riskTags.includes('qb_dependency')) unknowns.push('Quarterback situation stability.')
  if (riskTags.includes('future_pick_variance')) unknowns.push('Where future draft picks will land.')
  return unknowns
}

export function convertConfidenceRiskToTrustData(
  data: {
    confidence: number
    level: 'high' | 'learning' | 'evolving'
    volatility: 'Low' | 'Medium' | 'High'
    volatilityScore?: number
    riskProfile: 'low' | 'moderate' | 'high' | 'extreme'
    riskTags: string[]
    explanation: string
  }
): TrustData {
  const state = confidenceLevelToTrustState(data.level)
  return {
    state,
    score: data.confidence,
    riskChips: data.riskTags.map(mapRiskTagToChip),
    explanation: data.explanation,
    knownUnknowns: buildKnownUnknowns(data.riskTags),
    improvementHints: buildImprovementHints(state, data.riskTags),
  }
}
