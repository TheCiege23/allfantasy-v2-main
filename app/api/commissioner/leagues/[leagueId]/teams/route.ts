import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueRole } from '@/lib/league/permissions'

type SessionWithUser = { user?: { id?: string } } | null

const MAX_TEAM_NAME = 64
const MAX_AVATAR_URL = 600

/**
 * PATCH: update a league team's identity (name and/or logo).
 *
 * Owner assignment is handled separately by the sibling `managers` route
 * (PATCH/DELETE). This route only edits the team's own `teamName` / `avatarUrl`
 * columns on `leagueTeam`, scoped to the league so a commissioner of one league
 * can never mutate another league's teams.
 *
 * Body: { leagueTeamId: string, teamName?: string, avatarUrl?: string | null }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as SessionWithUser
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await params
  const role = await getLeagueRole(leagueId, userId)
  if (role !== 'commissioner' && role !== 'co_commissioner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    leagueTeamId?: unknown
    teamName?: unknown
    avatarUrl?: unknown
  }

  const leagueTeamId = typeof body.leagueTeamId === 'string' ? body.leagueTeamId.trim() : ''
  if (!leagueTeamId) {
    return NextResponse.json({ error: 'leagueTeamId required' }, { status: 400 })
  }

  const data: { teamName?: string; avatarUrl?: string | null } = {}

  if (body.teamName !== undefined) {
    if (typeof body.teamName !== 'string') {
      return NextResponse.json({ error: 'teamName must be a string' }, { status: 400 })
    }
    const name = body.teamName.trim()
    if (!name) {
      return NextResponse.json({ error: 'teamName cannot be empty' }, { status: 400 })
    }
    if (name.length > MAX_TEAM_NAME) {
      return NextResponse.json(
        { error: `teamName must be ${MAX_TEAM_NAME} characters or fewer` },
        { status: 400 },
      )
    }
    data.teamName = name
  }

  if (body.avatarUrl !== undefined) {
    if (body.avatarUrl === null) {
      data.avatarUrl = null
    } else if (typeof body.avatarUrl === 'string') {
      const url = body.avatarUrl.trim()
      if (!url) {
        data.avatarUrl = null
      } else {
        if (url.length > MAX_AVATAR_URL) {
          return NextResponse.json(
            { error: `avatarUrl must be ${MAX_AVATAR_URL} characters or fewer` },
            { status: 400 },
          )
        }
        if (!/^(https?:\/\/|data:image\/)/i.test(url)) {
          return NextResponse.json(
            { error: 'avatarUrl must be an http(s) or data:image URL' },
            { status: 400 },
          )
        }
        data.avatarUrl = url
      }
    } else {
      return NextResponse.json({ error: 'avatarUrl must be a string or null' }, { status: 400 })
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  // Scope the update to this league so the id alone can't cross leagues.
  const result = await prisma.leagueTeam.updateMany({
    where: { id: leagueTeamId, leagueId },
    data,
  })

  if (result.count === 0) {
    return NextResponse.json(
      { error: 'Team not found or does not belong to this league' },
      { status: 404 },
    )
  }

  return NextResponse.json({ status: 'ok', leagueTeamId, ...data })
}
