/**
 * POST: Commissioner pick editor (paused draft only). See commissionerPickEditService.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueActionGate } from '@/server/services/leagueActionGate'
import { recordCommissionerDraftAction, refuseIfSleeperMirrored } from '@/lib/draft-room/commissionerDraftActions'
import {
  commissionerPickEdit,
  COMMISSIONER_PICK_EDIT_ACTIONS,
  type CommissionerPickEditAction,
} from '@/lib/live-draft-engine/commissioner/commissionerPickEditService'
import { getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { getOrphanRosterIdsForLeague } from '@/lib/orphan-ai-manager/orphanRosterResolver'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { getProviderStatus } from '@/lib/provider-config'
import type { DraftSessionSnapshot } from '@/lib/live-draft-engine/types'
import { rosterConfigurationIncompleteBody } from '@/lib/league/roster-configuration-gate-error'
import { isLeagueRosterDraftReady } from '@/lib/league/league-roster-draft-gate'

export const dynamic = 'force-dynamic'

async function withViewerSession(
  leagueId: string,
  userId: string,
  snapshot: DraftSessionSnapshot | null,
): Promise<DraftSessionSnapshot | null> {
  if (!snapshot) return null
  const providerStatus = getProviderStatus()
  const [currentUserRosterId, orphanRosterIds, uiSettings] = await Promise.all([
    getCurrentUserRosterIdForLeague(leagueId, userId),
    getOrphanRosterIdsForLeague(leagueId),
    getDraftUISettingsForLeague(leagueId),
  ])
  return {
    ...snapshot,
    currentUserRosterId: currentUserRosterId ?? undefined,
    orphanRosterIds,
    aiManagerEnabled: uiSettings.orphanTeamAiManagerEnabled,
    orphanDrafterMode: uiSettings.orphanDrafterMode,
    orphanAiProviderAvailable: providerStatus.anyAi,
    orphanDrafterEffectiveMode:
      uiSettings.orphanDrafterMode === 'ai' && !providerStatus.anyAi ? 'cpu' : uiSettings.orphanDrafterMode,
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const gate = await assertLeagueActionGate(leagueId, userId, 'draft_commissioner_control')
  if (!gate.ok) {
    return NextResponse.json({ error: gate.err.error, code: gate.err.code }, { status: gate.err.status })
  }

  // Sleeper rewrites a mirrored draft on every sync; an edit made here would be silently undone.
  const mirrored = await refuseIfSleeperMirrored(leagueId)
  if (mirrored) return NextResponse.json(mirrored.body, { status: mirrored.status })

  if (!(await isLeagueRosterDraftReady(leagueId))) {
    return NextResponse.json(rosterConfigurationIncompleteBody(), { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const action = String(body?.action ?? '') as CommissionerPickEditAction
  if (!COMMISSIONER_PICK_EDIT_ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: `Invalid action. Expected one of: ${COMMISSIONER_PICK_EDIT_ACTIONS.join(', ')}` },
      { status: 400 },
    )
  }

  const overallPickNumber = Number(body?.overallPickNumber ?? body?.overall_pick_number)
  if (!Number.isFinite(overallPickNumber) || overallPickNumber < 1) {
    return NextResponse.json({ error: 'overallPickNumber must be a positive integer' }, { status: 400 })
  }

  const rawImg =
    body.playerImageUrl ?? body.player_image_url ?? body.imageUrl ?? body.image_url ?? null
  const playerImageUrl =
    typeof rawImg === 'string' && rawImg.trim() ? rawImg.trim().slice(0, 2048) : null

  const result = await commissionerPickEdit({
    leagueId,
    actorUserId: userId,
    action,
    overallPickNumber: Math.floor(overallPickNumber),
    reason: typeof body.reason === 'string' ? body.reason : null,
    force: Boolean(body.force),
    playerName: body.playerName ?? body.player_name ?? null,
    position: body.position ?? null,
    team: body.team ?? null,
    byeWeek: body.byeWeek ?? body.bye_week ?? null,
    playerId: body.playerId ?? body.player_id ?? null,
    playerImageUrl,
    newRosterId: body.newRosterId ?? body.new_roster_id ?? null,
    // Slice 2 — typed reason + this flag are required when the actor's roster
    // is the affected one. The service throws SELF_BENEFIT_CONFIRM_REQUIRED
    // (409) which the client surfaces as an inline confirm prompt.
    confirmSelfBenefit: Boolean(body.confirmSelfBenefit ?? body.confirm_self_benefit),
  })

  if (!result.ok) {
    if (result.status === 409 && result.code === 'ROSTER_ELIGIBILITY') {
      return NextResponse.json(
        {
          error: result.error,
          code: result.code,
          warnings: result.warnings ?? [],
        },
        { status: 409 },
      )
    }
    if (result.code === 'ROSTER_CONFIGURATION_INCOMPLETE') {
      return NextResponse.json(rosterConfigurationIncompleteBody(), { status: 400 })
    }
    if (result.status === 409 && result.code === 'SELF_BENEFIT_CONFIRM_REQUIRED') {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
  }

  await recordCommissionerDraftAction(leagueId, userId, 'pick_edit', {
    overall: Math.floor(overallPickNumber),
    source: `pick-edit:${action}`,
  })
  const sessionOut = await withViewerSession(leagueId, userId, result.snapshot)
  return NextResponse.json({ ok: true, session: sessionOut })
}
