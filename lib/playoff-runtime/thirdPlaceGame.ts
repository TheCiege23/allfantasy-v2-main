/**
 * The commissioner's third-place-game setting: `League.settings.playoff_structure.third_place_game_enabled`.
 *
 * ⚠ ONE READER FOR THE SETTINGS SCREEN AND THE BRACKET. The bracket reads it through
 * `getBracketConfigForLeague` (playoff_structure first, then the top level, then the sport default),
 * so the screen reads it the same way here — a toggle that showed "on" for a league whose bracket
 * would be built without the game is the failure this avoids. The sport default is on for every
 * sport that plays a bracket; a league that stored `false` keeps it off.
 *
 * It is read ONCE, when the bracket is generated: the game exists in the bracket or it does not.
 * Changing it while the playoffs are being played would do nothing, so the save refuses it then.
 */
import { resolveDefaultPlayoffConfig } from '@/lib/sport-defaults/DefaultPlayoffConfigResolver'
import { toSportType } from '@/lib/sport-defaults/sport-type-utils'

export const THIRD_PLACE_GAME_SETTINGS_KEY = 'third_place_game_enabled'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** The stored value, or null when the league never stored one. */
export function readStoredThirdPlaceGame(settings: unknown): boolean | null {
  const s = record(settings)
  const raw = record(s.playoff_structure)[THIRD_PLACE_GAME_SETTINGS_KEY] ?? s[THIRD_PLACE_GAME_SETTINGS_KEY]
  return typeof raw === 'boolean' ? raw : null
}

/** What the bracket will use: the stored value, else the sport default. */
export function readThirdPlaceGameEnabled(settings: unknown, sport: string | null | undefined, variant?: string | null): boolean {
  const stored = readStoredThirdPlaceGame(settings)
  if (stored != null) return stored
  return Boolean(resolveDefaultPlayoffConfig(toSportType(String(sport ?? 'NFL')), variant ?? undefined).third_place_game_enabled)
}
