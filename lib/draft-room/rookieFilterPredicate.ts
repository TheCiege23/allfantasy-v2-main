/**
 * D.7 — pure predicates for the "Rookies Only" / "Vets Only" draft pool
 * filters.
 *
 * Lives in `lib/draft-room/` rather than the PlayerPanel component so tests
 * (and any future server-side filter, e.g. autopick rookie targeting) can
 * import it without pulling React + the heavy PlayerPanel render tree
 * through Vitest's transformer.
 *
 * Rules (rookies):
 *  - NFL redraft/dynasty: include when `isRookie === true` OR `yearsExp === 0`.
 *  - Devy/C2C: also include `isDevy` rows and college class-year labels.
 *  - Otherwise (plain redraft when neither devy nor c2c is enabled, or pool
 *    rows missing rookie metadata): exclude.
 *
 * Rules (vets — Commit N):
 *  - NFL redraft/dynasty: include when `yearsExp` is a finite number ≥ 1.
 *  - Devy/C2C-graduated: include rows where `graduatedToNFL === true` and
 *    `isDevy` is also set (a former devy who has played a pro season).
 *  - Otherwise (no rookie metadata, no vet evidence): exclude — this is the
 *    "Vet data unavailable" state.
 *  - Rookies are never vets. The two predicates are designed to be mutually
 *    exclusive when both signals are present, but vet status is intentionally
 *    *evidence-required* rather than a simple negation of rookie so that
 *    rows missing all metadata don't get accidentally counted as vets.
 */

import { isDraftRoomRookie, type DraftRoomRookiePlayerLike } from '@/lib/draft-room/draftPlayerRookie'

export type RookieFilterCandidate = DraftRoomRookiePlayerLike

export type RookieFilterContext = {
  devyEnabled?: boolean
  c2cEnabled?: boolean
  /** Defaults to NFL when omitted (legacy callers). */
  sport?: string
  seasonYear?: number
  leagueSeasonYear?: number
  draftYear?: number
}

export function isRookieEligibleForFilter(
  player: RookieFilterCandidate,
  options: RookieFilterContext = {},
): boolean {
  return isDraftRoomRookie(player, {
    sport: options.sport ?? 'NFL',
    seasonYear: options.seasonYear,
    leagueSeasonYear: options.leagueSeasonYear,
    draftYear: options.draftYear,
    devyEnabled: options.devyEnabled,
    c2cEnabled: options.c2cEnabled,
  })
}

/**
 * Commit N — companion predicate to `isRookieEligibleForFilter`. Returns
 * true only when there is positive evidence the player has at least one
 * pro season under their belt. Rows missing all yearsExp / graduatedToNFL
 * metadata are excluded so the empty state can surface "Vet data
 * unavailable" instead of accidentally including unknown rows.
 */
export type VetFilterCandidate = {
  isRookie?: boolean
  yearsExp?: number | null
  isDevy?: boolean
  graduatedToNFL?: boolean
}

export function isVetEligibleForFilter(player: VetFilterCandidate): boolean {
  // Explicit rookie marker beats yearsExp — promoted devy rookies in their
  // first NFL season can have yearsExp=0 and isRookie=true; never count
  // those as vets.
  if (player.isRookie === true) return false
  if (player.yearsExp != null && Number.isFinite(Number(player.yearsExp))) {
    return Number(player.yearsExp) >= 1
  }
  // Devy graduates without explicit yearsExp metadata still count as vets.
  if (player.isDevy === true && player.graduatedToNFL === true) return true
  return false
}
