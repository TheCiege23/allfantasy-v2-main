/**
 * Sleeper's player map carries entries that are not players: an id Sleeper retired as a duplicate
 * of another ("Duplicate Player", or "<real name> DUPLICATE"), and ids it voided ("Player Invalid").
 * They keep a position, sometimes a club, an age and an Inactive status, so nothing else about them
 * looks wrong.
 *
 * Measured on production 2026-11-17: 98 such `SportsPlayer` rows, all `source: 'sleeper'`:
 * NFL 25 "Duplicate Player" (7 still on a club) and 60 "Player Invalid"; NBA 7 "Duplicate Player"
 * and 6 "<name> DUPLICATE". `refreshSleeperPlayerRows` created and re-named them every 6 hours, and
 * the draft pool read them like any other row.
 *
 * Matched on the name only, on purpose: it is the one field Sleeper uses to mark them, and the
 * patterns are exact enough that no real player matches (a real surname is never the uppercase
 * word DUPLICATE or the phrase "Player Invalid").
 */
const PLACEHOLDER_NAME = /^(duplicate player|player invalid)$/i
const DUPLICATE_SUFFIX = /\sDUPLICATE$/

export function isSleeperPlaceholderName(name: string | null | undefined): boolean {
  const n = typeof name === 'string' ? name.trim() : ''
  if (!n) return false
  return PLACEHOLDER_NAME.test(n) || DUPLICATE_SUFFIX.test(n)
}
