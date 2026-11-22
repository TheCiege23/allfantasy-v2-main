/**
 * GET: Full draft session snapshot (reconnect/resync). Poll-friendly.
 * POST: Create or start draft session (commissioner).
 */

import { assertCommissionerAccess } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft, getCurrentUserRosterIdForLeague, getCurrentUserRosterIdsForLeague } from '@/lib/live-draft-engine/auth'
import { getViewerAutopickPreference } from '@/lib/live-draft-engine/LiveDraftAutopickPreferenceService'
import {
  getOrCreateDraftSession,
  buildSessionSnapshot,
  startDraftSession,
} from '@/lib/live-draft-engine/DraftSessionService'
import { getCanonicalDraftState } from '@/lib/draft/getCanonicalDraftState'
import { runAutomationTicksThrottled } from '@/lib/live-draft-engine/draftAutomationTicks'
import { runKeeperAutomationTick } from '@/lib/live-draft-engine/keeper'
import { runSlowDraftAutomationTick } from '@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService'
import { prepareDraftSessionResponse } from '@/lib/draft-room/draftSessionResponse'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { getOrphanRosterIdsForLeague } from '@/lib/orphan-ai-manager/orphanRosterResolver'
import { getDraftOrderModeAndLotteryConfig } from '@/lib/draft-lottery/lotteryConfigStorage'
import { dedupeInFlight } from '@/lib/api-performance'
import {
  repairDraftCompletionIfBoardFull,
  syncPostDraftArtifactsIfCompletedThrottled,
} from '@/lib/live-draft-engine/postDraftFinalizeArtifacts'
import { getProviderStatus } from '@/lib/provider-config'
import {
  notifyDraftIntelOnClockUrgent,
  notifyDraftIntelQueueReady,
} from '@/lib/draft-notifications'
import { rosterConfigurationIncompleteBody } from '@/lib/league/roster-configuration-gate-error'
import { publishDraftIntelForUpcomingManagers, sendDraftIntelDm } from '@/lib/draft-intelligence'
import { recordEngineTelemetrySample } from '@/lib/analytics/recordAnalyticsEvent'
import { ENGINE } from '@/lib/analytics/eventNames'
import { logStructured } from '@/lib/logging/structured'
import { getDraftPoolReadiness, triggerDraftPoolPrewarmBackground } from '@/lib/draft-room/ensureDraftPoolReady'
import { isSportsDataEnabled } from '@/lib/sports-evidence/gates'
import { CertifiedDraftIntegrationService, type CertifiedScheduleDescription } from '@/lib/sports-evidence/draftIntegration'
import { extractPlayerRefs } from '@/lib/sports-evidence/lineupIntegration'
import { prisma } from '@/lib/prisma'
import { weekFromLeagueSettingsForLineup } from '@/lib/roster/buildPersistedRosterDataFromRosterState'

export const dynamic = 'force-dynamic'

/**
 * Gated, informational-only certified schedule context for the draft board (already-made picks). Room/board
 * evidence only — it NEVER affects draft order, current pick, the pool, or any pick authority. Wrapped so it can
 * never fail the room load. Returns undefined when the gate is off, sport is non-NFL, or on any error.
 */
async function draftBoardSportsContext(leagueId: string, picks: unknown): Promise<CertifiedScheduleDescription | undefined> {
  if (!isSportsDataEnabled('draft')) return undefined
  try {
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, season: true, settings: true } })
    if (!league || String(league.sport ?? 'NFL').toUpperCase() !== 'NFL') return undefined
    const rows = Array.isArray(picks) ? picks : []
    const ids = rows
      .map((p) => {
        const o = (p ?? {}) as Record<string, unknown>
        return o.playerId ?? o.player_id ?? o.id ?? o.playerName ?? o.player_name
      })
      .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
    if (ids.length === 0) return undefined
    const refs = extractPlayerRefs(ids)
    return await new CertifiedDraftIntegrationService().describeDraftBoardSportsContext({
      season: String(league.season ?? new Date().getFullYear()),
      week: String(weekFromLeagueSettingsForLineup(league.settings)),
      players: refs,
    })
  } catch {
    return undefined
  }
}

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

function shouldPrewarmDraftPool(status: unknown): boolean {
  const normalized = String(status ?? '').trim().toLowerCase()
  return ['pre_draft', 'scheduled', 'paused', 'in_progress'].includes(normalized)
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const userId = await getSessionUserIdOrNull()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  if (req.nextUrl.searchParams.get('commissionerReadiness') === '1') {
    try {
      await assertCommissionerAccess(leagueId, userId, 'league')
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    try {
      const { getNflDraftPoolCapacity } = await import('@/lib/draft-room/nflDraftPoolCapacity')
      const draftPoolCapacity = await getNflDraftPoolCapacity(leagueId, undefined, true)
      if (draftPoolCapacity?.eligiblePlayers === 0) triggerDraftPoolPrewarmBackground(leagueId)
      return NextResponse.json({ draftPoolCapacity })
    } catch {
      return NextResponse.json({ error: 'Could not check draft pool readiness' }, { status: 503 })
    }
  }
  // A held roster both grants room access and supplies the viewer's teams.
  const rosterIds = await getCurrentUserRosterIdsForLeague(leagueId, userId)
  const allowed = rosterIds.length > 0 || await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    // Only share values that are independent of the viewer.
    const shared = await dedupeInFlight(`draft:session-board:${leagueId}`, async () => {
      const [snapshot, uiSettings, orphanRosterIds, orderMode, poolReadiness] = await Promise.all([
        buildSessionSnapshot(leagueId, new Date()),
        getDraftUISettingsForLeague(leagueId),
        getOrphanRosterIdsForLeague(leagueId),
        getDraftOrderModeAndLotteryConfig(leagueId),
        getDraftPoolReadiness(leagueId).catch(() => ({
          ready: false,
          source: 'missing' as const,
          entryCount: 0,
          syncedAt: null,
        })),
      ])
      if (!snapshot) return null

      // A connected room and the scheduled draft worker both advance the board.
      // Keep recovery off the reconnect response path.
      void runAutomationTicksThrottled(leagueId).catch(() => {})
      void dedupeInFlight<boolean | void>(`draft:live-sync-maintenance:${leagueId}`, () =>
        snapshot.status === 'completed'
          ? syncPostDraftArtifactsIfCompletedThrottled(leagueId)
          : repairDraftCompletionIfBoardFull(leagueId),
      ).catch(error => {
        console.error('[draft/session GET] draft completion maintenance failed', leagueId, error)
      })
      if (shouldPrewarmDraftPool(snapshot.status) && !poolReadiness.ready) {
        triggerDraftPoolPrewarmBackground(leagueId)
      }

      const [canonical, sportsContext] = await Promise.all([
        getCanonicalDraftState({ leagueId }).then(state => ({ state })).catch(error => {
          logStructured('warn', 'draft_session_get', 'canonical_parity_check_failed', {
            leagueId,
            error: (error as Error)?.message ?? 'unknown error',
          })
          return null
        }),
        draftBoardSportsContext(leagueId, snapshot.picks),
      ])
      const state = canonical?.state
      const current = paritySnapshot(snapshot)
      const parity = state ? {
        statusMatches: current.status === state.status,
        currentPickMatches: current.currentPickNumber === state.currentPickNumber,
        picksMadeMatches: current.picksMade === state.picksMade,
      } : null

      if (parity && state) {
        const mismatches: string[] = []
        if (!parity.statusMatches) mismatches.push('status')
        if (!parity.currentPickMatches && current.currentPickNumber != null && state.currentPickNumber != null) {
          mismatches.push('currentPickNumber')
        }
        if (!parity.picksMadeMatches && current.picksMade != null) mismatches.push('picksMade')
        if (mismatches.length > 0) {
          logStructured('warn', 'draft_session_get', 'canonical_parity_mismatch', {
            leagueId,
            mismatches,
            canonicalStatus: state.status,
            canonicalPick: state.currentPickNumber,
            canonicalPicksMade: state.picksMade,
          })
        }
      }

      const providerStatus = getProviderStatus()
      const { viewerAutopick: _viewerAutopick, currentUserRosterId: _currentUserRosterId, ...sharedSnapshot } = snapshot
      const response = prepareDraftSessionResponse({
        leagueId,
        session: {
          ...sharedSnapshot,
          orphanRosterIds,
          aiManagerEnabled: uiSettings.orphanTeamAiManagerEnabled,
          orphanDrafterMode: uiSettings.orphanDrafterMode,
          orphanAiProviderAvailable: providerStatus.anyAi,
          orphanDrafterEffectiveMode:
            uiSettings.orphanDrafterMode === 'ai' && !providerStatus.anyAi
              ? 'cpu'
              : uiSettings.orphanDrafterMode,
          draftOrderMode: orderMode?.draftOrderMode,
          lotteryLastRunAt: orderMode?.lotteryLastRunAt ?? undefined,
        },
        poolReadiness: {
          ready: poolReadiness.ready,
          entryCount: poolReadiness.entryCount,
          source: poolReadiness.source,
          syncedAt: poolReadiness.syncedAt,
        },
        ...(canonical ? { canonicalDraftState: canonical.state } : {}),
        ...(parity ? { canonicalDraftStateParity: parity } : {}),
        ...(sportsContext ? { sportsContext } : {}),
      })
      return { snapshot, response }
    })

    if (!shared) {
      return NextResponse.json({
        leagueId,
        session: null,
        message: 'No draft session. POST to create and start.',
      })
    }

    const [currentUserRosterId, viewerAutopick] = await Promise.all([
      getCurrentUserRosterIdForLeague(leagueId, userId, undefined, shared.snapshot, rosterIds),
      getViewerAutopickPreference(shared.snapshot.id, userId),
    ])
    recordEngineTelemetrySample(ENGINE.DRAFT_STATE_POLL, { meta: { leagueId, userId } })
    return shared.response({ viewerAutopick, currentUserRosterId: currentUserRosterId ?? undefined })
  } catch (e) {
    logStructured('error', 'draft_session_get', 'unhandled_error', {
      leagueId,
      error: (e as Error)?.message ?? String(e),
    })
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
    await assertCommissionerAccess(leagueId, userId, 'league')
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const action = (body.action as string) || 'ensure'

  try {
    if (action === 'ensure' || action === 'create') {
      const { session: s, created } = await getOrCreateDraftSession(leagueId)
      const poolReadiness = await getDraftPoolReadiness(leagueId).catch(() => null)
      if (shouldPrewarmDraftPool(s.status)) {
        triggerDraftPoolPrewarmBackground(leagueId)
      }
      return NextResponse.json({
        sessionId: s.id,
        leagueId: s.leagueId,
        status: s.status,
        created,
        poolReadiness: poolReadiness
          ? {
              ready: poolReadiness.ready,
              entryCount: poolReadiness.entryCount,
              source: poolReadiness.source,
              syncedAt: poolReadiness.syncedAt,
            }
          : undefined,
      })
    }
    if (action === 'start') {
      const poolReadiness = await getDraftPoolReadiness(leagueId)
      if (!poolReadiness.ready) {
        triggerDraftPoolPrewarmBackground(leagueId)
        return NextResponse.json(
          {
            code: 'POOL_NOT_READY',
            error: 'Preparing player pool. Try again in a few seconds.',
            poolReadiness: {
              ready: poolReadiness.ready,
              entryCount: poolReadiness.entryCount,
              source: poolReadiness.source,
              syncedAt: poolReadiness.syncedAt,
            },
          },
          { status: 409 },
        )
      }
      const started = await startDraftSession(leagueId)
      if (!started.ok) {
        if (started.reason === 'ROSTER_CONFIGURATION_INCOMPLETE') {
          return NextResponse.json(rosterConfigurationIncompleteBody({ leagueId }), { status: 409 })
        }
        if (started.reason === 'SURVIVOR_CAST_INCOMPLETE' || started.reason === 'NFL_DRAFT_POOL_INCOMPLETE') {
          return NextResponse.json({ code: started.reason, error: started.error }, { status: 409 })
        }
        return NextResponse.json({ error: 'Cannot start draft' }, { status: 400 })
      }
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
        poolReadiness: {
          ready: true,
          entryCount: poolReadiness.entryCount,
          source: poolReadiness.source,
          syncedAt: poolReadiness.syncedAt,
        },
      })
    }
    return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 })
  } catch (e) {
    console.error('[draft/session POST]', e)
    return NextResponse.json({ error: (e as Error).message ?? 'Server error' }, { status: 500 })
  }
}
