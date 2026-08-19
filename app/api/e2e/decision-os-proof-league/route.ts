/**
 * G28 E2E-only Decision OS proof fixture.
 *
 * Creates one authenticated, commissioner-owned NFL redraft league through the
 * tracked canonical E2E seed helper, then deletes that league and its explicit
 * weekly-score rows on cleanup. This route is header-gated and disabled for real
 * production unless an operator explicitly opts into local/staging E2E seeding.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { cleanupG8League, seedG8CommissionerLeague } from '@/lib/e2e/seedG8League'

export const dynamic = 'force-dynamic'

function e2eAllowed(request: Request): boolean {
  const envAllows = process.env.NODE_ENV !== 'production' || process.env.ALLOW_E2E_SEED === '1'
  return envAllows && request.headers.get('x-allfantasy-e2e') === '1'
}

export async function POST(request: Request) {
  if (!e2eAllowed(request)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { team?: string; season?: number; week?: number } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    /* optional body */
  }

  const seeded = await seedG8CommissionerLeague(prisma, userId, {
    team: body.team ?? 'KC',
    season: typeof body.season === 'number' ? body.season : 2098,
    week: typeof body.week === 'number' ? body.week : 1,
  })
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

  await cleanupG8League(prisma, {
    leagueId: body.leagueId,
    season: body.season,
    seededScoreIds: body.seededScoreIds ?? [],
  })
  return NextResponse.json({ ok: true })
}
