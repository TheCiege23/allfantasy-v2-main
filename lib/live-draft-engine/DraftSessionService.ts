/**
 * Draft session: get or create, build snapshot for client, start/pause/complete.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logAction } from '@/server/services/auditService'
import {
  type ApplyPostDraftLifecycleResult,
  applyDraftingLifecycleOnDraftResetInTransaction,
  applyPostDraftLifecycleInTransaction,
  ensureDraftingLifecycleForActiveSession,
} from '@/server/services/leagueLifecycleService'
import { getDraftConfigForLeague } from '@/lib/draft-defaults/DraftRoomConfigResolver'
import { resolveCurrentOnTheClock } from './CurrentOnTheClockResolver'
import { isDraftPickRowEmpty, resolveNextOpenPickOverall } from './draftPickEmpty'
import { resolvePickOwner } from './PickOwnershipResolver'
import {
  computeTimerState,
  computeTimerStateWithPauseWindow,
  isInsidePauseWindow,
} from './DraftTimerService'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { getViewerAutopickPreference } from './LiveDraftAutopickPreferenceService'
import { getCurrentUserRosterIdForLeague } from './auth'
import { buildApiResponse, parseCommissionerAiManagers } from '@/lib/commissioner-ai-draft-manager'
import { formatPickLabel } from './DraftOrderService'
import { getManagerColorBySeed } from '@/lib/draft-room'
import {
  getAuctionStateFromSession,
  getBudgetsFromSession,
  getAuctionConfigFromSession,
} from './auction/AuctionEngine'
import type { DraftSessionSnapshot, DraftPickSnapshot, SlotOrderEntry, TradedPickRecord, AuctionSessionSnapshot, KeeperSessionSnapshot, DevySessionSnapshot, C2CSessionSnapshot } from './types'
import { buildKeeperLocks } from './keeper/KeeperDraftOrder'
import type { KeeperConfig, KeeperSelection } from './keeper/types'
import { draftOrderSlotsToSlotOrder } from '@/lib/league/league-settings-draft-sync'
import { pickTimerSecondsFromLeagueSettings } from '@/lib/league/league-settings-pick-timer'
import { ENGAGEMENT } from '@/lib/analytics/eventNames'
import { recordProductEvent } from '@/lib/analytics/recordAnalyticsEvent'
import { resolveWeightedLotterySlotOrderForLeague } from '@/lib/draft/resolve-draft-context'
import { parseDispersalPoolConfig } from '@/lib/live-draft-engine/SpecialtyDraftPoolValidation'
import { DRAFT_ROSTER_CONFIGURATION_CLIENT_MESSAGE } from '@/lib/league/roster-configuration-gate-error'
import { getEffectiveLeagueRosterTemplate } from '@/lib/league/getEffectiveLeagueRosterTemplate'

/**
 * Same rules as session creation: LeagueSettings pick timer wins when present; else draft config + UI slow-draft mode.
 * Returns null for untimed drafts (`timerMode === 'none'`) or when no positive timer can be resolved.
 */
export function computeEffectivePickTimerSeconds(
  leagueSettings: { pickTimerPreset: string; pickTimerCustomValue: number | null } | null | undefined,
  config: Awaited<ReturnType<typeof getDraftConfigForLeague>>,
  uiSettings: Awaited<ReturnType<typeof getDraftUISettingsForLeague>>,
): number | null {
  if (uiSettings.timerMode === 'none') {
    return null
  }

  const configuredBase =
    config?.timer_seconds != null && Number.isFinite(Number(config.timer_seconds))
      ? Math.round(Number(config.timer_seconds))
      : null
  const configuredSlow =
    config?.slow_timer_seconds != null && Number.isFinite(Number(config.slow_timer_seconds))
      ? Math.round(Number(config.slow_timer_seconds))
      : null

  const slowTimerSeconds =
    configuredSlow ??
    (configuredBase != null ? Math.max(3600, configuredBase) : null)

  let timerSeconds: number | null =
    uiSettings.timerMode === 'soft_pause' || uiSettings.timerMode === 'overnight_pause'
      ? slowTimerSeconds
      : configuredBase

  if (leagueSettings) {
    timerSeconds = pickTimerSecondsFromLeagueSettings(
      leagueSettings.pickTimerPreset,
      leagueSettings.pickTimerCustomValue,
    )
  }

  if (timerSeconds == null || !Number.isFinite(timerSeconds)) return null
  const rounded = Math.round(Number(timerSeconds))
  if (!Number.isFinite(rounded) || rounded <= 0) return null
  return rounded
}

/**
 * Reconcile overnight freeze: persist frozen pick seconds while inside the window; restore timerEndAt after exit.
 */
export async function reconcileOvernightDraftTimerForLeague(leagueId: string, now: Date = new Date()): Promise<void> {
  const session = await prisma.draftSession.findUnique({
    where: { leagueId },
    select: {
      id: true,
      status: true,
      draftType: true,
      timerEndAt: true,
      overnightFrozenPickSeconds: true,
      version: true,
    },
  })
  if (!session || session.status !== 'in_progress' || session.draftType === 'auction') return

  const ui = await getDraftUISettingsForLeague(leagueId)
  const window =
    ui.timerMode === 'overnight_pause' && ui.slowDraftPauseWindow?.start && ui.slowDraftPauseWindow?.end
      ? ui.slowDraftPauseWindow
      : null

  const frozen = session.overnightFrozenPickSeconds

  if (!window) {
    if (frozen != null) {
      const sec = Math.max(0, frozen)
      await prisma.draftSession.update({
        where: { id: session.id },
        data: {
          overnightFrozenPickSeconds: null,
          timerEndAt: sec > 0 ? new Date(now.getTime() + sec * 1000) : null,
          version: { increment: 1 },
        },
      })
    }
    return
  }

  const inside = isInsidePauseWindow(now, window)

  if (!inside) {
    if (frozen != null) {
      const sec = Math.max(0, frozen)
      await prisma.draftSession.update({
        where: { id: session.id },
        data: {
          overnightFrozenPickSeconds: null,
          timerEndAt: sec > 0 ? new Date(now.getTime() + sec * 1000) : null,
          version: { increment: 1 },
        },
      })
    }
    return
  }

  if (frozen == null && session.timerEndAt) {
    const rem = Math.max(0, Math.ceil((session.timerEndAt.getTime() - now.getTime()) / 1000))
    await prisma.draftSession.update({
      where: { id: session.id },
      data: {
        overnightFrozenPickSeconds: rem,
        timerEndAt: null,
        version: { increment: 1 },
      },
    })
  }
}

function isCompleteSlotOrder(order: unknown, teamCount: number): boolean {
  if (!Array.isArray(order) || teamCount < 1) return false
  const slots = new Set<number>()
  for (const raw of order) {
    if (!raw || typeof raw !== 'object') return false
    const e = raw as SlotOrderEntry
    const slot = e.slot
    if (typeof slot !== 'number' || slot < 1 || slot > teamCount) return false
    if (slots.has(slot)) return false
    slots.add(slot)
    const rid = e.rosterId
    if (typeof rid !== 'string' || rid.length === 0) return false
  }
  return slots.size === teamCount
}

/**
 * Build slot order from league rosters/teams, settings, and lottery — same rules as new session creation.
 * Used when repairing sessions with missing or corrupt `slotOrder` (resolves current pick / draft UI).
 */
export async function buildSlotOrderForLeague(leagueId: string): Promise<SlotOrderEntry[]> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: { rosters: true, teams: true, leagueSettings: true },
  })
  if (!league) return []

  const teamCount = league.leagueSize ?? 12
  const ls = league.leagueSettings
  const teams = league.teams ?? []
  const rosters = league.rosters ?? []

  // Slice 5: at league creation we typically have 1 real roster (the commissioner)
  // but teamCount of 12. Old behavior fell straight through to all-placeholder,
  // which discarded the commissioner's real rosterId. Now we prefer real rosters
  // for the first N slots, then pad the remainder with `placeholder-N` so the
  // Slice 4.5 materializer can fill the rest later without overwriting slot 1.
  let slotOrder: SlotOrderEntry[] = []
  if (rosters.length >= teamCount) {
    slotOrder = rosters.slice(0, teamCount).map((r, i) => ({
      slot: i + 1,
      rosterId: r.id,
      displayName: teams[i]?.ownerName || teams[i]?.teamName || `Team ${i + 1}`,
    }))
  } else if (teams.length >= teamCount) {
    slotOrder = teams.slice(0, teamCount).map((t, i) => ({
      slot: i + 1,
      rosterId: t.id,
      displayName: t.ownerName || t.teamName || `Team ${i + 1}`,
    }))
  } else {
    // Partial: seat every real roster first (index-aligned to teams when
    // available), then pad empty slots with placeholders.
    for (let i = 0; i < rosters.length && i < teamCount; i++) {
      slotOrder.push({
        slot: i + 1,
        rosterId: rosters[i].id,
        displayName: teams[i]?.ownerName || teams[i]?.teamName || `Team ${i + 1}`,
      })
    }
    for (let i = slotOrder.length; i < teamCount; i++) {
      slotOrder.push({
        slot: i + 1,
        rosterId: `placeholder-${i + 1}`,
        displayName: `Team ${i + 1}`,
      })
    }
  }

  if (ls) {
    const fromSettings = draftOrderSlotsToSlotOrder(ls.draftOrderSlots, teamCount)
    if (fromSettings.length >= teamCount && isCompleteSlotOrder(fromSettings, teamCount)) {
      slotOrder = fromSettings as SlotOrderEntry[]
    }
  }

  const lotterySlotOrder = await resolveWeightedLotterySlotOrderForLeague(leagueId).catch(() => null)
  if (lotterySlotOrder && lotterySlotOrder.length > 0 && isCompleteSlotOrder(lotterySlotOrder, teamCount)) {
    slotOrder = lotterySlotOrder
  }

  return slotOrder
}

async function repairDraftSessionSlotOrderIfNeeded(leagueId: string): Promise<void> {
  const session = await prisma.draftSession.findUnique({ where: { leagueId } })
  if (!session) return
  const teamCount = session.teamCount
  if (isCompleteSlotOrder(session.slotOrder, teamCount)) return

  // Weighted lottery (dynasty rookie): apply stored lottery order first — do not replace with roster-based order.
  const lotteryOrder = await resolveWeightedLotterySlotOrderForLeague(leagueId).catch(() => null)
  if (lotteryOrder && isCompleteSlotOrder(lotteryOrder, teamCount)) {
    await prisma.draftSession.update({
      where: { id: session.id },
      data: {
        slotOrder: lotteryOrder as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    })
    return
  }

  const slotOrder = await buildSlotOrderForLeague(leagueId)
  if (!isCompleteSlotOrder(slotOrder, teamCount)) return

  await prisma.draftSession.update({
    where: { id: session.id },
    data: {
      slotOrder: slotOrder as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  })
}

export async function getOrCreateDraftSession(leagueId: string): Promise<{
  session: { id: string; leagueId: string; status: string; slotOrder: unknown; teamCount: number; rounds: number; draftType: string; thirdRoundReversal: boolean; timerSeconds: number | null; timerEndAt: Date | null; pausedRemainingSeconds: number | null; version: number; updatedAt: Date }
  created: boolean
}> {
  let session = await prisma.draftSession.findUnique({ where: { leagueId } })
  if (session) {
    return { session: session as any, created: false }
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: { rosters: true, teams: true, leagueSettings: true },
  })
  if (!league) throw new Error('League not found')

  const [config, uiSettings] = await Promise.all([
    getDraftConfigForLeague(leagueId),
    getDraftUISettingsForLeague(leagueId),
  ])
  const teamCount = league.leagueSize ?? 12
  let rounds = config?.rounds ?? 15
  let draftType = (config?.draft_type ?? 'snake') as string
  let thirdRoundReversal = config?.third_round_reversal ?? false
  const ls = league.leagueSettings
  const timerSeconds = computeEffectivePickTimerSeconds(ls, config, uiSettings)
  let aiAutoPick = false
  let cpuAutoPick = true
  let playerPool = 'all'
  let alphabeticalSort = false
  if (ls) {
    rounds = Math.max(1, Math.min(50, ls.rounds))
    const dt = ls.draftType
    if (dt === '3rd_reversal') {
      draftType = 'snake'
      thirdRoundReversal = true
    } else if (dt === 'auction') {
      draftType = 'auction'
      thirdRoundReversal = false
    } else if (dt === 'linear') {
      draftType = 'linear'
      thirdRoundReversal = false
    } else {
      draftType = 'snake'
      thirdRoundReversal = false
    }
    aiAutoPick = ls.aiAutoPick
    cpuAutoPick = ls.cpuAutoPick
    playerPool = ls.playerPool
    alphabeticalSort = ls.alphabeticalSort
  }

  const slotOrder = await buildSlotOrderForLeague(leagueId)

  session = await (prisma as any).draftSession.create({
    data: {
      leagueId,
      sportType: league.sport ?? null,
      status: 'pre_draft',
      draftType,
      rounds,
      teamCount,
      thirdRoundReversal,
      timerSeconds,
      aiAutoPick,
      cpuAutoPick,
      playerPool,
      alphabeticalSort,
      slotOrder: slotOrder as any,
    },
  })
  return { session: session as any, created: true }
}

export async function getDraftSessionByLeague(leagueId: string) {
  return prisma.draftSession.findUnique({
    where: { leagueId },
    include: { picks: { orderBy: { overall: 'asc' } } },
  })
}

/**
 * Build full snapshot for client (reconnect/resync).
 */
export async function buildSessionSnapshot(
  leagueId: string,
  now: Date = new Date(),
  viewerUserId?: string | null,
  opts?: { skipRepair?: boolean },
): Promise<DraftSessionSnapshot | null> {
  if (!opts?.skipRepair) {
    await repairDraftSessionSlotOrderIfNeeded(leagueId)
    await reconcileOvernightDraftTimerForLeague(leagueId, now)
  }

  const session = await getDraftSessionByLeague(leagueId)
  if (!session) return null

  const effectiveRoster = await getEffectiveLeagueRosterTemplate(leagueId).catch(() => null)
  const rosterConfigurationIncomplete = effectiveRoster ? !effectiveRoster.hasPersistedRosterSchema : false

  const slotOrder = (session.slotOrder as unknown as SlotOrderEntry[]) ?? []
  const teamCount = session.teamCount
  const totalPicks = session.rounds * teamCount
  const picksCount = session.picks.length
  const progressPicks = session.picks.map((p) => ({
    overall: p.overall,
    playerName: p.playerName,
    position: p.position,
    pickMetadata: (p as { pickMetadata?: unknown | null }).pickMetadata ?? null,
  }))
  const tradedPicks: TradedPickRecord[] = Array.isArray(session.tradedPicks)
    ? (session.tradedPicks as unknown as TradedPickRecord[])
    : []
  let currentPick = resolveCurrentOnTheClock({
    totalPicks,
    picks: progressPicks,
    teamCount,
    draftType: session.draftType as 'snake' | 'linear' | 'auction',
    thirdRoundReversal: session.thirdRoundReversal,
    slotOrder,
  })
  if (currentPick && tradedPicks.length > 0) {
    const resolved = resolvePickOwner(currentPick.round, currentPick.slot, slotOrder, tradedPicks)
    if (resolved) {
      currentPick = { ...currentPick, rosterId: resolved.rosterId, displayName: resolved.displayName }
    }
  }

  const uiSettings = await getDraftUISettingsForLeague(leagueId)
  const pauseWindow = uiSettings.timerMode === 'overnight_pause' && uiSettings.slowDraftPauseWindow
    ? uiSettings.slowDraftPauseWindow
    : null
  const timer = computeTimerStateWithPauseWindow(
    {
      status: session.status,
      timerSeconds: session.timerSeconds,
      timerEndAt: session.timerEndAt,
      pausedRemainingSeconds: session.pausedRemainingSeconds,
      overnightFrozenPickSeconds: session.overnightFrozenPickSeconds ?? null,
    },
    now,
    pauseWindow
  )

  const isSlowDraft = (session.timerSeconds ?? 0) >= 3600 || uiSettings.timerMode === 'overnight_pause'

  const picks: DraftPickSnapshot[] = session.picks.map((p) => {
    // Emit traded-pick metadata according to commissioner UI settings.
    // No-trade picks never receive override metadata.
    const rawMeta = (p.tradedPickMeta ?? null) as Record<string, unknown> | null
    let tradedMeta: DraftPickSnapshot['tradedPickMeta'] = null
    if (rawMeta) {
      const resolved = { ...rawMeta } as Record<string, unknown>
      if (uiSettings.tradedPickOwnerNameRedEnabled) {
        resolved.showNewOwnerInRed = true
      } else {
        resolved.showNewOwnerInRed = false
      }
      if (uiSettings.tradedPickColorModeEnabled) {
        const seed = String(resolved.newOwnerName ?? p.rosterId ?? p.displayName ?? 'manager')
        resolved.tintColor = String(resolved.tintColor ?? getManagerColorBySeed(seed).tintHex)
      } else {
        delete resolved.tintColor
      }
      tradedMeta = resolved as DraftPickSnapshot['tradedPickMeta']
    }
    const pickEditorEmpty = isDraftPickRowEmpty({
      playerName: p.playerName,
      position: p.position,
      pickMetadata: (p as { pickMetadata?: unknown | null }).pickMetadata ?? null,
    })
    return {
    id: p.id,
    overall: p.overall,
    round: p.round,
    slot: p.slot,
    rosterId: p.rosterId,
    displayName: p.displayName,
    playerName: p.playerName,
    position: p.position,
    team: p.team,
    byeWeek: p.byeWeek,
    playerId: p.playerId,
    playerImageUrl: (p as { playerImageUrl?: string | null }).playerImageUrl ?? null,
    ...(pickEditorEmpty ? { pickEditorEmpty: true as const } : {}),
    tradedPickMeta: tradedMeta,
    source: p.source ?? 'user',
    pickLabel: formatPickLabel(p.overall, teamCount),
    amount: (p as any).amount ?? undefined,
    createdAt: p.createdAt.toISOString(),
    }
  })

  let auction: AuctionSessionSnapshot | undefined
  if (session.draftType === 'auction') {
    const config = getAuctionConfigFromSession(session)
    const auctionState = getAuctionStateFromSession(session) ?? {
      nominationOrderIndex: 0,
      currentNomination: null,
      currentBid: 0,
      currentBidderRosterId: null,
      bidTimerEndAt: null,
      minNextBid: config.minBid,
    }
    auction = {
      draftType: 'auction',
      budgetPerTeam: config.budgetPerTeam,
      budgets: getBudgetsFromSession(session),
      auctionState,
      minBidIncrement: config.minBidIncrement,
      nominationOrder: slotOrder,
    }
    const auctionNominator =
      slotOrder[((Math.max(0, auctionState.nominationOrderIndex) % Math.max(1, slotOrder.length)) + Math.max(1, slotOrder.length)) % Math.max(1, slotOrder.length)]
    if (auctionNominator) {
      const overall = resolveNextOpenPickOverall(progressPicks, totalPicks) ?? picksCount + 1
      const round = Math.ceil(overall / teamCount)
      currentPick = {
        overall,
        round,
        slot: auctionNominator.slot,
        rosterId: auctionNominator.rosterId,
        displayName: auctionNominator.displayName,
        pickLabel: formatPickLabel(overall, teamCount),
      }
    }
  }

  let devy: DevySessionSnapshot | undefined
  const rawDevyConfig = session.devyConfig ?? (session as any).devyConfig
  if (rawDevyConfig && typeof rawDevyConfig === 'object' && (rawDevyConfig as any).enabled) {
    const cfg = rawDevyConfig as { devyRounds?: number[] }
    devy = {
      enabled: true,
      devyRounds: Array.isArray(cfg.devyRounds) ? cfg.devyRounds : [],
    }
  }

  let c2c: C2CSessionSnapshot | undefined
  const rawC2cConfig = session.c2cConfig ?? (session as any).c2cConfig
  if (rawC2cConfig && typeof rawC2cConfig === 'object' && (rawC2cConfig as any).enabled) {
    const cfg = rawC2cConfig as { collegeRounds?: number[] }
    c2c = {
      enabled: true,
      collegeRounds: Array.isArray(cfg.collegeRounds) ? cfg.collegeRounds : [],
    }
  }

  let keeper: KeeperSessionSnapshot | undefined
  const rawKeeperConfig = session.keeperConfig ?? (session as any).keeperConfig
  const rawKeeperSelections = session.keeperSelections ?? (session as any).keeperSelections
  if (rawKeeperConfig && typeof rawKeeperConfig === 'object') {
    const config = rawKeeperConfig as KeeperConfig
    const selections: KeeperSelection[] = Array.isArray(rawKeeperSelections) ? rawKeeperSelections as KeeperSelection[] : []
    const locks = buildKeeperLocks(
      selections,
      slotOrder,
      tradedPicks,
      session.teamCount,
      session.rounds,
      session.draftType as 'snake' | 'linear' | 'auction',
      session.thirdRoundReversal
    )
    keeper = {
      config: {
        maxKeepers: config.maxKeepers ?? 0,
        deadline: config.deadline ?? null,
        maxKeepersPerPosition: config.maxKeepersPerPosition ?? undefined,
      },
      selections: selections.map((s) => ({
        rosterId: s.rosterId,
        roundCost: s.roundCost,
        playerName: s.playerName,
        position: s.position,
        team: s.team ?? null,
        playerId: s.playerId ?? null,
        commissionerOverride: s.commissionerOverride,
      })),
      locks,
    }
  }

  const commissionerAiDraft = buildApiResponse(
    parseCommissionerAiManagers((session as { commissionerAiManagers?: unknown }).commissionerAiManagers),
    slotOrder
  )

  const dispersalPool = parseDispersalPoolConfig((session as { dispersalPoolConfig?: unknown }).dispersalPoolConfig)

  return {
    id: session.id,
    leagueId: session.leagueId,
    status: session.status as any,
    draftType: session.draftType as any,
    rounds: session.rounds,
    teamCount: session.teamCount,
    thirdRoundReversal: session.thirdRoundReversal,
    onClockTradeTimerBehavior:
      (session as { onClockTradeTimerBehavior?: string }).onClockTradeTimerBehavior === 'reset_timer'
        ? 'reset_timer'
        : 'inherit_remaining',
    inDraftPlayerTradesEnabled:
      (session as { inDraftPlayerTradesEnabled?: boolean }).inDraftPlayerTradesEnabled !== false,
    customRankingsEnabled:
      (session as { customRankingsEnabled?: boolean }).customRankingsEnabled !== false,
    timerSeconds: session.timerSeconds,
    timerEndAt: session.timerEndAt?.toISOString() ?? null,
    pausedRemainingSeconds: session.pausedRemainingSeconds,
    slotOrder,
    tradedPicks,
    version: session.version,
    picks,
    currentPick,
    timer,
    updatedAt: session.updatedAt.toISOString(),
    auction,
    isSlowDraft,
    keeper,
    devy,
    commissionerAiDraft,
    c2c,
    draftModeLabel: (session as { draftModeLabel?: string | null }).draftModeLabel ?? null,
    dispersalPool,
    rosterConfigurationIncomplete,
    rosterConfigurationMessage: rosterConfigurationIncomplete ? DRAFT_ROSTER_CONFIGURATION_CLIENT_MESSAGE : null,
    pausedByUserId: session.pausedByUserId ?? null,
    allowPicksDuringOvernightPause: uiSettings.allowPicksDuringOvernightPause ?? false,
    viewerAutopick: viewerUserId
      ? await getViewerAutopickPreference(session.id, viewerUserId)
      : null,
    currentUserRosterId: viewerUserId
      ? (await getCurrentUserRosterIdForLeague(leagueId, viewerUserId).catch(() => null)) ?? undefined
      : undefined,
  }
}

export type StartDraftSessionResult =
  | { ok: true }
  | { ok: false; reason: 'session_not_ready' | 'ROSTER_CONFIGURATION_INCOMPLETE' }

export async function startDraftSession(leagueId: string): Promise<StartDraftSessionResult> {
  await repairDraftSessionSlotOrderIfNeeded(leagueId)
  const { isLeagueRosterDraftReady } = await import('@/lib/league/league-roster-draft-gate')
  if (!(await isLeagueRosterDraftReady(leagueId))) {
    return { ok: false, reason: 'ROSTER_CONFIGURATION_INCOMPLETE' }
  }

  const session = await prisma.draftSession.findUnique({ where: { leagueId } })
  if (!session || session.status !== 'pre_draft') return { ok: false, reason: 'session_not_ready' }

  const startedAtNow = new Date()

  const [ls, config, uiSettings] = await Promise.all([
    prisma.leagueSettings.findUnique({ where: { leagueId } }),
    getDraftConfigForLeague(leagueId),
    getDraftUISettingsForLeague(leagueId),
  ])
  if (ls) {
    await prisma.draftSession.update({
      where: { id: session.id },
      data: {
        aiAutoPick: ls.aiAutoPick,
        cpuAutoPick: ls.cpuAutoPick,
        playerPool: ls.playerPool,
        alphabeticalSort: ls.alphabeticalSort,
        startedAt: session.startedAt ?? startedAtNow,
        version: { increment: 1 },
      },
    })
  }

  if (session.draftType === 'auction') {
    const { initializeAuctionForSession } = await import('./auction/AuctionEngine')
    await initializeAuctionForSession(leagueId)
    try {
      const { isSalaryCapLeague } = await import('@/lib/salary-cap/SalaryCapLeagueConfig')
      const { initializeStartupLedgers } = await import('@/lib/salary-cap/AuctionStartupService')
      if (await isSalaryCapLeague(leagueId)) {
        const ledgers = await initializeStartupLedgers(leagueId)
        if (!ledgers.ok) console.warn('[startDraftSession] Salary cap ledger init:', ledgers.error)
      }
    } catch (e) {
      console.warn('[startDraftSession] Salary cap startup ledger init non-fatal:', e)
    }
    await prisma.draftSession.update({
      where: { id: session.id },
      data: {
        status: 'in_progress',
        pausedRemainingSeconds: null,
        overnightFrozenPickSeconds: null,
        startedAt: session.startedAt ?? startedAtNow,
        version: { increment: 1 },
      },
    })
    await ensureDraftingLifecycleForActiveSession(leagueId)
    return { ok: true }
  }

  const timerSeconds = computeEffectivePickTimerSeconds(ls, config, uiSettings)
  const timerEndAt =
    timerSeconds != null && timerSeconds > 0 ? new Date(Date.now() + timerSeconds * 1000) : null
  await prisma.draftSession.update({
    where: { id: session.id },
    data: {
      status: 'in_progress',
      timerSeconds,
      timerEndAt,
      pausedRemainingSeconds: null,
      overnightFrozenPickSeconds: null,
      startedAt: session.startedAt ?? startedAtNow,
      version: { increment: 1 },
    },
  })
  await ensureDraftingLifecycleForActiveSession(leagueId)
  return { ok: true }
}

export async function pauseDraftSession(leagueId: string, pausedByUserId?: string | null): Promise<boolean> {
  const session = await prisma.draftSession.findUnique({ where: { leagueId } })
  if (!session || session.status !== 'in_progress') return false
  const now = new Date()
  const frozen = session.overnightFrozenPickSeconds
  const remaining =
    frozen != null
      ? frozen
      : session.timerEndAt
        ? Math.max(0, Math.ceil((session.timerEndAt.getTime() - now.getTime()) / 1000))
        : session.timerSeconds ?? 0
  await prisma.draftSession.update({
    where: { id: session.id },
    data: {
      status: 'paused',
      timerEndAt: null,
      overnightFrozenPickSeconds: null,
      pausedRemainingSeconds: remaining,
      pausedByUserId: pausedByUserId ?? null,
      version: { increment: 1 },
    },
  })
  return true
}

export async function resumeDraftSession(leagueId: string): Promise<boolean> {
  const session = await prisma.draftSession.findUnique({ where: { leagueId } })
  if (!session || session.status !== 'paused') return false
  const [ls, config, uiSettings] = await Promise.all([
    prisma.leagueSettings.findUnique({ where: { leagueId } }),
    getDraftConfigForLeague(leagueId),
    getDraftUISettingsForLeague(leagueId),
  ])
  const effectiveStored = computeEffectivePickTimerSeconds(ls, config, uiSettings)
  // Use stored remainder only when it's a positive number — 0 means the timer had
  // already expired when the draft was paused, so restore the full configured clock.
  const hasUsableRemaining =
    typeof session.pausedRemainingSeconds === 'number' && session.pausedRemainingSeconds > 0
  const sec = hasUsableRemaining ? session.pausedRemainingSeconds : (effectiveStored ?? 0)
  const timerEndAt =
    effectiveStored != null && effectiveStored > 0
      ? new Date(Date.now() + sec * 1000)
      : null
  const auctionState =
    session.draftType === 'auction' &&
    session.auctionState &&
    typeof session.auctionState === 'object' &&
    !Array.isArray(session.auctionState)
      ? (session.auctionState as Record<string, unknown>)
      : null
  await prisma.draftSession.update({
    where: { id: session.id },
    data: {
      status: 'in_progress',
      timerSeconds: effectiveStored,
      timerEndAt,
      pausedRemainingSeconds: null,
      overnightFrozenPickSeconds: null,
      pausedByUserId: null,
      ...(auctionState
        ? {
            auctionState: {
              ...auctionState,
              ...(timerEndAt ? { bidTimerEndAt: timerEndAt.toISOString() } : { bidTimerEndAt: null }),
            } as any,
          }
        : {}),
      version: { increment: 1 },
    },
  })
  return true
}

export async function resetTimer(leagueId: string): Promise<boolean> {
  const session = await prisma.draftSession.findUnique({ where: { leagueId } })
  if (!session || (session.status !== 'in_progress' && session.status !== 'paused')) return false
  const [ls, config, uiSettings] = await Promise.all([
    prisma.leagueSettings.findUnique({ where: { leagueId } }),
    getDraftConfigForLeague(leagueId),
    getDraftUISettingsForLeague(leagueId),
  ])
  const timerSeconds = computeEffectivePickTimerSeconds(ls, config, uiSettings)

  /** Full clock refresh while commissioner-paused: stay paused; only refresh stored remainder (do not resume). */
  if (session.status === 'paused') {
    await prisma.draftSession.update({
      where: { id: session.id },
      data: {
        timerSeconds,
        overnightFrozenPickSeconds: null,
        pausedRemainingSeconds: timerSeconds ?? session.pausedRemainingSeconds,
        version: { increment: 1 },
      },
    })
    return true
  }

  const timerEndAt =
    timerSeconds != null && timerSeconds > 0 ? new Date(Date.now() + timerSeconds * 1000) : null
  const auctionState =
    session.draftType === 'auction' &&
    session.auctionState &&
    typeof session.auctionState === 'object' &&
    !Array.isArray(session.auctionState)
      ? (session.auctionState as Record<string, unknown>)
      : null
  await prisma.draftSession.update({
    where: { id: session.id },
    data: {
      status: 'in_progress',
      timerSeconds,
      timerEndAt,
      pausedRemainingSeconds: null,
      overnightFrozenPickSeconds: null,
      pausedByUserId: null,
      ...(auctionState
        ? {
            auctionState: {
              ...auctionState,
              ...(timerEndAt ? { bidTimerEndAt: timerEndAt.toISOString() } : { bidTimerEndAt: null }),
            } as any,
          }
        : {}),
      version: { increment: 1 },
    },
  })
  return true
}

/**
 * Update draft session timer length (seconds). Optionally reset current timer with new value.
 */
export async function setTimerSeconds(
  leagueId: string,
  seconds: number,
  options?: { resetCurrentTimer?: boolean }
): Promise<boolean> {
  const session = await prisma.draftSession.findUnique({ where: { leagueId } })
  if (!session) return false
  const sec = Math.max(0, Math.min(86400, Math.round(seconds)))
  const data: Prisma.DraftSessionUpdateInput = {
    timerSeconds: sec,
    version: { increment: 1 },
  }
  if (options?.resetCurrentTimer && (session.status === 'in_progress' || session.status === 'paused')) {
    if (session.status === 'paused') {
      // Bug-stab: while the draft is paused, changing the timer length must NOT
      // start a countdown. Stage the new value into pausedRemainingSeconds so
      // that resumeDraft() picks it up (see line 704: `session.pausedRemainingSeconds
      // ?? effectiveStored ?? 0`). Leaving `timerEndAt` untouched keeps the clock
      // visibly frozen until the commissioner clicks Resume — at which point a
      // fresh countdown starts with the new value, NOT the old timer or 30s.
      data.pausedRemainingSeconds = sec
    } else {
      // Live (in_progress) — restart the current pick's countdown immediately.
      data.timerEndAt = new Date(Date.now() + sec * 1000)
      data.pausedRemainingSeconds = null
      if (
        session.draftType === 'auction' &&
        session.auctionState &&
        typeof session.auctionState === 'object' &&
        !Array.isArray(session.auctionState)
      ) {
        data.auctionState = {
          ...(session.auctionState as Record<string, unknown>),
          bidTimerEndAt: data.timerEndAt.toISOString(),
        } as Prisma.InputJsonValue
      }
    }
  }
  await prisma.draftSession.update({
    where: { id: session.id },
    data: { ...data, updatedAt: new Date() },
  })
  return true
}

/**
 * Slice 4 — commissioner undo with required reason.
 * `reason` and `actorUserId` are passed by the route after authz; both are persisted to
 * `DraftPickAuditLog`. The reason is commissioner-visible only (read endpoint hides it for non-commissioners).
 * Optional args keep the function backward-compatible for legacy callers; routes always pass them.
 */
export async function undoLastPick(
  leagueId: string,
  options?: { reason?: string; actorUserId?: string | null },
): Promise<boolean> {
  const session = await prisma.draftSession.findUnique({
    where: { leagueId },
    include: { picks: { orderBy: { overall: 'desc' }, take: 1 } },
  })
  if (!session || session.picks.length === 0) return false
  const last = session.picks[0]
  const reason = typeof options?.reason === 'string' ? options.reason.trim() : ''
  const actorUserId = options?.actorUserId ?? null

  // Compute fresh timer before entering the transaction so the timestamp is stable.
  // Only reset when in_progress — if paused, leave pausedRemainingSeconds so resume still works.
  const freshTimerEndAt =
    session.status === 'in_progress' && session.timerSeconds != null && session.timerSeconds > 0
      ? new Date(Date.now() + session.timerSeconds * 1000)
      : null

  await prisma.$transaction(async (tx) => {
    await tx.draftPick.delete({ where: { id: last.id } })
    if (freshTimerEndAt !== null) {
      await tx.draftSession.update({
        where: { id: session.id },
        data: {
          version: { increment: 1 },
          updatedAt: new Date(),
          timerEndAt: freshTimerEndAt,
          pausedRemainingSeconds: null,
          overnightFrozenPickSeconds: null,
        },
      })
    } else {
      await tx.draftSession.update({
        where: { id: session.id },
        data: { version: { increment: 1 }, updatedAt: new Date() },
      })
    }
    if (actorUserId) {
      await tx.draftPickAuditLog.create({
        data: {
          leagueId,
          draftSessionId: session.id,
          overallPickNumber: last.overall,
          round: last.round,
          action: 'undo_pick',
          actorUserId,
          oldRosterId: last.rosterId ?? null,
          oldPlayerId: last.playerId ?? null,
          oldPlayerName: last.playerName ?? null,
          reason: reason ? reason : null,
          metadata: {
            slot: last.slot,
            position: last.position,
            team: last.team,
            source: last.source,
          },
        },
      })
    }
  })
  return true
}

/**
 * Slice 5 — Swap two draft slots' managers.
 *
 * Touches `slotOrder` ONLY. Does NOT modify any DraftPick row, does NOT move
 * players between rosters, does NOT auto-pause, does NOT reset the timer.
 * Past picks remain tied to their original rosterId; only future control of
 * each slot transfers. Traded picks are keyed by rosterId (originalRosterId),
 * so they follow the manager automatically — no separate bookkeeping needed.
 *
 * Allowed in pre_draft, in_progress, and paused states. Self-swap rejected.
 * Atomic: slotOrder update + audit log entry land in the same transaction.
 */
export type SwapDraftManagersResult =
  | { ok: true; fromRosterId: string; toRosterId: string }
  | {
      ok: false
      code: 'NO_SESSION' | 'INVALID_SWAP_SAME_SLOT' | 'SWAP_SLOT_NOT_FOUND' | 'INVALID_STATUS'
      error: string
    }

export async function swapDraftManagers(
  leagueId: string,
  fromSlot: number,
  toSlot: number,
  actorUserId: string,
): Promise<SwapDraftManagersResult> {
  if (!Number.isInteger(fromSlot) || !Number.isInteger(toSlot)) {
    return { ok: false, code: 'SWAP_SLOT_NOT_FOUND', error: 'fromSlot and toSlot must be integers' }
  }
  if (fromSlot === toSlot) {
    return {
      ok: false,
      code: 'INVALID_SWAP_SAME_SLOT',
      error: 'fromSlot and toSlot must be different',
    }
  }

  const session = await prisma.draftSession.findUnique({
    where: { leagueId },
    select: { id: true, status: true, slotOrder: true, picks: { select: { overall: true } } },
  })
  if (!session) return { ok: false, code: 'NO_SESSION', error: 'No draft session for league' }
  if (
    session.status !== 'pre_draft' &&
    session.status !== 'in_progress' &&
    session.status !== 'paused'
  ) {
    return {
      ok: false,
      code: 'INVALID_STATUS',
      error: `Cannot swap managers when draft status is ${session.status}`,
    }
  }

  const slotOrder = (Array.isArray(session.slotOrder) ? session.slotOrder : []) as Array<{
    slot: number
    rosterId: string
    displayName: string
    platformUserId?: string | null
  }>
  const fromIndex = slotOrder.findIndex((e) => e.slot === fromSlot)
  const toIndex = slotOrder.findIndex((e) => e.slot === toSlot)
  if (fromIndex < 0 || toIndex < 0) {
    return { ok: false, code: 'SWAP_SLOT_NOT_FOUND', error: 'One or both slots not found in slotOrder' }
  }

  const fromEntry = slotOrder[fromIndex]
  const toEntry = slotOrder[toIndex]
  // Swap rosterId / displayName / platformUserId; keep `slot` numbers fixed.
  const nextSlotOrder = slotOrder.map((entry) => {
    if (entry.slot === fromSlot) {
      return {
        ...entry,
        rosterId: toEntry.rosterId,
        displayName: toEntry.displayName,
        platformUserId: toEntry.platformUserId ?? null,
      }
    }
    if (entry.slot === toSlot) {
      return {
        ...entry,
        rosterId: fromEntry.rosterId,
        displayName: fromEntry.displayName,
        platformUserId: fromEntry.platformUserId ?? null,
      }
    }
    return entry
  })

  // Effective-from overall is the next unsubmitted overall. Past picks keep their existing rosterId on DraftPick rows.
  const effectiveFromOverall = session.picks.length + 1

  await prisma.$transaction(async (tx) => {
    await tx.draftSession.update({
      where: { id: session.id },
      data: {
        slotOrder: nextSlotOrder as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    })
    await tx.draftPickAuditLog.create({
      data: {
        leagueId,
        draftSessionId: session.id,
        // Audit log row uses overallPickNumber to anchor the swap to the next-unmade pick boundary.
        overallPickNumber: effectiveFromOverall,
        // Round derived from the next overall (helps post-draft analytics; harmless if the draft hasn't started).
        round: Math.max(1, Math.ceil(effectiveFromOverall / Math.max(1, slotOrder.length))),
        action: 'swap_manager',
        actorUserId,
        oldRosterId: fromEntry.rosterId,
        newRosterId: toEntry.rosterId,
        reason: null,
        metadata: {
          fromSlot,
          toSlot,
          fromRosterId: fromEntry.rosterId,
          toRosterId: toEntry.rosterId,
          fromDisplayName: fromEntry.displayName,
          toDisplayName: toEntry.displayName,
          effectiveFromOverall,
        },
      },
    })
  })

  return { ok: true, fromRosterId: fromEntry.rosterId, toRosterId: toEntry.rosterId }
}

export async function completeDraftSession(leagueId: string): Promise<boolean> {
  const outcome = await prisma.$transaction(async (tx) => {
    const session = await tx.draftSession.findUnique({ where: { leagueId } })
    if (!session) return { ok: false as const, transitioned: false as const, lifecycle: null }

    /** Idempotent: board already finalized in DB — outer callers may heal artifacts. */
    if (session.status === 'completed') {
      return { ok: true as const, transitioned: false as const, lifecycle: null }
    }

    const totalPicks = session.rounds * session.teamCount
    const pickRows = await tx.draftPick.findMany({
      where: { sessionId: session.id },
      select: { overall: true, playerName: true, position: true, pickMetadata: true },
    })
    const { isDraftBoardFull } = await import('./draftPickEmpty')
    if (!isDraftBoardFull(pickRows as any, totalPicks)) {
      return { ok: false as const, transitioned: false as const, lifecycle: null }
    }

    const completedAt = session.completedAt ?? new Date()
    await tx.draftSession.update({
      where: { id: session.id },
      data: {
        status: 'completed',
        timerEndAt: null,
        pausedRemainingSeconds: null,
        pausedByUserId: null,
        completedAt,
        version: { increment: 1 },
      },
    })

    const lifecycle = await applyPostDraftLifecycleInTransaction(tx as Prisma.TransactionClient, leagueId)
    return { ok: true as const, transitioned: true as const, lifecycle }
  })

  if (!outcome.ok) return false

  if (outcome.lifecycle?.applied && outcome.lifecycle.commissionerUserId && outcome.lifecycle.from != null && outcome.lifecycle.to != null) {
    void logAction({
      leagueId,
      userId: outcome.lifecycle.commissionerUserId,
      actionType: 'lifecycle_transition',
      entityType: 'league',
      entityId: leagueId,
      beforeState: { lifecycleState: outcome.lifecycle.from },
      afterState: { lifecycleState: outcome.lifecycle.to },
      metadata: { source: 'draft_completion' },
    }).catch(() => {})
  }

  try {
    const { runPostDraftFinalizationArtifacts } = await import('@/lib/live-draft-engine/postDraftFinalizeArtifacts')
    await runPostDraftFinalizationArtifacts(leagueId)
  } catch (err) {
    console.error('[completeDraftSession] post-draft artifacts failed', {
      leagueId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  if (outcome.transitioned) {
    import('@/lib/survivor/SurvivorDraftBootstrapService').then((m) => m.runSurvivorPostDraftBootstrap(leagueId)).catch(() => {})
    prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } }).then((league) => {
      if (league?.userId) {
        import('@/lib/achievement-system').then((m) => m.awardAchievement(league.userId, 'draft_completed', { leagueId })).catch(() => {})
      }
    }).catch(() => {})
    recordProductEvent(ENGAGEMENT.DRAFT_COMPLETED, {
      meta: { leagueId, source: 'completeDraftSession' },
    })
  }

  return true
}

/**
 * Commissioner-only: reset draft to pre_draft (delete all picks, clear timer/auction state).
 */
export async function resetDraftSession(leagueId: string): Promise<boolean> {
  const session = await prisma.draftSession.findUnique({ where: { leagueId } })
  if (!session) return false
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.draftPick.deleteMany({ where: { sessionId: session.id } })
    await tx.draftSession.update({
      where: { id: session.id },
      data: {
        status: 'pre_draft',
        nextOverallPick: 1,
        currentRoundNum: 1,
        timerEndAt: null,
        pausedRemainingSeconds: null,
        auctionBudgets: Prisma.JsonNull,
        auctionState: Prisma.JsonNull,
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    })
    return applyDraftingLifecycleOnDraftResetInTransaction(tx as Prisma.TransactionClient, leagueId)
  })

  if (outcome.applied && outcome.commissionerUserId && outcome.from != null && outcome.to != null) {
    void logAction({
      leagueId,
      userId: outcome.commissionerUserId,
      actionType: 'lifecycle_transition',
      entityType: 'league',
      entityId: leagueId,
      beforeState: { lifecycleState: outcome.from },
      afterState: { lifecycleState: outcome.to },
      metadata: { source: 'draft_reset' },
    }).catch(() => {})
  }

  return true
}
