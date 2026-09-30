import { compatRouteParams } from '@/lib/http/compatRouteParams'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

// Next 15 hands route params in as a Promise.
type RouteContext = { params: Promise<Record<string, string | string[] | undefined>> }
type RouteModule = Partial<Record<string, (request: NextRequest, context: RouteContext) => Response | Promise<Response>>>
type RouteLoader = () => Promise<unknown>

const ROUTES: Array<{ pattern: string[]; load: RouteLoader }> = [
  { pattern: ["sit-outs",":sitOutId","respond"], load: () => import('@/server/api-route-modules/league-survivor/sit-outs/[sitOutId]/respond/route') },
  { pattern: ["exile","assign"], load: () => import('@/server/api-route-modules/league-survivor/exile/assign/route') },
  { pattern: ["exile","complete"], load: () => import('@/server/api-route-modules/league-survivor/exile/complete/route') },
  { pattern: ["finale","vote"], load: () => import('@/server/api-route-modules/league-survivor/finale/vote/route') },
  { pattern: ["idols","assign"], load: () => import('@/server/api-route-modules/league-survivor/idols/assign/route') },
  { pattern: ["idols","expire"], load: () => import('@/server/api-route-modules/league-survivor/idols/expire/route') },
  { pattern: ["idols","play"], load: () => import('@/server/api-route-modules/league-survivor/idols/play/route') },
  { pattern: ["tokens","grant"], load: () => import('@/server/api-route-modules/league-survivor/tokens/grant/route') },
  { pattern: ["tokens","spend"], load: () => import('@/server/api-route-modules/league-survivor/tokens/spend/route') },
  { pattern: ["votes","lock"], load: () => import('@/server/api-route-modules/league-survivor/votes/lock/route') },
  { pattern: ["votes","reveal"], load: () => import('@/server/api-route-modules/league-survivor/votes/reveal/route') },
  { pattern: ["ai"], load: () => import('@/server/api-route-modules/league-survivor/ai/route') },
  { pattern: ["commands"], load: () => import('@/server/api-route-modules/league-survivor/commands/route') },
  { pattern: ["commissioner-dashboard"], load: () => import('@/server/api-route-modules/league-survivor/commissioner-dashboard/route') },
  { pattern: ["config"], load: () => import('@/server/api-route-modules/league-survivor/config/route') },
  { pattern: ["exile"], load: () => import('@/server/api-route-modules/league-survivor/exile/route') },
  { pattern: ["idols"], load: () => import('@/server/api-route-modules/league-survivor/idols/route') },
  { pattern: ["live"], load: () => import('@/server/api-route-modules/league-survivor/live/route') },
  { pattern: ["return"], load: () => import('@/server/api-route-modules/league-survivor/return/route') },
  { pattern: ["runtime"], load: () => import('@/server/api-route-modules/league-survivor/runtime/route') },
  { pattern: ["seed-faq"], load: () => import('@/server/api-route-modules/league-survivor/seed-faq/route') },
  { pattern: ["state"], load: () => import('@/server/api-route-modules/league-survivor/state/route') },
  { pattern: ["summary"], load: () => import('@/server/api-route-modules/league-survivor/summary/route') },
  { pattern: ["token-shop"], load: () => import('@/server/api-route-modules/league-survivor/token-shop/route') },
  { pattern: ["tokens"], load: () => import('@/server/api-route-modules/league-survivor/tokens/route') },
  { pattern: ["tribes"], load: () => import('@/server/api-route-modules/league-survivor/tribes/route') },
  { pattern: ["vote"], load: () => import('@/server/api-route-modules/league-survivor/vote/route') },
  { pattern: ["votes"], load: () => import('@/server/api-route-modules/league-survivor/votes/route') },
]

function normalizePath(outer: Record<string, string | string[] | undefined>): string[] {
  const raw = outer?.path
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
  const outer = await context.params
  const path = normalizePath(outer)
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
      params: compatRouteParams({
        ...outer,
        ...matchedParams,
      }),
    })
  }
  if (method === 'POST' && path.length === 1) {
    const mod = (await import('@/server/api-route-modules/league-survivor/foundation/route')) as unknown as RouteModule
    const handler = mod.POST
    if (handler) {
      return handler(request, {
        ...context,
        params: compatRouteParams({
          ...outer,
          action: path[0],
        }),
      })
    }
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
