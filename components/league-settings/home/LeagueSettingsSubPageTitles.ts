import type { SettingsSubPageId } from '@/lib/league-settings-home/buildLeagueSettingsHome'

/** Header title of each League Settings sub-page. */
export const SUB_PAGE_TITLES: Record<SettingsSubPageId, string> = {
  general: 'General',
  format: 'League format',
  roster: 'Roster positions',
  scoring: 'Scoring',
  draft: 'Draft',
  waivers: 'Waivers',
  trades: 'Trades',
  'guillotine-first-chop': 'First chop week',
  'guillotine-chop-rules': 'Chop rules',
  playoffs: 'Playoffs',
  members: 'Managers',
  'co-commissioners': 'Co-commissioners',
  divisions: 'Divisions',
  ai: 'League AI',
  'commissioner-tools': 'Commissioner tools',
  'score-adjustments': 'Score adjustments',
  'survivor-tribes': 'Survivor tribes',
}
