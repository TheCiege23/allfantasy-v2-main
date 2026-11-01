import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/normalizeSurvivorSettings'
import { readSurvivorGovernanceSettings } from '@/lib/survivor/survivorGovernanceSettings'
import { listSurvivorConductStrikes } from '@/lib/survivor/survivorConductService'
import { createSurvivorAlliance, leaveSurvivorAlliance, listSurvivorAlliances } from '@/lib/survivor/survivorAlliances'
import { survivorTradeWindowStatus } from '@/lib/survivor/survivorTradeRules'

export const dynamic = 'force-dynamic'

/**
 * A castaway's own governance view: the league's trade rules and today's window, the strike policy
 * and THEIR OWN strikes (never anyone else's), their alliances and who they could invite. League
 * members only. POST forms or leaves an alliance.
 */

async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET(req: NextRequest) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, survivorMode: true } })
  if (!league?.survivorMode) return NextResponse.json({ error: 'Not a Survivor league' }, { status: 404 })
  const settings = readSurvivorGovernanceSettings(league.settings)
  const foundation = normalizeSurvivorFoundationSettings(league.settings && typeof league.settings === 'object' ? league.settings as Record<string, unknown> : {})
  const [game, me, cast, myStrikes, alliances] = await Promise.all([
    prisma.survivorGameState.findUnique({ where: { leagueId }, select: { mergeTriggeredAt: true, currentWeek: true } }),
    prisma.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId } }, select: { playerState: true, tribeId: true } }),
    prisma.survivorPlayer.findMany({ where: { leagueId, playerState: 'active' }, select: { userId: true, displayName: true, tribeId: true }, orderBy: { displayName: 'asc' } }),
    listSurvivorConductStrikes(leagueId, userId),
    listSurvivorAlliances(leagueId, userId),
  ])
  const merged = Boolean(game?.mergeTriggeredAt)
  return NextResponse.json({
    rules: {
      tradeRulesEnabled: settings.tradeRulesEnabled,
      crossTribeTrades: settings.crossTribeTrades,
      crossTribeCloseDay: settings.crossTribeCloseDay,
      crossTribeCloseTime: settings.crossTribeCloseTime,
      withinTribeUnplayedOnly: settings.withinTribeUnplayedOnly,
      playedLockUntilTribal: settings.playedLockUntilTribal,
      weeklyTradeFreezeEnabled: settings.weeklyTradeFreezeEnabled,
      weeklyTradeFreezeDay: settings.weeklyTradeFreezeDay,
      weeklyTradeFreezeTime: settings.weeklyTradeFreezeTime,
      strikeLimit: settings.strikeLimit,
      strikeAutoRemove: settings.strikeAutoRemove,
      alliancesEnabled: settings.alliancesEnabled,
      allianceMaxSize: settings.allianceMaxSize,
      allianceSameTribeOnly: settings.allianceSameTribeOnly,
      allianceHostCanRead: settings.allianceHostCanRead,
      tribalDay: foundation.tribalCouncilDay,
      tribalTime: foundation.tribalCouncilTime,
    },
    tradeWindow: settings.tradeRulesEnabled ? survivorTradeWindowStatus(settings, { tribalDay: foundation.tribalCouncilDay, tribalTime: foundation.tribalCouncilTime, now: new Date() }, merged) : null,
    me: me ? { playerState: me.playerState, tribeId: me.tribeId, canFormAlliance: settings.alliancesEnabled && me.playerState === 'active' } : null,
    myStrikes,
    alliances,
    inviteable: me?.playerState === 'active' && settings.alliancesEnabled
      ? cast.filter((c) => c.userId !== userId && (!settings.allianceSameTribeOnly || merged || c.tribeId === me.tribeId)).map((c) => ({ userId: c.userId, displayName: c.displayName }))
      : [],
  })
}

export async function POST(req: NextRequest) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : ''
  const action = typeof body.action === 'string' ? body.action : ''
  if (!leagueId || !action) return NextResponse.json({ error: 'leagueId and action required' }, { status: 400 })
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (action === 'alliance_create') {
    const name = typeof body.name === 'string' ? body.name : ''
    const memberUserIds = Array.isArray(body.memberUserIds) ? body.memberUserIds.filter((id): id is string => typeof id === 'string') : null
    if (!memberUserIds) return NextResponse.json({ error: 'memberUserIds must be a list' }, { status: 400 })
    const result = await createSurvivorAlliance(leagueId, userId, { name, memberUserIds })
    if (!result.ok) {
      const status = result.code === 'disabled' || result.code === 'not_active' || result.code === 'host' ? 403 : result.code === 'not_found' ? 404 : result.code === 'duplicate' || result.code === 'too_many' ? 409 : 400
      return NextResponse.json({ error: result.error, code: result.code }, { status })
    }
    return NextResponse.json(result)
  }
  if (action === 'alliance_leave') {
    const channelId = typeof body.channelId === 'string' ? body.channelId : ''
    if (!channelId) return NextResponse.json({ error: 'channelId required' }, { status: 400 })
    const result = await leaveSurvivorAlliance(leagueId, userId, channelId)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result)
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
