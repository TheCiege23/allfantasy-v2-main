/**
 * GET: Full draft session snapshot (reconnect/resync). Poll-friendly.
 * POST: Create or start draft session (commissioner).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { canAccessLeagueDraft, getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import {
  getOrCreateDraftSession,
  buildSessionSnapshot,
  startDraftSession,
} from '@/lib/live-draft-engine/DraftSessionService'
import { getCanonicalDraftState } from '@/lib/draft/getCanonicalDraftState'
import { runAuctionAutomationTick } from '@/lib/live-draft-engine/auction'
import { runKeeperAutomationTick } from '@/lib/live-draft-engine/keeper'
import { runSlowDraftAutomationTick } from '@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { getOrphanRosterIdsForLeague } from '@/lib/orphan-ai-manager/orphanRosterResolver'
import { getDraftOrderModeAndLotteryConfig } from '@/lib/draft-lottery/lotteryConfigStorage'
import { dedupeInFlight } from '@/lib/api-performance'
import {
  repairDraftCompletionIfBoardFull,
  syncPostDraftArtifactsIfCompletedThrottled,
} from '@/lib/live-draft-engine/postDraftFinalizeArtifacts'
import { getProviderStatus } from '@/lib/provider-config'
import { notifyDraftStartingSoon } from '@/lib/draft-notifications'
import {
  notifyDraftIntelOnClockUrgent,
  notifyDraftIntelQueueReady,
} from '@/lib/draft-notifications'
import { rosterConfigurationIncompleteBody } from '@/lib/league/roster-configuration-gate-error'
import { publishDraftIntelForUpcomingManagers, sendDraftIntelDm } from '@/lib/draft-intelligence'

export const dynamic = 'force-dynamic'

async function getSessionUserIdOrNull(): Promise<string | null> {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    return session?.user?.id ?? null
  } catch (e) {
    console.warn('[draft/session] getServerSession failed (treating as unauthenticated)', {
      error: (e as Error)?.message ?? 'unknown error',
    })
    return null
  }
}

function normalizeSessionStatus(value: unknown): 'scheduled' | 'live' | 'paused' | 'completed' {
  const status = String(value ?? '').trim().toLowerCase()
  if (status === 'in_progress' || status === 'active' || status === 'live') return 'live'
  if (status === 'paused') return 'paused'
  if (status === 'completed' || status === 'complete' || status === 'post_draft') return 'completed'
  return 'scheduled'
}

function safeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

function paritySnapshot(summary: unknown): {
  status: 'scheduled' | 'live' | 'paused' | 'completed'
  currentPickNumber: number | null
  picksMade: number | null
} {
  const s = (summary ?? {}) as {
    status?: unknown
    currentPick?: { overall?: unknown } | null
    picks?: unknown
  }

  return {
    status: normalizeSessionStatus(s.status),
    currentPickNumber: safeNumber(s.currentPick?.overall),
    picksMade: Array.isArray(s.picks) ? s.picks.length : null,
  }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const userId = await getSessionUserIdOrNull()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const providerStatus = getProviderStatus()
    // Dedup key includes viewer userId because the snapshot now contains viewer-private fields (viewerAutopick).
    const shared = await dedupeInFlight(`draft:session:${leagueId}:${userId}`, async () => {
      // Phase 3b — perf: automation ticks were running sequentially (4 awaits
      // = 2-4 sec on a typical snake draft where most are no-ops). They don't
      // depend on each other, so run in parallel. Same for the snapshot/UI
      // settings/orphan/orderMode quartet which was already parallel.
      // syncPostDraftArtifactsIfCompletedThrottled is also independent.
      await Promise.all([
        runKeeperAutomationTick(leagueId).catch(() => {}),
        runSlowDraftAutomationTick(leagueId).catch(() => {}),
        runAuctionAutomationTick(leagueId).catch(() => {}),
        repairDraftCompletionIfBoardFull(leagueId).catch((e) => {
          console.error('[draft/session GET] repairDraftCompletionIfBoardFull', leagueId, e)
        }),
        syncPostDraftArtifactsIfCompletedThrottled(leagueId).catch(() => {}),
      ])
      const [snapshot, uiSettings, orphanRosterIds, orderMode] = await Promise.all([
        buildSessionSnapshot(leagueId, new Date(), userId),
        getDraftUISettingsForLeague(leagueId),
        getOrphanRosterIdsForLeague(leagueId),
        getDraftOrderModeAndLotteryConfig(leagueId),
      ])
      return { snapshot, uiSettings, orphanRosterIds, orderMode }
    })

    if (!shared.snapshot) {
      return NextResponse.json({
        leagueId,
        session: null,
        message: 'No draft session. POST to create and start.',
      })
    }

    let canonicalDraftState: Awaited<ReturnType<typeof getCanonicalDraftState>> | null = null
    let canonicalDraftStateParity:
      | {
          statusMatches: boolean
          currentPickMatches: boolean
          picksMadeMatches: boolean
        }
      | null = null
    let canonicalParityCheckFailed = false

    // Read canonical state for parity visibility only. Keep existing response
    // shape untouched until explicit route migration.
    try {
      canonicalDraftState = await getCanonicalDraftState({ leagueId })
      if (canonicalDraftState) {
        const current = paritySnapshot(shared.snapshot)
        canonicalDraftStateParity = {
          statusMatches: current.status === canonicalDraftState.status,
          currentPickMatches:
            current.currentPickNumber === canonicalDraftState.currentPickNumber,
          picksMadeMatches: current.picksMade === canonicalDraftState.picksMade,
        }

        const mismatches: string[] = []
        if (!canonicalDraftStateParity.statusMatches) mismatches.push('status')
        if (
          !canonicalDraftStateParity.currentPickMatches &&
          current.currentPickNumber != null &&
          canonicalDraftState.currentPickNumber != null
        ) {
          mismatches.push('currentPickNumber')
        }
        if (!canonicalDraftStateParity.picksMadeMatches && current.picksMade != null) {
          mismatches.push('picksMade')
        }

        if (mismatches.length > 0) {
          console.warn('[draft/session GET] canonical parity mismatch', {
            leagueId,
            mismatches,
            canonical: {
              status: canonicalDraftState.status,
              currentPickNumber: canonicalDraftState.currentPickNumber,
              picksMade: canonicalDraftState.picksMade,
            },
            existing: current,
          })
        }
      }
    } catch (e) {
      canonicalParityCheckFailed = true
      console.warn('[draft/session GET] canonical parity check failed (non-fatal)', {
        leagueId,
        error: (e as Error)?.message ?? 'unknown error',
      })
    }

    const currentUserRosterId = await getCurrentUserRosterIdForLeague(leagueId, userId)
    const responseBody: {
      leagueId: string
      session: Record<string, unknown>
      canonicalDraftState?: Awaited<ReturnType<typeof getCanonicalDraftState>> | null
      canonicalDraftStateParity?: {
        statusMatches: boolean
        currentPickMatches: boolean
        picksMadeMatches: boolean
      }
    } = {
      leagueId,
      session: {
        ...shared.snapshot,
        currentUserRosterId: currentUserRosterId ?? undefined,
        orphanRosterIds: shared.orphanRosterIds,
        aiManagerEnabled: shared.uiSettings.orphanTeamAiManagerEnabled,
        orphanDrafterMode: shared.uiSettings.orphanDrafterMode,
        orphanAiProviderAvailable: providerStatus.anyAi,
        orphanDrafterEffectiveMode:
          shared.uiSettings.orphanDrafterMode === 'ai' && !providerStatus.anyAi
            ? 'cpu'
            : shared.uiSettings.orphanDrafterMode,
        draftOrderMode: shared.orderMode?.draftOrderMode,
        lotteryLastRunAt: shared.orderMode?.lotteryLastRunAt ?? undefined,
      },
    }

    if (!canonicalParityCheckFailed) {
      responseBody.canonicalDraftState = canonicalDraftState
      if (canonicalDraftStateParity) {
        responseBody.canonicalDraftStateParity = canonicalDraftStateParity
      }
    }

    return NextResponse.json(responseBody)
  } catch (e) {
    console.error('[draft/session GET]', e)
    return NextResponse.json({ error: 'Failed to load draft session' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const userId = await getSessionUserIdOrNull()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await assertCommissioner(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const action = (body.action as string) || 'ensure'

  try {
    if (action === 'ensure' || action === 'create') {
      const { session: s, created } = await getOrCreateDraftSession(leagueId)
      return NextResponse.json({
        sessionId: s.id,
        leagueId: s.leagueId,
        status: s.status,
        created,
      })
    }
    if (action === 'start') {
      const started = await startDraftSession(leagueId)
      if (!started.ok) {
        if (started.reason === 'ROSTER_CONFIGURATION_INCOMPLETE') {
          return NextResponse.json(rosterConfigurationIncompleteBody({ leagueId }), { status: 409 })
        }
        return NextResponse.json({ error: 'Cannot start draft' }, { status: 400 })
      }
      void notifyDraftStartingSoon(leagueId)
      await runKeeperAutomationTick(leagueId).catch(() => {})
      await runSlowDraftAutomationTick(leagueId).catch(() => {})
      const providerStatus = getProviderStatus()
      const [snapshot, uiSettings, orphanRosterIds] = await Promise.all([
        buildSessionSnapshot(leagueId, new Date(), userId),
        getDraftUISettingsForLeague(leagueId),
        getOrphanRosterIdsForLeague(leagueId),
      ])
      if (!snapshot) return NextResponse.json({ error: 'Failed to build session' }, { status: 500 })
      void (async () => {
        const states = await publishDraftIntelForUpcomingManagers({
          leagueId,
          trigger: 'n_minus_5',
        }).catch(() => [])
        for (const result of states) {
          const state = result.state
          await sendDraftIntelDm(state).catch(() => null)
          if (state.status === 'active' && state.picksUntilUser === 5 && state.queue[0]) {
            await notifyDraftIntelQueueReady(leagueId, state.rosterId, {
              playerName: state.queue[0].playerName,
              availabilityProbability: state.queue[0].availabilityProbability,
            }).catch(() => null)
          }
          if (state.status === 'on_clock') {
            await notifyDraftIntelOnClockUrgent(leagueId, state.rosterId, {
              playerName: state.queue[0]?.playerName,
              pickLabel: snapshot.currentPick?.pickLabel,
            }).catch(() => null)
          }
        }
      })()
      const currentUserRosterId = await getCurrentUserRosterIdForLeague(leagueId, userId)
      return NextResponse.json({
        leagueId,
        session: {
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
        },
      })
    }
    return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 })
  } catch (e) {
    console.error('[draft/session POST]', e)
    return NextResponse.json({ error: (e as Error).message ?? 'Server error' }, { status: 500 })
  }
}
