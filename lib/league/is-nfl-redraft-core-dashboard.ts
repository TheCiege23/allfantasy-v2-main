import type { UserLeague } from '@/app/dashboard/types'
import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope'
import { isNativePlatform } from '@/lib/dashboard/platform-label'

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

/**
 * Whether the league's CURRENT WEEK lives on its `RedraftSeason` row, so the league shell must load
 * that row to know it.
 *
 * 🛑 THE SHELL LOADED IT FOR FOOTBALL REDRAFT ONLY. `RedraftSeason` is the season row every league
 * that plays on AllFantasy hangs off, in every sport and format. Gated on the football redraft shell
 * alone, an NBA redraft league and every dynasty league never learned their week: League Home read
 * "Week —", and the "What's next?" card dropped the week and read "Is underway" (seen in a browser on
 * the re-walk, 2026-11-19). An imported league keeps its week in its provider settings and is not
 * given a season row to read, so it is left to that.
 */
export function leagueWeekIsOnSeasonRow(league: NflRedraftCoreLeagueShape & { platform?: string | null }): boolean {
  return isNflRedraftCoreDashboardLeague(league) || isNativePlatform(league.platform)
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

/** `isRedraftFormatLeague` for a client `UserLeague`, any sport: which leagues get the one simple redraft League home. */
export function isRedraftFormatUserLeague(league: UserLeague): boolean {
  return isRedraftFormatLeague({
    leagueType: league.leagueType ?? null,
    isDynasty: league.isDynasty ?? false,
    leagueVariant: league.leagueVariant ?? null,
    bestBallMode: league.bestBallMode ?? false,
    guillotineMode: league.guillotineMode ?? false,
    keeperPhaseActive: league.keeperPhaseActive ?? false,
  })
}
