import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { runTodayActions } from '@/lib/today-actions-engine'
import {
  enrichLineupActionsWithLinks,
  enrichLineupBlocksWithLinks,
  buildLeagueActionBundles,
} from '@/lib/league-links/enrichDecisionOsActions'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await runTodayActions(userId)
    // Imported-league source-platform deep links — resolved SERVER-SIDE from the canonical League row
    // (never a cached/provider URL, never a URL carried by the item). DB-first: no provider fetch here.
    body.lineup.actions = await enrichLineupActionsWithLinks(body.lineup.actions)
    body.lineup.leagues = await enrichLineupBlocksWithLinks(body.lineup.leagues)
    const tradeBundles = await buildLeagueActionBundles(
      body.trades.trades.map((t) => ({ leagueId: t.leagueId, leagueName: t.leagueName })),
      { action: 'trade', internalLabel: 'Analyze Trade in AF', internalTab: 'trades', externalLabel: (n) => `Review Trade in ${n}` },
    )
    for (const t of body.trades.trades) t.actionLinks = tradeBundles.get(t.leagueId)
    const waiverBundles = await buildLeagueActionBundles(
      body.waivers.recommendations.map((r) => ({ leagueId: r.leagueId, leagueName: r.leagueName })),
      { action: 'waiver', internalLabel: 'Analyze Waivers in AF', internalTab: 'players', externalLabel: (n) => `Manage Waivers in ${n}` },
    )
    for (const r of body.waivers.recommendations) r.actionLinks = waiverBundles.get(r.leagueId)
    return NextResponse.json(body)
  } catch (err) {
    console.error('[today-actions] runTodayActions failed', err)
    const detail = err instanceof Error ? err.message : 'unknown'
    // Return 503 + structured error so the client can surface "Today Actions temporarily unavailable"
    // without defaulting to a misleading "All clear" zero-state.
    return NextResponse.json(
      {
        error: 'Today Actions pipeline failed',
        detail,
        degraded: true,
      },
      { status: 503 },
    )
  }
}
