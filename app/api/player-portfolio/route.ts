/**
 * Cross-League Player Intelligence phase — Part 10, the "My Players" list API.
 *
 * Authenticates, derives the user server-side, and calls the real coordinator
 * (`assembleCrossLeaguePlayerPortfolio`) — which itself derives every league
 * membership and roster row from the resolved `appUserId`, never a
 * client-supplied one. Filtering/sorting happens here, over the real,
 * already-authorized result — never a second, independent data path.
 */
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { assembleCrossLeaguePlayerPortfolio } from '@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio'
import type { CrossLeaguePlayerPortfolioItem, InjuryStatus, RosterStatus } from '@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio'

export const dynamic = 'force-dynamic'

type SortKey = 'action_urgency' | 'exposure' | 'name' | 'injury_severity' | 'bye_week' | 'next_game' | 'position' | 'league_count'

const INJURY_SEVERITY_RANK: Record<InjuryStatus, number> = {
  out: 6,
  ir: 6,
  suspended: 5,
  doubtful: 4,
  questionable: 3,
  day_to_day: 2,
  healthy: 0,
  unknown: 1,
}

function applyFilters(items: CrossLeaguePlayerPortfolioItem[], params: URLSearchParams): CrossLeaguePlayerPortfolioItem[] {
  const provider = params.get('provider')
  const leagueId = params.get('league')
  const position = params.get('position')
  const professionalTeam = params.get('professionalTeam')
  const injuryStatus = params.get('injuryStatus') as InjuryStatus | null
  const rosterStatus = params.get('rosterStatus') as RosterStatus | null
  const actionNeeded = params.get('actionNeeded') === 'true'
  const exposureThreshold = params.get('exposureThreshold') ? Number(params.get('exposureThreshold')) : null
  const search = params.get('search')?.trim().toLowerCase()

  return items.filter((item) => {
    if (provider && !item.leagueAppearances.some((a) => a.provider === provider)) return false
    if (leagueId && !item.leagueAppearances.some((a) => a.canonicalLeagueId === leagueId)) return false
    if (position && item.position !== position) return false
    if (professionalTeam && item.professionalTeam !== professionalTeam) return false
    if (injuryStatus && item.injury?.status !== injuryStatus) return false
    if (rosterStatus && !item.leagueAppearances.some((a) => a.rosterStatus === rosterStatus)) return false
    if (actionNeeded && item.actionSummary.criticalCount === 0 && item.actionSummary.highCount === 0) return false
    if (exposureThreshold !== null && item.exposure.percentageOfUserLeagues < exposureThreshold) return false
    if (search && !item.displayName.toLowerCase().includes(search)) return false
    return true
  })
}

function applySort(items: CrossLeaguePlayerPortfolioItem[], sort: SortKey | null): CrossLeaguePlayerPortfolioItem[] {
  const sorted = [...items]
  switch (sort) {
    case 'exposure':
      return sorted.sort((a, b) => b.exposure.percentageOfUserLeagues - a.exposure.percentageOfUserLeagues)
    case 'name':
      return sorted.sort((a, b) => a.displayName.localeCompare(b.displayName))
    case 'injury_severity':
      return sorted.sort((a, b) => INJURY_SEVERITY_RANK[b.injury?.status ?? 'unknown'] - INJURY_SEVERITY_RANK[a.injury?.status ?? 'unknown'])
    case 'bye_week':
      return sorted.sort((a, b) => (a.schedule?.byeWeek ?? 99) - (b.schedule?.byeWeek ?? 99))
    case 'next_game':
      return sorted.sort((a, b) => (a.schedule?.nextGameAt ?? '9999').localeCompare(b.schedule?.nextGameAt ?? '9999'))
    case 'position':
      return sorted.sort((a, b) => (a.position ?? '').localeCompare(b.position ?? ''))
    case 'league_count':
      return sorted.sort((a, b) => b.exposure.leagueCount - a.exposure.leagueCount)
    case 'action_urgency':
    default:
      return sorted.sort((a, b) => {
        const aScore = a.actionSummary.criticalCount * 2 + a.actionSummary.highCount
        const bScore = b.actionSummary.criticalCount * 2 + b.actionSummary.highCount
        return bScore - aScore
      })
  }
}

export async function GET(req: Request) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const sport = url.searchParams.get('sport') ?? undefined
  const season = url.searchParams.get('season') ? Number(url.searchParams.get('season')) : undefined

  try {
    const result = await assembleCrossLeaguePlayerPortfolio({ appUserId: auth.userId, sport, season })
    const filtered = applyFilters(result.items, url.searchParams)
    const sorted = applySort(filtered, url.searchParams.get('sort') as SortKey | null)

    return NextResponse.json({
      items: sorted,
      totalCount: sorted.length,
      connectedLeagueCount: result.connectedLeagueCount,
      unsupportedSports: result.unsupportedSports,
      generatedAt: new Date().toISOString(),
    })
  } catch (error: unknown) {
    console.error('[Player Portfolio]', error)
    return NextResponse.json({ error: 'Failed to load player portfolio' }, { status: 500 })
  }
}
