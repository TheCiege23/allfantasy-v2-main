/**
 * GET /api/leagues/[leagueId]/future-picks — every team's future draft picks plus next season's
 * projected rookie order, for a league member (lib/league/futurePicksView.ts). Read-only; no
 * provider or AI call.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/get-current-user'
import { loadFuturePicksView } from '@/lib/league/futurePicksView'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  const user = await getCurrentUser()
  const result = await loadFuturePicksView(leagueId, user?.id ?? null)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.view, { headers: { 'Cache-Control': 'private, no-store' } })
}
