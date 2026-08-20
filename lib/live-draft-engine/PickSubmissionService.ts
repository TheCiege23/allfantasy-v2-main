/**
 * Pick submission: validate, persist, advance timer, optional roster append.
 * Uses transaction to avoid race conditions (duplicate picks, wrong order).
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { assertDraftSessionBelongsToLeague } from '@/lib/engine-testing/hardening/engineInvariants'
import { logEngineInvariantOptional } from '@/lib/engine-testing/runtime/invariantRuntime'
import { computeTimerEndAt } from './DraftTimerService'
import { validatePickSubmission, validateDevyEligibilityAsync, validateC2CEligibilityAsync } from './PickValidation'
import { validateSpecialtyDraftPools } from './SpecialtyDraftPoolValidation'
import { validateRosterFitForDraftPick } from './RosterFitValidation'
import { resolveCurrentOnTheClock } from './CurrentOnTheClockResolver'
import { resolvePickOwner } from './PickOwnershipResolver'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { getManagerColorBySeed } from '@/lib/draft-room'
import { completeDraftSession } from './DraftSessionService'
import { recordTrendSignalByPlayerId } from '@/lib/player-trend/signal-integration'
import { resolveSportForTrend } from '@/lib/player-trend/SportTrendContextResolver'
import type { SlotOrderEntry } from './types'
import { buildKeeperLocks } from './keeper/KeeperDraftOrder'
import type { KeeperConfig, KeeperSelection } from './keeper/types'
import { getSalaryCapConfig } from '@/lib/salary-cap/SalaryCapLeagueConfig'
import { assignRookieContract } from '@/lib/salary-cap/RookieContractService'
import { isDraftBoardFull, isDraftPickRowEmpty } from './draftPickEmpty'
import {
  DRAFT_PICK_NOT_LIVE,
  DRAFT_PICK_RACE_RETRY,
  DRAFT_PICK_STALE_OVERALL,
  type PickAuthorityCode,
} from './pickAuthorityCodes'
import { logStructured } from '@/lib/logging/structured'
import { recordEngineTelemetrySample } from '@/lib/analytics/recordAnalyticsEvent'
import { ENGINE } from '@/lib/analytics/eventNames'
import { withPickLock } from '@/lib/draft/draftLock'

export interface SubmitPickInput {
  leagueId: string
  playerName: string
  position: string
  team?: string | null
  byeWeek?: number | null
  playerId?: string | null
  /** Headshot URL captured at commit (from pool normalization / DB) for stable board & history rendering. */
  playerImageUrl?: string | null
  rosterId?: string | null
  /** User who submitted the pick (manager or commissioner). */
  madeByUserId?: string | null
  source?: 'user' | 'auto' | 'commissioner' | 'keeper' | 'devy' | 'college' | 'promoted_devy'
  tradedPicks?: { round: number; originalRosterId: string; previousOwnerName: string; newRosterId: string; newOwnerName: string }[]
  /** Override asset classification (dispersal, pick_slot, etc.). */
  assetType?: 'player' | 'rookie_pick' | 'devy_pick' | 'dispersal_asset' | 'pick_slot' | 'c2c_college'
  pickMetadata?: Record<string, unknown> | null
  /** Client view of next overall (typically picks.length + 1); stale guard when it differs from server. */
  expectedOverall?: number
  /** When true, commissioner correction flow — on-clock check skipped in validation. */
  commissionerOverride?: boolean
}

export interface SubmitPickResult {
  success: boolean
  error?: string
  code?: 'ROSTER_CONFIGURATION_INCOMPLETE' | PickAuthorityCode
  snapshot?: { sessionId: string; overall: number; pickLabel: string; rosterId: string }
}

async function resolveCurrentOverallForStalePreflight(leagueId: string): Promise<number | null> {
  const session = await prisma.draftSession.findUnique({
    where: { leagueId },
    include: { picks: { orderBy: { overall: 'asc' } } },
  })
  if (!session) return null

  const current = resolveCurrentOnTheClock({
    totalPicks: session.rounds * session.teamCount,
    picks: (session.picks ?? []).map((p) => ({
      overall: p.overall,
      playerName: p.playerName,
      position: p.position,
      pickMetadata: p.pickMetadata ?? null,
    })),
    teamCount: session.teamCount,
    draftType: session.draftType as 'snake' | 'linear' | 'auction',
    thirdRoundReversal: session.thirdRoundReversal,
    slotOrder: (session.slotOrder as unknown as SlotOrderEntry[]) ?? [],
  })
  return current?.overall ?? null
}

/**
 * Internal: pick core logic — validation + transaction. Called under a distributed lock.
 * Not exported; external callers use the `submitPick` wrapper below.
 */
async function _submitPickCore(input: SubmitPickInput): Promise<SubmitPickResult> {
  const session = await prisma.draftSession.findUnique({
    where: { leagueId: input.leagueId },
    include: { picks: { orderBy: { overall: 'asc' } } },
  })
  if (!session) return { success: false, error: 'Draft session not found' }

  logEngineInvariantOptional(
    assertDraftSessionBelongsToLeague({
      sessionLeagueId: session.leagueId,
      expectedLeagueId: input.leagueId,
    }),
    'submitPick.draft_session_league',
    { leagueId: input.leagueId, sessionId: session.id },
  )

  const slotOrder = (session.slotOrder as unknown as SlotOrderEntry[]) ?? []
  const tradedPicksRaw = (session as any).tradedPicks
  const tradedPicks = Array.isArray(tradedPicksRaw) ? tradedPicksRaw : []
  const teamCount = session.teamCount
  const totalPicks = session.rounds * teamCount
  // Use the picks array (not just picksCount) so that commissioner-cleared empty slots
  // (gap boards) are skipped and the correct next open overall is resolved.
  const picksForResolver = session.picks.map((p) => ({
    overall: p.overall,
    playerName: p.playerName,
    position: p.position,
    pickMetadata: (p as { pickMetadata?: unknown | null }).pickMetadata ?? null,
  }))
  const current = resolveCurrentOnTheClock({
    totalPicks,
    picks: picksForResolver,
    teamCount,
    draftType: session.draftType as 'snake' | 'linear' | 'auction',
    thirdRoundReversal: session.thirdRoundReversal,
    slotOrder,
  })
  if (!current) {
    return { success: false, error: 'Draft is complete or not started', code: DRAFT_PICK_NOT_LIVE }
  }

  // overall comes from the resolver so it correctly handles boards with gaps
  const overall = current.overall
  if (input.expectedOverall != null && input.expectedOverall !== overall) {
    return {
      success: false,
      error: 'Draft board moved; refresh and retry.',
      code: DRAFT_PICK_STALE_OVERALL,
    }
  }
  const round = Math.ceil(overall / teamCount)
  const slot = current.slot
  const resolvedOwner = resolvePickOwner(round, slot, slotOrder, tradedPicks)
  const effectiveRosterId = input.rosterId ?? resolvedOwner?.rosterId ?? current.rosterId
  const onClockRosterId = resolvedOwner?.rosterId ?? current.rosterId
  const validation = validatePickSubmission({
    playerName: input.playerName,
    position: input.position,
    rosterId: effectiveRosterId,
    currentOnClockRosterId: onClockRosterId,
    existingPicks: session.picks
      .filter((p) => !isDraftPickRowEmpty(p))
      .map((p) => ({ playerName: p.playerName, position: p.position })),
    sessionStatus: session.status,
    commissionerOverride: input.commissionerOverride === true || input.source === 'commissioner',
  })
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
      ...(validation.code ? { code: validation.code } : {}),
    }
  }

  const keeperConfig = (session.keeperConfig ?? (session as any).keeperConfig) as KeeperConfig | null
  const keeperSelections = (session.keeperSelections ?? (session as any).keeperSelections) as KeeperSelection[] | null
  if (keeperConfig?.maxKeepers && Array.isArray(keeperSelections) && keeperSelections.length > 0) {
    const keeperLocks = buildKeeperLocks(
      keeperSelections,
      slotOrder,
      tradedPicks,
      teamCount,
      session.rounds,
      session.draftType as 'snake' | 'linear' | 'auction',
      session.thirdRoundReversal
    )
    const lock = keeperLocks.find((item) => item.round === round && item.slot === slot)
    if (lock && input.source !== 'keeper') {
      return { success: false, error: 'This slot is keeper-locked and will be auto-applied.' }
    }
    if (lock && input.source === 'keeper') {
      if (lock.playerName.trim().toLowerCase() !== input.playerName.trim().toLowerCase()) {
        return { success: false, error: 'Keeper lock mismatch for this slot.' }
      }
    }
  }

  const rosterFit = await validateRosterFitForDraftPick({
    leagueId: input.leagueId,
    rosterId: effectiveRosterId,
    existingPicks: session.picks.map((p) => ({ rosterId: p.rosterId, position: p.position })),
    newPickPosition: input.position,
  })
  if (!rosterFit.valid) return { success: false, error: rosterFit.error }

  const roundForEligibility = round ?? 1
  const rawC2cConfig = session.c2cConfig ?? (session as any).c2cConfig
  const c2cConfig =
    rawC2cConfig && typeof rawC2cConfig === 'object' && (rawC2cConfig as any).enabled
      ? { enabled: true, collegeRounds: Array.isArray((rawC2cConfig as any).collegeRounds) ? (rawC2cConfig as any).collegeRounds : [] }
      : null
  const rawDevyConfig = session.devyConfig ?? (session as any).devyConfig
  const devyConfig =
    rawDevyConfig && typeof rawDevyConfig === 'object' && (rawDevyConfig as any).enabled
      ? { enabled: true, devyRounds: Array.isArray((rawDevyConfig as any).devyRounds) ? (rawDevyConfig as any).devyRounds : [] }
      : null

  if (c2cConfig?.enabled) {
    const c2cValidation = await validateC2CEligibilityAsync(
      { currentRound: roundForEligibility, playerName: input.playerName, c2cConfig },
      prisma
    )
    if (!c2cValidation.valid) return { success: false, error: c2cValidation.error }
  } else if (devyConfig?.enabled) {
    const devyValidation = await validateDevyEligibilityAsync(
      {
        currentRound: roundForEligibility,
        playerName: input.playerName,
        position: input.position,
        source: input.source,
        devyConfig,
      },
      prisma
    )
    if (!devyValidation.valid) return { success: false, error: devyValidation.error }
  }

  const owner = resolvePickOwner(round, slot, slotOrder, input.tradedPicks ?? tradedPicks)
  const displayName = owner?.displayName ?? current.displayName
  const slotOriginalRosterId = slotOrder.find((s) => s.slot === slot)?.rosterId ?? onClockRosterId

  let assetType: string = input.assetType ?? 'player'
  if (!input.assetType) {
    if (input.source === 'devy' || input.source === 'promoted_devy') assetType = 'devy_pick'
    else if (input.source === 'college') assetType = 'c2c_college'
    else assetType = 'player'
  }

  const specialtyPool = validateSpecialtyDraftPools({
    draftModeLabel: (session as { draftModeLabel?: string | null }).draftModeLabel,
    dispersalPoolConfig: (session as { dispersalPoolConfig?: unknown }).dispersalPoolConfig,
    playerPool: session.playerPool ?? 'all',
    effectiveRosterId,
    onClockRosterId,
    playerId: input.playerId,
    playerName: input.playerName,
    position: input.position,
    assetType,
    pickMetadata: input.pickMetadata ?? undefined,
    commissionerOverride: input.source === 'commissioner',
  })
  if (!specialtyPool.valid) return { success: false, error: specialtyPool.error }
  const uiSettings = await getDraftUISettingsForLeague(input.leagueId)
  let tradedPickMeta = owner?.tradedPickMeta ? { ...owner.tradedPickMeta } : null
  if (tradedPickMeta) {
    tradedPickMeta.showNewOwnerInRed = Boolean(uiSettings.tradedPickOwnerNameRedEnabled)
    if (uiSettings.tradedPickColorModeEnabled) {
      const seed = String(tradedPickMeta.newOwnerName ?? owner?.rosterId ?? displayName ?? 'manager')
      tradedPickMeta.tintColor = getManagerColorBySeed(seed).tintHex
    } else {
      delete tradedPickMeta.tintColor
    }
  }

  const timerSeconds = session.timerSeconds ?? 90
  const nextTimerEndAt = computeTimerEndAt(timerSeconds)

  /*
   * A COMMISSIONER CORRECTION MUST NOT RESUME A PAUSED DRAFT.
   *
   * Every successful pick used to write `status: 'in_progress'` and a fresh `timerEndAt`, which is
   * right for a manager picking on the clock and wrong for the commissioner. A pause is exactly
   * when corrections happen — reassigning a pick to the manager it should have gone to, fixing a
   * misdraft — and doing that silently un-paused the draft and started everyone's clock running.
   * The commissioner then had to notice and re-pause, racing the very managers they paused for.
   *
   * `resetTimer()` in DraftSessionService already encodes the correct semantic for this exact
   * situation — "stay paused; only refresh stored remainder (do not resume)" — and `undoPick`
   * calls it when a commissioner removes a player. This is that rule applied to the other half of
   * the pair: reassigning a pick resets the clock the same way removing a player does.
   *
   * Resuming stays an explicit commissioner action (resumeDraftSession), never a side effect of a
   * correction.
   */
  const isCommissionerCorrection =
    input.commissionerOverride === true || input.source === 'commissioner'
  const keepPaused = isCommissionerCorrection && session.status === 'paused'
  const picksCountAtSubmit = session.picks.length

  let pick: any
  try {
    pick = await prisma.$transaction(async (tx) => {
      const locked = await (tx as any).draftSession.findUnique({
        where: { id: session.id },
        include: { picks: { orderBy: { overall: 'asc' } } },
      })
      if (!locked) {
        throw new Error('Draft state changed; please retry')
      }
      if (locked.picks.length !== picksCountAtSubmit) {
        throw new Error('Draft state changed; please retry')
      }
      const existingAtOverall = locked.picks.find((p: any) => p.overall === overall)
      // If a real (non-empty) pick already landed at this slot, reject as stale
      if (existingAtOverall && !isDraftPickRowEmpty(existingAtOverall)) {
        throw new Error('Draft state changed; please retry')
      }
      // If a commissioner-cleared empty-slot row exists, delete it before inserting
      if (existingAtOverall) {
        await (tx as any).draftPick.delete({ where: { id: existingAtOverall.id } })
      }
      const created = await (tx as any).draftPick.create({
        data: {
          sessionId: session.id,
          sportType: (session as any).sportType ?? null,
          overall,
          round,
          slot,
          rosterId: effectiveRosterId,
          originalRosterId: slotOriginalRosterId,
          displayName,
          playerName: input.playerName.trim(),
          position: input.position,
          team: input.team ?? null,
          byeWeek: input.byeWeek ?? null,
          playerId: input.playerId ?? null,
          tradedPickMeta: tradedPickMeta ? (tradedPickMeta as any) : undefined,
          source: input.source ?? 'user',
          assetType,
          ...(input.pickMetadata != null
            ? { pickMetadata: input.pickMetadata as Prisma.InputJsonValue }
            : {}),
          ownerUserId: input.madeByUserId ?? null,
        },
      })
      await (tx as any).draftSession.update({
        where: { id: session.id },
        data: keepPaused
          ? {
              /*
               * Clock reset, pause preserved: the stored remainder is refreshed to a full timer so
               * the next manager on the clock gets a whole pick when the commissioner resumes,
               * and `timerEndAt` stays null because nothing is counting down while paused.
               */
              timerEndAt: null,
              pausedRemainingSeconds: timerSeconds,
              status: 'paused',
              version: { increment: 1 },
              updatedAt: new Date(),
            }
          : {
              timerEndAt: nextTimerEndAt,
              pausedRemainingSeconds: null,
              status: 'in_progress',
              version: { increment: 1 },
              updatedAt: new Date(),
            },
      })
      return created
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // Sampled metric: track race frequency so we can decide if pessimistic
      // Redis locking is warranted (threshold: >2 % of picks in prod).
      recordEngineTelemetrySample(ENGINE.DRAFT_PICK_RACE, {
        meta: { leagueId: input.leagueId, reason: 'p2002_unique' },
      })
      return {
        success: false,
        error: 'Draft state changed; please retry',
        code: DRAFT_PICK_RACE_RETRY,
      }
    }
    if (error instanceof Error && /Draft state changed/.test(error.message)) {
      recordEngineTelemetrySample(ENGINE.DRAFT_PICK_RACE, {
        meta: { leagueId: input.leagueId, reason: 'optimistic_sentinel' },
      })
      return {
        success: false,
        error: 'Draft state changed; please retry',
        code: DRAFT_PICK_RACE_RETRY,
      }
    }
    throw error
  }

  // Sampled: record successful pick submission for draft-room analytics.
  recordEngineTelemetrySample(ENGINE.DRAFT_PICK_SUBMITTED, {
    meta: {
      leagueId: input.leagueId,
      sessionId: session.id,
      overall,
      source: input.source ?? 'user',
    },
  })

  // Transition league lifecycle to drafting if this is the first pick and league is in pre_draft
  try {
    const { transitionLeagueState, getLeagueLifecycleState } = await import('@/server/services/leagueLifecycleService')
    const league = await prisma.league.findUnique({
      where: { id: input.leagueId },
      select: { lifecycleState: true, userId: true },
    })
    if (league) {
      const currentState = getLeagueLifecycleState(league)
      if (currentState === 'pre_draft') {
        await transitionLeagueState(input.leagueId, 'drafting', league.userId ?? 'system')
      }
    }
  } catch (e) {
    // Lifecycle transition is best-effort; don't fail the pick if it fails
    logStructured('error', 'submit_pick', 'lifecycle_transition_failed', {
      leagueId: input.leagueId,
      error: e instanceof Error ? e.message : String(e),
    })
  }

  const pickLabel = `${round}.${slot.toString().padStart(2, '0')}`

  // Trend detection signals are best-effort and should never block draft picks.
  try {
    const league = await prisma.league.findUnique({
      where: { id: input.leagueId },
      select: { sport: true },
    })
    const sport = resolveSportForTrend(league?.sport)
    let resolvedPlayerId = pick.playerId ?? input.playerId ?? null
    if (!resolvedPlayerId) {
      const byName = await prisma.player.findFirst({
        where: {
          sport,
          name: { equals: input.playerName.trim(), mode: 'insensitive' },
        },
        select: { id: true },
      })
      resolvedPlayerId = byName?.id ?? null
    }

    if (resolvedPlayerId) {
      await recordTrendSignalByPlayerId({
        playerId: resolvedPlayerId,
        sport,
        signalType: 'draft_pick',
        leagueId: input.leagueId,
        updateAfter: true,
      })

      if (input.source === 'auto') {
        await recordTrendSignalByPlayerId({
          playerId: resolvedPlayerId,
          sport,
          signalType: 'ai_recommendation',
          leagueId: input.leagueId,
          value: 1,
          updateAfter: false,
        })
      }
    }
  } catch {
    // non-fatal
  }

  if (overall >= totalPicks) {
    let completed = await completeDraftSession(input.leagueId)
    if (!completed) {
      completed = await completeDraftSession(input.leagueId)
    }
    if (!completed) {
      const { repairDraftCompletionIfBoardFull } = await import('@/lib/live-draft-engine/postDraftFinalizeArtifacts')
      completed = await repairDraftCompletionIfBoardFull(input.leagueId)
      if (!completed) {
        logStructured('error', 'submit_pick', 'draft_completion_failed', {
          leagueId: input.leagueId,
          overall,
          totalPicks,
          note: 'completion may heal on next state poll',
        })
      }
    }
  } else {
    // For boards with commissioner-cleared gaps: the filled slot may not be the
    // highest overall, but the board might now be complete. Check explicitly.
    const allPickRows = await prisma.draftPick.findMany({
      where: { sessionId: session.id },
      select: { overall: true, playerName: true, position: true, pickMetadata: true },
    })
    if (
      isDraftBoardFull(
        allPickRows.map((p) => ({
          overall: p.overall,
          playerName: p.playerName,
          position: p.position,
          pickMetadata: (p as { pickMetadata?: unknown | null }).pickMetadata ?? null,
        })),
        totalPicks,
      )
    ) {
      await completeDraftSession(input.leagueId)
    }
  }

  // ── Salary cap: auto-assign rookie contract on snake draft picks ──
  try {
    const capConfig = await getSalaryCapConfig(input.leagueId)
    if (capConfig?.startupDraftType === 'snake' && effectiveRosterId) {
      const resolvedPlayerId = pick.playerId ?? input.playerId ?? null
      const capYear = new Date().getFullYear()
      await assignRookieContract(
        input.leagueId,
        effectiveRosterId,
        resolvedPlayerId ?? `draft-${overall}`,
        input.playerName.trim(),
        input.position,
        overall,
        capYear
      ).catch((err: unknown) => {
        logStructured('error', 'submit_pick', 'salary_cap_contract_failed', {
          leagueId: input.leagueId,
          overall,
          error: String(err),
        })
      })
    }
  } catch {
    // non-fatal: contract assignment failure should never block pick persistence
  }

  void import('@/lib/draft-room/postDraftPickChatEvent')
    .then(({ postDraftPickChatEvent }) =>
      postDraftPickChatEvent({
        leagueId: input.leagueId,
        rosterId: effectiveRosterId,
        madeByUserId: input.madeByUserId ?? null,
        playerName: input.playerName.trim(),
        position: input.position.trim(),
        rosterDisplayName: typeof displayName === 'string' && displayName.trim() ? displayName.trim() : 'Team',
        overall: pick.overall,
        pickLabel,
        round: pick.round ?? round,
        roundSlot: pick.slot ?? slot,
        playerId: pick.playerId ?? input.playerId ?? null,
        nflTeam: pick.team ?? input.team ?? null,
        // D.6.3 — pick chat card metadata (forwarded to LeagueChatMessage.metadata).
        headshotUrl: pick.playerImageUrl ?? input.playerImageUrl ?? null,
        // D.6.3 — flips the AI badge on the rendered card. Mutually exclusive with commissionerOverride below.
        aiManager: input.source === 'auto',
        // Commit T — flips the Commissioner badge on the rendered card.
        commissionerOverride: input.source === 'commissioner',
      }),
    )
    .catch(() => {})

  return {
    success: true,
    snapshot: { sessionId: session.id, overall: pick.overall, pickLabel, rosterId: effectiveRosterId },
  }
}

/**
 * Submit a pick. Acquires a per-league distributed lock before running
 * validation and the Prisma transaction.
 *
 * Layer order:
 *   1. Redis SET NX (5 s TTL) — prevents concurrent writes across instances
 *   2. Postgres AutomationLock fallback — when Redis unavailable
 *   3. Optimistic sentinel (picksCountAtSubmit) inside transaction
 *   4. Unique constraint on (sessionId, overall) — final DB safety net
 *
 * If both lock layers fail (infra outage), the request proceeds without a
 * lock so active drafts are never blocked by a Redis/DB monitoring issue.
 */
export async function submitPick(input: SubmitPickInput): Promise<SubmitPickResult> {
  if (input.expectedOverall != null) {
    const currentOverall = await resolveCurrentOverallForStalePreflight(input.leagueId)
    if (currentOverall != null && currentOverall !== input.expectedOverall) {
      return {
        success: false,
        error: 'Draft board moved; refresh and retry.',
        code: DRAFT_PICK_STALE_OVERALL,
      }
    }
  }

  const lockResult = await withPickLock(input.leagueId, () => _submitPickCore(input))
  if (!lockResult.acquired) {
    // Competing instance is writing — tell client to refresh and retry.
    recordEngineTelemetrySample(ENGINE.DRAFT_PICK_RACE, {
      meta: { leagueId: input.leagueId, reason: 'lock_contended' },
    })
    return {
      success: false,
      error: 'Draft state changed; please retry',
      code: DRAFT_PICK_RACE_RETRY,
    }
  }
  return lockResult.value
}
