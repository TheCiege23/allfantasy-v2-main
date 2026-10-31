import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueAccess } from '@/lib/league-access'
import { loadRealGameBoard, submitRealGamePick } from '@/lib/survivor/survivorRealGameChallenges'

export const dynamic = 'force-dynamic'

async function viewer(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

/** This week's real-game picks and past results. League members only. Reads our DB, never a provider. */
export async function GET(req: NextRequest) {
  const userId = await viewer()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  if (!(await resolveLeagueAccess(leagueId, userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(await loadRealGameBoard(leagueId, userId), { headers: { 'Cache-Control': 'no-store' } })
}

/** Pick or change a side before kickoff. */
export async function POST(req: NextRequest) {
  const userId = await viewer()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { leagueId?: unknown; challengeId?: unknown; optionId?: unknown } | null
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  const challengeId = typeof body?.challengeId === 'string' ? body.challengeId : ''
  const optionId = typeof body?.optionId === 'string' ? body.optionId : ''
  if (!leagueId || !challengeId || !optionId) return NextResponse.json({ error: 'leagueId, challengeId and optionId required' }, { status: 400 })
  if (!(await resolveLeagueAccess(leagueId, userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const result = await submitRealGamePick(leagueId, userId, challengeId, optionId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result)
}
