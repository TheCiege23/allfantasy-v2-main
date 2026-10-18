import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { getExileWaivers, mutateExileRoster } from '@/lib/survivor/exileRosterService'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/survivorSettings'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { assertLeagueCommissioner, assertLeagueMember } from '@/lib/league/league-access'
import { processReturnFromExile, scoreExileWeek } from '@/lib/survivor/exileEngine'
import { runExileRosterRollover } from '@/lib/survivor/survivorExileRollover'
import { dailySportWeekForInstant } from '@/lib/season-week/dailySportSeasonStarts'
import {
  submitExileTeamClaim,
  getExileTeamDraftStatus,
} from '@/lib/survivor/exileTeamDraft'

import { survivorHostGuard } from '@/lib/survivor/survivorHostGuard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (requireCronAuth(req)) {
    const nativeRollover = await runExileRosterRollover()
    const islands = await prisma.exileIsland.findMany({ where: { isActive: true } })
    for (const is of islands) {
      await scoreExileWeek(is.leagueId, is.currentWeek).catch(() => {})
    }
    return NextResponse.json({ ok: true, processed: islands.length, nativeRollover })
  }

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const island = await prisma.exileIsland.findUnique({ where: { leagueId } })
  const me = await prisma.survivorPlayer.findFirst({ where: { leagueId, userId } })
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, sport: true, season: true, survivorTokenCap: true } })
  const settings = normalizeSurvivorFoundationSettings(league?.settings as Record<string, unknown> | null)
  const resolved = await prisma.survivorAuditEntry.findFirst({ where: { leagueId, action: 'scheduled_exile_return_resolved' }, select: { id: true } })
  let bossContest: { status: 'pending' | 'locked' | 'final'; week: number; team?: string; players?: { name: string; position: string; slot: string }[]; score?: number } | null = null
  if (island?.isActive && island.bossWinsEnabled && me?.playerState === 'exile') {
    const week = league ? dailySportWeekForInstant(league.sport, league.season, new Date()) ?? island.currentWeek : island.currentWeek
    const [locked, finalized] = await Promise.all([
      prisma.survivorAuditEntry.findFirst({ where: { leagueId, week, action: 'exile_boss_roster_locked' }, select: { data: true } }),
      prisma.survivorAuditEntry.findFirst({ where: { leagueId, week, action: 'exile_boss_result_finalized' }, select: { data: true } }),
    ])
    const rosterData = locked?.data && typeof locked.data === 'object' && !Array.isArray(locked.data) ? locked.data as Record<string, unknown> : null
    const scoreData = finalized?.data && typeof finalized.data === 'object' && !Array.isArray(finalized.data) ? finalized.data as Record<string, unknown> : null
    const roster = rosterData?.roster && typeof rosterData.roster === 'object' && !Array.isArray(rosterData.roster) ? rosterData.roster as Record<string, unknown> : null
    const players = Array.isArray(roster?.players) ? roster.players.flatMap((player: unknown) => {
      if (!player || typeof player !== 'object' || Array.isArray(player)) return []
      const row = player as Record<string, unknown>
      return typeof row.name === 'string' && typeof row.position === 'string' && typeof row.slot === 'string'
        ? [{ name: row.name, position: row.position, slot: row.slot }] : []
    }) : []
    const score = typeof scoreData?.score === 'number' && Number.isFinite(scoreData.score) ? scoreData.score : undefined
    bossContest = { status: score != null ? 'final' : locked ? 'locked' : 'pending', week,
      ...(locked && typeof rosterData?.team === 'string' ? { team: rosterData.team, players } : {}),
      ...(score != null ? { score } : {}) }
  }
  // The caller's own entry for the most recent SCORED Exile week drives the token earned / wiped
  // toast (scoreExileWeek writes an exile_week_scored marker per week; open weeks are not final).
  // Owner-only: filtered to the session user, never another manager's entry.
  const scored = island && me ? await prisma.survivorAuditEntry.findFirst({ where: { leagueId, action: 'exile_week_scored', week: { not: null } }, orderBy: { week: 'desc' }, select: { week: true } }) : null
  const latestEntry = island && me && scored?.week != null ? await prisma.exileWeeklyEntry.findFirst({
    where: { exileId: island.id, userId, week: scored.week },
    orderBy: { week: 'desc' },
    select: { id: true, week: true, weeklyScore: true, bossScore: true, tokenEarned: true, tokenWiped: true },
  }) : null
  const latest = latestEntry && (latestEntry.tokenEarned > 0 || latestEntry.tokenWiped) ? latestEntry : null
  const latestResult = latest ? { id: latest.id, week: latest.week, weeklyScore: latest.weeklyScore, bossScore: latest.bossScore, tokenEarned: latest.tokenEarned, tokenWiped: latest.tokenWiped } : null
  return NextResponse.json({ island, user: me, bossContest, latestResult, tokenCap: league?.survivorTokenCap ?? null, returnRules: { enabled: settings.exileIslandEnabled, week: settings.exileReturnWeek, tokensRequired: settings.exileReturnTokens, resolved: Boolean(resolved), slots: 1 } })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { intent?: string; leagueId?: string; week?: number; lineup?: unknown; userId?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.intent === 'return') {
    if (!body.leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
    const gate = await assertLeagueCommissioner(body.leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const denied = await survivorHostGuard(body.leagueId, userId)
    if (denied) return denied
    const uid = await processReturnFromExile(body.leagueId)
    return NextResponse.json({ returnedUserId: uid })
  }

  if (['waivers', 'drop_player', 'move_player'].includes(body.intent ?? '')) {
    if (!body.leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
    const gate = await assertLeagueMember(body.leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
    const input = body as Record<string, unknown>
    try {
      if (body.intent === 'waivers') return NextResponse.json(await getExileWaivers(body.leagueId, userId, typeof input.search === 'string' ? input.search : ''))
      if (!Number.isInteger(body.week) || typeof input.playerId !== 'string') return NextResponse.json({ error: 'week and playerId required' }, { status: 400 })
      return NextResponse.json(await mutateExileRoster({ leagueId: body.leagueId, userId, week: body.week!, playerId: input.playerId, action: body.intent === 'drop_player' ? 'drop' : 'move', slot: typeof input.slot === 'string' ? input.slot : undefined }))
    } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Exile waivers unavailable.' }, { status: 409 }) }
  }

  if (body.intent === 'lineup') {
    if (!body.leagueId || body.week == null) return NextResponse.json({ error: 'leagueId and week required' }, { status: 400 })
    const gate = await assertLeagueMember(body.leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
    const native = await prisma.league.findUnique({ where: { id: body.leagueId }, select: { platform: true } })
    if (native && isNativePlatform(native.platform)) return NextResponse.json({ error: 'Build your separate Exile roster through Exile waivers.' }, { status: 409 })
    const island = await prisma.exileIsland.findUnique({ where: { leagueId: body.leagueId } })
    if (!island) return NextResponse.json({ error: 'Exile not initialized' }, { status: 400 })
    const player = await prisma.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId: body.leagueId, userId } } })
    if (player?.playerState !== 'exile' || !Number.isInteger(body.week) || body.week !== island.currentWeek) return NextResponse.json({ error: 'Only an exiled manager can submit for the current Exile period.' }, { status: 403 })
    if (await prisma.survivorAuditEntry.findFirst({ where: { leagueId: body.leagueId, week: body.week, action: 'exile_week_scored' }, select: { id: true } })) return NextResponse.json({ error: 'This Exile period has been finalized.' }, { status: 409 })
    await prisma.exileWeeklyEntry.upsert({
      where: {
        exileId_userId_week: { exileId: island.id, userId, week: body.week },
      },
      create: {
        exileId: island.id,
        leagueId: body.leagueId,
        userId,
        week: body.week,
        submittedLineup: (body.lineup ?? {}) as object,
      },
      update: { submittedLineup: (body.lineup ?? {}) as object },
    })
    return NextResponse.json({ ok: true })
  }

  if (body.intent === 'claim_team') {
    if (!body.leagueId || body.week == null) return NextResponse.json({ error: 'leagueId and week required' }, { status: 400 })
    if (!Number.isInteger(body.week) || body.week < 1) {
      return NextResponse.json({ error: 'Valid week required' }, { status: 400 })
    }
    const gate = await assertLeagueMember(body.leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
    const island = await prisma.exileIsland.findUnique({ where: { leagueId: body.leagueId } })
    if (!island) return NextResponse.json({ error: 'Exile not initialized' }, { status: 400 })
    const player = body as Record<string, unknown>
    const playerId = typeof player.playerId === 'string' ? player.playerId.trim() : ''
    if (!playerId) {
      return NextResponse.json({ error: 'playerId is required' }, { status: 400 })
    }
    // Denormalized display fields (playerName/position/team/teamId/sport) are
    // resolved by the claim processor from the sport feed at fulfillment
    // time, so the claim row only needs playerId + week + priority here.
    const priorityRaw = (body as Record<string, unknown>).priority
    const priority =
      typeof priorityRaw === 'number' && Number.isFinite(priorityRaw)
        ? priorityRaw
        : undefined
    const result = await submitExileTeamClaim({
      leagueId: body.leagueId,
      userId,
      realPlayerId: playerId,
      week: body.week,
      priority,
    })
    return NextResponse.json(result, { status: result.ok ? 200 : 409 })
  }

  if (body.intent === 'available_teams') {
    if (!body.leagueId || body.week == null) return NextResponse.json({ error: 'leagueId and week required' }, { status: 400 })
    if (!Number.isInteger(body.week) || body.week < 1) {
      return NextResponse.json({ error: 'Valid week required' }, { status: 400 })
    }
    const gate = await assertLeagueMember(body.leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
    const league = await prisma.league.findUnique({ where: { id: body.leagueId }, select: { sport: true, platform: true } })
    if (league && isNativePlatform(league.platform)) {
      try { const board = await getExileWaivers(body.leagueId, userId); return NextResponse.json({ takenTeamIds: board.takenTeamIds }) }
      catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Exile waivers unavailable.' }, { status: 409 }) }
    }
    // Returns { takenTeamIds } — the client diffs against its own
    // sport catalog to render the available list. Renamed from
    // `teams` to avoid the prior misleading shape.
    const status = await getExileTeamDraftStatus(body.leagueId, body.week, league?.sport ?? 'NFL')
    return NextResponse.json(status)
  }

  return NextResponse.json({ error: 'Invalid intent' }, { status: 400 })
}

