import type { SettingsSubPageId } from '@/lib/league-settings-home/buildLeagueSettingsHome'

/** Header title of each League Settings sub-page. */
export const SUB_PAGE_TITLES: Record<SettingsSubPageId, string> = {
  general: 'League settings',
  format: 'League format',
  roster: 'Roster settings',
  scoring: 'Scoring settings',
  draft: 'Draft settings',
  waivers: 'Waivers',
  trades: 'Trades',
  'guillotine-first-chop': 'First chop week',
  'guillotine-chop-rules': 'Chop rules',
  'guillotine-rules': 'League rules',
  'pirate-rules': 'Pirate rules',
  playoffs: 'Playoff settings',
  members: 'Managers',
  'co-commissioners': 'Co-commissioners',
  divisions: 'Divisions',
  ai: 'League AI',
  'commissioner-tools': 'Commissioner tools',
  'settings-lock': 'Settings lock',
  'score-adjustments': 'Score adjustments',
  'survivor-tribes': 'Survivor tribes',
}
