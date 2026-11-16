import { requireCommissionerAccess } from '@/lib/league/commissionerAccess'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type UiPrefs = {
  animations?: Record<string, unknown>
  advanced?: Record<string, unknown>
}

export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const leagueId = searchParams?.get('leagueId')
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  await requireCommissionerAccess(leagueId, session.user.id, 'view')
  const z = await prisma.zombieLeague.findUnique({
    where: { leagueId },
    select: { commissionerUiPrefs: true },
  })
  if (!z) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ prefs: (z.commissionerUiPrefs as UiPrefs | null) ?? null })
}

export async function PATCH(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    leagueId?: string
    animations?: Record<string, unknown>
    advanced?: Record<string, unknown>
  }
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId : null
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  await requireCommissionerAccess(leagueId, session.user.id, 'league')
  const z = await prisma.zombieLeague.findUnique({ where: { leagueId }, select: { id: true, commissionerUiPrefs: true } })
  if (!z) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const prev = (z.commissionerUiPrefs as UiPrefs | null) ?? {}
  const next: UiPrefs = { ...prev }
  if (body.animations && typeof body.animations === 'object') {
    next.animations = { ...(prev.animations ?? {}), ...body.animations }
  }
  if (body.advanced && typeof body.advanced === 'object') {
    next.advanced = { ...(prev.advanced ?? {}), ...body.advanced }
  }

  await prisma.zombieLeague.update({
    where: { id: z.id },
    data: { commissionerUiPrefs: next as object },
  })

  return NextResponse.json({ ok: true, prefs: next })
}

