import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league-access'
import {
  AutoSubLineupEngineResultSchema,
  runAutoSubLineupEngine,
  type AutoSubLineupEngineInput,
} from '@/lib/auto-sub-lineup-engine'
import { isSportsDataEnabled } from '@/lib/fantasy-os/sports-runtime/gates'
import { CertifiedLineupIntegrationService, extractPlayerRefs } from '@/lib/fantasy-os/sports-runtime/lineupIntegration'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as any)) as
    | { user?: { id?: string } }
    | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: AutoSubLineupEngineInput & { leagueId?: string }
  try {
    body = (await req.json()) as AutoSubLineupEngineInput & { leagueId?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body.leagueId) {
    try {
      await assertLeagueMember(body.leagueId, session.user.id)
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  if (!Array.isArray(body.starters) || body.starters.length === 0) {
    return NextResponse.json({ error: 'starters must be a non-empty array' }, { status: 400 })
  }
  if (!Array.isArray(body.bench)) {
    return NextResponse.json({ error: 'bench must be an array' }, { status: 400 })
  }

  try {
    const { leagueId: _leagueId, ...engineInput } = body
    const raw = runAutoSubLineupEngine(engineInput)
    const result = AutoSubLineupEngineResultSchema.parse(raw)

    // Gated, additive, FAIL-CLOSED sports-data guard. This never approves a sub; it only advises callers to
    // hold automatic execution when certified schedule evidence is stale/unavailable. The deterministic engine
    // above remains authoritative for WHAT to sub. Wrapped so it never turns a safe result into an error.
    let sportsDataGuard: { safe: boolean; reason: string; freshnessStatus: string } | undefined
    if (isSportsDataEnabled('lineup') && body.leagueId && typeof (body as { season?: unknown }).season !== 'undefined') {
      try {
        const svc = new CertifiedLineupIntegrationService()
        const players = extractPlayerRefs((body as { starters?: unknown }).starters)
        const ev = await svc.getScheduleEvidenceForPlayers({ season: String((body as { season?: unknown }).season ?? ''), week: (body as { week?: unknown }).week != null ? String((body as { week?: unknown }).week) : null, players })
        const fresh = ev.runtimeContext.freshnessStatus
        const safe = ev.available && fresh === 'current'
        sportsDataGuard = { safe, reason: safe ? 'certified schedule current' : `automatic execution should be held: schedule ${ev.available ? fresh : 'unavailable'}`, freshnessStatus: ev.available ? fresh : 'unavailable' }
      } catch {
        sportsDataGuard = { safe: false, reason: 'certified sports evidence unavailable — hold automatic execution', freshnessStatus: 'unavailable' }
      }
    }

    return NextResponse.json({
      ok: true,
      injuryInactiveOnly: true,
      autoSubsExecuted: result.autoSubsExecuted,
      blockedAutoSubs: result.blockedAutoSubs,
      notifications: result.notifications,
      ...(sportsDataGuard ? { sportsDataGuard } : {}),
    })
  } catch (error) {
    console.error('[lineup/auto-sub]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to run auto-sub lineup engine' },
      { status: 500 }
    )
  }
}
