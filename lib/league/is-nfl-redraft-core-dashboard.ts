import type { UserLeague } from '@/app/dashboard/types'
import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope'

/** League-like shape for dashboard gating (Prisma `League` or `UserLeague` subset). */
export type NflRedraftCoreLeagueShape = {
  sport: string
  leagueType?: string | null
  isDynasty?: boolean | null
  leagueVariant?: string | null
  bestBallMode?: boolean | null
  guillotineMode?: boolean | null
  keeperPhaseActive?: boolean | null
}

const SPECIALTY_VARIANTS = new Set([
  'survivor',
  'zombie',
  'big_brother',
  'idp',
  'dynasty_idp',
  'merged_devy_c2c',
  'devy_dynasty',
])

const FOOTBALL_REDRAFT_CORE_SPORTS = new Set(['NFL', 'NCAAF'])

/**
 * True when the league should use the simplified NFL redraft shell (Home / Roster / Matchups / …).
 * Excludes specialty formats, dynasty/keeper/devy/C2C, best ball, guillotine, etc.
 */
export function isNflRedraftCoreDashboardLeague(league: NflRedraftCoreLeagueShape): boolean {
  const sport = normalizeToSupportedSport(String(league.sport)) ?? DEFAULT_SPORT
  if (!FOOTBALL_REDRAFT_CORE_SPORTS.has(sport)) return false
  return isRedraftFormatLeague(league)
}

/**
 * The format half of the gate above, for every sport: `leagueType` is literally `redraft` (an
 * absent type is NOT read as redraft), and no dynasty / best ball / guillotine / keeper flag or
 * specialty variant is set. Split out so the redraft visual identity
 * (lib/league-media/redraftIdentity.ts) classifies a league by the SAME rule as the redraft shell
 * rather than a second copy of it.
 */
export function isRedraftFormatLeague(league: Omit<NflRedraftCoreLeagueShape, 'sport'>): boolean {
  if (league.isDynasty) return false
  if (league.bestBallMode) return false
  if (league.guillotineMode) return false
  if (league.keeperPhaseActive) return false

  const lt = typeof league.leagueType === 'string' ? league.leagueType.trim().toLowerCase() : ''
  if (lt !== 'redraft') return false

  const v = String(league.leagueVariant ?? '').trim().toLowerCase()
  if (v && SPECIALTY_VARIANTS.has(v)) return false

  return true
}

/** Client tabs receive `UserLeague`; mirror Prisma gates using optional fields from `prismaLeagueToUserLeague`. */
export function isNflRedraftCoreDashboardFromUserLeague(league: UserLeague): boolean {
  return isNflRedraftCoreDashboardLeague({
    sport: league.sport,
    leagueType: league.leagueType ?? null,
    isDynasty: league.isDynasty ?? false,
    leagueVariant: league.leagueVariant ?? null,
    bestBallMode: league.bestBallMode ?? false,
    guillotineMode: league.guillotineMode ?? false,
    keeperPhaseActive: league.keeperPhaseActive ?? false,
  })
}
