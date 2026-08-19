import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import {
  assembleCrossLeaguePlayerPortfolio,
  type CrossLeaguePlayerPortfolioItem,
} from '@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/player-portfolio — Cross-League Player Intelligence Part 10.
 *
 * REBUILT 2026-08-10: this route was missing from the tree while
 * `app/my-players/MyPlayersClient.tsx` fetched it (a live 404) and two test
 * suites imported it — the "broken in prod is usually never merged" failure
 * mode. Rebuilt against the contract those suites pin:
 *   - appUserId ONLY from the session (`requireAuth`); any client-supplied
 *     user param is ignored.
 *   - server-side filters: sport, injuryStatus, actionNeeded=true
 *   - sort: action_urgency (default) | exposure | name | injury_severity |
 *     bye_week | league_count (the exact SortKey set MyPlayersClient sends)
 *   - 500s never leak internals.
 */

const INJURY_SEVERITY_RANK: Record<string, number> = {
  out: 5,
  ir: 5,
  suspended: 5,
  doubtful: 4,
  questionable: 3,
  day_to_day: 3,
  unknown: 1,
  healthy: 0,
}

function urgencyScore(item: CrossLeaguePlayerPortfolioItem): number {
  return item.actionSummary.criticalCount * 2 + item.actionSummary.highCount
}

function sortItems(items: CrossLeaguePlayerPortfolioItem[], sort: string): CrossLeaguePlayerPortfolioItem[] {
  const byName = (a: CrossLeaguePlayerPortfolioItem, b: CrossLeaguePlayerPortfolioItem) =>
    a.displayName.localeCompare(b.displayName)
  const sorted = [...items]
  switch (sort) {
    case 'exposure':
      return sorted.sort(
        (a, b) => b.exposure.percentageOfUserLeagues - a.exposure.percentageOfUserLeagues || byName(a, b),
      )
    case 'name':
      return sorted.sort(byName)
    case 'injury_severity':
      return sorted.sort(
        (a, b) =>
          (INJURY_SEVERITY_RANK[b.injury?.status ?? ''] ?? 0) - (INJURY_SEVERITY_RANK[a.injury?.status ?? ''] ?? 0) ||
          byName(a, b),
      )
    case 'bye_week':
      // Soonest bye first; players with no bye (null) sort last.
      return sorted.sort((a, b) => {
        const av = a.schedule?.byeWeek ?? Number.POSITIVE_INFINITY
        const bv = b.schedule?.byeWeek ?? Number.POSITIVE_INFINITY
        return av - bv || byName(a, b)
      })
    case 'league_count':
      return sorted.sort((a, b) => b.exposure.leagueCount - a.exposure.leagueCount || byName(a, b))
    case 'action_urgency':
    default:
      return sorted.sort(
        (a, b) =>
          urgencyScore(b) - urgencyScore(a) ||
          b.exposure.percentageOfUserLeagues - a.exposure.percentageOfUserLeagues ||
          byName(a, b),
      )
  }
}

export async function GET(req: Request) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  try {
    const url = new URL(req.url)
    const sport = url.searchParams.get('sport')?.trim().toUpperCase() || undefined

    const result = await assembleCrossLeaguePlayerPortfolio({
      appUserId: auth.userId,
      ...(sport ? { sport } : {}),
    })

    let items = result.items
    const injuryStatus = url.searchParams.get('injuryStatus')?.trim().toLowerCase()
    if (injuryStatus) {
      items = items.filter((i) => i.injury?.status === injuryStatus)
    }
    if (url.searchParams.get('actionNeeded') === 'true') {
      items = items.filter((i) => i.actionSummary.criticalCount > 0 || i.actionSummary.highCount > 0)
    }

    items = sortItems(items, url.searchParams.get('sort') ?? 'action_urgency')

    return NextResponse.json({
      items,
      totalCount: items.length,
      connectedLeagueCount: result.connectedLeagueCount,
      unsupportedSports: result.unsupportedSports,
      generatedAt: new Date().toISOString(),
      // Slice 18 — injury source health (ambiguous name collisions the injury
      // read port refused to bind, feed staleness). Optional so older callers
      // and test fixtures without it keep working.
      injuryPort: result.injuryPort ?? null,
    })
  } catch (error) {
    console.error('[player-portfolio] error:', error)
    return NextResponse.json({ error: 'Failed to load player portfolio.' }, { status: 500 })
  }
}
