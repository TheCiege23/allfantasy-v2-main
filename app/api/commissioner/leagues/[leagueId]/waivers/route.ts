import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { getEffectiveLeagueWaiverSettings, upsertLeagueWaiverSettings } from '@/lib/waiver-wire'
import { getPendingClaims, getProcessedClaimsAndTransactions } from '@/lib/waiver-wire'
import { processWaiverClaimsForLeague } from '@/lib/waiver-wire/process-engine'
import { refreshLeagueWaiverNextRunAt, setWaiverProcessingLocked } from '@/lib/waiver-wire/waiver-state-service'
import { waiverSettingsRequestSchema } from '@/lib/waiver-wire/settings-request'
import { diffRuleSnapshots } from '@/lib/league-rules-explainer/changeKeys'
import { publishRuleChangesEvent } from '@/lib/league-rules-explainer/publishRuleChanges'
import { waiverRulesFromEffective } from '@/lib/league-rules-explainer/snapshot'

export async function GET(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const type = req.nextUrl.searchParams?.get('type') || 'pending'
  const limitRaw = Number(req.nextUrl.searchParams?.get('limit') || '50')
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 50))

  if (type === 'settings') {
    const settings = await getEffectiveLeagueWaiverSettings(params.leagueId)
    return NextResponse.json(settings)
  }

  if (type === 'history') {
    const { claims, transactions } = await getProcessedClaimsAndTransactions(params.leagueId, limit)
    return NextResponse.json({ claims, transactions })
  }

  const pending = await getPendingClaims(params.leagueId)
  return NextResponse.json({ claims: pending })
}

export async function PUT(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = waiverSettingsRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid waiver settings', details: parsed.error.flatten() }, { status: 400 })
  // Read before the write for the "What changed" card; a failed read only drops the card.
  let before: Awaited<ReturnType<typeof getEffectiveLeagueWaiverSettings>> | null = null
  try {
    before = (await getEffectiveLeagueWaiverSettings(params.leagueId)) ?? null
  } catch {
    before = null
  }
  const settings = await upsertLeagueWaiverSettings(params.leagueId, parsed.data)
  // The league home's "What changed" card: the waiver rules the popup reads from these settings.
  if (before) {
    try {
      const after = await getEffectiveLeagueWaiverSettings(params.leagueId)
      await publishRuleChangesEvent({
        leagueId: params.leagueId,
        actorUserId: userId,
        section: 'waivers',
        changes: diffRuleSnapshots(waiverRulesFromEffective(before), waiverRulesFromEffective(after)),
      })
    } catch (e) {
      console.warn('[commissioner/waivers] change card', e instanceof Error ? e.message : 'unknown error')
    }
  }
  // The free-agency mode moves a daily sport's run days (lib/waiver-wire/daily-sport-waiver-runs.ts):
  // reschedule now rather than at the next run under the old days.
  if (parsed.data.waiverEngineConfig?.free_agency_mode !== undefined) {
    await refreshLeagueWaiverNextRunAt(params.leagueId).catch((e) => console.warn('[commissioner/waivers] next run refresh', e))
  }
  return NextResponse.json(settings)
}

/** Manual waiver run, or lock/unlock processing (commissioner only) */
export async function POST(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    const text = await req.text()
    const parsed: unknown = text === '' ? {} : JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid action')
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid waiver action request' }, { status: 400 })
  }
  // Empty requests remain the documented legacy manual-run contract. A typo,
  // truncated body or other action must never trigger roster-changing work.
  const action = Object.keys(body).length === 0 ? 'process' : body.action
  if (action !== 'process' && action !== 'lock_waivers' && action !== 'unlock_waivers') {
    return NextResponse.json({ error: 'Unknown waiver action' }, { status: 400 })
  }

  if (action === 'lock_waivers') {
    await setWaiverProcessingLocked(params.leagueId, true)
    return NextResponse.json({ status: 'ok', processingLocked: true })
  }
  if (action === 'unlock_waivers') {
    await setWaiverProcessingLocked(params.leagueId, false)
    return NextResponse.json({ status: 'ok', processingLocked: false })
  }

  const results = await processWaiverClaimsForLeague(params.leagueId, {
    processedByUserId: userId,
    runType: 'manual',
  })
  return NextResponse.json({ status: 'ok', processed: results.length, results })
}
