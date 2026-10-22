import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  checkCommissionerPermission,
  getLeagueRosterConfig,
  getRosterEngineRegistry,
  resetLeagueRosterToDefault,
} from '@/lib/roster-engine'
import { prisma } from '@/lib/prisma'
import { invalidateLeagueDraftCaches } from '@/lib/league/invalidateLeagueDraftCaches'
import { settingsLockedResponse } from '@/lib/league/settingsLockGuard'
import { decideSettingsEdit, recordMidSeasonSettingsChange } from '@/lib/league/settingsLifecycleGate'
import { getComputedDraftRounds } from '@/lib/draft/computedDraftRounds'
import { syncDraftRoundsToRoster } from '@/lib/draft/syncDraftRoundsToRoster'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await params
  const permission = await checkCommissionerPermission(session.user.id, leagueId)
  if (!permission.isCommissioner) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true } })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const registry = getRosterEngineRegistry()
  if (!registry.isSupported(league.sport)) {
    return NextResponse.json({ error: `Roster settings not yet available for ${league.sport}` }, { status: 400 })
  }
  const body = await req.json().catch(() => ({}))
  const lifecycle = await decideSettingsEdit(leagueId, session.user.id, 'roster', body)
  if (!lifecycle.ok) return NextResponse.json(lifecycle.body, { status: lifecycle.status })

  const locked = await settingsLockedResponse(leagueId, 'rosters')

  if (locked) return locked
  const roundsBefore = await getComputedDraftRounds(leagueId).catch(() => null)
  await resetLeagueRosterToDefault(leagueId, session.user.id)
  invalidateLeagueDraftCaches(leagueId)
  // A reset to the sport default is a request for the default shape, rounds included.
  const draftRounds = await syncDraftRoundsToRoster(leagueId, { before: roundsBefore, keepManualOverride: false }).catch((e) => {
    console.warn('[roster-settings reset-default] draft rounds sync', e instanceof Error ? e.message : 'unknown error')
    return null
  })
  const config = await registry.getService(league.sport).getConfig(leagueId)
  const unifiedConfig = await getLeagueRosterConfig(leagueId)

  await recordMidSeasonSettingsChange(lifecycle, { leagueId: leagueId, userId: session.user.id, section: 'roster', source: 'roster-settings/reset-default' })
  return NextResponse.json({ ok: true, config, unifiedConfig, draftRounds })
}
