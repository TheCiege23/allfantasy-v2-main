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

/*
 * 🛑 AN NBA ROOKIE STOPPED BEING A ROOKIE ON JANUARY 1. This used `new Date().getFullYear()`, taken
 * once when the module loaded: the calendar year, not the rookie class. A 2026 draftee (June 2026,
 * rookie season 2026-27) failed `draftYear === year` from Jan 1 2027 — mid rookie season and
 * before the next rookie draft — and a long-running server kept whatever year it booted in.
 *
 * The class year is now resolved per call: the caller's league season when it has one
 * (`seasonYear`, keyed by the year the season begins), otherwise the most recent draft class for
 * the sport. NBA and NHL draft in late June, so before July the latest class is last year's; NCAAB
 * and SOCCER keep their existing label/age rules; MLB debut years are calendar seasons.
 */
const JUNE_DRAFT_SPORTS: ReadonlySet<string> = new Set(['NBA', 'NHL'])

export function rookieClassYear(sport: unknown, now: Date = new Date()): number {
  const year = now.getUTCFullYear()
  if (!JUNE_DRAFT_SPORTS.has(normalizedSport(sport))) return year
  // Months are 0-based: 6 = July, the first month after the June draft.
  return now.getUTCMonth() >= 6 ? year : year - 1
}

type RookieClassContext = { classYear: number }

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

function hasCurrentDraftYear(player: RookieFilterCandidate, ctx: RookieClassContext): boolean {
  const year = finiteNumber(player.draftYear ?? player.rookieYear)
  return year === ctx.classYear
}

function hasCurrentDebutYear(player: RookieFilterCandidate, ctx: RookieClassContext): boolean {
  const year = finiteNumber(player.debutYear ?? player.firstSeasonYear)
  return year === ctx.classYear
}

function inferNonFootballRookie(player: RookieFilterCandidate, ctx: RookieClassContext): boolean {
  const sport = normalizedSport(player.sport)
  const age = finiteNumber(player.age)

  switch (sport) {
    case 'NBA':
      return hasCurrentDraftYear(player, ctx)

    case 'NCAAB':
      return hasFreshmanClassLabel(player)

    case 'MLB':
      return hasCurrentDebutYear(player, ctx)

    case 'NHL':
      return hasCurrentDraftYear(player, ctx) || (age != null && age <= 20)

    case 'SOCCER':
      return hasCurrentDebutYear(player, ctx) || (age != null && age <= 19)

    default:
      return false
  }
}

export function isRookieEligibleForFilter(
  player: RookieFilterCandidate,
  options?: {
    devyEnabled?: boolean
    c2cEnabled?: boolean
    /** The league's season (the year it begins). Wins over the sport's latest draft class. */
    seasonYear?: number | null
    now?: Date
  },
): boolean {
  if (player.isRookie === true) return true

  if (player.yearsExp != null && Number.isFinite(Number(player.yearsExp))) {
    return Number(player.yearsExp) === 0
  }

  if (options?.devyEnabled || options?.c2cEnabled) {
    if (player.isDevy === true && player.graduatedToNFL !== true) return true
    if (hasFreshmanClassLabel(player)) return true
  }

  const seasonYear = finiteNumber(options?.seasonYear)
  const classYear = seasonYear ?? rookieClassYear(player.sport, options?.now)
  return inferNonFootballRookie(player, { classYear })
}

export function isVetEligibleForFilter(player: VetFilterCandidate): boolean {
  if (player.isRookie === true) return false

  if (player.yearsExp != null && Number.isFinite(Number(player.yearsExp))) {
    return Number(player.yearsExp) >= 1
  }

  if (player.isDevy === true && player.graduatedToNFL === true) return true

  return false
}
