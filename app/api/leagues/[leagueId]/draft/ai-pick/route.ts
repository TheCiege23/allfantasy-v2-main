/**
 * POST: Commissioner triggers automated orphan manager to make the current pick.
 * Mode follows draft settings: CPU (deterministic) or AI (with deterministic fallback).
 * Only works when current on-the-clock roster is orphan and orphanTeamAiManagerEnabled is on.
 */

import { assertCommissionerAccess } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { executeDraftPickForOrphan } from '@/lib/orphan-ai-manager/OrphanAIManagerService'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { getOrphanRosterIdsForLeague } from '@/lib/orphan-ai-manager/orphanRosterResolver'
import { getProviderStatus } from '@/lib/provider-config'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await assertCommissionerAccess(leagueId, userId, 'league')
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const result = await executeDraftPickForOrphan({
    leagueId,
    triggeredByUserId: userId,
  })

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  const [updated, uiSettings, orphanRosterIds, currentUserRosterId] = await Promise.all([
    buildSessionSnapshot(leagueId),
    getDraftUISettingsForLeague(leagueId),
    getOrphanRosterIdsForLeague(leagueId),
    getCurrentUserRosterIdForLeague(leagueId, userId),
  ])
  const providerStatus = getProviderStatus()
  const sessionPayload =
    updated == null
      ? null
      : {
          ...updated,
          currentUserRosterId: currentUserRosterId ?? undefined,
          orphanRosterIds,
          aiManagerEnabled: uiSettings.orphanTeamAiManagerEnabled,
          orphanDrafterMode: uiSettings.orphanDrafterMode,
          orphanAiProviderAvailable: providerStatus.anyAi,
          orphanDrafterEffectiveMode:
            uiSettings.orphanDrafterMode === 'ai' && !providerStatus.anyAi
              ? 'cpu'
              : uiSettings.orphanDrafterMode,
        }
  return NextResponse.json({
    ok: true,
    pick: result.pick,
    reason: result.reason,
    requestedMode: result.requestedMode,
    executedMode: result.executedMode,
    aiProviderAvailable: result.aiProviderAvailable,
    usedFallback: result.usedFallback,
    session: sessionPayload,
  })
}
