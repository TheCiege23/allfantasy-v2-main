import 'server-only'

import { prisma } from '@/lib/prisma'
import { getLeagueActivity } from '@/lib/core-app/leagueActivity'
import { activityRows } from '@/lib/core-app/tradesActivity'
import { TradesLeagueActivityView } from '@/components/core-app/screens/TradesLeagueActivityView'

/**
 * The Trades tab's League activity, streamed under the trade history (2026-11-14). Reads the same
 * `decision_os_imported_activity` rows the league home's buzz does, through `getLeagueActivity`, so the
 * two can never disagree. A failed read renders "could not be read", never an empty list.
 */
export async function TradesLeagueActivity({ leagueId, language }: { leagueId: string; language: string }) {
  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { platformLeagueId: true, platform: true, sport: true },
    })
    if (!league) return null
    const activity = await getLeagueActivity({
      leagueId,
      platformLeagueId: league.platformLeagueId ?? null,
      platform: league.platform ?? null,
      sport: league.sport ?? null,
      limit: 24,
    })
    /* Null from the reader is "no rows for this league" (it swallows its own query errors), so: empty. */
    return <TradesLeagueActivityView rows={activityRows(activity?.items ?? [])} language={language} />
  } catch (e: unknown) {
    console.error('[core/trades] league activity read failed', e)
    return <TradesLeagueActivityView rows={null} language={language} />
  }
}
