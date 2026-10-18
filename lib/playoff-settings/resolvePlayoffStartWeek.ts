/**
 * The ONE reader for a native league's playoff start week.
 *
 * The commissioner's quick "Playoff start week" field is the source of truth: it writes the
 * `League.playoffStartWeek` column and executeLeagueSettingsPatch → syncCommissionerDerivedLeagueState
 * mirrors it into the settings JSON (`playoff_structure.playoff_start_week`,
 * `playoffSettings.playoffStartWeek`, `playoffStartWeek`) and the stage editor's
 * `playoff_config_data`. Order: the column, then those JSON copies, then the sport default — and
 * the sport default only when the league has no chosen week at all.
 *
 * The stage/bracket editor used to compute the start week from the sport default and write it over
 * the chosen week (`settings.playoffStartWeek`). It now reads the week from here and never sets it.
 *
 * Pure (no prisma), so the client editor and the server route share it.
 */
import { resolveDefaultPlayoffConfig } from '@/lib/sport-defaults/DefaultPlayoffConfigResolver'
import type { SportType } from '@/lib/sport-defaults/types'

export type PlayoffStartWeekLeague = {
  playoffStartWeek?: number | null
  settings?: unknown
  sport?: string | null
  leagueVariant?: string | null
}

export type PlayoffStartWeekSource = 'column' | 'settings' | 'sport_default'

function positiveWeek(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** The commissioner's chosen week (column, then the JSON copies), or null when none was ever set. */
export function readChosenPlayoffStartWeek(league: PlayoffStartWeekLeague): number | null {
  const column = positiveWeek(league.playoffStartWeek)
  if (column != null) return column
  const settings = record(league.settings) ?? {}
  return (
    positiveWeek(record(settings.playoff_structure)?.playoff_start_week) ??
    positiveWeek(record(settings.playoffSettings)?.playoffStartWeek) ??
    positiveWeek(settings.playoffStartWeek)
  )
}

/** The sport/variant default start week — only for a league with no chosen week. */
export function sportDefaultPlayoffStartWeek(sport: string | null | undefined, variant?: string | null): number {
  const defaults = resolveDefaultPlayoffConfig(String(sport || 'NFL').toUpperCase() as SportType, variant)
  return defaults.playoff_start_week ?? 15
}

export function resolvePlayoffStartWeek(league: PlayoffStartWeekLeague): { week: number; source: PlayoffStartWeekSource } {
  const column = positiveWeek(league.playoffStartWeek)
  if (column != null) return { week: column, source: 'column' }
  const chosen = readChosenPlayoffStartWeek(league)
  if (chosen != null) return { week: chosen, source: 'settings' }
  return { week: sportDefaultPlayoffStartWeek(league.sport, league.leagueVariant), source: 'sport_default' }
}
