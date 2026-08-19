import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

/**
 * Route-count consolidation (dynamic edition): Vercel's 2048-route ceiling
 * counts DYNAMIC route patterns, and this cluster contributed one per sibling.
 * This single [section] dispatcher serves the IDENTICAL /api/leagues/[leagueId]/<name>
 * URLs - each sibling's logic lives in its colocated handler.ts (same directory,
 * same relative imports, same params contract: handlers still receive
 * { params: { leagueId } } plus the extra `section` key they ignore).
 * Deeper nested routes (draft/*, trades/[tradeId]/*, big-brother/*, ...) are
 * their own routes and are untouched.
 * Do NOT add new route.ts files directly under [leagueId]/ - add a handler.ts
 * and register it in the map below.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const HANDLERS: Record<string, () => Promise<Record<string, unknown>>> = {
  'activity': () => import('../activity/handler'),
  'activity-feed': () => import('../activity-feed/handler'),
  'advisor': () => import('../advisor/handler'),
  'ai-adp': () => import('../ai-adp/handler'),
  'ai-commissioner': () => import('../ai-commissioner/handler'),
  'ai-settings': () => import('../ai-settings/handler'),
  'audit-logs': () => import('../audit-logs/handler'),
  'autocoach-settings': () => import('../autocoach-settings/handler'),
  'awards': () => import('../awards/handler'),
  'best-ball-war-room': () => import('../best-ball-war-room/handler'),
  'bestball': () => import('../bestball/handler'),
  'claim-roster': () => import('../claim-roster/handler'),
  'commentary': () => import('../commentary/handler'),
  'commissioner-controls': () => import('../commissioner-controls/handler'),
  'commissioner-rating': () => import('../commissioner-rating/handler'),
  'league-type': () => import('../league-type/handler'),
  'dispersal-draft': () => import('../dispersal-draft/handler'),
  'divisions': () => import('../divisions/handler'),
  'downsize': () => import('../downsize/handler'),
  'draft-grades': () => import('../draft-grades/handler'),
  'draft-results': () => import('../draft-results/handler'),
  'drama': () => import('../drama/handler'),
  'dynasty-backfill': () => import('../dynasty-backfill/handler'),
  'dynasty-projections': () => import('../dynasty-projections/handler'),
  'dynasty-settings': () => import('../dynasty-settings/handler'),
  'dynasty-war-room': () => import('../dynasty-war-room/handler'),
  'fill-empty-slots': () => import('../fill-empty-slots/handler'),
  'forecast-summary': () => import('../forecast-summary/handler'),
  'graph-insight': () => import('../graph-insight/handler'),
  'guillotine-war-room': () => import('../guillotine-war-room/handler'),
  'hall-of-fame': () => import('../hall-of-fame/handler'),
  'history': () => import('../history/handler'),
  'integrity': () => import('../integrity/handler'),
  'intro': () => import('../intro/handler'),
  'intro-seen': () => import('../intro-seen/handler'),
  'intro-status': () => import('../intro-status/handler'),
  'keeper-war-room': () => import('../keeper-war-room/handler'),
  'ldi-heatmap': () => import('../ldi-heatmap/handler'),
  'legacy-score': () => import('../legacy-score/handler'),
  'lifecycle': () => import('../lifecycle/handler'),
  'matchup-center': () => import('../matchup-center/handler'),
  'matchups': () => import('../matchups/handler'),
  'media': () => import('../media/handler'),
  'orphaned-teams': () => import('../orphaned-teams/handler'),
  'partner-profiles': () => import('../partner-profiles/handler'),
  'power-rankings': () => import('../power-rankings/handler'),
  'prestige-context': () => import('../prestige-context/handler'),
  'prestige-governance': () => import('../prestige-governance/handler'),
  'privacy': () => import('../privacy/handler'),
  'psychological-profiles': () => import('../psychological-profiles/handler'),
  'rank-history': () => import('../rank-history/handler'),
  'record-book': () => import('../record-book/handler'),
  'redraft-war-room': () => import('../redraft-war-room/handler'),
  'relationship-insights': () => import('../relationship-insights/handler'),
  'relationship-map': () => import('../relationship-map/handler'),
  'relationship-profile': () => import('../relationship-profile/handler'),
  'replay-insights': () => import('../replay-insights/handler'),
  'reputation': () => import('../reputation/handler'),
  'rivalries': () => import('../rivalries/handler'),
  'roster-config': () => import('../roster-config/handler'),
  'season-forecast': () => import('../season-forecast/handler'),
  'season-results': () => import('../season-results/handler'),
  'settings': () => import('../settings/handler'),
  'simulation-insights': () => import('../simulation-insights/handler'),
  'sleeper-hosted-draft-history': () => import('../sleeper-hosted-draft-history/handler'),
  'snapshots': () => import('../snapshots/handler'),
  'standings': () => import('../standings/handler'),
  'survivor': () => import('../survivor/handler'),
  'tournament-context': () => import('../tournament-context/handler'),
  'trades': () => import('../trades/handler'),
}

type Ctx = { params: Promise<{ leagueId: string; section: string }> | { leagueId: string; section: string } }

async function dispatch(method: string, req: NextRequest, ctx: Ctx): Promise<Response> {
  const params = await ctx.params
  const load = HANDLERS[params.section]
  if (!load) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const mod = await load()
  const fn = mod[method]
  if (typeof fn !== 'function') return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
  return (fn as (r: NextRequest, c?: unknown) => Promise<Response>)(req, ctx)
}

export const GET = (req: NextRequest, ctx: Ctx) => dispatch('GET', req, ctx)
export const PATCH = (req: NextRequest, ctx: Ctx) => dispatch('PATCH', req, ctx)
export const POST = (req: NextRequest, ctx: Ctx) => dispatch('POST', req, ctx)
export const PUT = (req: NextRequest, ctx: Ctx) => dispatch('PUT', req, ctx)
