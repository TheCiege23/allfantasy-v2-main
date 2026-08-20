import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertCommissioner } from '@/lib/commissioner/permissions'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await assertCommissioner(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { autoCoachEnabled: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  return NextResponse.json({ autoCoachEnabled: league.autoCoachEnabled ?? true })
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await assertCommissioner(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  }

  let body: { autoCoachEnabled?: boolean }
  try {
    body = (await req.json()) as { autoCoachEnabled?: boolean }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const next = body.autoCoachEnabled !== false

  await prisma.$transaction([
    prisma.league.update({
      where: { id: leagueId },
      data: { autoCoachEnabled: next },
    }),
    prisma.autoCoachSetting.updateMany({
      where: { leagueId },
      data: { blockedByCommissioner: !next },
    }),
  ])

  return NextResponse.json({ updated: true, autoCoachEnabled: next })
}
