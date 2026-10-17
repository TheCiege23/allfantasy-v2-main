import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { specialtySettingsEditRefusal } from '@/lib/league/specialty-settings-access'
import { isTaxiLockMode } from '@/lib/c2c/taxiLockResolver'

export const dynamic = 'force-dynamic'

/**
 * PATCH: commissioner updates C2C league settings. Currently supports
 * `devyScoringEnabled`; more fields can be added here as they gain UI.
 */
export async function PATCH(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId : ''
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueCommissioner(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const refusal = await specialtySettingsEditRefusal(leagueId, userId)
  if (refusal) return refusal

  const data: Record<string, unknown> = {}
  if (typeof body?.devyScoringEnabled === 'boolean') {
    data.devyScoringEnabled = body.devyScoringEnabled
  }

  // Taxi lock mode lives in League.settings so it doesn't require a new
  // Prisma column. Mode drives resolveTaxiLock() → concrete timestamp.
  let taxiLockUpdated: string | null = null
  if (body && 'taxiLockMode' in body) {
    if (!isTaxiLockMode(body.taxiLockMode)) {
      return NextResponse.json({ error: 'Invalid taxiLockMode' }, { status: 400 })
    }
    const current = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { settings: true },
    })
    const nextSettings = {
      ...((current?.settings as Record<string, unknown> | null) ?? {}),
      c2cTaxiLockMode: body.taxiLockMode,
    }
    await prisma.league.update({
      where: { id: leagueId },
      data: { settings: nextSettings },
    })
    taxiLockUpdated = body.taxiLockMode
  }

  if (Object.keys(data).length === 0 && !taxiLockUpdated) {
    return NextResponse.json({ error: 'No updatable fields in body' }, { status: 400 })
  }

  let updatedConfig: { leagueId: string; devyScoringEnabled: boolean } | null = null
  if (Object.keys(data).length > 0) {
    updatedConfig = await prisma.c2CLeague.update({
      where: { leagueId },
      data,
      select: { leagueId: true, devyScoringEnabled: true },
    })
  }

  return NextResponse.json({
    ok: true,
    config: updatedConfig,
    taxiLockMode: taxiLockUpdated,
  })
}
