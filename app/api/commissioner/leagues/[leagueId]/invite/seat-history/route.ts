import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { prisma } from '@/lib/prisma'
import { rateLimit } from '@/lib/rate-limit'
import { checkProviderDelivery } from '@/lib/core-app/teamDeliveryReconciliation'
import { pendingSeatInviteStatuses, recordSeatInviteProviderEvent, seatInviteHistorySelect } from '@/lib/league/seatInvites'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ leagueId: string }> }

async function authorize(leagueId: string) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const error = await commissionerAccessResponse(leagueId, userId, 'league')
  return error ? { error } : { userId }
}

export async function GET(req: NextRequest, { params }: Context) {
  const { leagueId } = await params
  const auth = await authorize(leagueId)
  if (auth.error) return auth.error
  const id = req.nextUrl.searchParams.get('leagueTeamId')
  if (!id) return NextResponse.json({ error: 'Choose a team.' }, { status: 400 })

  const seat = await prisma.leagueTeam.findFirst({
    where: { leagueId, id, role: { not: 'viewer' } },
    select: { invites: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20, select: seatInviteHistorySelect } },
  })
  if (!seat) return NextResponse.json({ error: 'Team not found in this league.' }, { status: 404 })
  return NextResponse.json({ invites: seat.invites })
}

export async function PATCH(req: NextRequest, { params }: Context) {
  const { leagueId } = await params
  const auth = await authorize(leagueId)
  if (auth.error) return auth.error
  const body = await req.json().catch(() => null)
  if (typeof body?.inviteId !== 'string') return NextResponse.json({ error: 'Choose an invite.' }, { status: 400 })
  const attempt = await prisma.leagueSeatInvite.findFirst({
    where: { id: body.inviteId, team: { leagueId } },
    select: { ...seatInviteHistorySelect, providerMessageId: true },
  })
  if (!attempt) return NextResponse.json({ error: 'Invite not found in this league.' }, { status: 404 })
  const { providerMessageId, ...invite } = attempt
  if (!providerMessageId || !pendingSeatInviteStatuses.includes(invite.status)) return NextResponse.json({ invite })
  const allowed = rateLimit(`league-seat-email-status:${auth.userId}`, 18, 60_000)
  if (!allowed.success) return NextResponse.json({ error: 'Wait a minute before checking delivery again.' }, { status: 429 })
  const provider = await checkProviderDelivery('email', providerMessageId, 3500)
  if (!provider) return NextResponse.json({ invite, message: 'The email provider could not confirm the latest status.' })
  const event = provider.status === 'failed' ? provider.reason.replace(/^provider_/, '') : provider.status
  await recordSeatInviteProviderEvent(providerMessageId, event)
  const updated = await prisma.leagueSeatInvite.findUnique({ where: { id: attempt.id }, select: seatInviteHistorySelect })
  return NextResponse.json({ invite: updated ?? invite })
}
