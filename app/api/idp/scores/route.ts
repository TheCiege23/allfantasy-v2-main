import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isIdpLeague } from '@/lib/idp'
import { prisma } from '@/lib/prisma'
import { computeIdpFantasyPoints, getMergedScoringRulesForLeague } from '@/lib/idp/scoringEngine'
import { getLatestIdpStatSeason, getRealIdpLinesForRosterIds } from '@/lib/idp/realStatLines'
import { parseIdpRowsFromPlayerData } from '@/lib/idp/idpRouteHelpers'

export const dynamic = 'force-dynamic'

const MAX_IDS = 80

const MISS_REASON_LABEL: Record<string, string> = {
  no_identity_mapping: 'no identity mapping into the ingested stat-line id space',
  no_stat_line: 'no ingested stat line for this week',
}

/*
 * ⚠ THIS ROUTE NEVER FABRICATES SCORES. It once scored
 * generateDeterministicWeeklyStatLine — stat lines invented from a hash of the
 * player id — under the league's real rules. It now serves the real PBP-derived
 * rows in FantasyStatLine (source rolling_insights_pbp), joined from Sleeper
 * roster ids via PlayerIdentityMap. Players without a real line stay absent
 * from `entries` and are listed in `missing` with the reason.
 */
async function honestEmptyResponse(leagueId: string, week: number, requested: number) {
  return NextResponse.json({
    leagueId,
    week,
    source: 'unavailable',
    message:
      requested > 0
        ? 'No ingested IDP stat lines match this request yet — scores appear when real weekly stats land.'
        : 'No IDP players found on your roster snapshot.',
    scoringRules: await getMergedScoringRulesForLeague(leagueId).catch(() => ({})),
    entries: [],
  })
}

async function realScoresResponse(leagueId: string, week: number, playerIds: string[]) {
  if (playerIds.length === 0) return honestEmptyResponse(leagueId, week, 0)
  const season = await getLatestIdpStatSeason()
  if (!season) return honestEmptyResponse(leagueId, week, playerIds.length)

  const rules = await getMergedScoringRulesForLeague(leagueId).catch(
    () => ({}) as Record<string, number>,
  )
  const { linesByPlayer, missing } = await getRealIdpLinesForRosterIds(playerIds, season, { week })
  if (linesByPlayer.size === 0) return honestEmptyResponse(leagueId, week, playerIds.length)

  const entries = playerIds.flatMap((playerId) => {
    const line = linesByPlayer.get(playerId)?.[0]
    if (!line) return []
    const points = computeIdpFantasyPoints(line.stats, rules)
    return [
      {
        playerId,
        week: line.week,
        stats: line.stats,
        points: Math.round(points.total * 100) / 100,
        breakdown: points.breakdown,
      },
    ]
  })

  return NextResponse.json({
    leagueId,
    week,
    season,
    source: 'ingested_stats',
    scoringRules: rules,
    entries,
    missing: playerIds
      .filter((id) => !linesByPlayer.has(id))
      .map((playerId) => ({
        playerId,
        reason: MISS_REASON_LABEL[missing.get(playerId) ?? 'no_stat_line'],
      })),
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
 * Points use league merged scoring rules × real ingested weekly stat lines
 * (FantasyStatLine, source rolling_insights_pbp). Players with no real line
 * are reported in `missing` with the reason — never scored from invented stats.
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
      return honestEmptyResponse(leagueId, week, 0)
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

  return realScoresResponse(leagueId, week, playerIds)
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

  return realScoresResponse(leagueId, week, playerIds)
}

