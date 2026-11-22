import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { getFanPredictionState, submitFanPrediction } from '@/lib/survivor/spectator/fanPredictions'

export const dynamic = 'force-dynamic'

async function viewerId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

/** Fan predictions on the public watch page. Reading needs no sign-in; making a call does. */
export async function GET(req: NextRequest) {
  const limit = rateLimit(`survivor-watch-pred:${getClientIp(req)}`, 120, 60_000)
  if (!limit.success) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  const state = await getFanPredictionState(leagueId, await viewerId())
  return NextResponse.json(state, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const userId = await viewerId()
  if (!userId) return NextResponse.json({ error: 'Sign in to make your call.' }, { status: 401 })
  const limit = rateLimit(`survivor-watch-pred-post:${userId}`, 20, 60_000)
  if (!limit.success) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
  const body = (await req.json().catch(() => null)) as { leagueId?: unknown; choice?: unknown } | null
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  const choice = typeof body?.choice === 'string' ? body.choice.trim() : ''
  if (!leagueId || !choice) return NextResponse.json({ error: 'leagueId and choice are required' }, { status: 400 })
  const result = await submitFanPrediction(leagueId, userId, choice)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ myPick: result.myPick })
}
