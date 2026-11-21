import { NextRequest, NextResponse } from 'next/server'
import { leagueMemberWhere } from '@/lib/league/leagueMemberWhere'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'

export const dynamic = 'force-dynamic'

const SLEEPER = 'https://api.sleeper.app/v1' // db-first-exception: public league rosters for trend UI
const CACHE = { next: { revalidate: 120 } } as const

type SleeperRoster = {
  owner_id?: string
  players?: string[]
}

/**
 * League context for the Trend tab: rostered % in this league, owner display name, and current user's player ids.
 */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) {
    return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  }

  const league = await prisma.league.findFirst({
    where: {
      id: leagueId,
      OR: leagueMemberWhere(userId),
    },
    select: {
      id: true,
      platform: true,
      platformLeagueId: true,
      leagueSize: true,
    },
  })

  if (!league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }

  const base = {
    totalTeams: 0,
    playerRosterPct: {} as Record<string, number>,
    playerOwner: {} as Record<string, { displayName: string }>,
    myPlayerIds: [] as string[],
  }

  if (league.platform === 'sleeper' && league.platformLeagueId) {
    const [rostersRes, usersRes] = await Promise.all([
      fetch(`${SLEEPER}/league/${encodeURIComponent(league.platformLeagueId)}/rosters`, CACHE),
      fetch(`${SLEEPER}/league/${encodeURIComponent(league.platformLeagueId)}/users`, CACHE),
    ])

    if (!rostersRes.ok || !usersRes.ok) {
      return NextResponse.json({ ...base, source: 'sleeper' as const, error: 'Sleeper unavailable' })
    }

    const rosters = (await rostersRes.json()) as SleeperRoster[]
    const sleeperUsers = (await usersRes.json()) as { user_id?: string; display_name?: string }[]

    const userById = new Map<string, string>()
    for (const u of sleeperUsers) {
      if (u.user_id) {
        userById.set(String(u.user_id), String(u.display_name ?? 'Manager'))
      }
    }

    const rosterList = Array.isArray(rosters) ? rosters : []
    const totalTeams = rosterList.filter((r) => r.owner_id).length

    const countMap = new Map<string, number>()
    const playerOwner: Record<string, { displayName: string }> = {}

    for (const r of rosterList) {
      const oid = r.owner_id != null ? String(r.owner_id) : ''
      if (!oid) continue
      const ownerName = userById.get(oid) ?? 'Manager'
      for (const pid of (r.players ?? []).map(String)) {
        countMap.set(pid, (countMap.get(pid) ?? 0) + 1)
        playerOwner[pid] = { displayName: ownerName }
      }
    }

    const playerRosterPct: Record<string, number> = {}
    for (const [pid, c] of countMap) {
      playerRosterPct[pid] = totalTeams > 0 ? Math.round((c / totalTeams) * 100) : 0
    }

    const [profile, leagueTeam] = await Promise.all([
      prisma.userProfile.findUnique({
        where: { userId },
        select: { sleeperUserId: true },
      }),
      prisma.leagueTeam.findFirst({
        where: { leagueId, claimedByUserId: userId },
        select: { platformUserId: true },
      }),
    ])

    let sleeperOwnerId = profile?.sleeperUserId?.trim() || null
    if (!sleeperOwnerId && leagueTeam?.platformUserId) {
      sleeperOwnerId = leagueTeam.platformUserId
    }

    const myPlayerIds: string[] = []
    if (sleeperOwnerId) {
      const mine = rosterList.find((r) => String(r.owner_id) === String(sleeperOwnerId))
      if (mine?.players?.length) {
        myPlayerIds.push(...mine.players.map(String))
      }
    }

    return NextResponse.json({
      source: 'sleeper' as const,
      totalTeams,
      playerRosterPct,
      playerOwner,
      myPlayerIds,
    })
  }

  const rosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { platformUserId: true, playerData: true },
  })

  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId },
    select: {
      platformUserId: true,
      ownerName: true,
      teamName: true,
      claimedByUserId: true,
      isOrphan: true,
    },
  })

  const teamByPlatform = new Map<string, { ownerLabel: string }>()
  for (const t of teams) {
    if (t.isOrphan) continue
    const label = t.teamName?.trim() || t.ownerName?.trim() || 'Manager'
    if (t.platformUserId) {
      teamByPlatform.set(t.platformUserId, { ownerLabel: label })
    }
  }

  const activeTeamCount = teams.filter((t) => !t.isOrphan).length
  const totalTeams = Math.max(activeTeamCount, league.leagueSize ?? activeTeamCount, 1)

  const countMap = new Map<string, number>()
  const playerOwner: Record<string, { displayName: string }> = {}

  for (const r of rosters) {
    const label = teamByPlatform.get(r.platformUserId)?.ownerLabel ?? 'Manager'
    for (const pid of getRosterPlayerIds(r.playerData)) {
      countMap.set(pid, (countMap.get(pid) ?? 0) + 1)
      playerOwner[pid] = { displayName: label }
    }
  }

  const playerRosterPct: Record<string, number> = {}
  for (const [pid, c] of countMap) {
    playerRosterPct[pid] = Math.round((c / totalTeams) * 100)
  }

  const myTeam = teams.find((t) => t.claimedByUserId === userId)
  const myRoster = myTeam?.platformUserId
    ? rosters.find((r) => r.platformUserId === myTeam.platformUserId)
    : null
  const myPlayerIds = myRoster ? getRosterPlayerIds(myRoster.playerData) : []

  return NextResponse.json({
    source: 'native' as const,
    totalTeams,
    playerRosterPct,
    playerOwner,
    myPlayerIds,
  })
}
