import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readAutoBenchBye, setAutoBenchBye } from '@/lib/lineup-automation/autoBenchByeService'

/**
 * GET  /api/league/auto-bench-bye?leagueId=…        → { available, on }
 * PUT  /api/league/auto-bench-bye  { leagueId, on }  → { on }
 *
 * The free "bench my starters on bye automatically" switch for the signed-in manager's own team
 * (lib/lineup-automation/autoBenchByePolicy.ts). Only the team's owner reads or changes it.
 */
export const dynamic = 'force-dynamic'

async function userId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET(req: Request) {
  const uid = await userId()
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = new URL(req.url).searchParams.get('leagueId')?.trim() ?? ''
  if (!leagueId) return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
  return NextResponse.json(await readAutoBenchBye(leagueId, uid), { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function PUT(req: Request) {
  const uid = await userId()
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : ''
  if (!leagueId) return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
  const r = await setAutoBenchBye(leagueId, uid, body.on)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ on: r.on }, { headers: { 'Cache-Control': 'private, no-store' } })
}
