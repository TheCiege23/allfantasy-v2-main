/**
 * E2E-ONLY seed endpoint for the G8/R1 DEF/ST browser spec.
 *
 * Hard-gated: only responds when NODE_ENV !== 'production' AND the request carries
 * `x-allfantasy-e2e: 1` (mirrors the register route's E2E gate). In a deployed
 * production/staging build (NODE_ENV=production) it returns 404 — the spec falls
 * back to the manual `G8_LEAGUE_ID` override there. Never touches production data.
 *
 *   POST   → seeds a commissioner-owned NFL league for the logged-in user; returns ids.
 *   DELETE → cleans up by { leagueId, season, seededScoreIds }.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { seedG8CommissionerLeague, cleanupG8League } from '@/lib/e2e/seedG8League'

export const dynamic = 'force-dynamic'

function e2eAllowed(request: Request): boolean {
  // Header-gated always. Enabled in non-production, OR in a production-mode build
  // ONLY when the operator explicitly opts in via ALLOW_E2E_SEED=1 — needed because
  // the only stable local browser runtime is `next start` (production mode) against
  // the STAGING DB. The real production deploy never sets ALLOW_E2E_SEED, so seeding
  // stays disabled there. Combined with the x-allfantasy-e2e header, this never
  // exposes seeding to real users.
  const envAllows = process.env.NODE_ENV !== 'production' || process.env.ALLOW_E2E_SEED === '1'
  return envAllows && request.headers.get('x-allfantasy-e2e') === '1'
}

export async function POST(request: Request) {
  if (!e2eAllowed(request)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { team?: string } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    /* optional body */
  }

  const seeded = await seedG8CommissionerLeague(prisma, userId, { team: body.team })
  return NextResponse.json({ ok: true, ...seeded })
}

export async function DELETE(request: Request) {
  if (!e2eAllowed(request)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: { leagueId?: string; season?: number; seededScoreIds?: string[] }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.leagueId || typeof body.season !== 'number') {
    return NextResponse.json({ error: 'leagueId and season required' }, { status: 400 })
  }

  await cleanupG8League(prisma, { leagueId: body.leagueId, season: body.season, seededScoreIds: body.seededScoreIds ?? [] })
  return NextResponse.json({ ok: true })
}
