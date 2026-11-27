/**
 * The commissioner's "place keepers on the draft board automatically" switch. PURE, client-safe.
 *
 * Stored in `League.settings` (no column, no migration). AF Commissioner / AF Supreme to turn on
 * (./keeperRuleGate); the placement itself re-checks the commissioner's plan every run
 * (./keeperAutoBoard), so a lapsed plan falls back to the manual flow rather than keeping the feature.
 */

export const KEEPER_AUTO_BOARD_SETTING = 'keeper_auto_place_board'

export function readKeeperAutoBoard(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false
  return (settings as Record<string, unknown>)[KEEPER_AUTO_BOARD_SETTING] === true
}
