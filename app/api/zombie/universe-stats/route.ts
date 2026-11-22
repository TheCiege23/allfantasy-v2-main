import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveZombieUniverseAccess } from '@/lib/zombie/zombieUniverseAccess'
import { executePromotionRelegation } from '@/lib/zombie/universeStatEngine'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const universeId = searchParams?.get('universeId')
  const filterUserId = searchParams?.get('userId')
  if (!universeId) return NextResponse.json({ error: 'universeId required' }, { status: 400 })

  const access = await resolveZombieUniverseAccess(universeId, session.user.id)
  if (!access.exists) return NextResponse.json({ error: 'Universe not found' }, { status: 404 })
  if (!access.isOwner) return NextResponse.json({ error: 'Use the universe standings for member-visible results.' }, { status: 403 })

  if (filterUserId) {
    const rows = await prisma.zombieUniverseStat.findMany({
      where: { universeId, userId: filterUserId },
      orderBy: { season: 'desc' },
    })
    return NextResponse.json({ history: rows })
  }

  const stats = await prisma.zombieUniverseStat.findMany({
    where: { universeId },
    orderBy: [{ universeRank: 'asc' }],
  })

  return NextResponse.json({ stats })
}

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const universeId = typeof body.universeId === 'string' ? body.universeId : null
  const action = typeof body.action === 'string' ? body.action : ''
  const season = typeof body.season === 'number' ? body.season : new Date().getFullYear()

  if (action !== 'execute_movement' || !universeId)
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const access = await resolveZombieUniverseAccess(universeId, userId)
  if (!access.exists) return NextResponse.json({ error: 'Universe not found' }, { status: 404 })
  if (!access.isOwner) return NextResponse.json({ error: 'Only the universe commissioner can record movement.' }, { status: 403 })
  if (!Number.isInteger(season) || season < 2000 || season > 2200) return NextResponse.json({ error: 'Invalid season' }, { status: 400 })
  try {
    const result = await executePromotionRelegation(universeId, season, userId)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    const errors: Record<string, string> = {
      MOVEMENT_MANUAL_REVIEW_REQUIRED: 'This universe requires manual movement review.',
      MOVEMENT_SEASONS_INCOMPLETE: 'Every linked league must finish this season before movement is recorded.',
      MOVEMENT_RECONCILIATION_REQUIRED: 'Resolve weekly score corrections before recording movement.',
      MOVEMENT_LEGACY_REVIEW_REQUIRED: 'Existing movement records need commissioner review.',
      MOVEMENT_MEMBERSHIP_AMBIGUOUS: 'A manager has multiple or unidentified seats. Review universe membership.',
      MOVEMENT_STANDINGS_INCOMPLETE: 'Complete standings are required for every manager.',
      MOVEMENT_OWNER_REQUIRED: 'Only the universe commissioner can record movement.',
    }
    return NextResponse.json({ error: errors[code] ?? 'Movement could not be recorded. Refresh and retry.' }, { status: 409 })
  }
}
