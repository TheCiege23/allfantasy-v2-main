import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessLeague } from '@/lib/draft/access'
import { getDraftIdFromSettings } from '@/app/league/[leagueId]/components/league-settings-modal-utils'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export const dynamic = 'force-dynamic'

/**
 * Ensures a `DraftSession` row exists for the league (for `/draft/live/[draftId]` URLs + Sleeper sync).
 */
export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  }

  const ok = await canAccessLeague(leagueId, userId)
  if (!ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: {
      id: true,
      sport: true,
      leagueSize: true,
      settings: true,
    },
  })
  if (!league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }

  const sleeperDraftId = getDraftIdFromSettings(league.settings)

  /**
   * `leagueId` is no longer unique on DraftSession, so this is a find-then-write rather than
   * an upsert.
   *
   * 🛑 It deliberately looks for ANY existing draft, not just an open one. "Ensure" must not
   * quietly start a league's SECOND draft once the first has completed — beginning a rookie or
   * dispersal draft is an explicit commissioner action, not a side effect of a page load.
   *
   * A concurrent pair of calls on a league with no draft can both reach the create; the partial
   * unique index on `("leagueId") WHERE status <> 'completed'` is what makes the loser fail
   * rather than produce two open drafts.
   */
  const existing = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { id: true },
  })

  const ds = existing
    ? await prisma.draftSession.update({
        where: { id: existing.id },
        data: {
          sportType: String(league.sport),
          teamCount: league.leagueSize ?? 12,
          ...(sleeperDraftId ? { sleeperDraftId } : {}),
        },
      })
    : await prisma.draftSession.create({
        data: {
          leagueId,
          sportType: String(league.sport),
          teamCount: league.leagueSize ?? 12,
          rounds: 15,
          sleeperDraftId: sleeperDraftId ?? undefined,
          sessionKind: 'live',
        },
      })

  return NextResponse.json({ draftSessionId: ds.id, leagueId: ds.leagueId, sleeperDraftId: ds.sleeperDraftId })
}
