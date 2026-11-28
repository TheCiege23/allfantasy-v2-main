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
  // One page since 2026-11-25 (GuillotineRulesPage): the two older ids open it too.
  'guillotine-first-chop': 'Guilly rules',
  'guillotine-chop-rules': 'Guilly rules',
  'guillotine-rules': 'Guilly rules',
  'pirate-rules': 'Pirate rules',
  'af-options': 'AllFantasy options',
  playoffs: 'Playoff settings',
  members: 'Managers',
  'team-settings': 'Team settings',
  'previous-leagues': 'Previous Leagues',
  'co-commissioners': 'Co-commissioners',
  divisions: 'Divisions',
  ai: 'League Chimmy',
  'commissioner-tools': 'Lineups, locks & schedule',
  dues: 'Dues & payouts',
  'settings-lock': 'Settings lock',
  'score-adjustments': 'Score adjustments',
  'survivor-tribes': 'Survivor tribes',
  'delete-league': 'Delete league',
}
