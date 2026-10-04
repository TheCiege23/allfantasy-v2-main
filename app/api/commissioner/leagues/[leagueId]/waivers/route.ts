import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { getEffectiveLeagueWaiverSettings, upsertLeagueWaiverSettings } from '@/lib/waiver-wire'
import { getPendingClaims, getProcessedClaimsAndTransactions } from '@/lib/waiver-wire'
import { processWaiverClaimsForLeague } from '@/lib/waiver-wire/process-engine'
import { setWaiverProcessingLocked } from '@/lib/waiver-wire/waiver-state-service'

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

  const body = await req.json().catch(() => ({}))
  const settings = await upsertLeagueWaiverSettings(params.leagueId, {
    waiverType: body.waiverType,
    processingDayOfWeek: body.processingDayOfWeek,
    processingTimeUtc: body.processingTimeUtc,
    claimLimitPerPeriod: body.claimLimitPerPeriod,
    claimLimitPerWeek: body.claimLimitPerWeek,
    claimLimitPerRun: body.claimLimitPerRun,
    faabBudget: body.faabBudget,
    faabResetDate: body.faabResetDate,
    faabResetType: body.faabResetType,
    waiverOrderResetPolicy: body.waiverOrderResetPolicy,
    postGameWaiverBehavior: body.postGameWaiverBehavior,
    processingDays: body.processingDays,
    freeAgentWindowRules: body.freeAgentWindowRules,
    dropRestrictions: body.dropRestrictions,
    commissionerOverrideRules: body.commissionerOverrideRules,
    specialtyConceptOverrides: body.specialtyConceptOverrides,
    tiebreakRule: body.tiebreakRule,
    lockType: body.lockType,
    instantFaAfterClear: body.instantFaAfterClear,
    waiverEngineConfig: body.waiverEngineConfig,
  })
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
