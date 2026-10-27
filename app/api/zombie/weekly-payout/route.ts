import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireCommissionerOnly } from '@/lib/league/permissions'
import { buildWeeklyUpdate, composeWeeklyUpdateBody } from '@/lib/zombie/weeklyUpdateEngine'

export const dynamic = 'force-dynamic'

async function commissioner(leagueId: string, userId: string): Promise<Response | null> {
  try {
    await requireCommissionerOnly(leagueId, userId)
    return null
  } catch (denied) {
    if (denied instanceof Response) return denied
    throw denied
  }
}

export async function GET(req: Request) {
  const userId = ((await getServerSession(authOptions as never)) as { user?: { id?: string } } | null)?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = new URL(req.url).searchParams.get('leagueId')
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  const denied = await commissioner(leagueId, userId)
  if (denied) return denied
  const z = await prisma.zombieLeague.findUnique({ where: { leagueId }, select: { id: true } })
  if (!z) return NextResponse.json({ error: 'Zombie league not found' }, { status: 404 })
  const payouts = await prisma.zombieExternalWeeklyPayout.findMany({
    where: { zombieLeagueId: z.id }, orderBy: { week: 'desc' }, take: 40,
  })
  return NextResponse.json({ payouts })
}

export async function PUT(req: Request) {
  const userId = ((await getServerSession(authOptions as never)) as { user?: { id?: string } } | null)?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId : ''
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  const denied = await commissioner(leagueId, userId)
  if (denied) return denied
  const z = await prisma.zombieLeague.findUnique({ where: { leagueId }, select: { id: true, isPaid: true } })
  if (!z?.isPaid) return NextResponse.json({ error: 'Paid Zombie league required' }, { status: 400 })

  const week = body.week
  const winnerRosterId = body.winnerRosterId
  const amountCents = body.amountCents
  const providerName = typeof body.providerName === 'string' ? body.providerName.trim() : ''
  const status = body.status
  const reference = typeof body.reference === 'string' ? body.reference.trim() : null
  if (typeof week !== 'number' || !Number.isInteger(week) || week < 1 ||
      typeof winnerRosterId !== 'string' ||
      typeof amountCents !== 'number' || !Number.isSafeInteger(amountCents) || amountCents < 0 || amountCents > 100_000_000 ||
      !['LeagueSafe', 'Fancred', 'Other'].includes(providerName) ||
      !['recorded', 'confirmed'].includes(String(status)) ||
      (reference && reference.length > 160)) {
    return NextResponse.json({ error: 'Valid week, winner, cents, provider, and status required' }, { status: 400 })
  }
  const [resolution, winner] = await Promise.all([
    prisma.zombieWeeklyResolution.findUnique({ where: { zombieLeagueId_week: { zombieLeagueId: z.id, week } }, select: { status: true } }),
    prisma.zombieLeagueTeam.findUnique({ where: { leagueId_rosterId: { leagueId, rosterId: winnerRosterId } }, select: { id: true } }),
  ])
  if (resolution?.status !== 'complete') return NextResponse.json({ error: 'Week must resolve before a payout is recorded' }, { status: 409 })
  if (!winner) return NextResponse.json({ error: 'Winner is not on this league' }, { status: 400 })

  const payout = await prisma.zombieExternalWeeklyPayout.upsert({
    where: { zombieLeagueId_week: { zombieLeagueId: z.id, week } },
    create: {
      zombieLeagueId: z.id, week, winnerRosterId, amountCents,
      providerName, status: String(status), reference, recordedById: userId,
      confirmedAt: status === 'confirmed' ? new Date() : null,
    },
    update: {
      winnerRosterId, amountCents, providerName, status: String(status), reference,
      recordedById: userId, recordedAt: new Date(),
      confirmedAt: status === 'confirmed' ? new Date() : null,
    },
  })
  const announcement = await prisma.zombieAnnouncement.findUnique({
    where: { idempotencyKey: `zombie-weekly:${z.id}:${week}` }, select: { id: true, isPosted: true },
  })
  if (announcement?.isPosted) {
    const draft = await buildWeeklyUpdate(leagueId, week)
    const text = composeWeeklyUpdateBody(draft)
    await prisma.$transaction([
      prisma.zombieAnnouncement.update({ where: { id: announcement.id }, data: { content: text } }),
      prisma.leagueChatMessage.updateMany({ where: { zombieWeeklyAnnouncementId: announcement.id }, data: { message: text.slice(0, 100_000) } }),
    ])
  }
  return NextResponse.json({ payout })
}
