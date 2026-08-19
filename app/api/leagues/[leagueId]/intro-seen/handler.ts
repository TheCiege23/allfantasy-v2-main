import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessLeagueIntro } from '@/lib/league/intro-access'

export const dynamic = 'force-dynamic'

type SessionShape = {
  user?: {
    id?: string
    role?: string | null
    email?: string | null
  }
} | null

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as any)) as SessionShape
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueIntro({
    leagueId,
    userId,
    role: session?.user?.role ?? null,
    email: session?.user?.email ?? null,
  })
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await (prisma as any).leagueIntroView.upsert({
    where: {
      leagueId_userId: {
        leagueId,
        userId,
      },
    },
    update: {
      seenAt: new Date(),
    },
    create: {
      leagueId,
      userId,
    },
  })

  return NextResponse.json({ ok: true })
}
