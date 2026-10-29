/**
 * POST: a Chimmy-managed team makes its pick.
 *
 * Called by every open draft room a few seconds after a Chimmy-managed team comes on the clock
 * (`CHIMMY_PICK_DELAY_MS`), so the draft does not wait out that team's timer. Unlike
 * `/draft/ai-pick` (the commissioner's manual button) any league member's room may call it — the
 * server, not the caller, decides whether a pick is due:
 *   - the team on the clock must be an orphan with an ACTIVE Chimmy assignment, and the league's
 *     orphan AI manager must be on (`chimmyManagesRoster`);
 *   - the pick must have been on the clock for the thinking time (`chimmyThinkingTimeElapsed`);
 *   - `expectedOverall` must still be the current pick. Several rooms fire for the same pick; the
 *     pick lock plus this check let exactly one land and refuse the rest as stale (409).
 *
 * Body: { expectedOverall: number }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessLeagueDraft, getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { getOrphanRosterIdsForLeague } from '@/lib/orphan-ai-manager/orphanRosterResolver'
import { executeDraftPickForOrphan } from '@/lib/orphan-ai-manager/OrphanAIManagerService'
import { parseCommissionerAiManagers } from '@/lib/commissioner-ai-draft-manager'
import { chimmyManagesRoster, chimmyThinkingTimeElapsed } from '@/lib/commissioner-ai-draft-manager/chimmyManagerPick'
import { DRAFT_PICK_STALE_OVERALL } from '@/lib/live-draft-engine/pickAuthorityCodes'
import { getProviderStatus } from '@/lib/provider-config'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  if (!(await canAccessLeagueDraft(leagueId, userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as { expectedOverall?: unknown }
  const expectedOverall = Number(body.expectedOverall)
  if (!Number.isInteger(expectedOverall) || expectedOverall < 1) {
    return NextResponse.json({ error: 'expectedOverall is required' }, { status: 400 })
  }

  const snapshot = await buildSessionSnapshot(leagueId)
  if (!snapshot || snapshot.status !== 'in_progress' || !snapshot.currentPick) {
    return NextResponse.json({ error: 'No pick is on the clock.', skipped: true }, { status: 409 })
  }
  if (snapshot.currentPick.overall !== expectedOverall) {
    return NextResponse.json(
      { error: 'That pick has already been made.', code: DRAFT_PICK_STALE_OVERALL, skipped: true },
      { status: 409 },
    )
  }

  const [uiSettings, orphanRosterIds, aiRow] = await Promise.all([
    getDraftUISettingsForLeague(leagueId),
    getOrphanRosterIdsForLeague(leagueId),
    prisma.draftSession.findFirst({
      where: { leagueId },
      orderBy: CURRENT_DRAFT_SESSION_ORDER,
      select: { commissionerAiManagers: true },
    }),
  ])
  const managed = chimmyManagesRoster({
    blob: parseCommissionerAiManagers(aiRow?.commissionerAiManagers),
    rosterId: snapshot.currentPick.rosterId,
    orphanRosterIds,
    orphanAiManagerEnabled: Boolean(uiSettings.orphanTeamAiManagerEnabled),
  })
  if (!managed.eligible) {
    return NextResponse.json(
      { error: 'Chimmy does not manage the team on the clock.', reason: managed.reason, skipped: true },
      { status: 409 },
    )
  }
  if (
    !chimmyThinkingTimeElapsed({
      timerSeconds: snapshot.timerSeconds,
      timerEndAt: snapshot.timerEndAt,
      now: new Date(),
    })
  ) {
    return NextResponse.json({ error: 'Chimmy is still on the clock.', skipped: true, retry: true }, { status: 409 })
  }

  const result = await executeDraftPickForOrphan({ leagueId, triggeredByUserId: userId, expectedOverall })
  if (!result.success) {
    const stale = result.code === DRAFT_PICK_STALE_OVERALL
    return NextResponse.json(
      { error: result.error, code: result.code, skipped: stale },
      { status: stale ? 409 : 400 },
    )
  }

  const [updated, currentUserRosterId] = await Promise.all([
    buildSessionSnapshot(leagueId),
    getCurrentUserRosterIdForLeague(leagueId, userId),
  ])
  const providerStatus = getProviderStatus()
  return NextResponse.json({
    ok: true,
    pick: result.pick,
    reason: result.reason,
    executedMode: result.executedMode,
    usedFallback: result.usedFallback,
    session:
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
              uiSettings.orphanDrafterMode === 'ai' && !providerStatus.anyAi ? 'cpu' : uiSettings.orphanDrafterMode,
          },
  })
}
