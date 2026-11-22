import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { resolveBashingDecision } from '@/lib/zombie/bashingEngine'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    leagueId?: string
    bashingEventId?: string
    decision?: string
  }
  if (!body.leagueId || !body.bashingEventId || !body.decision) {
    return NextResponse.json({ error: 'leagueId, bashingEventId, and decision required' }, { status: 400 })
  }
  if (body.decision !== 'spare' && body.decision !== 'infect' && body.decision !== 'replace') {
    return NextResponse.json({ error: 'decision must be spare, infect or replace' }, { status: 400 })
  }

  const gate = await assertLeagueMember(body.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await resolveBashingDecision(body.bashingEventId, body.decision, userId, body.leagueId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
}
