import type { CreateLeagueV2State } from '@/lib/create-league-v2/state'

export const UNIVERSAL_CREATE_TEAM_COUNTS: readonly number[] = Array.from(
  { length: 31 },
  (_, index) => index + 2,
)

export const CREATE_LEAGUE_TIMEZONES: readonly string[] = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
]

export type ImportProviderState = 'available' | 'limited_beta' | 'coming_soon'

export type ImportProviderOption = {
  id: 'sleeper' | 'espn' | 'fantrax' | 'yahoo' | 'mfl' | 'manual'
  label: string
  state: ImportProviderState
  route?: string
}

export const IMPORT_LEAGUE_PROVIDERS: readonly ImportProviderOption[] = [
  { id: 'sleeper', label: 'Sleeper', state: 'available', route: '/import?provider=sleeper' },
  { id: 'espn', label: 'ESPN', state: 'limited_beta', route: '/api/import-espn' },
  { id: 'fantrax', label: 'Fantrax', state: 'limited_beta', route: '/api/league/import/fantrax/preview' },
  { id: 'yahoo', label: 'Yahoo', state: 'limited_beta', route: '/api/league/yahoo-auth' },
  { id: 'mfl', label: 'MFL', state: 'limited_beta', route: '/api/mfl/import' },
  { id: 'manual', label: 'Other/manual', state: 'coming_soon' },
]

export const PREMIUM_ADVANCED_CREATE_KEYS = [
  'customScoring',
  'superflex',
  'tePremium',
  'idp',
  'customWaiverRules',
  'customPlayoffRules',
  'advancedDraftRules',
  'aiCommissionerTools',
  'tradeApprovalAutomation',
  'leagueHealthMonitoring',
] as const

export type PremiumAdvancedCreateKey = (typeof PREMIUM_ADVANCED_CREATE_KEYS)[number]

export type PremiumAdvancedCreateState = Partial<Record<PremiumAdvancedCreateKey, boolean>>

export const PREMIUM_ADVANCED_CREATE_LABELS: Record<PremiumAdvancedCreateKey, string> = {
  customScoring: 'Custom scoring',
  superflex: 'Superflex',
  tePremium: 'TE Premium',
  idp: 'IDP',
  customWaiverRules: 'Custom waiver rules',
  customPlayoffRules: 'Custom playoff rules',
  advancedDraftRules: 'Advanced draft rules',
  aiCommissionerTools: 'AI Commissioner tools',
  tradeApprovalAutomation: 'Trade approval automation',
  leagueHealthMonitoring: 'League health monitoring',
}

export function isUniversalTeamCount(value: number): boolean {
  return Number.isInteger(value) && value >= 2 && value <= 32
}

export function getEnabledPremiumAdvancedSettings(
  advancedSetup: PremiumAdvancedCreateState | null | undefined,
): PremiumAdvancedCreateKey[] {
  if (!advancedSetup) return []
  return PREMIUM_ADVANCED_CREATE_KEYS.filter((key) => advancedSetup[key] === true)
}

export function validateSimpleCreateState(state: CreateLeagueV2State): string[] {
  const issues: string[] = []
  if (!state.leagueType) issues.push('Choose a league type.')
  if (!state.sport) issues.push('Choose a sport.')
  if (!state.name.trim() || state.name.trim().length < 3) issues.push('Enter a league name.')
  if (!isUniversalTeamCount(state.teamCount)) issues.push('Team count must be from 2 through 32.')
  if (state.privacy !== 'public' && state.privacy !== 'private') issues.push('Choose public or private.')
  if (!state.draftType) issues.push('Choose a draft type.')
  if (!state.draftDate.trim()) issues.push('Choose a draft date.')
  if (!state.draftTime.trim()) issues.push('Choose a draft time.')
  if (!state.timezone.trim()) issues.push('Choose a timezone.')
  if (!state.scoringPresetId.trim()) issues.push('Choose a scoring preset.')
  return issues
}
