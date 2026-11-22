import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getCareerWidgetSnapshot } from '@/lib/core-app/careerScreen'

/**
 * GET /api/core/career/widget-snapshot — what the iOS "Your career" widget shows, for the signed-in
 * user. Called by the app when it opens or comes back to the foreground
 * (components/platform/CareerWidgetSync.tsx), so the widget stays current without the person having
 * to visit the Career tab.
 *
 * Reads Postgres only (the stored career profile, rebuilt from our own tables when its stamp is
 * stale) — no provider call. 204 when there is no career yet: the widget keeps what it has.
 */

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }

export async function GET() {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })

  try {
    const snapshot = await getCareerWidgetSnapshot(userId)
    if (!snapshot) return new NextResponse(null, { status: 204, headers })
    return NextResponse.json({ snapshot }, { headers })
  } catch (error) {
    console.error('[api/core/career/widget-snapshot] failed', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ error: 'Career unavailable' }, { status: 500, headers })
  }
}
