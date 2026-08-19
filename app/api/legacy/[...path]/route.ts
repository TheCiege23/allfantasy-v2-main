import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

type RouteContext = { params: Record<string, string | string[] | undefined> }
type RouteModule = Partial<Record<string, (request: NextRequest, context: RouteContext) => Response | Promise<Response>>>
type RouteLoader = () => Promise<unknown>

const ROUTES: Array<{ pattern: string[]; load: RouteLoader }> = [
  { pattern: ["leagues",":leagueId","draft-war-room"], load: () => import('@/server/api-route-modules/legacy/leagues/[leagueId]/draft-war-room/route') },
  { pattern: ["leagues",":leagueId","market-board"], load: () => import('@/server/api-route-modules/legacy/leagues/[leagueId]/market-board/route') },
  { pattern: ["leagues",":leagueId","team-scan"], load: () => import('@/server/api-route-modules/legacy/leagues/[leagueId]/team-scan/route') },
  { pattern: ["leagues",":leagueId","trade-command-center"], load: () => import('@/server/api-route-modules/legacy/leagues/[leagueId]/trade-command-center/route') },
  { pattern: ["ai","run"], load: () => import('@/server/api-route-modules/legacy/ai/run/route') },
  { pattern: ["backfill","playoffs"], load: () => import('@/server/api-route-modules/legacy/backfill/playoffs/route') },
  { pattern: ["decision-guardian","evaluate"], load: () => import('@/server/api-route-modules/legacy/decision-guardian/evaluate/route') },
  { pattern: ["decision-guardian","override"], load: () => import('@/server/api-route-modules/legacy/decision-guardian/override/route') },
  { pattern: ["decision-log","evaluate"], load: () => import('@/server/api-route-modules/legacy/decision-log/evaluate/route') },
  { pattern: ["decision-log","resolve"], load: () => import('@/server/api-route-modules/legacy/decision-log/resolve/route') },
  { pattern: ["draft","recommendation-refresh"], load: () => import('@/server/api-route-modules/legacy/draft/recommendation-refresh/route') },
  { pattern: ["feedback","upload"], load: () => import('@/server/api-route-modules/legacy/feedback/upload/route') },
  { pattern: ["import","status"], load: () => import('@/server/api-route-modules/legacy/import/status/route') },
  { pattern: ["guest-import"], load: () => import('@/server/api-route-modules/legacy/guest-import/route') },
  { pattern: ["market","refresh"], load: () => import('@/server/api-route-modules/legacy/market/refresh/route') },
  { pattern: ["portfolio","history"], load: () => import('@/server/api-route-modules/legacy/portfolio/history/route') },
  { pattern: ["rank","dispute"], load: () => import('@/server/api-route-modules/legacy/rank/dispute/route') },
  { pattern: ["rank","refresh"], load: () => import('@/server/api-route-modules/legacy/rank/refresh/route') },
  { pattern: ["rankings","adaptive"], load: () => import('@/server/api-route-modules/legacy/rankings/adaptive/route') },
  { pattern: ["rankings","analyze"], load: () => import('@/server/api-route-modules/legacy/rankings/analyze/route') },
  { pattern: ["rankings","enhanced"], load: () => import('@/server/api-route-modules/legacy/rankings/enhanced/route') },
  { pattern: ["rankings","historical-ratings"], load: () => import('@/server/api-route-modules/legacy/rankings/historical-ratings/route') },
  { pattern: ["rankings","league-format"], load: () => import('@/server/api-route-modules/legacy/rankings/league-format/route') },
  { pattern: ["rankings","playoff-forecast"], load: () => import('@/server/api-route-modules/legacy/rankings/playoff-forecast/route') },
  { pattern: ["share","engagement"], load: () => import('@/server/api-route-modules/legacy/share/engagement/route') },
  { pattern: ["snapshots","latest"], load: () => import('@/server/api-route-modules/legacy/snapshots/latest/route') },
  { pattern: ["team","direction-refresh"], load: () => import('@/server/api-route-modules/legacy/team/direction-refresh/route') },
  { pattern: ["trade","analyze"], load: () => import('@/server/api-route-modules/legacy/trade/analyze/route') },
  { pattern: ["trade","feedback"], load: () => import('@/server/api-route-modules/legacy/trade/feedback/route') },
  { pattern: ["trade","goal-proposals"], load: () => import('@/server/api-route-modules/legacy/trade/goal-proposals/route') },
  { pattern: ["trade","league-analyze"], load: () => import('@/server/api-route-modules/legacy/trade/league-analyze/route') },
  { pattern: ["trade","league-managers"], load: () => import('@/server/api-route-modules/legacy/trade/league-managers/route') },
  { pattern: ["trade","preferences"], load: () => import('@/server/api-route-modules/legacy/trade/preferences/route') },
  { pattern: ["trade","proposal-generator"], load: () => import('@/server/api-route-modules/legacy/trade/proposal-generator/route') },
  { pattern: ["trade","quick-evaluate"], load: () => import('@/server/api-route-modules/legacy/trade/quick-evaluate/route') },
  { pattern: ["trade","review"], load: () => import('@/server/api-route-modules/legacy/trade/review/route') },
  { pattern: ["trade","roster"], load: () => import('@/server/api-route-modules/legacy/trade/roster/route') },
  { pattern: ["trades","check"], load: () => import('@/server/api-route-modules/legacy/trades/check/route') },
  { pattern: ["user","lookup"], load: () => import('@/server/api-route-modules/legacy/user/lookup/route') },
  { pattern: ["waiver","analyze"], load: () => import('@/server/api-route-modules/legacy/waiver/analyze/route') },
  { pattern: ["waiver","leagues"], load: () => import('@/server/api-route-modules/legacy/waiver/leagues/route') },
  { pattern: ["worker","run"], load: () => import('@/server/api-route-modules/legacy/worker/run/route') },
  { pattern: ["ai-coach"], load: () => import('@/server/api-route-modules/legacy/ai-coach/route') },
  { pattern: ["ai-gm-analyze"], load: () => import('@/server/api-route-modules/legacy/ai-gm-analyze/route') },
  { pattern: ["ai-report"], load: () => import('@/server/api-route-modules/legacy/ai-report/route') },
  { pattern: ["badges"], load: () => import('@/server/api-route-modules/legacy/badges/route') },
  { pattern: ["cfb-players"], load: () => import('@/server/api-route-modules/legacy/cfb-players/route') },
  { pattern: ["chat"], load: () => import('@/server/api-route-modules/legacy/chat/route') },
  { pattern: ["community-insights"], load: () => import('@/server/api-route-modules/legacy/community-insights/route') },
  { pattern: ["compare"], load: () => import('@/server/api-route-modules/legacy/compare/route') },
  { pattern: ["decision-log"], load: () => import('@/server/api-route-modules/legacy/decision-log/route') },
  { pattern: ["devy-board"], load: () => import('@/server/api-route-modules/legacy/devy-board/route') },
  { pattern: ["draft-war-room"], load: () => import('@/server/api-route-modules/legacy/draft-war-room/route') },
  { pattern: ["email-preferences"], load: () => import('@/server/api-route-modules/legacy/email-preferences/route') },
  { pattern: ["espn-import"], load: () => import('@/server/api-route-modules/legacy/espn-import/route') },
  { pattern: ["fantrax"], load: () => import('@/server/api-route-modules/legacy/fantrax/route') },
  { pattern: ["feedback"], load: () => import('@/server/api-route-modules/legacy/feedback/route') },
  { pattern: ["identity"], load: () => import('@/server/api-route-modules/legacy/identity/route') },
  { pattern: ["identity-sync"], load: () => import('@/server/api-route-modules/legacy/identity-sync/route') },
  { pattern: ["import"], load: () => import('@/server/api-route-modules/legacy/import/route') },
  { pattern: ["insights"], load: () => import('@/server/api-route-modules/legacy/insights/route') },
  { pattern: ["leagues"], load: () => import('@/server/api-route-modules/legacy/leagues/route') },
  { pattern: ["manager-dna"], load: () => import('@/server/api-route-modules/legacy/manager-dna/route') },
  { pattern: ["offseason-dashboard"], load: () => import('@/server/api-route-modules/legacy/offseason-dashboard/route') },
  { pattern: ["opponent-tendencies"], load: () => import('@/server/api-route-modules/legacy/opponent-tendencies/route') },
  { pattern: ["player-enrichment"], load: () => import('@/server/api-route-modules/legacy/player-enrichment/route') },
  { pattern: ["player-finder"], load: () => import('@/server/api-route-modules/legacy/player-finder/route') },
  { pattern: ["player-game-logs"], load: () => import('@/server/api-route-modules/legacy/player-game-logs/route') },
  { pattern: ["player-profile"], load: () => import('@/server/api-route-modules/legacy/player-profile/route') },
  { pattern: ["player-stock"], load: () => import('@/server/api-route-modules/legacy/player-stock/route') },
  { pattern: ["players"], load: () => import('@/server/api-route-modules/legacy/players/route') },
  { pattern: ["pre-analysis"], load: () => import('@/server/api-route-modules/legacy/pre-analysis/route') },
  { pattern: ["profile"], load: () => import('@/server/api-route-modules/legacy/profile/route') },
  { pattern: ["season-strategy"], load: () => import('@/server/api-route-modules/legacy/season-strategy/route') },
  { pattern: ["session"], load: () => import('@/server/api-route-modules/legacy/session/route') },
  { pattern: ["share"], load: () => import('@/server/api-route-modules/legacy/share/route') },
  { pattern: ["share-reward"], load: () => import('@/server/api-route-modules/legacy/share-reward/route') },
  { pattern: ["simulations"], load: () => import('@/server/api-route-modules/legacy/simulations/route') },
  { pattern: ["smart-recommendations"], load: () => import('@/server/api-route-modules/legacy/smart-recommendations/route') },
  { pattern: ["social-pulse"], load: () => import('@/server/api-route-modules/legacy/social-pulse/route') },
  { pattern: ["trade-alternatives"], load: () => import('@/server/api-route-modules/legacy/trade-alternatives/route') },
  { pattern: ["trade-analytics"], load: () => import('@/server/api-route-modules/legacy/trade-analytics/route') },
  { pattern: ["trade-command-center"], load: () => import('@/server/api-route-modules/legacy/trade-command-center/route') },
  { pattern: ["trade-history"], load: () => import('@/server/api-route-modules/legacy/trade-history/route') },
  { pattern: ["trade-ideas"], load: () => import('@/server/api-route-modules/legacy/trade-ideas/route') },
  { pattern: ["trade-vote-analyze"], load: () => import('@/server/api-route-modules/legacy/trade-vote-analyze/route') },
  { pattern: ["transfer"], load: () => import('@/server/api-route-modules/legacy/transfer/route') },
  { pattern: ["leagues",":leagueId","*path"], load: () => import('@/server/api-route-modules/legacy/leagues/[leagueId]/[...path]/route') },
]

function normalizePath(context: RouteContext): string[] {
  const raw = context.params?.path
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean)
  if (typeof raw === 'string' && raw.length > 0) return [raw]
  return []
}

function matchPattern(pattern: string[], actual: string[]): Record<string, string | string[]> | null {
  const params: Record<string, string | string[]> = {}
  let index = 0
  for (const segment of pattern) {
    if (segment.startsWith('*')) {
      params[segment.slice(1)] = actual.slice(index)
      return params
    }
    const value = actual[index]
    if (value == null) return null
    if (segment.startsWith(':')) {
      params[segment.slice(1)] = value
    } else if (segment !== value) {
      return null
    }
    index += 1
  }
  return index === actual.length ? params : null
}

async function dispatch(method: string, request: NextRequest, context: RouteContext) {
  const path = normalizePath(context)
  for (const route of ROUTES) {
    const matchedParams = matchPattern(route.pattern, path)
    if (!matchedParams) continue
    const mod = (await route.load()) as RouteModule
    const handler = mod[method]
    if (!handler) {
      return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
    }
    return handler(request, {
      ...context,
      params: {
        ...context.params,
        ...matchedParams,
      },
    })
  }
  return NextResponse.json({ error: 'Route not found', path: path.join('/') }, { status: 404 })
}

export const GET = (request: NextRequest, context: RouteContext) => dispatch('GET', request, context)
export const POST = (request: NextRequest, context: RouteContext) => dispatch('POST', request, context)
export const PUT = (request: NextRequest, context: RouteContext) => dispatch('PUT', request, context)
export const PATCH = (request: NextRequest, context: RouteContext) => dispatch('PATCH', request, context)
export const DELETE = (request: NextRequest, context: RouteContext) => dispatch('DELETE', request, context)
export const HEAD = (request: NextRequest, context: RouteContext) => dispatch('HEAD', request, context)
export const OPTIONS = (request: NextRequest, context: RouteContext) => dispatch('OPTIONS', request, context)
