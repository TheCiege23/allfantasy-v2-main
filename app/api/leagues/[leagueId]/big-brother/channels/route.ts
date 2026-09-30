import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getAccessibleBbChannels } from '@/lib/big-brother/BigBrotherChatChannels'
import { isBigBrotherLeague } from '@/lib/big-brother/BigBrotherLeagueConfig'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = params
  if (!(await isBigBrotherLeague(leagueId))) {
    return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 400 })
  }

  const channels = await getAccessibleBbChannels(leagueId, userId)
  return NextResponse.json({ ok: true, channels })
}
