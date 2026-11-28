import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { loadCollegeProDraft } from '@/lib/league/collegePro/loadCollegeProDraft'
import { MANUAL_STEPS, withChecklistTick, type ManualStep } from '@/lib/league/collegePro/draftChecklist'
import { pairedLeagueFor } from '@/lib/league/collegePro/pairLink'

export const dynamic = 'force-dynamic'

async function viewer() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

/** The draft pipeline for a paired college + pro league. See loadCollegeProDraft. */
export async function GET(req: NextRequest) {
  const userId = await viewer()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  try {
    return NextResponse.json(await loadCollegeProDraft(leagueId, userId))
  } catch {
    return NextResponse.json({ applies: false as const }, { status: 502 })
  }
}

/**
 * Tick or untick one of the commissioner's hand-checked steps: `{ leagueId, year, step, done }`.
 * Stored on the PRO half (either half's id is accepted), for a commissioner with roster rights there.
 */
export async function PATCH(req: NextRequest) {
  const userId = await viewer()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { leagueId?: unknown; year?: unknown; step?: unknown; done?: unknown } | null
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  const year = Number(body?.year)
  const step = body?.step as ManualStep
  if (!leagueId || !Number.isInteger(year) || year < 2000 || year > 2100 || !MANUAL_STEPS.includes(step) || typeof body?.done !== 'boolean') {
    return NextResponse.json({ error: 'Expected { leagueId, year, step, done }' }, { status: 400 })
  }

  const pair = await pairedLeagueFor(leagueId, userId).catch(() => null)
  if (!pair) return NextResponse.json({ error: 'This league is not paired with a college league' }, { status: 400 })
  const proId = pair.role === 'pro' ? leagueId : pair.otherLeagueId
  if (!(await canCommissionerAct(proId, userId, 'rosters').catch(() => false))) {
    return NextResponse.json({ error: 'Only the commissioner can update the checklist' }, { status: 403 })
  }
  const pro = await prisma.league.findUnique({ where: { id: proId }, select: { settings: true } })
  if (!pro) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  await prisma.league.update({
    where: { id: proId },
    data: { settings: withChecklistTick(pro.settings, year, step, body.done, userId, new Date()) as never },
  })
  return NextResponse.json({ ok: true })
}
