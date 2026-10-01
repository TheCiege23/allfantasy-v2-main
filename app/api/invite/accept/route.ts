import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { acceptInvite } from '@/lib/invite-engine'
import { getClientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const code = typeof body.code === 'string' ? body.code.trim() : null
  if (!code) return NextResponse.json({ error: 'Missing code' }, { status: 400 })
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : null

  const result = await acceptInvite(code, userId, {
    ip: getClientIp(req),
    userAgent: req.headers.get('user-agent'),
    deviceId,
  })
  if (!result.ok) {
    // The division gate refused an open join: hand back the structured refusal, so the page can offer
    // "ask the commissioner" instead of a bare message (lib/league-join/classRequests.ts).
    if (result.divisionGate) return NextResponse.json(result.divisionGate, { status: 403 })
    const statusByError: Record<string, number> = {
      'Invite expired': 410,
      'Invite limit reached': 409,
      'League is full': 409,
      'Referral already claimed': 409,
      'You cannot redeem your own referral invite': 400,
      'Invalid or expired invite': 404,
      'Invalid code': 400,
    }
    return NextResponse.json({ error: result.error }, { status: statusByError[result.error] ?? 400 })
  }
  return NextResponse.json({
    ok: true,
    inviteType: result.inviteType,
    targetId: result.targetId,
    alreadyMember: result.alreadyMember,
    alreadyRedeemed: result.alreadyRedeemed,
    destinationHref: result.destinationHref,
    pendingReview: result.pendingReview ?? false,
  })
}
