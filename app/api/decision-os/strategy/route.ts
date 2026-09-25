import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueRole } from '@/lib/league/permissions'
import { strategyPrismaPort } from '@/lib/decision-os/value-v2/strategyPrisma'
import { refreshStrategyFromEvidence } from '@/lib/decision-os/value-v2/strategyEvidence'
import { strategyEvidencePrismaPort } from '@/lib/decision-os/value-v2/strategyEvidencePrisma'
import { confirmStoredStrategy, readStrategy, strategyConfirmationSchema, strategyOwnerView, StrategyStoreError } from '@/lib/decision-os/value-v2/strategyStore'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
async function scopeFor(request: Request) {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  if (!userId) return { error: json({ error: 'Unauthorized' }, 401) }
  const leagueId = new URL(request.url).searchParams.get('leagueId')?.trim()
  if (!leagueId || leagueId.length > 128) return { error: json({ error: 'A valid leagueId is required' }, 400) }
  const role = await getLeagueRole(leagueId, userId)
  if (!role || role === 'viewer') return { error: json({ error: 'League membership is required' }, 403) }
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { season: true } })
  if (!league) return { error: json({ error: 'League unavailable' }, 404) }
  return { scope: { userId, leagueId, season: league.season } }
}
export async function GET(request: Request) {
  try {
    const authorized = await scopeFor(request)
    if (authorized.error) return authorized.error
    return json(strategyOwnerView(await readStrategy(authorized.scope!, strategyPrismaPort)))
  } catch { return json({ error: 'Strategy is temporarily unavailable' }, 503) }
}
export async function POST(request: Request) {
  try {
    // Session cookies alone do not authorize cross-origin writes. Same-origin browser JSON only.
    const origin = request.headers.get('origin')
    if (!origin || origin !== new URL(request.url).origin) return json({ error: 'Same-origin confirmation required' }, 403)
    const authorized = await scopeFor(request)
    if (authorized.error) return authorized.error
    const text = await request.text()
    if (text.length > 2048) return json({ error: 'Request too large' }, 413)
    let body: unknown
    try { body = JSON.parse(text) } catch { return json({ error: 'Invalid request' }, 400) }
    const refresh = body !== null && typeof body === 'object' && !Array.isArray(body) &&
      Object.keys(body).length === 1 && 'action' in body && body.action === 'refresh'
    const input = strategyConfirmationSchema.safeParse(body)
    if (!refresh && !input.success) return json({ error: 'Explicit confirmation, strategy and current revision are required' }, 400)
    const current = await refreshStrategyFromEvidence(authorized.scope!, strategyEvidencePrismaPort, strategyPrismaPort)
    if (refresh) return json({ ...strategyOwnerView(current.state), evidence: {
      available: current.gaps.length === 0, completedWeek: current.completedWeek, canConfirm: current.canConfirm,
    } })
    if (!current.canConfirm) return json({ error: 'This proposal needs current, complete weekly results before confirmation.', code: 'NOT_READY' }, 409)
    if (!input.success) return json({ error: 'Invalid confirmation' }, 400)
    return json(strategyOwnerView(await confirmStoredStrategy(authorized.scope!, input.data, strategyPrismaPort)))
  } catch (error) {
    if (error instanceof StrategyStoreError && error.code === 'CONFLICT') return json({ error: 'Strategy changed. Refresh before confirming.', code: 'CONFLICT' }, 409)
    if (error instanceof StrategyStoreError && error.code === 'NOT_READY') return json({ error: 'A strategy proposal needs three consecutive weekly observations.', code: 'NOT_READY' }, 409)
    return json({ error: 'Strategy is temporarily unavailable' }, 503)
  }
}
