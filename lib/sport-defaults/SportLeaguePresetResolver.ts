import { getFullLeaguePreset } from './SportLeaguePresetService'
import { getDefaultLeagueSettingsForVariant } from './LeagueDefaultSettingsService'

export interface ResolvedLeaguePreset {
  /** Existing preset (defaults + roster/scoring templates) */
  preset: Awaited<ReturnType<typeof getFullLeaguePreset>>
  /** Full default league settings (playoff, schedule, waiver mode, tiebreakers, lock behavior) */
  defaultLeagueSettings: ReturnType<typeof getDefaultLeagueSettingsForVariant>
  /** Ready-to-store League.settings JSON (sport-specific starting point) */
  initialSettingsJson: Record<string, unknown>
}

