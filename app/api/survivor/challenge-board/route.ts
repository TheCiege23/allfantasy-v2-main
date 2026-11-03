import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueAccess } from '@/lib/league-access'
import { loadBuilderBoard, submitBuilderAnswer } from '@/lib/survivor/survivorChallengeBuilder'

export const dynamic = 'force-dynamic'

/**
 * The commissioner's challenges as a manager sees them (the Camp card), and the manager's one
 * answer. League members only. Other entrants' answers stay hidden until the lock (or the result,
 * when sealed) — `loadBuilderBoard` enforces it. Reads our DB, never a provider.
 */
async function viewer(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET(req: NextRequest) {
  const userId = await viewer()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  if (!(await resolveLeagueAccess(leagueId, userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(await loadBuilderBoard(leagueId, userId), { headers: { 'Cache-Control': 'no-store' } })
}

/** Submit once: the first answer stands. */
export async function POST(req: NextRequest) {
  const userId = await viewer()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { leagueId?: unknown; challengeId?: unknown; answer?: unknown } | null
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  const challengeId = typeof body?.challengeId === 'string' ? body.challengeId.trim() : ''
  if (!leagueId || !challengeId || !body?.answer || typeof body.answer !== 'object') return NextResponse.json({ error: 'leagueId, challengeId and answer required' }, { status: 400 })
  if (!(await resolveLeagueAccess(leagueId, userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const result = await submitBuilderAnswer(leagueId, userId, challengeId, body.answer)
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
  return NextResponse.json(result)
}
