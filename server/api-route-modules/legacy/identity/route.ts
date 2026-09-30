import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getUserSessionFromCookie } from '@/lib/api-auth'
import { resolveLegacyIdentityForAppUser } from '@/lib/legacy-identity'

export async function GET() {
  try {
    const session = (await getServerSession(authOptions as any)) as {
      user?: { id?: string | null; email?: string | null }
    } | null

    const appUserId = session?.user?.id ? String(session.user.id) : ''
    if (!appUserId) {
      return NextResponse.json({
        authenticated: false,
        resolved: false,
        identity: null,
      })
    }

    const legacyCookieSession = (await getUserSessionFromCookie())
    const identity = await resolveLegacyIdentityForAppUser({
      appUserId,
      fallbackSleeperUsername: legacyCookieSession?.sleeperUsername || null,
      createIfMissing: true,
    })

    return NextResponse.json({
      authenticated: true,
      resolved: Boolean(identity?.recommendedUserId),
      identity,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to resolve legacy identity'
    return NextResponse.json(
      {
        authenticated: false,
        resolved: false,
        identity: null,
        error: message,
      },
      { status: 500 },
    )
  }
}
