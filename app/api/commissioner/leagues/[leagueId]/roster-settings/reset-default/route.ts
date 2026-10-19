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

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
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

  const locked = await settingsLockedResponse(leagueId, 'rosters')

  if (locked) return locked
  await resetLeagueRosterToDefault(leagueId, session.user.id)
  invalidateLeagueDraftCaches(leagueId)
  const config = await registry.getService(league.sport).getConfig(leagueId)
  const unifiedConfig = await getLeagueRosterConfig(leagueId)

  return NextResponse.json({ ok: true, config, unifiedConfig })
}
