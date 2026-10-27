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
    if (z.whispererRecord) whispererCount += 1
    whispererCount += z.coWhisperers.length
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

