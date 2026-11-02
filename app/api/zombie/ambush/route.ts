import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { executeBetaAmbush, previewBetaAmbush } from '@/lib/zombie/beta2025Ambush'
import type { AmbushPair } from '@/lib/zombie/beta2025CombatPolicy'

export const dynamic = 'force-dynamic'
export async function GET(req: Request) {
  const session = await getServerSession(authOptions as never) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = new URL(req.url).searchParams.get('leagueId')
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  const gate = await assertLeagueMember(leagueId, session.user.id)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try { return NextResponse.json(await previewBetaAmbush(leagueId, session.user.id)) }
  catch { return NextResponse.json({ error: 'A matchup preview is unavailable. Check your role, league state and remaining ambushes.' }, { status: 409 }) }
}
export async function POST(req: Request) {
  const session = await getServerSession(authOptions as never) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body.leagueId !== 'string' || typeof body.requestId !== 'string' || typeof body.previewHash !== 'string' || !Number.isInteger(body.week) || !Array.isArray(body.pairs)) return NextResponse.json({ error: 'A complete reviewed matchup plan and request ID are required.' }, { status: 400 })
  const gate = await assertLeagueMember(body.leagueId, session.user.id)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try { return NextResponse.json(await executeBetaAmbush({ leagueId: body.leagueId, userId: session.user.id, week: body.week as number,
    requestId: body.requestId, previewHash: body.previewHash, pairs: body.pairs as AmbushPair[] })) }
  catch (error) { return NextResponse.json({ error: error instanceof Error && !error.name.startsWith('Prisma') ? error.message : 'The remap could not be completed. Refresh and try again.' }, { status: 409 }) }
}
