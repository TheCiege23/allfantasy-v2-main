/**
 * Rolling Insights documentation coverage registry (per sport).
 */

export type RollingInsightsDocStatus =
  | 'unmapped'
  | 'partial'
  | 'mapped'
  | 'mapped_with_sleeper_rookie_fallback'
  | 'mapped_from_uploaded_doc_partial'

export type RollingInsightsRegistryEntry = {
  sport: 'NFL' | 'NBA' | 'MLB' | 'NHL' | 'NCAABB' | 'NCAAF' | 'SOCCER'
  rollingInsightsSportCode: string
  docUrl: string
  status: RollingInsightsDocStatus
  mappedDomains: readonly string[]
  missingFromDoc: readonly string[]
  rookieFallback?: string
  notes?: string
}

export const ROLLING_INSIGHTS_DOCS_REGISTRY: readonly RollingInsightsRegistryEntry[] = [
  {
    sport: 'NFL',
    rollingInsightsSportCode: 'NFL',
    docUrl: 'docs/provider-docs/rolling-insights/NFL_Documentation_20251202.md',
    status: 'mapped_with_sleeper_rookie_fallback',
    mappedDomains: [
      'schedules',
      'live',
      'team_info',
      'team_stats',
      'player_info',
      'player_stats',
      'injuries',
      'depth_charts',
      'play_by_play',
    ],
    missingFromDoc: ['rookie', 'isRookie', 'yearsExperience', 'experience', 'draftYear'],
    rookieFallback: 'sleeper_years_exp',
    notes: 'NFL RI doc does not document rookie/experience; Sleeper years_exp is operational fallback.',
  },
  {
    sport: 'NBA',
    rollingInsightsSportCode: 'NBA',
    docUrl: 'docs/provider-docs/rolling-insights/NBA_Documentation.md',
    status: 'mapped_from_uploaded_doc_partial',
    mappedDomains: ['schedules', 'live', 'team_info', 'player_stats', 'player_box'],
    missingFromDoc: ['rookie', 'yearsExperience', 'draftYear'],
    notes: 'Live player_box + schedule fields mapped from uploaded doc summary.',
  },
  {
    sport: 'MLB',
    rollingInsightsSportCode: 'MLB',
    docUrl: 'docs/provider-docs/rolling-insights/MLB_Documentation.md',
    status: 'mapped_from_uploaded_doc_partial',
    mappedDomains: ['schedules', 'live', 'team_info', 'batting', 'pitching', 'player_stats'],
    missingFromDoc: ['rookie', 'yearsExperience', 'draftYear'],
    notes: 'Batting/pitching live boxes per upload; no universal rookie field called out.',
  },
  {
    sport: 'NHL',
    rollingInsightsSportCode: 'NHL',
    docUrl: 'docs/provider-docs/rolling-insights/NHL_Documentation.md',
    status: 'mapped_from_uploaded_doc_partial',
    mappedDomains: ['schedules', 'live', 'team_info', 'skaters', 'goalies'],
    missingFromDoc: ['rookie', 'yearsExperience', 'draftYear'],
  },
  {
    sport: 'NCAABB',
    rollingInsightsSportCode: 'NCAABB',
    docUrl: 'docs/provider-docs/rolling-insights/NCAABB_Documentation.md',
    status: 'mapped_from_uploaded_doc_partial',
    mappedDomains: ['schedules', 'live', 'player_box', 'tournament_fields'],
    missingFromDoc: ['rookie', 'yearsExperience', 'draftYear', 'class'],
    notes: 'Use RI path segment NCAABB (not NCAAB) for API calls.',
  },
  {
    sport: 'NCAAF',
    rollingInsightsSportCode: 'NCAAFB',
    docUrl: 'docs/provider-docs/rolling-insights/ncaafb-field-map.md',
    status: 'mapped_from_uploaded_doc_partial',
    mappedDomains: ['schedules', 'live', 'player_info', 'player_stats'],
    missingFromDoc: ['nfl_style_rookie'],
    notes: 'College `class` from RI player-info powers devy/C2C filters; not NFL rookie.',
  },
  {
    sport: 'SOCCER',
    rollingInsightsSportCode: 'SOCCER',
    docUrl: 'docs/provider-docs/rolling-insights/soccer-field-map.md',
    status: 'mapped_from_uploaded_doc_partial',
    mappedDomains: [
      'team_info',
      'schedules',
      'player_info',
      'live',
      'team_stats',
      'team_season_stats',
    ],
    missingFromDoc: [],
    notes: 'Requires `league=EPL|LALIGA|SERIEA` on all SOCCER calls; daily schedule documented as schedule-daily with optional /schedule alias.',
  },
] as const
