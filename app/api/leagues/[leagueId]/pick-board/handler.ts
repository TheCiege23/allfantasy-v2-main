/**
 * GET /api/leagues/[leagueId]/pick-board
 *
 * Every team's future draft picks, for a league member: who holds which pick in each upcoming rookie
 * draft, where an acquired pick came from, and which of a team's own picks it has traded away
 * (lib/dynasty-core/leaguePickBoard.ts). `{ board: null, reason }` when this league has no pick
 * inventory to show. No AI call.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/get-current-user'
import { loadLeaguePickBoard } from '@/lib/dynasty-core/leaguePickBoardService'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  const user = await getCurrentUser()
  const result = await loadLeaguePickBoard(leagueId, user?.id ?? null)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.board ? { board: result.board, trade: result.trade } : { board: null, reason: result.reason }, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
