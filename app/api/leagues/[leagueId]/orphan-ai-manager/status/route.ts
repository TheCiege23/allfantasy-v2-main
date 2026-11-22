/**
 * GET: Commissioner views orphan AI manager status: orphan rosters, last actions, setting.
 */

import { assertCommissionerAccess } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { getOrphanRosterIdsForLeague } from '@/lib/orphan-ai-manager/orphanRosterResolver'
import { getRecentAuditEntries } from '@/lib/orphan-ai-manager/OrphanAIManagerService'
import { prisma } from '@/lib/prisma'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { getProviderStatus } from '@/lib/provider-config'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await assertCommissionerAccess(leagueId, userId, 'view')
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [uiSettings, orphanRosterIds, recentLogs, rosters, snapshot] = await Promise.all([
    getDraftUISettingsForLeague(leagueId),
    getOrphanRosterIdsForLeague(leagueId),
    getRecentAuditEntries(leagueId, { limit: 15 }),
    prisma.roster.findMany({
      where: { leagueId },
      select: { id: true, platformUserId: true },
    }),
    buildSessionSnapshot(leagueId),
  ])

  const orphanRosters = rosters.filter((r) => orphanRosterIds.includes(r.id)).map((r) => ({ rosterId: r.id, platformUserId: r.platformUserId }))
  const providerStatus = getProviderStatus()
  const effectiveMode =
    uiSettings.orphanDrafterMode === 'ai' && !providerStatus.anyAi
      ? 'cpu'
      : uiSettings.orphanDrafterMode

  return NextResponse.json({
    orphanTeamAiManagerEnabled: uiSettings.orphanTeamAiManagerEnabled,
    orphanDrafterMode: uiSettings.orphanDrafterMode,
    orphanDrafterEffectiveMode: effectiveMode,
    orphanAiProviderAvailable: providerStatus.anyAi,
    orphanRosterIds,
    currentOnClockRosterId: snapshot?.currentPick?.rosterId ?? null,
    isOrphanOnClock: Boolean(
      snapshot?.currentPick?.rosterId &&
      orphanRosterIds.includes(snapshot.currentPick.rosterId) &&
      uiSettings.orphanTeamAiManagerEnabled
    ),
    orphanRosters,
    recentActions: recentLogs.map((l) => ({
      id: l.id,
      rosterId: l.rosterId,
      action: l.action,
      payload: l.payload,
      reason: l.reason,
      triggeredBy: l.triggeredBy,
      createdAt: l.createdAt.toISOString(),
    })),
  })
}
