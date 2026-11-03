import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueMembership } from '@/lib/league-access'
import {
  momentImageAccess,
  PRIVATE_IMAGE_CACHE_CONTROL,
  PUBLIC_IMAGE_CACHE_CONTROL,
} from '@/lib/survivor/shareCards/momentAccess'
import { getShareMoment, readShareCardsEnabled } from '@/lib/survivor/shareCards/momentStore'
import { renderShareCard } from '@/lib/survivor/shareCards/renderCard'
import { councilIdOfRecapMoment, parseShareCardFormat } from '@/lib/survivor/shareCards/types'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/share/survivor/[momentId]?f=post|story|link — a Survivor share card PNG at the exact
 * export size (1080×1350, 1080×1920, 1200×630).
 *
 * A published, final moment is public and immutable: cached by momentId + format for a year.
 * Before it is published, only the people it is offered to (momentAccess.ts) get the image, as a
 * private, uncached live preview. Everything else — unknown id, not final, sharing turned off for
 * the league, someone else's out card — is the same 404, so an unpublished moment's existence
 * never leaks.
 */
type Ctx = { params: Promise<{ momentId: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const { momentId } = await ctx.params
  const format = parseShareCardFormat(new URL(req.url).searchParams.get('f'))
  let moment = await getShareMoment(momentId)
  // The Torch Ceremony post names the week recap by its council before the capture hook may have run.
  // Capture it now (idempotent, and gated on the read being complete, so nothing leaks early).
  const recapCouncilId = moment ? null : councilIdOfRecapMoment(momentId)
  if (recapCouncilId) {
    const council = await prisma.survivorTribalCouncil.findUnique({ where: { id: recapCouncilId }, select: { leagueId: true } }).catch(() => null)
    if (council) {
      const { captureCouncilShareMoments } = await import('@/lib/survivor/shareCards/momentCapture')
      await captureCouncilShareMoments(council.leagueId, recapCouncilId, { notify: false }).catch(() => 0)
      moment = await getShareMoment(momentId)
    }
  }
  const enabled = moment ? await readShareCardsEnabled(moment.leagueId) : false

  let viewer = { userId: null as string | null, isLeagueMember: false }
  if (moment && enabled && !moment.publishedAt) {
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    const userId = session?.user?.id ?? null
    const membership = userId ? await resolveLeagueMembership(moment.leagueId, userId) : null
    viewer = { userId, isLeagueMember: Boolean(membership?.ok) }
  }

  const access = momentImageAccess(moment, enabled, viewer)
  if (access === 'not_found' || !moment) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  return renderShareCard(moment, format, access === 'public' ? PUBLIC_IMAGE_CACHE_CONTROL : PRIVATE_IMAGE_CACHE_CONTROL)
}
