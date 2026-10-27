import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** Aggregate universe + leagues for Zombie Hub UI. */
export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const universeId = searchParams?.get('universeId')
  if (!universeId) return NextResponse.json({ error: 'universeId required' }, { status: 400 })

  // This endpoint includes unredacted role records; only the universe commissioner may read it.
  const owner = await prisma.zombieUniverse.findUnique({
    where: { id: universeId },
    select: { commissionedByUserId: true },
  })
  if (!owner) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (owner.commissionedByUserId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const u = await prisma.zombieUniverse.findUnique({
    where: { id: universeId },
    include: {
      levels: { orderBy: { rankOrder: 'asc' } },
      leagues: {
        include: {
          teams: true,
          whispererRecord: true,
          coWhisperers: true,
          level: true,
        },
      },
    },
  })
  if (!u) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let survivorCount = 0
  let zombieCount = 0
  let whispererCount = 0
  for (const z of u.leagues) {
    whispererCount += z.teams.filter((team) => team.status === 'Whisperer').length
    for (const t of z.teams) {
      const s = (t.status ?? '').toLowerCase()
      if (s.includes('zombie')) zombieCount += 1
      else if (s.includes('survivor') || s.includes('revived')) survivorCount += 1
    }
  }

  const animations = await prisma.zombieEventAnimation.findMany({
    where: { leagueId: { in: u.leagues.map((l) => l.leagueId) } },
    orderBy: { createdAt: 'desc' },
    take: 12,
  })

  const announcements = await prisma.zombieAnnouncement.findMany({
    where: { universeId },
    orderBy: { createdAt: 'desc' },
    take: 12,
  })

  const stats = await prisma.zombieUniverseStat.findMany({
    where: { universeId, season: new Date().getFullYear() },
    orderBy: { currentSeasonPPW: 'desc' },
    take: 30,
  })

  return NextResponse.json({
    universe: u,
    counts: { survivorCount, zombieCount, whispererCount, leagueCount: u.leagues.length },
    animations,
    announcements,
    topByPpw: stats.slice(0, 10),
  })
}


/** Universe-wide movement rules are owned by the universe commissioner. */
export async function PATCH(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const universeId = typeof body.universeId === 'string' ? body.universeId : null
  if (!universeId) return NextResponse.json({ error: 'universeId required' }, { status: 400 })

  const universe = await prisma.zombieUniverse.findUnique({
    where: { id: universeId },
    select: {
      commissionedByUserId: true,
      leagues: { select: { status: true } },
    },
  })
  if (!universe) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (universe.commissionedByUserId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (universe.leagues.some((league) => !['setup', 'registering'].includes(league.status))) {
    return NextResponse.json({ error: 'Promotion and relegation rules lock when a league starts.' }, { status: 409 })
  }

  const data: { promotionCount?: number; relegationCount?: number } = {}
  for (const key of ['promotionCount', 'relegationCount'] as const) {
    const value = body[key]
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 5) {
      return NextResponse.json({ error: `${key} must be an integer between 0 and 5.` }, { status: 400 })
    }
    data[key] = value
  }
  if (!Object.keys(data).length) return NextResponse.json({ error: 'No supported settings supplied.' }, { status: 400 })

  const updated = await prisma.zombieUniverse.update({ where: { id: universeId }, data })
  return NextResponse.json({
    universe: {
      id: updated.id,
      promotionCount: updated.promotionCount,
      relegationCount: updated.relegationCount,
    },
  })
}
