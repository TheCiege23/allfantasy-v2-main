import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { syncLeagueShareMoments } from '@/lib/survivor/shareCards/momentCapture'
import {
  getShareMoment,
  listOfferedMoments,
  postShareMomentToLeagueChat,
  publishShareMoment,
  readShareCardsEnabled,
  toListItem,
} from '@/lib/survivor/shareCards/momentStore'
import { canPublishMoment } from '@/lib/survivor/shareCards/momentAccess'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Survivor share moments for the signed-in manager.
 *
 * GET  ?leagueId=…            → { enabled, moments } — only moments offered to this viewer:
 *                               their own immunity/out/idol/exile cards, plus the champion recap.
 * POST { momentId, action }   → action "publish" makes the moment page + images public;
 *                               action "chat" publishes and posts the card to league chat.
 */

async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

const noStore = { 'Cache-Control': 'private, no-store' }

export async function GET(req: Request) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore })
  const leagueId = new URL(req.url).searchParams.get('leagueId')?.trim() ?? ''
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400, headers: noStore })
  const membership = await resolveLeagueMembership(leagueId, userId)
  if (!membership.ok) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: noStore })
  if (!(await readShareCardsEnabled(leagueId))) return NextResponse.json({ enabled: false, moments: [] }, { headers: noStore })

  // Backstop for the engine hooks; never let it break the list.
  await syncLeagueShareMoments(leagueId).catch((error: unknown) => {
    console.warn('[survivor-share] sync failed:', error instanceof Error ? error.message : 'unknown error')
  })
  const viewer = { userId, isLeagueMember: true }
  const moments = await listOfferedMoments(leagueId, viewer)
  return NextResponse.json({ enabled: true, moments: moments.map(moment => toListItem(moment, userId)) }, { headers: noStore })
}

export async function POST(req: Request) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore })
  const body = (await req.json().catch(() => ({}))) as { momentId?: unknown; action?: unknown }
  const momentId = typeof body.momentId === 'string' ? body.momentId : ''
  const action = body.action === 'chat' ? 'chat' : body.action === 'publish' ? 'publish' : null
  if (!momentId || !action) return NextResponse.json({ error: 'momentId and action are required' }, { status: 400, headers: noStore })

  const moment = await getShareMoment(momentId)
  if (!moment || !(await readShareCardsEnabled(moment.leagueId))) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: noStore })
  const membership = await resolveLeagueMembership(moment.leagueId, userId)
  const viewer = { userId, isLeagueMember: membership.ok }
  if (!membership.ok || !canPublishMoment(moment, viewer)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: noStore })

  const published = await publishShareMoment(moment, viewer)
  if (!published) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: noStore })

  if (action === 'chat') {
    const player = await prisma.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId: moment.leagueId, userId } }, select: { displayName: true } })
    const posted = await postShareMomentToLeagueChat(published, player?.displayName?.trim() || 'A manager')
    if (!posted.ok) return NextResponse.json({ error: posted.error }, { status: 409, headers: noStore })
  }
  return NextResponse.json({ ok: true, moment: toListItem(published, userId) }, { headers: noStore })
}
