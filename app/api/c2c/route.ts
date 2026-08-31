import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner, assertLeagueMember } from '@/lib/league/league-access'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const cfg = await prisma.c2CLeague.findUnique({ where: { leagueId } })
  if (!cfg) return NextResponse.json({ error: 'C2C not configured' }, { status: 404 })
  return NextResponse.json({ c2c: cfg })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueCommissioner(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const existing = await prisma.c2CLeague.findUnique({ where: { leagueId } })
  if (existing) return NextResponse.json({ error: 'C2C already exists', c2c: existing }, { status: 409 })

  /*
   * 🛑 SEASON FROM THE LEAGUE, NOT THE SCHEMA DEFAULT. `C2CLeague.season` carries
   * `@default(2025)`, so a config created today would be born a year stale. It is READ —
   * lib/specialty-automation/syncMetadata.ts:39 selects it into `meta.c2c` — so the wrong year
   * propagates into specialty-automation metadata rather than sitting inert.
   *
   * ⚠ Milder than the same defect in DevyLeague, and worth stating so nobody over-reads this:
   * no C2C query defaults its season from the config. app/api/c2c/draft and /score both use
   * `body?.season ?? new Date().getFullYear()`, so scoring and drafting were never affected.
   * Devy's picks route DID read `cfg.season` and generated pick inventory from it.
   *
   * Fourth of four models carrying this default. See __tests__/idp-projections/staleSeasonDefaults.
   */
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { season: true } })

  const c2c = await prisma.c2CLeague.create({
    data: {
      leagueId,
      season: Number(league?.season) || new Date().getUTCFullYear(),
      sportPair: typeof body?.sportPair === 'string' ? body.sportPair : 'NFL_CFB',
      scoringMode: typeof body?.scoringMode === 'string' ? body.scoringMode : 'combined_total',
    },
  })
  return NextResponse.json({ c2c })
}

