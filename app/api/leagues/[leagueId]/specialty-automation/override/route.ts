import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { runSpecialtyAutomationOrchestrator } from '@/lib/specialty-automation/orchestrator'
import { assertLeagueActionGate } from '@/server/services/leagueActionGate'
import { logAction } from '@/server/services/auditService'
import type { AutomationTrigger } from '@/lib/specialty-automation/types'

const TRIGGERS: AutomationTrigger[] = [
  'onWeekFinalized',
  'onStandingsUpdated',
  'onDraftCompleted',
  'onWaiverProcessed',
  'onPhaseTransition',
  'onManualRun',
  'onScheduledPass',
]

function parseTrigger(raw: unknown): AutomationTrigger {
  const s = String(raw ?? 'onManualRun')
  return TRIGGERS.includes(s as AutomationTrigger) ? (s as AutomationTrigger) : 'onManualRun'
}

/**
 * Commissioner override — always runs with `force: true` so idempotency does not block replays,
 * and tags the run for audit.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLeagueActionGate(params.leagueId, userId, 'automation_run')
  if (!gate.ok) {
    return NextResponse.json({ error: gate.err.error, code: gate.err.code }, { status: gate.err.status })
  }

  const body = await req.json().catch(() => ({}))
  const league = await prisma.league.findUnique({
    where: { id: params.leagueId },
    select: { season: true },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const season = Math.max(2000, Math.min(2100, Number(body.season) || league.season))
  const weekRaw = body.week
  const week =
    weekRaw === null || weekRaw === undefined
      ? null
      : Math.max(0, Math.min(53, Number(weekRaw))) || null

  const trigger = parseTrigger(body.trigger)

  const out = await runSpecialtyAutomationOrchestrator({
    leagueId: params.leagueId,
    season,
    week,
    trigger,
    force: true,
    source: 'commissioner_override',
  })

  void logAction({
    leagueId: params.leagueId,
    userId,
    actionType: 'specialty_automation_override',
    entityType: 'automation',
    entityId: out.runId,
    afterState: { concept: out.concept, duplicate: out.duplicate, override: true },
    metadata: { trigger },
  }).catch(() => {})

  return NextResponse.json({
    ok: true,
    runId: out.runId,
    concept: out.concept,
    duplicate: out.duplicate,
    result: out.result,
    override: true,
  })
}
