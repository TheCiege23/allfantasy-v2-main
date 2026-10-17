import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { appendEvent } from '@/lib/guillotine/GuillotineEventLog'

export const dynamic = 'force-dynamic'

/**
 * POST: an eliminated user requests full removal from the league. This
 * creates a pending commissioner notification — the user stays in the
 * league until the commissioner approves.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = params

  const [league, roster] = await Promise.all([
    prisma.league.findUnique({
      where: { id: leagueId },
      select: { userId: true, guillotineMode: true },
    }),
    prisma.roster.findFirst({
      where: { leagueId, platformUserId: userId },
      select: { id: true },
    }),
  ])
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (!league.guillotineMode) {
    return NextResponse.json({ error: 'Not a Guillotine league' }, { status: 400 })
  }
  if (!roster) return NextResponse.json({ error: 'No roster found' }, { status: 404 })

  const guillotineState = await prisma.guillotineRosterState.findFirst({
    where: { leagueId, rosterId: roster.id },
    select: { choppedAt: true },
  })

  if (!guillotineState?.choppedAt) {
    return NextResponse.json({ error: 'Active rosters cannot request removal' }, { status: 400 })
  }

  let body: { reason?: string } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    // empty body OK
  }

  await appendEvent(leagueId, 'removal_request', {
    userId,
    rosterId: roster.id,
    reason: body.reason?.trim().slice(0, 500) ?? null,
    commissionerUserId: league.userId,
  }).catch(() => {})

  return NextResponse.json({ ok: true, message: 'Request sent to commissioner.' })
}
