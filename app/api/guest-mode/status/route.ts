import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { GUEST_SESSION_COOKIE_NAME, verifyGuestSessionToken } from '@/lib/guest-mode/guestSessionToken'

export const dynamic = 'force-dynamic'

/**
 * The only client-readable signal of guest state — af_guest_session is HttpOnly by design,
 * so no component can read it directly. Client accessTier resolution treats "no session" as
 * guest tier regardless of this response; this route only supplies the guest's imported
 * identity (sleeperUsername/displayName) for richer guest-state copy ("Welcome back, @user").
 */
export async function GET() {
  const token = (await cookies()).get(GUEST_SESSION_COOKIE_NAME)?.value
  const guest = await verifyGuestSessionToken(token)
  if (!guest) {
    return NextResponse.json({ isGuest: false, sleeperUsername: null, displayName: null })
  }

  const legacyUser = await prisma.legacyUser
    .findUnique({ where: { id: guest.legacyUserId }, select: { sleeperUsername: true, displayName: true } })
    .catch(() => null)

  if (!legacyUser) {
    return NextResponse.json({ isGuest: false, sleeperUsername: null, displayName: null })
  }

  return NextResponse.json({
    isGuest: true,
    sleeperUsername: legacyUser.sleeperUsername,
    displayName: legacyUser.displayName,
  })
}
