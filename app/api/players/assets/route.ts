import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  getNflInjuries,
  injuryForName,
  theSportsDbHeadshots,
  type InjuryFlag,
  type TsdbHeadshot,
} from '@/lib/sports-data/playerAssetsService'

export const dynamic = 'force-dynamic'

/**
 * Player asset enrichment: TheSportsDB headshot fallbacks (for players the
 * Sleeper CDN doesn't cover) + Rolling Insights injury flags (when the RSC
 * token is configured).
 *
 * GET ?names=Name One|Name Two|…  (≤24 names)
 * → { headshots: { [name]: {cutout,thumb} | null },
 *     injuries:  { configured, available?, byName? matched to the SAME names } }
 */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const namesParam = req.nextUrl.searchParams?.get('names') ?? ''
  const names = namesParam
    .split('|')
    .map((n) => n.trim())
    .filter(Boolean)
    .slice(0, 24)
  if (names.length === 0) {
    return NextResponse.json({ error: 'Missing names' }, { status: 400 })
  }

  const [headshots, injuriesPayload] = await Promise.all([
    theSportsDbHeadshots(names),
    getNflInjuries(),
  ])

  const injuries: {
    configured: boolean
    available: boolean
    byName: Record<string, InjuryFlag>
  } = { configured: injuriesPayload.configured, available: false, byName: {} }
  if (injuriesPayload.configured && 'available' in injuriesPayload && injuriesPayload.available) {
    injuries.available = true
    for (const n of names) {
      const flag = injuryForName(injuriesPayload, n)
      if (flag) injuries.byName[n] = flag
    }
  }

  return NextResponse.json({
    headshots: headshots as Record<string, TsdbHeadshot | null>,
    injuries,
  })
}
