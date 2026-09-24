/**
 * GET: Poll for draft events (since=timestamp). Returns session snapshot when updatedAt > since.
 * Realtime: client polls this or GET session; no WebSocket in this implementation.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft, getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { getOrphanRosterIdsForLeague } from '@/lib/orphan-ai-manager/orphanRosterResolver'
import { prisma } from '@/lib/prisma'
import {
  repairDraftCompletionIfBoardFull,
  syncPostDraftArtifactsIfCompletedThrottled,
} from '@/lib/live-draft-engine/postDraftFinalizeArtifacts'
import { getProviderStatus } from '@/lib/provider-config'
import { runAutomationTicksThrottled } from '@/lib/live-draft-engine/draftAutomationTicks'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

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

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await runAutomationTicksThrottled(leagueId)

  await repairDraftCompletionIfBoardFull(leagueId).catch((e) => {
    console.error('[draft/events] repairDraftCompletionIfBoardFull', leagueId, e)
  })
  await syncPostDraftArtifactsIfCompletedThrottled(leagueId)

  const url = new URL(req.url)
  const since = url.searchParams?.get('since')
  const draftSession = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { updatedAt: true },
  })
  if (!draftSession) {
    return NextResponse.json({ leagueId, updated: false, session: null })
  }

  const updatedAt = draftSession.updatedAt.toISOString()
  if (since && new Date(since).getTime() >= draftSession.updatedAt.getTime()) {
    return NextResponse.json({ leagueId, updated: false, updatedAt })
  }

  const [snapshot, uiSettings, orphanRosterIds] = await Promise.all([
    buildSessionSnapshot(leagueId),
    getDraftUISettingsForLeague(leagueId),
    getOrphanRosterIdsForLeague(leagueId),
  ])
  const providerStatus = getProviderStatus()
  const currentUserRosterId = await getCurrentUserRosterIdForLeague(leagueId, userId!)
  const sessionPayload =
    snapshot != null
      ? {
          ...snapshot,
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
      : null
  return NextResponse.json({ leagueId, updated: true, updatedAt, session: sessionPayload })
}
