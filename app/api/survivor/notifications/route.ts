import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { isCommissioner } from '@/lib/commissioner/permissions'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  const filterUserId = req.nextUrl.searchParams?.get('userId')?.trim() ?? userId
  const type = req.nextUrl.searchParams?.get('type')?.trim()
  const status = req.nextUrl.searchParams?.get('status')?.trim()
  const urgency = req.nextUrl.searchParams?.get('urgency')?.trim()

  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  // Notifications are private (idols, tribal info). Membership alone let any member
  // read another's by passing ?userId=; only the commissioner may look at someone else's.
  if (filterUserId !== userId && !(await isCommissioner(leagueId, userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rows = await prisma.survivorNotification.findMany({
    where: {
      leagueId,
      OR: [{ recipientUserId: filterUserId }, { recipientUserId: null }],
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
      ...(urgency ? { urgency } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return NextResponse.json({ notifications: rows })
}

