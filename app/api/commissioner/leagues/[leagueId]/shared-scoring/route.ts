/**
 * Shared scoring (2026-11-16): apply this league's scoring to other leagues you run.
 *
 * GET  — this league's scoring, and every other league of the same sport you commission, each with whether it can
 *        take the change now (ready, already the same, in season, locked, refused, or a format that keeps its own).
 * POST { leagueIds, confirmMidSeasonChange? } — saves this league's scoring to each league named, one by one, through
 *        the same save each league's scoring tab uses (lib/league/sharedScoring.ts). Returns each league's outcome.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { applySharedScoring, getSharedScoringView } from '@/lib/league/sharedScoring'

export const dynamic = 'force-dynamic'

async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const view = await getSharedScoringView(userId, leagueId)
  if (!view.ok) return NextResponse.json({ error: view.error }, { status: view.status })
  return NextResponse.json(view)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const body = (await req.json().catch(() => ({}))) as { leagueIds?: unknown; confirmMidSeasonChange?: unknown }
  const leagueIds = Array.isArray(body.leagueIds) ? body.leagueIds.filter((id): id is string => typeof id === 'string') : []
  const result = await applySharedScoring({
    userId,
    sourceLeagueId: leagueId,
    leagueIds,
    confirmMidSeasonChange: body.confirmMidSeasonChange === true,
  })
  if (!result.ok) return NextResponse.json({ error: result.error, code: 'code' in result ? result.code : undefined }, { status: result.status })
  return NextResponse.json(result)
}
