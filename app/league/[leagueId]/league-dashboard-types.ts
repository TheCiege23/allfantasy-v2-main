/**
 * Client-safe types for league dashboard (settings + standings layout).
 * All IDs are AllFantasy (`League.id`, `LeagueTeam.id`) — never expose platform IDs in UI.
 */

export type LeagueSettingsRow = {
  label: string
  value: string
  /** Renders value with preserved newlines */
  multiline?: boolean
}

export type StandingsPresentation =
  | { mode: 'standard' }
  | {
      mode: 'divisions'
      divisions: { divisionId: string; name: string; tierLevel: number }[]
    }
  | {
      mode: 'guillotine'
      /**
       * AF `LeagueTeam.id` -> danger tier. `chopped` comes only from an imported league, whose chops are read
       * from the provider's scores (lib/guillotine/importedGuillyView.ts `importedGuillyTiers`).
       */
      dangerByTeamId: Record<string, 'chop_zone' | 'danger' | 'safe' | 'chopped'>
    }
  | {
      mode: 'survivor'
      tribes: { tribeId: string; name: string; teamIds: string[] }[]
    }

export type LeagueScoringRow = {
  label: string
  value: string
  /** Differs from template default (points or enabled). */
  highlight: boolean
  valueTone: 'positive' | 'negative' | 'neutral'
}

export type LeagueScoringSection = {
  title: string
  rows: LeagueScoringRow[]
}

export type LeagueScoringDashboardSummary = {
  sport: string
  formatType: string
  templateId: string
  nonStandardCount: number
  sections: LeagueScoringSection[]
}

export type LeagueDashboardView = {
  settingsRows: LeagueSettingsRow[]
  standings: StandingsPresentation
  scoring: LeagueScoringDashboardSummary | null
}
