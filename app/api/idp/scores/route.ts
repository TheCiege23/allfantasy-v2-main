import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isIdpLeague } from '@/lib/idp'
import { prisma } from '@/lib/prisma'
import { getMergedScoringRulesForLeague } from '@/lib/idp/scoringEngine'
import { parseIdpRowsFromPlayerData } from '@/lib/idp/idpRouteHelpers'

export const dynamic = 'force-dynamic'

const MAX_IDS = 80

/*
 * ⚠ THIS ROUTE NO LONGER FABRICATES SCORES. It used to score
 * generateDeterministicWeeklyStatLine — stat lines invented from a hash of
 * the player id — under the league's real rules and attach them to real
 * player names. Real PBP-derived rows exist in FantasyStatLine; until this
 * route is wired to them (planned work), it answers honestly: rules yes,
 * scores no. No mounted UI calls it today.
 */
async function honestEmptyResponse(leagueId: string, week: number, requested: number) {
  return NextResponse.json({
    leagueId,
    week,
    source: 'unavailable',
    message:
      requested > 0
        ? 'Live IDP stat lines are not wired to this endpoint yet — scores appear when real weekly stats land.'
        : 'No IDP players found on your roster snapshot.',
    scoringRules: await getMergedScoringRulesForLeague(leagueId).catch(() => ({})),
    entries: [],
  })
}

/**
 * GET /api/idp/scores?leagueId=&week=
 *   &scope=mine — current user's IDP roster in this league
 *   &playerIds=id1,id2 — explicit list (required if scope not mine)
 *
 * POST /api/idp/scores — body: { leagueId, week, playerIds?: string[], scope?: 'mine' }
 * (playerIds for large batches)
 *
 * Points use league merged scoring rules × deterministic weekly stat lines until live stats are wired.
 */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const leagueId = searchParams?.get('leagueId')?.trim() ?? ''
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const weekRaw = Number(searchParams?.get('week') || '1')
  const week = Math.min(18, Math.max(1, Number.isFinite(weekRaw) ? weekRaw : 1))

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isIdp = await isIdpLeague(leagueId)
  if (!isIdp) return NextResponse.json({ error: 'Not an IDP league' }, { status: 404 })

  const scope = (searchParams?.get('scope') ?? 'explicit').toLowerCase()
  let playerIds: string[]

  if (scope === 'mine') {
    const roster = await prisma.roster.findFirst({
      where: { leagueId, platformUserId: userId },
      select: { playerData: true },
    })
    playerIds = parseIdpRowsFromPlayerData(roster?.playerData).map((r) => r.playerId)
    if (playerIds.length === 0) {
      return NextResponse.json({
        leagueId,
        week,
        source: 'deterministic_simulation',
        message: 'No IDP players found on your roster snapshot.',
        scoringRules: await getMergedScoringRulesForLeague(leagueId),
        entries: [],
      })
    }
  } else {
    const raw = searchParams?.get('playerIds')?.trim() ?? ''
    playerIds = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_IDS)
    if (playerIds.length === 0) {
      return NextResponse.json(
        { error: 'playerIds required (or use scope=mine)' },
        { status: 400 },
      )
    }
  }

  return honestEmptyResponse(leagueId, week, playerIds.length)
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : ''
  const weekRaw = Number(body.week)
  const week = Math.min(18, Math.max(1, Number.isFinite(weekRaw) ? weekRaw : 1))
  const scope = typeof body.scope === 'string' ? body.scope.toLowerCase() : 'explicit'

  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isIdp = await isIdpLeague(leagueId)
  if (!isIdp) return NextResponse.json({ error: 'Not an IDP league' }, { status: 404 })

  let playerIds: string[]

  if (scope === 'mine') {
    const roster = await prisma.roster.findFirst({
      where: { leagueId, platformUserId: userId },
      select: { playerData: true },
    })
    playerIds = parseIdpRowsFromPlayerData(roster?.playerData).map((r) => r.playerId)
  } else {
    const arr = Array.isArray(body.playerIds) ? body.playerIds : []
    playerIds = arr
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((s) => s.trim())
      .slice(0, MAX_IDS)
    if (playerIds.length === 0) {
      return NextResponse.json({ error: 'playerIds array required (or scope=mine)' }, { status: 400 })
    }
  }

  return honestEmptyResponse(leagueId, week, playerIds.length)
}

