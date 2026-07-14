import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { openRedraftRenewal } from '@/lib/redraft/renewal/CanonicalRedraftRenewalService'
export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null) as { leagueId?: string; seasonId?: string; deadline?: string } | null
  if (!body?.leagueId || !body.seasonId || !body.deadline) return NextResponse.json({ error: 'leagueId, seasonId, and deadline required' }, { status: 400 })
  const deadline = new Date(body.deadline)
  if (Number.isNaN(deadline.getTime()) || deadline <= new Date()) return NextResponse.json({ error: 'Valid future deadline required' }, { status: 400 })
  try { return NextResponse.json(await openRedraftRenewal({ leagueId: body.leagueId, seasonId: body.seasonId, actorUserId: userId, deadline })) }
  catch (error) { const message = error instanceof Error ? error.message : 'Renewal failed'; return NextResponse.json({ error: message }, { status: message === 'FORBIDDEN' ? 403 : 409 }) }
}