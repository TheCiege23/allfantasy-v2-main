import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { DashboardLiveScore } from '@/lib/types/liveScoring'

const SLEEPER_BASE = 'https://api.sleeper.app/v1' // db-first-exception: live scoring reads the platform feed
const SLEEPER_CACHE_PREFIX = 'live-scores-sleeper:v1:'
const SLEEPER_CACHE_TTL_MS = 60_000 // live scores stay fresh; 60s stops per-render hammering
const MAX_SLEEPER_LEAGUES = 10

type WireRoster = {
  roster_id: number
  owner_id: string | null
  settings?: { wins?: number; losses?: number; ties?: number; fpts?: number; fpts_decimal?: number } | null
}
type WireUser = { user_id: string; display_name: string; metadata?: { team_name?: string | null } | null }
type WireMatchup = { roster_id: number; matchup_id: number | null; points: number }

async function j<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SLEEPER_BASE}${path}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/**
 * Real current-week Sleeper scores for every Sleeper league the user is in:
 * my points vs opponent points from `/matchups/{week}` (Sleeper updates these
 * live during games), record + rank from roster settings. Cached 60s per user.
 * Leagues that fail to fetch are simply absent — never zero-filled.
 */
async function sleeperLiveScores(userId: string): Promise<DashboardLiveScore[]> {
  const cacheKey = `${SLEEPER_CACHE_PREFIX}${userId}`
  const now = new Date()
  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey } }).catch(() => null)
  if (cached && cached.expiresAt > now && Array.isArray((cached.data as { scores?: unknown[] })?.scores)) {
    return (cached.data as { scores: DashboardLiveScore[] }).scores
  }

  const profile = await prisma.userProfile
    .findUnique({ where: { userId }, select: { sleeperUserId: true } })
    .catch(() => null)
  const me = profile?.sleeperUserId
  if (!me) return []

  const leagues = await prisma.league.findMany({
    // This query is truncated by `take`, so ordering decides *which* leagues are
    // covered at all - not merely what order they come back in.
    // Stable, total ordering: season and id are non-null and id is unique, so
    // the result set cannot silently reorder between requests. Mirrors
    // lib/dashboard/get-dashboard-league-list.ts so this set lines up with the
    // league list the user actually sees. Deliberately not lastSyncedAt: it is
    // nullable, and Postgres sorts NULLS FIRST on DESC, so never-synced leagues
    // would sort to the top.
    orderBy: [{ season: 'desc' }, { name: 'asc' }, { id: 'asc' }],
    where: {
      platform: 'sleeper',
      platformLeagueId: { not: '' },
      OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }],
    },
    select: { id: true, name: true, platformLeagueId: true },
    take: MAX_SLEEPER_LEAGUES,
  })
  if (leagues.length === 0) return []

  const state = await j<{ week?: number; season_type?: string }>(`/state/nfl`)
  const week = Math.max(1, Number(state?.week ?? 1))

  const scores: DashboardLiveScore[] = []
  await Promise.all(
    leagues.map(async (league) => {
      const sid = league.platformLeagueId as string
      const [rosters, users, matchups] = await Promise.all([
        j<WireRoster[]>(`/league/${sid}/rosters`),
        j<WireUser[]>(`/league/${sid}/users`),
        j<WireMatchup[]>(`/league/${sid}/matchups/${week}`),
      ])
      if (!rosters || !users) return
      const myRoster = rosters.find((r) => r.owner_id === me)
      if (!myRoster) return

      const nameOfOwner = new Map(users.map((u) => [u.user_id, u.metadata?.team_name?.trim() || u.display_name]))
      const mine = matchups?.find((m) => m.roster_id === myRoster.roster_id) ?? null
      const opp =
        mine?.matchup_id != null
          ? matchups?.find((m) => m.matchup_id === mine.matchup_id && m.roster_id !== myRoster.roster_id) ?? null
          : null
      const oppRoster = opp ? rosters.find((r) => r.roster_id === opp.roster_id) ?? null : null

      const fpts = (r: WireRoster) => (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100
      const myWins = myRoster.settings?.wins ?? 0
      const myPF = fpts(myRoster)
      const betterCount = rosters.filter((r) => {
        const w = r.settings?.wins ?? 0
        return w > myWins || (w === myWins && fpts(r) > myPF)
      }).length

      scores.push({
        leagueId: league.id,
        leagueName: league.name ?? 'League',
        sport: 'NFL',
        week,
        myPts: Math.round((mine?.points ?? 0) * 100) / 100,
        oppPts: opp ? Math.round(opp.points * 100) / 100 : null,
        oppTeamName: oppRoster?.owner_id ? nameOfOwner.get(oppRoster.owner_id) ?? null : null,
        myRecord: {
          wins: myWins,
          losses: myRoster.settings?.losses ?? 0,
          ties: myRoster.settings?.ties ?? 0,
        },
        myRank: betterCount + 1,
        totalTeams: rosters.length,
        matchupStatus:
          (mine?.points ?? 0) > 0 || (opp?.points ?? 0) > 0 ? 'in_progress' : mine ? 'scheduled' : 'no_matchup',
      })
    }),
  )

  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey },
      update: { data: { scores } as unknown as object, expiresAt: new Date(now.getTime() + SLEEPER_CACHE_TTL_MS) },
      create: { cacheKey, data: { scores } as unknown as object, expiresAt: new Date(now.getTime() + SLEEPER_CACHE_TTL_MS) },
    })
    .catch(() => null)
  return scores
}

export async function GET() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  // Find all active redraft seasons where the user has a roster.
  const seasons = await prisma.redraftSeason.findMany({
    where: {
      status: 'active',
      rosters: { some: { ownerId: userId } },
    },
    select: {
      id: true,
      leagueId: true,
      sport: true,
      currentWeek: true,
      league: { select: { name: true } },
      rosters: {
        where: { ownerId: userId },
        select: {
          id: true,
          teamName: true,
          ownerName: true,
          wins: true,
          losses: true,
          ties: true,
          pointsFor: true,
        },
      },
    },
  })

  // Sleeper leagues fetch in parallel with the native query below; merged at the end.
  const sleeperScoresPromise = sleeperLiveScores(userId).catch(() => [] as DashboardLiveScore[])

  if (seasons.length === 0) {
    return NextResponse.json({ scores: await sleeperScoresPromise })
  }

  // For each season, count total rosters and get the user's matchup for the current week.
  const results: DashboardLiveScore[] = []

  await Promise.all(
    seasons.map(async (season) => {
      const myRoster = season.rosters[0]
      if (!myRoster) return

      const week = Math.max(1, season.currentWeek)

      const [matchup, totalTeams, allRosters] = await Promise.all([
        prisma.redraftMatchup.findFirst({
          where: {
            leagueId: season.leagueId,
            week,
            OR: [{ homeRosterId: myRoster.id }, { awayRosterId: myRoster.id }],
          },
          include: {
            homeRoster: { select: { teamName: true, ownerName: true } },
            awayRoster: { select: { teamName: true, ownerName: true } },
          },
        }),
        prisma.redraftRoster.count({ where: { seasonId: season.id } }),
        prisma.redraftRoster.findMany({
          where: { seasonId: season.id },
          select: { wins: true, losses: true, ties: true, pointsFor: true },
        }),
      ])

      const isHome = matchup?.homeRosterId === myRoster.id
      const myPts = matchup ? (isHome ? matchup.homeScore : matchup.awayScore) : 0
      const oppPts = matchup ? (isHome ? matchup.awayScore : matchup.homeScore) : null
      const oppRoster = matchup ? (isHome ? matchup.awayRoster : matchup.homeRoster) : null
      const oppTeamName = oppRoster
        ? (oppRoster.teamName?.trim() || oppRoster.ownerName || null)
        : null

      const myWins = myRoster.wins
      const myPF = myRoster.pointsFor
      // Count rosters strictly better (more wins, or same wins + more PF) → rank = count + 1
      const betterCount = allRosters.filter(
        (r) => r.wins > myWins || (r.wins === myWins && r.pointsFor > myPF),
      ).length
      const myRank = betterCount + 1

      results.push({
        leagueId: season.leagueId,
        leagueName: season.league.name ?? 'League',
        sport: season.sport ?? 'NFL',
        week,
        myPts,
        oppPts: matchup?.awayRosterId ? oppPts : null,
        oppTeamName,
        myRecord: { wins: myRoster.wins, losses: myRoster.losses, ties: myRoster.ties },
        myRank,
        totalTeams,
        matchupStatus: matchup?.status ?? 'unknown',
      })
    }),
  )

  // Merge native + Sleeper rows (dedupe on leagueId — native wins if both exist).
  const sleeperScores = await sleeperScoresPromise
  const nativeIds = new Set(results.map((r) => r.leagueId))
  for (const s of sleeperScores) {
    if (!nativeIds.has(s.leagueId)) results.push(s)
  }

  // Sort by sport relevance (NFL first) then by league name.
  results.sort((a, b) => {
    if (a.sport === 'NFL' && b.sport !== 'NFL') return -1
    if (b.sport === 'NFL' && a.sport !== 'NFL') return 1
    return a.leagueName.localeCompare(b.leagueName)
  })

  return NextResponse.json({ scores: results })
}
