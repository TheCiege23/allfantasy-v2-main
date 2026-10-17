import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { executeSGLiveChop, reconcileSGLiveStatCorrection } from '@/lib/survivor-guillotine/live'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ leagueId: string }> }

export async function POST(req: NextRequest, context: Context) {
  const userId = (await getServerSession(authOptions as never) as { user?: { id?: string } } | null)?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await context.params
  const access = await assertLeagueCommissioner(leagueId, userId)
  if (!access.ok) return NextResponse.json({ error: 'Commissioner access required' }, { status: access.status })
  const body = await req.json().catch(() => null) as { period?: number; action?: string } | null
  if (body?.action === 'reconcile_correction') {
    try { return NextResponse.json({ result: await reconcileSGLiveStatCorrection(leagueId) }) }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Correction failed' }, { status: 409 }) }
  }
  if (!Number.isInteger(body?.period)) return NextResponse.json({ error: 'Scoring period required' }, { status: 400 })
  try {
    const result = await executeSGLiveChop(leagueId, body!.period!)
    return NextResponse.json({ result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Chop failed' }, { status: 409 })
  }
}
