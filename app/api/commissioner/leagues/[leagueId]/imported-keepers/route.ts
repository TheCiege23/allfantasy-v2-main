/**
 * GET /api/commissioner/leagues/[leagueId]/imported-keepers — commissioner / co-commissioner only.
 * The keeper cost grid for a keeper league imported from Sleeper/ESPN/Yahoo/Fleaflicker/MFL, and how
 * to set the keepers there (lib/import-assist/keeperGrid.ts). AF Commissioner; `locked` otherwise.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLeagueRole } from '@/lib/league/permissions'
import { readImportedKeeperGrid } from '@/lib/import-assist/keeperGridService'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const role = await getLeagueRole(leagueId, userId)
  if (role === null) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (role !== 'commissioner' && role !== 'co_commissioner') return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  const view = await readImportedKeeperGrid(leagueId, userId)
  if (!view.applies && view.reason === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(view, { headers: { 'Cache-Control': 'no-store' } })
}
