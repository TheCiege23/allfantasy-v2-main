import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getCommandCenter } from '@/lib/dashboard-intel/commandCenterService'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Cross-league Command Center for the main dashboard: urgency-ranked feed +
 * week-at-a-glance + portfolio, aggregated from every OS engine. Cached 10
 * minutes per user; ?force=1 rebuilds.
 */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const force = req.nextUrl.searchParams?.get('force') === '1'
  const center = await getCommandCenter(userId, { force })
  if (!center) {
    return NextResponse.json(
      { center: null, error: 'Command center temporarily unavailable' },
      { status: 502 },
    )
  }
  return NextResponse.json({ center })
}
