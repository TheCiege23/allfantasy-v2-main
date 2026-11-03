import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requireCommissionerOnly } from '@/lib/league/permissions'
import { buildWeeklyUpdate } from '@/lib/zombie/weeklyUpdateEngine'

import { approveZombieWeeklyReport } from '@/lib/zombie/weeklyReportApproval'

export const dynamic = 'force-dynamic'

/** Preview draft (commissioner). */
export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const leagueId = searchParams?.get('leagueId')
  const week = searchParams?.get('week')
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  const w = week ? parseInt(week, 10) : NaN
  if (!Number.isFinite(w)) return NextResponse.json({ error: 'week required' }, { status: 400 })

  await requireCommissionerOnly(leagueId, session.user.id)
  const draft = await buildWeeklyUpdate(leagueId, w)
  return NextResponse.json({ draft })
}

/** Approval and its linked delivery receipt commit together. */
export async function POST(req: Request) {
  const userId = ((await getServerSession(authOptions as never)) as { user?: { id?: string } } | null)?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body.leagueId !== 'string' || typeof body.week !== 'number' || !Number.isInteger(body.week)) return NextResponse.json({ error: 'leagueId and integer week required' }, { status: 400 })
  try { await requireCommissionerOnly(body.leagueId, userId) }
  catch (error) { if (error instanceof Response) return error; throw error }
  try { return NextResponse.json(await approveZombieWeeklyReport(body.leagueId, body.week)) }
  catch { return NextResponse.json({ error: 'Report approval could not finish. Check settlement and correction status, then retry.' }, { status: 409 }) }
}
