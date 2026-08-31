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

  const config = await prisma.devyLeague.findUnique({ where: { leagueId } })
  if (!config) return NextResponse.json({ error: 'Devy league not configured' }, { status: 404 })
  return NextResponse.json({ config })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as { leagueId?: string }
  const leagueId = body.leagueId?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueCommissioner(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const existing = await prisma.devyLeague.findUnique({ where: { leagueId } })
  if (existing) return NextResponse.json({ config: existing })

  /*
   * 🛑 SEASON MUST COME FROM THE LEAGUE. `DevyLeague.season` carries `@default(2025)`, and a
   * config created today would take it — but it is not inert:
   *
   *   app/api/devy/picks/route.ts:28   `const season = seasonParam ? Number(seasonParam) : cfg.season`
   *   app/api/devy/draft/route.ts:156  same
   *
   * and picks/route then calls `generatePickInventory(leagueId, season, 3)`. So a devy league
   * configured now would generate its pick inventory for a season that has already passed, and
   * the draft pool cache would key on it too. Nothing throws; the wrong year is simply used.
   *
   * Same defect and same fix as IDPCapConfig — see the commissioner cap-config route, where the
   * identical stale default hid every current-season contract.
   */
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { season: true } })
  const config = await prisma.devyLeague.create({
    data: {
      leagueId,
      isDynastyOnly: true,
      season: Number(league?.season) || new Date().getUTCFullYear(),
    },
  })
  return NextResponse.json({ config })
}

