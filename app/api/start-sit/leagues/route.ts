import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { prismaSportToUiKey } from '@/lib/startSit/shared'
import { resolvesToLeagueRecord, type LeagueRecordPolicyInput } from '@/lib/dashboard/league-card-fetch-policy'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const q = new URL(req.url).searchParams.get('userId')?.trim() ?? ''
  const userId = (typeof session?.user?.id === 'string' ? session.user.id : '') || q

  const empty = {
    nfl: [] as { id: string; name: string }[],
    nba: [] as { id: string; name: string }[],
    mlb: [] as { id: string; name: string }[],
    nhl: [] as { id: string; name: string }[],
    soccer: [] as { id: string; name: string }[],
    cfb: [] as { id: string; name: string }[],
    cbb: [] as { id: string; name: string }[],
  }

  if (!userId) {
    return NextResponse.json(empty)
  }

  try {
    const payload = await getDashboardLeagueListForUser(userId)
    const leagues = Array.isArray(payload.leagues) ? payload.leagues : []
    const grouped: typeof empty = { ...empty }
    for (const row of leagues) {
      const r = row as Record<string, unknown>
      const id = typeof r.id === 'string' ? r.id : ''
      if (!id) continue
      /*
       * Start/Sit resolves the id the picker sends against the `leagues` table. AF Legacy rows and
       * tournament hubs carry ids from other tables, so offering them here builds a picker whose
       * entries cannot be answered — the tournament case slipped through because those rows set
       * `hasUnifiedRecord: true`.
       */
      if (!resolvesToLeagueRecord(r as LeagueRecordPolicyInput)) continue
      const name = typeof r.name === 'string' && r.name.trim() ? r.name : 'League'
      const sport = typeof r.sport === 'string' ? r.sport : 'NFL'
      const key = prismaSportToUiKey(sport) as keyof typeof grouped
      if (!grouped[key]) grouped[key] = []
      grouped[key].push({ id, name })
    }
    return NextResponse.json(grouped)
  } catch (e) {
    console.error('[start-sit/leagues]', e)
    return NextResponse.json(empty)
  }
}
