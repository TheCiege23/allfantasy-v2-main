import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notifyUserPlatform } from '@/lib/tournament/tournamentMiniCommissionerNotifications'
import { leagueChatThreadLinkRefusalInPatch } from '@/lib/league/leagueChatThreadLink'

export const dynamic = 'force-dynamic'

/**
 * Approve or reject a pending league settings patch (main commissioner only).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tournamentId: string; requestId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tournamentId, requestId } = await params
  const t = await prisma.legacyTournament.findUnique({
    where: { id: tournamentId },
    select: { creatorId: true },
  })
  if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (t.creatorId !== userId) {
    return NextResponse.json({ error: 'Only the main commissioner can approve or reject' }, { status: 403 })
  }

  let body: { action?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const action = body.action === 'reject' ? 'reject' : body.action === 'approve' ? 'approve' : null
  if (!action) return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })

  const reqRow = await prisma.legacyTournamentLeagueSettingRequest.findFirst({
    where: { id: requestId, tournamentId },
  })
  if (!reqRow) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (reqRow.status !== 'pending') {
    return NextResponse.json({ error: 'Request already resolved' }, { status: 400 })
  }

  if (action === 'reject') {
    const updated = await prisma.legacyTournamentLeagueSettingRequest.update({
      where: { id: requestId },
      data: {
        status: 'rejected',
        resolvedAt: new Date(),
        resolverId: userId,
      },
    })
    await notifyUserPlatform(
      reqRow.requesterId,
      'tournament_league_setting_resolved',
      'League settings request rejected',
      'The main commissioner did not apply your proposed settings change.',
      { requestId, tournamentId, leagueId: reqRow.leagueId }
    )
    return NextResponse.json({ request: updated })
  }

  const league = await prisma.league.findUnique({ where: { id: reqRow.leagueId } })
  if (!league) return NextResponse.json({ error: 'League missing' }, { status: 404 })

  const prev = (league.settings as Record<string, unknown>) ?? {}
  const patch = (reqRow.proposedPatch as Record<string, unknown>) ?? {}
  // A proposed patch is free-form JSON merged key by key, so it can carry the chat link. Only this
  // league's own chat may be linked (lib/league/leagueChatThreadLink.ts); the request stays pending.
  const chatLinkRefusal = leagueChatThreadLinkRefusalInPatch(reqRow.leagueId, patch)
  if (chatLinkRefusal) return NextResponse.json({ error: chatLinkRefusal }, { status: 400 })
  const nextSettings = { ...prev, ...patch }

  await prisma.$transaction([
    prisma.league.update({
      where: { id: reqRow.leagueId },
      data: { settings: nextSettings },
    }),
    prisma.legacyTournamentLeagueSettingRequest.update({
      where: { id: requestId },
      data: {
        status: 'approved',
        resolvedAt: new Date(),
        resolverId: userId,
      },
    }),
  ])

  await notifyUserPlatform(
    reqRow.requesterId,
    'tournament_league_setting_resolved',
    'League settings request approved',
    'Your proposed settings were applied to the league.',
    { requestId, tournamentId, leagueId: reqRow.leagueId }
  )

  return NextResponse.json({ ok: true, mergedSettingsKeys: Object.keys(patch) })
}
