import { NextResponse, type NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isSportsDataEnabled } from '@/lib/fantasy-os/sports-runtime/gates'
import { buildRuntimeContext, identityStatusFrom, unavailableRuntimeContext } from '@/lib/fantasy-os/sports-runtime/context'
import { SportsRuntimeStore } from '@/lib/sports-data-gateway/runtime/store'
import { getCertifiedSchedule } from '@/lib/sports-data-gateway/runtime/scheduleRuntime'
import { buildCertifiedFreshness } from '@/lib/sports-data-gateway/runtime/freshnessPure'
import { resolvePlayerGame } from '@/lib/sports-data-gateway/runtime/playerGameResolution'
import { assembleLiveLineupContext } from '@/lib/sports-data-gateway/runtime/lineupSafety'

/**
 * Fantasy OS Phase 5E — live Lineup sports-data context (read-only, gated).
 *
 * This is the FIRST live wiring that brings the certified sports-data runtime into a real compiled application
 * route. It returns canonical game/lock EVIDENCE for a set of players — the existing lineup lock authority
 * (`lineupLockService`) remains final; this route decides nothing about roster mutation. Gated by
 * FANTASY_OS_SPORTS_DATA_LINEUP_ENABLED (disabled → preserves existing behavior, returns no context). Fails
 * closed to an `unavailable` envelope; never fabricates data; never leaks provider-specific fields.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Body = { season?: string; week?: string | null; players?: Array<{ canonicalPlayerId?: string; team?: string | null }> }

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = typeof session?.user?.id === 'string' ? session.user.id.trim() : ''
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isSportsDataEnabled('lineup')) {
    // Gate off → existing behavior preserved; no certified context added.
    return NextResponse.json({ enabled: false, contexts: [], runtimeContext: unavailableRuntimeContext('lineup sports-data integration disabled') })
  }

  let body: Body = {}
  try {
    body = (await req.json()) as Body
  } catch {
    body = {}
  }
  const season = (body.season ?? '').trim()
  const week = body.week != null ? String(body.week) : null
  const players = Array.isArray(body.players) ? body.players : []
  if (!season || players.length === 0) {
    return NextResponse.json({ enabled: true, contexts: [], runtimeContext: unavailableRuntimeContext('season + players required') })
  }

  const store = new SportsRuntimeStore()
  const now = new Date()
  let games
  let meta
  try {
    games = await getCertifiedSchedule(store, season, week)
    meta = await store.getCertifiedSnapshotMeta('NFL', 'games', `${season}-w${week ?? 'x'}`)
  } catch {
    return NextResponse.json({ enabled: true, contexts: [], runtimeContext: unavailableRuntimeContext('certified schedule unavailable') })
  }
  if (!meta || games.length === 0) {
    return NextResponse.json({ enabled: true, contexts: [], runtimeContext: unavailableRuntimeContext('no certified games snapshot for this window') })
  }

  const freshness = buildCertifiedFreshness(meta, now)
  let resolvedCount = 0
  const contexts = players.map((p) => {
    const canonicalPlayerId = String(p.canonicalPlayerId ?? '')
    const resolution = resolvePlayerGame({
      canonicalPlayerId,
      playerTeamReference: p.team ?? null,
      sport: 'NFL',
      at: now.toISOString(),
      games,
      // Schedule completeness is asserted only by a certified full-week snapshot; keep conservative.
      scheduleComplete: false,
    })
    if (resolution.status === 'resolved') resolvedCount++
    return assembleLiveLineupContext({ canonicalPlayerId, resolution, now, freshness })
  })

  const runtimeContext = buildRuntimeContext({
    dataContext: freshness,
    identityStatus: identityStatusFrom(resolvedCount, players.length),
    evidenceIds: meta.version ? [meta.version] : [],
  })

  return NextResponse.json({ enabled: true, contexts, runtimeContext })
}
