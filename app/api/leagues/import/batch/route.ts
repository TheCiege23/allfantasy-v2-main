import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { calculateAndSaveRank } from '@/lib/rank/calculateRank'
import { isLeagueTombstoned } from '@/lib/league-delete/leagueTombstones'
import { runWithConcurrency } from '@/lib/async-utils'
import { SLEEPER_IMPORT_SPORTS, SLEEPER_SPORT_BY_SUPPORTED } from '@/lib/league-import/sleeper/import-sports'
import { normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { getUserLeagues, getLeagueRosters } from '@/lib/sleeper-client'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface LeagueRecord {
  platformLeagueId: string
  name: string
  sport?: string
  season: number
  leagueSize: number
  importWins: number
  importLosses: number
  importTies: number
  importMadePlayoffs: boolean
  importWonChampionship: boolean
  importFinalStanding: number | null
  importPointsFor: number | null
}

type SleeperLeagueApi = {
  league_id?: string
  sport?: string
  name?: string
  total_rosters?: number
  settings?: {
    playoff_teams?: number
    num_teams?: number
  }
}

type SleeperRosterApi = {
  owner_id?: string
  co_owners?: string[]
  settings?: Record<string, unknown>
}

const MIN_ALLOWED_SEASON = 2000
const MAX_ALLOWED_SEASON_BUFFER = 1
const PLATFORM_LEAGUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

const SUPPORTED_BY_SLEEPER_SPORT: Record<string, SupportedSport> = {
  nfl: 'NFL',
  nhl: 'NHL',
  nba: 'NBA',
  mlb: 'MLB',
  mls: 'SOCCER',
  soccer: 'SOCCER',
  epl: 'SOCCER',
}

function toLeagueMapKey(platformLeagueId: string, sleeperSport: string): string {
  return `${platformLeagueId}:${sleeperSport.toLowerCase()}`
}

function toSupportedSportFromSleeperSport(
  sleeperSport: string | null | undefined,
  fallbackSport: string | null | undefined
): SupportedSport {
  const raw = typeof sleeperSport === 'string' ? sleeperSport.trim().toLowerCase() : ''
  if (raw && SUPPORTED_BY_SLEEPER_SPORT[raw]) {
    return SUPPORTED_BY_SLEEPER_SPORT[raw]
  }
  return normalizeToSupportedSport(fallbackSport)
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toIntegerOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (value == null) return null
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? parsed : null
}

function toValidatedSeason(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed)) return null
  const maxSeason = new Date().getFullYear() + MAX_ALLOWED_SEASON_BUFFER
  if (parsed < MIN_ALLOWED_SEASON || parsed > maxSeason) return null
  return parsed
}

function toValidatedPlatformLeagueId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const normalized = String(value).trim()
  if (!normalized) return null
  return PLATFORM_LEAGUE_ID_PATTERN.test(normalized) ? normalized : null
}

export async function POST(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const body = (await req.json().catch(() => ({}))) as {
      season?: number
      leagues?: LeagueRecord[]
      sleeperUserId?: string
      sleeperUsername?: string
      isLastSeason?: boolean
    }

    const { season, leagues, sleeperUserId, sleeperUsername, isLastSeason } = body

    if (season == null || !Array.isArray(leagues)) {
      return NextResponse.json({ error: 'season and leagues required' }, { status: 400 })
    }
    const validatedSeason = toValidatedSeason(season)
    if (validatedSeason == null) {
      return NextResponse.json({ error: 'Invalid season' }, { status: 400 })
    }
    if (leagues.length > 200) {
      return NextResponse.json({ error: 'Too many leagues in one request (max 200)' }, { status: 400 })
    }
    for (const league of leagues) {
      if (!toValidatedPlatformLeagueId(league?.platformLeagueId)) {
        return NextResponse.json({ error: 'Invalid platformLeagueId' }, { status: 400 })
      }
    }

    const sleeperUserIdTrimmed = typeof sleeperUserId === 'string' ? sleeperUserId.trim() : ''
    const sleeperUsernameTrimmed = typeof sleeperUsername === 'string' ? sleeperUsername.trim() : ''
    const existingProfile = await prisma.userProfile
      .findUnique({
        where: { userId },
        select: { sleeperUserId: true },
      })
      .catch(() => null)
    const resolvedSleeperUserId = sleeperUserIdTrimmed || existingProfile?.sleeperUserId?.trim() || ''

    if (!resolvedSleeperUserId) {
      return NextResponse.json({ error: 'sleeperUserId required' }, { status: 400 })
    }

    const rl = consumeRateLimit({
      scope: 'leagues',
      action: 'import_batch',
      sleeperUsername: sleeperUsernameTrimmed || resolvedSleeperUserId,
      ip: getClientIp(req),
      maxRequests: 3,
      windowMs: 60_000,
      includeIpInKey: true,
    })
    if (!rl.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait before importing again.', retryAfterSec: rl.retryAfterSec },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec || 60) } }
      )
    }

    await prisma.userProfile.upsert({
      where: { userId },
      update: {
        sleeperUserId: resolvedSleeperUserId,
        ...(sleeperUsernameTrimmed ? { sleeperUsername: sleeperUsernameTrimmed.toLowerCase() } : {}),
        sleeperLinkedAt: new Date(),
      },
      create: {
        userId,
        sleeperUserId: resolvedSleeperUserId,
        ...(sleeperUsernameTrimmed ? { sleeperUsername: sleeperUsernameTrimmed.toLowerCase() } : {}),
        sleeperLinkedAt: new Date(),
      },
    })

    const leaguesById = new Map<string, SleeperLeagueApi>()
    for (const sleeperSport of SLEEPER_IMPORT_SPORTS) {
      try {
        const sleeperLeagues = await getUserLeagues(resolvedSleeperUserId, sleeperSport, String(validatedSeason)) as unknown as SleeperLeagueApi[]
        if (!Array.isArray(sleeperLeagues)) continue
        for (const row of sleeperLeagues) {
          const leagueId = typeof row?.league_id === 'string' ? row.league_id : ''
          if (!leagueId) continue
          const rowSport = typeof row.sport === 'string' ? row.sport.toLowerCase() : sleeperSport
          leaguesById.set(toLeagueMapKey(leagueId, rowSport), row)
        }
      } catch {
        continue
      }
    }
    const sleeperVerificationUnavailable = leaguesById.size === 0

    const saveResults = await runWithConcurrency(leagues, 8, async (league) => {
      try {
        const platformLeagueId = toValidatedPlatformLeagueId(league.platformLeagueId)
        if (!platformLeagueId) return 0

        const requestedSport =
          typeof league.sport === 'string' ? normalizeToSupportedSport(league.sport) : null
        const requestedSleeperSport = requestedSport
          ? SLEEPER_SPORT_BY_SUPPORTED[requestedSport]
          : null

        let sleeperLeague = requestedSleeperSport
          ? leaguesById.get(toLeagueMapKey(platformLeagueId, requestedSleeperSport))
          : undefined
        if (!sleeperLeague) {
          for (const sleeperSport of SLEEPER_IMPORT_SPORTS) {
            sleeperLeague = leaguesById.get(toLeagueMapKey(platformLeagueId, sleeperSport))
            if (sleeperLeague) break
          }
        }
        if (!sleeperLeague && sleeperVerificationUnavailable) {
          sleeperLeague = {
            league_id: platformLeagueId,
            name: league.name,
            sport: requestedSleeperSport ?? undefined,
            total_rosters: league.leagueSize,
          }
        }
        if (!sleeperLeague) return 0
        const resolvedLeagueSport = toSupportedSportFromSleeperSport(
          typeof sleeperLeague.sport === 'string' ? sleeperLeague.sport : null,
          requestedSport ?? league.sport
        )
        const hintedFinalStanding = toIntegerOrNull(league.importFinalStanding)
        const hintedWins = toNumber(league.importWins, 0)
        const hintedLosses = toNumber(league.importLosses, 0)
        const hintedTies = toNumber(league.importTies, 0)
        const hintedMadePlayoffs =
          typeof league.importMadePlayoffs === 'boolean'
            ? league.importMadePlayoffs
            : hintedFinalStanding != null
              ? hintedFinalStanding <= Math.max(1, Math.ceil((league.leagueSize || 12) / 3))
              : false
        const hintedWonChampionship =
          typeof league.importWonChampionship === 'boolean'
            ? league.importWonChampionship
            : hintedFinalStanding === 1
        const hintedPointsFor =
          league.importPointsFor == null ? null : toNumber(league.importPointsFor, Number.NaN)
        let wins = hintedWins
        let losses = hintedLosses
        let ties = hintedTies
        let finalStanding = hintedFinalStanding
        let madePlayoffs = hintedMadePlayoffs
        let wonChampionship = hintedWonChampionship
        let pf = Number.isFinite(hintedPointsFor) ? hintedPointsFor : null

        const rosters = await getLeagueRosters(platformLeagueId).catch(() => []) as unknown as SleeperRosterApi[]
        const mine = Array.isArray(rosters)
          ? rosters.find((row) => {
              const ownerId = row?.owner_id != null ? String(row.owner_id) : ''
              const coOwners = Array.isArray(row?.co_owners) ? row.co_owners.map(String) : []
              return ownerId === resolvedSleeperUserId || coOwners.includes(resolvedSleeperUserId)
            })
          : null

        const totalTeams =
          typeof sleeperLeague.total_rosters === 'number' && sleeperLeague.total_rosters >= 1
            ? sleeperLeague.total_rosters
            : typeof sleeperLeague.settings?.num_teams === 'number' && sleeperLeague.settings.num_teams >= 1
              ? sleeperLeague.settings.num_teams
              : 12
        const playoffTeams =
          typeof sleeperLeague.settings?.playoff_teams === 'number' && sleeperLeague.settings.playoff_teams >= 1
            ? sleeperLeague.settings.playoff_teams
            : Math.max(1, Math.ceil(totalTeams / 3))

        if (mine) {
          const settings = (mine.settings ?? {}) as Record<string, unknown>
          wins = toNumber(settings.wins, wins)
          losses = toNumber(settings.losses, losses)
          ties = toNumber(settings.ties, ties)
          finalStanding = toIntegerOrNull(settings.final_standing ?? settings.rank) ?? finalStanding
          madePlayoffs = finalStanding != null ? finalStanding <= playoffTeams : madePlayoffs
          wonChampionship = finalStanding === 1
          const fpts = toNumber(settings.fpts, Number.NaN)
          const fptsDecimal = toNumber(settings.fpts_decimal, 0)
          pf = Number.isFinite(fpts) ? fpts + fptsDecimal / 100 : pf
        }

        /*
         * 🛑 SKIP A LEAGUE THE USER DELETED. This is a bare upsert with no
         * existing-row branch at all, so without this it re-creates anything in
         * the payload — and a bulk import is exactly where one unwanted league
         * rides back in unnoticed among dozens of wanted ones.
         *
         * `return 0` rather than `continue`: this is a callback returning a
         * per-league count, not a loop body. Counting it as 0 imported is
         * accurate — nothing was written.
         */
        if (await isLeagueTombstoned({ userId, platform: 'sleeper', platformLeagueId })) {
          return 0
        }

        const leagueImportData = {
          name: sleeperLeague.name ?? league.name,
          sport: resolvedLeagueSport,
          leagueSize: totalTeams,
          importWins: wins,
          importLosses: losses,
          importTies: ties,
          importMadePlayoffs: madePlayoffs,
          importWonChampionship: wonChampionship,
          importFinalStanding: finalStanding,
          importPointsFor: pf,
          importedAt: new Date(),
        }

        await prisma.league.upsert({
          where: {
            userId_platform_platformLeagueId_season: {
              userId,
              platform: 'sleeper',
              platformLeagueId,
              season: validatedSeason,
            },
          },
          update: leagueImportData as any,
          create: {
            userId,
            platform: 'sleeper',
            platformLeagueId,
            season: validatedSeason,
            ...(leagueImportData as any),
          } as any,
        })
        return 1
      } catch (e) {
        console.error(`[import/batch] league ${league.platformLeagueId}:`, e)
        return 0
      }
    })
    const saved = saveResults.reduce<number>((sum, value) => sum + value, 0)

    const rankResult = await calculateAndSaveRank(userId).catch(() => null)

    return NextResponse.json({
      success: true,
      season: validatedSeason,
      saved,
      rankTier: rankResult?.rankTier ?? null,
      xpLevel: rankResult?.xpLevel ?? null,
      xpTotal: rankResult?.xpTotal ?? null,
      isLastSeason: isLastSeason === true,
    })
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err))
    console.error('[import/batch]', e.message, e.stack)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
