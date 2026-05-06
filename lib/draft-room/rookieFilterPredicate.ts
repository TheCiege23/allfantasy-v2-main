/**
 * Pure predicates for the "Rookies Only" / "Vets Only" draft pool filters.
 *
 * Rookie rules:
 * - Explicit `isRookie === true` always wins.
 * - `yearsExp === 0` means rookie when experience data is available.
 * - Devy/C2C rows remain rookie while not graduated.
 * - Non-football sports get conservative inference from available metadata.
 *
 * Vet rules:
 * - Explicit rookie marker beats vet classification.
 * - `yearsExp >= 1` means veteran.
 * - Graduated devy rows count as vets only when not explicitly rookie.
 * - Unknown rows stay excluded from both filters.
 */

export type DraftSportForRookieInference =
  | 'NFL'
  | 'NCAAF'
  | 'NBA'
  | 'NCAAB'
  | 'MLB'
  | 'NHL'
  | 'SOCCER'
  | string

export type RookieFilterCandidate = {
  sport?: DraftSportForRookieInference | null
  isRookie?: boolean
  yearsExp?: number | null
  isDevy?: boolean
  graduatedToNFL?: boolean
  draftYear?: number | string | null
  rookieYear?: number | string | null
  debutYear?: number | string | null
  firstSeasonYear?: number | string | null
  age?: number | string | null
  classYear?: string | null
  /** Legacy alias (PlayerEntry / DraftRoomRookiePlayerLike use this name). */
  classYearLabel?: string | null
  collegeClass?: string | null
  playerClass?: string | null
}

export type VetFilterCandidate = {
  isRookie?: boolean
  yearsExp?: number | null
  isDevy?: boolean
  graduatedToNFL?: boolean
}

const CURRENT_SEASON_YEAR = new Date().getFullYear()

function finiteNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizedSport(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function normalizedClassLabel(player: RookieFilterCandidate): string {
  return String(
    player.classYear ??
      player.classYearLabel ??
      player.collegeClass ??
      player.playerClass ??
      '',
  )
    .trim()
    .toLowerCase()
}

function hasFreshmanClassLabel(player: RookieFilterCandidate): boolean {
  const label = normalizedClassLabel(player)
  return (
    label === 'rookie' ||
    label === 'fr' ||
    label === 'freshman' ||
    label === 'true freshman' ||
    label === 'redshirt freshman' ||
    label === 'r-fr' ||
    label === 'rs-fr'
  )
}

function hasCurrentDraftYear(player: RookieFilterCandidate): boolean {
  const year = finiteNumber(player.draftYear ?? player.rookieYear)
  return year === CURRENT_SEASON_YEAR
}

function hasCurrentDebutYear(player: RookieFilterCandidate): boolean {
  const year = finiteNumber(player.debutYear ?? player.firstSeasonYear)
  return year === CURRENT_SEASON_YEAR
}

function inferNonFootballRookie(player: RookieFilterCandidate): boolean {
  const sport = normalizedSport(player.sport)
  const age = finiteNumber(player.age)

  switch (sport) {
    case 'NBA':
      return hasCurrentDraftYear(player)

    case 'NCAAB':
      return hasFreshmanClassLabel(player)

    case 'MLB':
      return hasCurrentDebutYear(player)

    case 'NHL':
      return hasCurrentDraftYear(player) || (age != null && age <= 20)

    case 'SOCCER':
      return hasCurrentDebutYear(player) || (age != null && age <= 19)

    default:
      return false
  }
}

export function isRookieEligibleForFilter(
  player: RookieFilterCandidate,
  options?: { devyEnabled?: boolean; c2cEnabled?: boolean },
): boolean {
  if (player.isRookie === true) return true

  if (player.yearsExp != null && Number.isFinite(Number(player.yearsExp))) {
    return Number(player.yearsExp) === 0
  }

  if (options?.devyEnabled || options?.c2cEnabled) {
    if (player.isDevy === true && player.graduatedToNFL !== true) return true
    if (hasFreshmanClassLabel(player)) return true
  }

  return inferNonFootballRookie(player)
}

export function isVetEligibleForFilter(player: VetFilterCandidate): boolean {
  if (player.isRookie === true) return false

  if (player.yearsExp != null && Number.isFinite(Number(player.yearsExp))) {
    return Number(player.yearsExp) >= 1
  }

  if (player.isDevy === true && player.graduatedToNFL === true) return true

  return false
}
