import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner, assertLeagueMember } from '@/lib/league/league-access'
import {
  applyNflRedraftStatCorrectionToSeason,
  ingestNflRedraftStatPayload,
  persistNflRedraftLiveScoringWeek,
  resolveNflRedraftLiveScoringRuntime,
  type NflRedraftStatPayloadRow,
} from '@/lib/scoring-runtime'
import { parseOptionalRedraftPositiveInteger } from '@/lib/redraft/betaRouteInput'

export const dynamic = 'force-dynamic'

type LiveScoringAction = 'ingest_stats' | 'apply_correction' | 'recalculate_week'

type LiveScoringBody = {
  action?: LiveScoringAction
  seasonId?: string
  leagueId?: string
  week?: number
  rows?: NflRedraftStatPayloadRow[]
  playerId?: string
  correctedStats?: unknown
  isFinalized?: boolean
  reason?: string
  source?: string
}

async function readBody(request: Request): Promise<LiveScoringBody> {
  try {
    return ((await request.json()) ?? {}) as LiveScoringBody
  } catch {
    return {}
  }
}

async function leagueIdFromInput(input: { seasonId?: string | null; leagueId?: string | null }): Promise<string | null> {
  if (input.leagueId?.trim()) return input.leagueId.trim()
  if (!input.seasonId?.trim()) return null
  const season = await prisma.redraftSeason.findUnique({
    where: { id: input.seasonId.trim() },
    select: { leagueId: true },
  })
  return season?.leagueId ?? null
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const seasonId = req.nextUrl.searchParams.get('seasonId')?.trim() || null
  const leagueId = req.nextUrl.searchParams.get('leagueId')?.trim() || null
  const week = req.nextUrl.searchParams.get('week')
  if (!seasonId && !leagueId) {
    return NextResponse.json({ error: 'seasonId or leagueId required' }, { status: 400 })
  }

  const resolvedLeagueId = await leagueIdFromInput({ seasonId, leagueId })
  if (!resolvedLeagueId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const gate = await assertLeagueMember(resolvedLeagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const parsedWeek = parseOptionalRedraftPositiveInteger(week, 'week')
  if (!parsedWeek.ok) {
    return NextResponse.json({ error: parsedWeek.error }, { status: 400 })
  }

  const resolved = await resolveNflRedraftLiveScoringRuntime({
    seasonId,
    leagueId: resolvedLeagueId,
    week: parsedWeek.value,
  })
  if (!resolved.ok) {
    const status = resolved.reason === 'season_not_found' || resolved.reason === 'league_not_found' ? 404 : 400
    return NextResponse.json({ error: resolved.reason }, { status })
  }

  return NextResponse.json({ scoring: resolved.state })
}

export async function POST(request: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await readBody(request)
  const action = body.action ?? 'recalculate_week'
  const resolvedLeagueId = await leagueIdFromInput({ seasonId: body.seasonId, leagueId: body.leagueId })
  if (!resolvedLeagueId) return NextResponse.json({ error: 'seasonId or leagueId required' }, { status: 400 })

  const gate = await assertLeagueCommissioner(resolvedLeagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const parsedWeek = parseOptionalRedraftPositiveInteger(body.week, 'week')
  if (!parsedWeek.ok) {
    return NextResponse.json({ error: parsedWeek.error }, { status: 400 })
  }
  const week = parsedWeek.value ?? undefined

  try {
    if (action === 'ingest_stats') {
      if (!Array.isArray(body.rows)) {
        return NextResponse.json({ error: 'rows required' }, { status: 400 })
      }
      const result = await ingestNflRedraftStatPayload({
        seasonId: body.seasonId,
        leagueId: resolvedLeagueId,
        week,
        rows: body.rows,
        actorUserId: userId,
        source: body.source ?? 'manual_provider_payload',
      })
      return NextResponse.json({ ok: true, synced: result.synced, skipped: result.skipped, scoring: result.state })
    }

    if (action === 'apply_correction') {
      if (!body.playerId || body.correctedStats == null) {
        return NextResponse.json({ error: 'playerId and correctedStats required' }, { status: 400 })
      }
      const result = await applyNflRedraftStatCorrectionToSeason({
        seasonId: body.seasonId,
        leagueId: resolvedLeagueId,
        week,
        playerId: body.playerId,
        correctedStats: body.correctedStats,
        isFinalized: body.isFinalized,
        reason: body.reason,
        actorUserId: userId,
      })
      return NextResponse.json({ ok: true, correctionVersion: result.correctionVersion, scoring: result.state })
    }

    if (action === 'recalculate_week') {
      const result = await persistNflRedraftLiveScoringWeek({
        seasonId: body.seasonId,
        leagueId: resolvedLeagueId,
        week,
        actorUserId: userId,
      })
      return NextResponse.json({ ok: true, scoring: result.state, standings: result.standings })
    }

    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Live scoring action failed' },
      { status: 500 },
    )
  }
}
