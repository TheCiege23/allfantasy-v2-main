import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner, assertLeagueMember } from '@/lib/league/league-access'
import { parseOptionalRedraftPositiveInteger } from '@/lib/redraft/betaRouteInput'
import {
  advanceNflRedraftPlayoffRuntimeRound,
  finalizeNflRedraftPlayoffRuntimeSeason,
  generateNflRedraftPlayoffRuntimeBracket,
  overrideNflRedraftPlayoffMatchup,
  resolveNflRedraftPlayoffRuntime,
} from '@/lib/playoff-runtime'

export const dynamic = 'force-dynamic'

type PlayoffRuntimeAction =
  | 'advance_round'
  | 'commissioner_override'
  | 'finalize_season'
  | 'generate_bracket'
  | 'regenerate_bracket'

type PlayoffRuntimeBody = {
  action?: PlayoffRuntimeAction
  seasonId?: string
  leagueId?: string
  week?: number | string | null
  playoffTeams?: number | string | null
  regenerate?: boolean
  lockBracket?: boolean
  matchupId?: string
  winnerRosterId?: string
  reason?: string | null
}

async function readBody(request: Request): Promise<PlayoffRuntimeBody> {
  try {
    return ((await request.json()) ?? {}) as PlayoffRuntimeBody
  } catch {
    return {}
  }
}

async function leagueIdFromInput(input: { seasonId?: string | null; leagueId?: string | null }) {
  if (input.leagueId?.trim()) return input.leagueId.trim()
  if (!input.seasonId?.trim()) return null
  const season = await prisma.redraftSeason.findUnique({
    where: { id: input.seasonId.trim() },
    select: { leagueId: true },
  })
  return season?.leagueId ?? null
}

async function seasonIdFromInput(input: { seasonId?: string | null; leagueId?: string | null }) {
  if (input.seasonId?.trim()) return input.seasonId.trim()
  if (!input.leagueId?.trim()) return null
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId: input.leagueId.trim() },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  return season?.id ?? null
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const seasonId = req.nextUrl.searchParams.get('seasonId')?.trim() || null
  const leagueIdParam = req.nextUrl.searchParams.get('leagueId')?.trim() || null
  const week = req.nextUrl.searchParams.get('week')
  if (!seasonId && !leagueIdParam) {
    return NextResponse.json({ error: 'seasonId or leagueId required' }, { status: 400 })
  }

  const parsedWeek = parseOptionalRedraftPositiveInteger(week, 'week')
  if (!parsedWeek.ok) return NextResponse.json({ error: parsedWeek.error }, { status: 400 })

  const leagueId = await leagueIdFromInput({ seasonId, leagueId: leagueIdParam })
  if (!leagueId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await assertLeagueMember(leagueId, userId)
  if (!member.ok) return NextResponse.json({ error: 'Forbidden' }, { status: member.status })
  const commissioner = await assertLeagueCommissioner(leagueId, userId)

  const resolved = await resolveNflRedraftPlayoffRuntime({
    seasonId,
    leagueId,
    week: parsedWeek.value,
  })
  if (!resolved.ok) {
    const status = resolved.reason === 'season_not_found' || resolved.reason === 'league_not_found' ? 404 : 400
    return NextResponse.json({ error: resolved.reason }, { status })
  }

  return NextResponse.json({ playoffs: resolved.state, isCommissioner: commissioner.ok })
}

export async function POST(request: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await readBody(request)
  const action = body.action ?? 'generate_bracket'
  const leagueId = await leagueIdFromInput({ seasonId: body.seasonId, leagueId: body.leagueId })
  if (!leagueId) return NextResponse.json({ error: 'seasonId or leagueId required' }, { status: 400 })

  const member = await assertLeagueMember(leagueId, userId)
  if (!member.ok) return NextResponse.json({ error: 'Forbidden' }, { status: member.status })
  const commissioner = await assertLeagueCommissioner(leagueId, userId)
  if (!commissioner.ok) return NextResponse.json({ error: 'Forbidden' }, { status: commissioner.status })

  const seasonId = await seasonIdFromInput({ seasonId: body.seasonId, leagueId })
  if (!seasonId) return NextResponse.json({ error: 'Season not found' }, { status: 404 })

  try {
    if (action === 'generate_bracket' || action === 'regenerate_bracket') {
      const parsedPlayoffTeams = parseOptionalRedraftPositiveInteger(body.playoffTeams, 'playoffTeams')
      if (!parsedPlayoffTeams.ok) return NextResponse.json({ error: parsedPlayoffTeams.error }, { status: 400 })
      const result = await generateNflRedraftPlayoffRuntimeBracket({
        seasonId,
        playoffTeams: parsedPlayoffTeams.value,
        regenerate: action === 'regenerate_bracket' || body.regenerate !== false,
        lockBracket: body.lockBracket,
        actorUserId: userId,
      })
      return NextResponse.json({ ok: true, ...result })
    }

    if (action === 'advance_round') {
      const parsedWeek = parseOptionalRedraftPositiveInteger(body.week, 'week')
      if (!parsedWeek.ok) return NextResponse.json({ error: parsedWeek.error }, { status: 400 })
      const result = await advanceNflRedraftPlayoffRuntimeRound({
        seasonId,
        week: parsedWeek.value,
        actorUserId: userId,
      })
      return NextResponse.json({ ok: result.ok, result }, { status: result.ok ? 200 : 409 })
    }

    if (action === 'finalize_season') {
      const result = await finalizeNflRedraftPlayoffRuntimeSeason({ seasonId, actorUserId: userId })
      return NextResponse.json({ ok: result.ok, result }, { status: result.ok ? 200 : 409 })
    }

    if (action === 'commissioner_override') {
      if (!body.matchupId?.trim() || !body.winnerRosterId?.trim()) {
        return NextResponse.json({ error: 'matchupId and winnerRosterId required' }, { status: 400 })
      }
      const result = await overrideNflRedraftPlayoffMatchup({
        seasonId,
        matchupId: body.matchupId.trim(),
        winnerRosterId: body.winnerRosterId.trim(),
        actorUserId: userId,
        reason: body.reason,
      })
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Playoff runtime action failed'
    const status = message.includes('not_found') ? 404 : message.includes('not_nfl_redraft') ? 400 : 409
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
