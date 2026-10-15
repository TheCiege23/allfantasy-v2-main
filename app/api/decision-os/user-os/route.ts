import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveUserOsSnapshot } from '@/lib/decision-os/userOs'
import { authorizeLeagueRead } from '@/lib/decision-os/leagueReadAuthorization'
import { strategyPrismaPort } from '@/lib/decision-os/value-v2/strategyPrisma'
import { refreshStrategyFromEvidence } from '@/lib/decision-os/value-v2/strategyEvidence'
import { strategyEvidencePrismaPort } from '@/lib/decision-os/value-v2/strategyEvidencePrisma'
import {
  confirmStoredStrategy,
  readStrategy,
  strategyConfirmationSchema,
  strategyOwnerView,
  StrategyStoreError,
} from '@/lib/decision-os/value-v2/strategyStore'

export const dynamic = 'force-dynamic'

/**
 * Fantasy OS Suite — Phase D Increment 5.
 *
 * User OS read API for the signed-in session user, in one league. Mirrors
 * `/api/decision-os/manager-intelligence`'s contract exactly (session-gated, `leagueId` required,
 * degraded-safe, always resolves the SESSION user's own managerId — never a URL param). Works
 * whether or not the signed-in user commissions this league. Read-only.
 * `resolveUserOsSnapshot` never throws — a pipeline failure returns an honest
 * `available: false` snapshot, not a 500.
 *
 * Phase OS-C6.1: gated by `authorizeLeagueRead`, same rationale as the identical addition to
 * `/api/decision-os/manager-intelligence` — closes the `leagueTrend` (real, league-wide activity
 * data) leak to non-members, even though the rest of this payload was already self-scoped.
 *
 * `?view=strategy` — the viewer's saved league strategy (value-v2). Folded in here rather than given
 * its own route (the repo is at the route ceiling). GET reads it; POST either refreshes the proposal
 * from completed weekly results (`{ "action": "refresh" }`) or confirms it
 * (`{ expectedRevision, strategy, confirmed: true }`). League members only, never viewers; the
 * userId always comes from the session.
 */
const noStore = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

type StrategyScopeResult =
  | { error: NextResponse; scope?: undefined }
  | { error?: undefined; scope: { userId: string; leagueId: string; season: number } }

async function strategyScopeFor(request: Request): Promise<StrategyScopeResult> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return { error: noStore({ error: 'Unauthorized' }, 401) }
  const leagueId = new URL(request.url).searchParams.get('leagueId')?.trim()
  if (!leagueId || leagueId.length > 128) return { error: noStore({ error: 'A valid leagueId is required' }, 400) }
  const gate = await authorizeLeagueRead(leagueId, userId)
  if (!gate.authorized || gate.role === 'viewer') {
    return { error: noStore({ error: 'League membership is required' }, gate.authorized ? 403 : gate.status) }
  }
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { season: true } })
  if (!league || league.season == null) return { error: noStore({ error: 'League unavailable' }, 404) }
  return { scope: { userId, leagueId, season: league.season } }
}

function isStrategyView(request: Request): boolean {
  return new URL(request.url).searchParams.get('view') === 'strategy'
}

async function getStrategy(request: Request) {
  try {
    const authorized = await strategyScopeFor(request)
    if (authorized.error) return authorized.error
    return noStore(strategyOwnerView(await readStrategy(authorized.scope, strategyPrismaPort)))
  } catch {
    return noStore({ error: 'Strategy is temporarily unavailable' }, 503)
  }
}

export async function GET(request: Request) {
  if (isStrategyView(request)) return getStrategy(request)

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const leagueId = new URL(request.url).searchParams.get('leagueId')?.trim()
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
  }

  const gate = await authorizeLeagueRead(leagueId, userId)
  if (!gate.authorized) {
    return NextResponse.json(
      { error: gate.status === 403 ? 'Forbidden' : 'Unauthorized' },
      { status: gate.status },
    )
  }

  const snapshot = await resolveUserOsSnapshot(leagueId, userId)
  return NextResponse.json(snapshot)
}

export async function POST(request: Request) {
  if (!isStrategyView(request)) return noStore({ error: 'Not found' }, 404)
  try {
    // Session cookies alone do not authorize cross-origin writes. Same-origin browser JSON only.
    const origin = request.headers.get('origin')
    if (!origin || origin !== new URL(request.url).origin) {
      return noStore({ error: 'Same-origin confirmation required' }, 403)
    }
    const authorized = await strategyScopeFor(request)
    if (authorized.error) return authorized.error
    const text = await request.text()
    if (text.length > 2048) return noStore({ error: 'Request too large' }, 413)
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return noStore({ error: 'Invalid request' }, 400)
    }
    const refresh = body !== null && typeof body === 'object' && !Array.isArray(body) &&
      Object.keys(body).length === 1 && 'action' in body && body.action === 'refresh'
    const input = strategyConfirmationSchema.safeParse(body)
    if (!refresh && !input.success) {
      return noStore({ error: 'Explicit confirmation, strategy and current revision are required' }, 400)
    }
    const current = await refreshStrategyFromEvidence(authorized.scope, strategyEvidencePrismaPort, strategyPrismaPort)
    if (refresh) {
      return noStore({
        ...strategyOwnerView(current.state),
        evidence: { available: current.gaps.length === 0, completedWeek: current.completedWeek, canConfirm: current.canConfirm },
      })
    }
    if (!current.canConfirm) {
      return noStore({ error: 'This proposal needs current, complete weekly results before confirmation.', code: 'NOT_READY' }, 409)
    }
    if (!input.success) return noStore({ error: 'Invalid confirmation' }, 400)
    return noStore(strategyOwnerView(await confirmStoredStrategy(authorized.scope, input.data, strategyPrismaPort)))
  } catch (error) {
    if (error instanceof StrategyStoreError && error.code === 'CONFLICT') {
      return noStore({ error: 'Strategy changed. Refresh before confirming.', code: 'CONFLICT' }, 409)
    }
    if (error instanceof StrategyStoreError && error.code === 'NOT_READY') {
      return noStore({ error: 'A strategy proposal needs three consecutive weekly observations.', code: 'NOT_READY' }, 409)
    }
    return noStore({ error: 'Strategy is temporarily unavailable' }, 503)
  }
}
