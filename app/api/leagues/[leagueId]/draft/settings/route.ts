import { isSeasonTournamentDraft, SEASON_DRAFT_MUTATION_BLOCKED } from '@/lib/tournament/seasonDraftMutationGate'
/**
 * GET: Full draft variant settings (config + UI + session variant + orphan status for commissioner).
 * PATCH: Update draft variant settings (commissioner only). Body: config?, draftUISettings?, sessionVariant?
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { assertCommissioner, isCommissioner } from '@/lib/commissioner/permissions'
import { prisma } from '@/lib/prisma'
import { validateDraftRoundsFitRoster } from '@/lib/live-draft-engine/RosterFitValidation'
import { getDraftVariantSettings, updateDraftVariantSettings } from '@/lib/draft-defaults/DraftVariantSettingsHub'
import { isDraftTypeAllowedOnSettingsTab } from '@/lib/draft-types/draftTypeRegistry'
import { CURRENT_TEAMS } from '@/lib/leagues/leagueTeamLifecycle'
import { validateLeagueSettings } from '@/lib/league-settings-validation'
import { getDraftOrderModeAndLotteryConfig, setDraftOrderModeAndLotteryConfig } from '@/lib/draft-lottery/lotteryConfigStorage'
import { getOrphanRosterIdsForLeague } from '@/lib/orphan-ai-manager/orphanRosterResolver'
import { buildApiResponse, parseCommissionerAiManagers } from '@/lib/commissioner-ai-draft-manager'
import type { SlotOrderEntry } from '@/lib/live-draft-engine/types'
import { getRecentAuditEntries } from '@/lib/orphan-ai-manager/OrphanAIManagerService'
import { getProviderStatus } from '@/lib/provider-config'
import { notifyOrphanAiManagerAssigned } from '@/lib/draft-notifications'
import { supportsIdpLeagueSport } from '@/lib/sport-scope'
import { triggerDraftPoolPrewarmBackground } from '@/lib/draft-room/ensureDraftPoolReady'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { hasAfCommissionerPlan } from '@/lib/entitlements/afCommissionerPlan'
import { getComputedDraftRounds } from '@/lib/draft/computedDraftRounds'
import { markDraftRoundsManual } from '@/lib/draft/syncDraftRoundsToRoster'
import { slowDraftPauseAllowed, validateDraftTimerSeconds } from '@/lib/draft/draftSettingsPolicy'
import { classifySeconds } from '@/lib/draft/timer-presets'
import { syncDraftSessionFromLeagueSettings } from '@/lib/league/league-settings-draft-sync'
import { copyLeagueDraftTimeToTournament } from '@/lib/tournament/divisions/leagueDraftTimeToTournament'

export const dynamic = 'force-dynamic'

function parseSlotOrder(value: unknown): SlotOrderEntry[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []

    const record = entry as Record<string, unknown>
    if (typeof record.slot !== 'number' || typeof record.rosterId !== 'string' || typeof record.displayName !== 'string') {
      return []
    }

    return [{
      slot: record.slot,
      rosterId: record.rosterId,
      displayName: record.displayName,
      platformUserId: typeof record.platformUserId === 'string' ? record.platformUserId : undefined,
    }]
  })
}

/** AF Commissioner plan — the one shared check (lib/entitlements/afCommissionerPlan.ts). */
function hasAfCommissionerSub(userId: string): Promise<boolean> {
  return hasAfCommissionerPlan({ id: userId })
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

type DraftOrderTeamSlot = { position: number; teamName: string | null; ownerName: string | null; avatarUrl: string | null; isEmpty: boolean }

/**
 * The draft order as the settings panel lists it: the saved `LeagueSettings.draftOrderSlots` when
 * present (names refreshed from the live team rows), else the current teams, then empty seats up to
 * the league size.
 */
async function loadDraftOrderTeams(leagueId: string, savedSlots: unknown, leagueSize: number | null): Promise<DraftOrderTeamSlot[]> {
  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId, ...CURRENT_TEAMS },
    select: { id: true, teamName: true, ownerName: true, avatarUrl: true },
    orderBy: { externalId: 'asc' },
  })
  const byId = new Map(teams.map((t) => [t.id, t]))
  const out: DraftOrderTeamSlot[] = []
  const used = new Set<string>()
  if (Array.isArray(savedSlots)) {
    const sorted = [...savedSlots]
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .sort((a, b) => Number(a.slot ?? 0) - Number(b.slot ?? 0))
    for (const row of sorted) {
      const ownerId = typeof row.ownerId === 'string' ? row.ownerId : null
      const team = ownerId ? byId.get(ownerId) : undefined
      if (team && !used.has(team.id)) {
        used.add(team.id)
        out.push({ position: out.length + 1, teamName: team.teamName ?? null, ownerName: team.ownerName ?? null, avatarUrl: team.avatarUrl ?? null, isEmpty: false })
      }
    }
  }
  for (const t of teams) {
    if (used.has(t.id)) continue
    out.push({ position: out.length + 1, teamName: t.teamName ?? null, ownerName: t.ownerName ?? null, avatarUrl: t.avatarUrl ?? null, isEmpty: false })
  }
  const size = typeof leagueSize === 'number' && leagueSize > 0 ? leagueSize : out.length
  while (out.length < size) out.push({ position: out.length + 1, teamName: null, ownerName: null, avatarUrl: null, isEmpty: true })
  return out
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const [variant, commissioner, league, idpRosterSummary, orderModeAndLottery] = await Promise.all([
      getDraftVariantSettings(leagueId),
      isCommissioner(leagueId, userId),
      prisma.league.findUnique({
        where: { id: leagueId },
        select: {
          sport: true, leagueVariant: true, timezone: true,
          leagueType: true, isDynasty: true, platform: true, survivorMode: true, guillotineMode: true,
        },
      }),
      (async () => {
        const { isIdpLeague, getRosterDefaultsForIdpLeague, getIdpLeagueConfig } = await import('@/lib/idp')
        if (!(await isIdpLeague(leagueId))) return null
        const [def, idpConfig] = await Promise.all([
          getRosterDefaultsForIdpLeague(leagueId),
          getIdpLeagueConfig(leagueId),
        ])
        if (!def) return null
        return {
          starterSlots: def.starter_slots,
          benchSlots: def.bench_slots,
          scoringPreset: idpConfig?.scoringPreset ?? 'balanced',
          positionMode: idpConfig?.positionMode ?? 'standard',
        }
      })(),
      getDraftOrderModeAndLotteryConfig(leagueId),
    ])
    const providerStatus = getProviderStatus()

    const [lsRow, leagueMeta, draftSessionStatus, computedRounds, viewerHasSub] = await Promise.all([
      prisma.leagueSettings.findUnique({
        where: { leagueId },
        select: {
          draftDateUtc: true, autostart: true, slowDraftPause: true, slowPauseFrom: true,
          slowPauseUntil: true, cpuAutoPick: true, draftOrderSlots: true, draftOrderLocked: true,
        },
      }),
      prisma.league.findUnique({ where: { id: leagueId }, select: { leagueSize: true } }),
      prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER, select: { status: true } }),
      getComputedDraftRounds(leagueId).catch(() => null),
      commissioner ? hasAfCommissionerSub(userId) : Promise.resolve(false),
    ])
    const teams = await loadDraftOrderTeams(leagueId, lsRow?.draftOrderSlots ?? null, leagueMeta?.leagueSize ?? null).catch(() => [])

    let orphanStatus: { orphanRosterIds: string[]; recentActions: Array<{ action: string; createdAt: string; reason: string | null }> } | null = null
    let commissionerAiDraft: ReturnType<typeof buildApiResponse> | null = null
    /*
     * Which teams Chimmy manages, for every member's room — not only the commissioner's. Each open
     * room asks for a Chimmy-managed team's pick when it comes on the clock
     * (`/draft/chimmy-manager-pick`), so it needs to know which teams those are. Roster ids only:
     * the styles and trade rules stay commissioner-only, below.
     */
    const chimmyManagedRosterIds = await prisma.draftSession
      .findFirst({
        where: { leagueId },
        orderBy: CURRENT_DRAFT_SESSION_ORDER,
        select: { commissionerAiManagers: true },
      })
      .then((row) =>
        parseCommissionerAiManagers(row?.commissionerAiManagers)
          .assignments.filter((a) => a.active)
          .map((a) => a.rosterId),
      )
      .catch(() => [] as string[])
    if (commissioner) {
      const [orphanRosterIds, recentLogs, dsAi] = await Promise.all([
        getOrphanRosterIdsForLeague(leagueId),
        getRecentAuditEntries(leagueId, { limit: 10 }),
        prisma.draftSession.findFirst({
          where: { leagueId },
          orderBy: CURRENT_DRAFT_SESSION_ORDER,
          select: { commissionerAiManagers: true, slotOrder: true },
        }),
      ])
      orphanStatus = {
        orphanRosterIds,
        recentActions: recentLogs.map((l) => ({
          rosterId: l.rosterId,
          action: l.action,
          createdAt: l.createdAt.toISOString(),
          reason: l.reason,
        })),
      }
      if (dsAi) {
        commissionerAiDraft = buildApiResponse(
          parseCommissionerAiManagers(dsAi.commissionerAiManagers),
          parseSlotOrder(dsAi.slotOrder)
        )
      }
    }

    const res = NextResponse.json({
      config: variant.config ? { ...variant.config, leagueSize: variant.leagueSize } : null,
      draftUISettings: variant.draftUISettings,
      isCommissioner: !!commissioner,
      variantSettings: variant,
      sessionVariant: variant.sessionVariant ?? null,
      sessionPreDraft: variant.sessionPreDraft ?? false,
      orphanStatus,
      chimmyManagedRosterIds,
      orphanAiProviderAvailable: providerStatus.anyAi,
      orphanDrafterEffectiveMode:
        variant.draftUISettings.orphanDrafterMode === 'ai' && !providerStatus.anyAi
          ? 'cpu'
          : variant.draftUISettings.orphanDrafterMode,
      formatType:
        league?.sport &&
        supportsIdpLeagueSport(league.sport) &&
        (league?.leagueVariant === 'IDP' || league?.leagueVariant === 'DYNASTY_IDP' || league?.leagueVariant === 'idp')
          ? 'IDP'
          : undefined,
      idpRosterSummary: idpRosterSummary ? { starterSlots: idpRosterSummary.starterSlots, benchSlots: idpRosterSummary.benchSlots } : undefined,
      idpScoringPreset: (idpRosterSummary as { scoringPreset?: string } | null)?.scoringPreset ?? undefined,
      idpPositionMode: (idpRosterSummary as { positionMode?: string } | null)?.positionMode ?? undefined,
      draftOrderMode: orderModeAndLottery?.draftOrderMode ?? 'randomize',
      lotteryConfig: orderModeAndLottery?.lotteryConfig ?? null,
      lotteryLastSeed: orderModeAndLottery?.lotteryLastSeed ?? null,
      lotteryLastRunAt: orderModeAndLottery?.lotteryLastRunAt ?? null,
      commissionerAiDraft,
      // Commissioner Draft tab (components/league-settings/DraftSettingsCommissionerPanel).
      teams,
      draftStatus: draftSessionStatus?.status ?? 'pre_draft',
      draftDate: lsRow?.draftDateUtc?.toISOString() ?? null,
      // The draft date/time inputs are wall-clock in THIS zone, not the viewer's browser zone.
      timezone: league?.timezone || 'America/New_York',
      autostartEnabled: lsRow?.autostart ?? false,
      // What `startsAtScheduledTimeRegardlessOfAutostart` needs: the panel hides the Autostart toggle
      // for leagues whose scheduled draft starts at its time whatever the toggle says.
      scheduledStartLeague: league
        ? {
            sport: league.sport, leagueType: league.leagueType, isDynasty: league.isDynasty,
            platform: league.platform, survivorMode: league.survivorMode,
            guillotineMode: league.guillotineMode, leagueVariant: league.leagueVariant,
          }
        : null,
      slowDraftPauseEnabled: lsRow?.slowDraftPause ?? (variant.draftUISettings.timerMode === 'overnight_pause'),
      slowDraftPauseFrom: lsRow?.slowPauseFrom ?? variant.draftUISettings.slowDraftPauseWindow?.start ?? null,
      slowDraftPauseTo: lsRow?.slowPauseUntil ?? variant.draftUISettings.slowDraftPauseWindow?.end ?? null,
      cpuAutoPickEnabled: lsRow?.cpuAutoPick ?? (variant.config?.autopick_behavior !== 'skip'),
      draftOrderLocked: lsRow?.draftOrderLocked ?? false,
      computedRounds,
      hasAfCommissionerSub: viewerHasSub,
    })
    res.headers.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60')
    return res
  } catch (e) {
    console.error('[draft/settings GET]', e)
    return NextResponse.json({ error: 'Failed to load draft settings' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await assertCommissioner(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (await isSeasonTournamentDraft(leagueId)) return NextResponse.json({ error: SEASON_DRAFT_MUTATION_BLOCKED, code: 'TOURNAMENT_RULES_FROZEN' }, { status: 409 })

  const body = await req.json().catch(() => ({}))

  // Resolve league format for draft-type validation so format-specific ids
  // (devy_snake, c2c_auction, salary_cap → auction, etc.) are accepted here
  // the same way they are on the dedicated settings/draft endpoint.
  const leagueForFormat = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { leagueType: true, timezone: true, leagueSize: true },
  })

  // AF Commissioner gates: custom pick timers, a manual round count. Resolved once, lazily.
  let subCache: boolean | null = null
  const viewerHasSub = async () => (subCache ??= await hasAfCommissionerSub(userId))
  let currentVariantCache: Awaited<ReturnType<typeof getDraftVariantSettings>> | null = null
  const currentVariant = async () => (currentVariantCache ??= await getDraftVariantSettings(leagueId))

  const configPatch: Record<string, unknown> = {}
  let roundsManual: boolean | null = null
  if (typeof body.draft_type === 'string' && body.draft_type.trim().length > 0) {
    const normalizedDraftType = body.draft_type.trim().toLowerCase()
    if (isDraftTypeAllowedOnSettingsTab(leagueForFormat?.leagueType ?? null, normalizedDraftType)) {
      configPatch.draft_type = normalizedDraftType
    }
  }
  if (typeof body.rounds === 'number') {
    let rounds = Math.round(body.rounds)
    // Rounds = draftable roster spots (IR excluded; taxi/devy counted for dynasty/devy/C2C/salary
    // cap). Only an AF Commissioner may override it; anyone else gets the computed count.
    const computed = await getComputedDraftRounds(leagueId).catch(() => null)
    if (!(await viewerHasSub()) && computed) rounds = computed.rounds
    const roundsError = await validateDraftRoundsFitRoster(leagueId, rounds)
    if (roundsError) return NextResponse.json({ error: roundsError }, { status: 400 })
    configPatch.rounds = rounds
    // Remember whether this is a deliberate override, so a later ROSTER change knows whether to
    // carry the draft along with it (lib/draft/syncDraftRoundsToRoster.ts).
    roundsManual = computed ? rounds !== computed.rounds : null
  }
  if (body.timer_seconds === null) configPatch.timer_seconds = null
  else if (body.timer_seconds !== undefined) {
    const timer = validateDraftTimerSeconds(body.timer_seconds, {
      allowCustom: await viewerHasSub(),
      currentSeconds: (await currentVariant()).config?.timer_seconds ?? null,
    })
    if (!timer.ok) return NextResponse.json({ error: timer.error, code: timer.code }, { status: 400 })
    configPatch.timer_seconds = timer.seconds
  }
  if (body.slow_timer_seconds !== undefined) configPatch.slow_timer_seconds = body.slow_timer_seconds
  if (typeof body.pick_order_rules === 'string') configPatch.pick_order_rules = body.pick_order_rules
  if (typeof body.snake_or_linear === 'string') configPatch.snake_or_linear = body.snake_or_linear
  // 3RR applies only to snake; ignore or clear when draft is linear/auction
  if (typeof body.third_round_reversal === 'boolean') {
    const draftType = body.draft_type ?? configPatch.draft_type
    const snakeOrLinear = body.snake_or_linear ?? body.pick_order_rules ?? configPatch.snake_or_linear ?? configPatch.pick_order_rules
    const isSnake = draftType !== 'auction' && (snakeOrLinear === 'snake' || snakeOrLinear == null)
    configPatch.third_round_reversal = isSnake ? body.third_round_reversal : false
  }
  if (typeof body.autopick_behavior === 'string') configPatch.autopick_behavior = body.autopick_behavior
  if (body.queue_size_limit !== undefined) configPatch.queue_size_limit = body.queue_size_limit
  if (typeof body.pre_draft_ranking_source === 'string') configPatch.pre_draft_ranking_source = body.pre_draft_ranking_source
  if (typeof body.roster_fill_order === 'string') configPatch.roster_fill_order = body.roster_fill_order
  if (typeof body.position_filter_behavior === 'string') configPatch.position_filter_behavior = body.position_filter_behavior

  const uiPatch: Record<string, unknown> = {}
  if (typeof body.tradedPickColorModeEnabled === 'boolean') uiPatch.tradedPickColorModeEnabled = body.tradedPickColorModeEnabled
  if (typeof body.tradedPickOwnerNameRedEnabled === 'boolean') uiPatch.tradedPickOwnerNameRedEnabled = body.tradedPickOwnerNameRedEnabled
  if (typeof body.aiAdpEnabled === 'boolean') uiPatch.aiAdpEnabled = body.aiAdpEnabled
  if (typeof body.aiQueueReorderEnabled === 'boolean') uiPatch.aiQueueReorderEnabled = body.aiQueueReorderEnabled
  if (typeof body.orphanTeamAiManagerEnabled === 'boolean') uiPatch.orphanTeamAiManagerEnabled = body.orphanTeamAiManagerEnabled
  if (body.orphanDrafterMode === 'cpu' || body.orphanDrafterMode === 'ai') uiPatch.orphanDrafterMode = body.orphanDrafterMode
  if (typeof body.liveDraftChatSyncEnabled === 'boolean') uiPatch.liveDraftChatSyncEnabled = body.liveDraftChatSyncEnabled
  if (typeof body.draftOrderRandomizationEnabled === 'boolean') uiPatch.draftOrderRandomizationEnabled = body.draftOrderRandomizationEnabled
  if (typeof body.pickTradeEnabled === 'boolean') uiPatch.pickTradeEnabled = body.pickTradeEnabled
  if (typeof body.auctionAutoNominationEnabled === 'boolean') uiPatch.auctionAutoNominationEnabled = body.auctionAutoNominationEnabled
  if (typeof body.importEnabled === 'boolean') uiPatch.importEnabled = body.importEnabled
  if (typeof body.autoPickEnabled === 'boolean') uiPatch.autoPickEnabled = body.autoPickEnabled
  if (['per_pick', 'soft_pause', 'overnight_pause', 'none'].includes(body.timerMode)) uiPatch.timerMode = body.timerMode
  if (typeof body.commissionerForceAutoPickEnabled === 'boolean') uiPatch.commissionerForceAutoPickEnabled = body.commissionerForceAutoPickEnabled
  if (typeof body.commissionerPauseControlsEnabled === 'boolean') uiPatch.commissionerPauseControlsEnabled = body.commissionerPauseControlsEnabled
  if (typeof body.allowPicksDuringOvernightPause === 'boolean')
    uiPatch.allowPicksDuringOvernightPause = body.allowPicksDuringOvernightPause
  if (typeof body.guillotineAutoHeyGenEnabled === 'boolean')
    uiPatch.guillotineAutoHeyGenEnabled = body.guillotineAutoHeyGenEnabled
  if (typeof body.survivorFinaleAutoHeyGenEnabled === 'boolean')
    uiPatch.survivorFinaleAutoHeyGenEnabled = body.survivorFinaleAutoHeyGenEnabled
  if (body.slowDraftPauseWindow !== undefined) {
    const w = body.slowDraftPauseWindow
    if (w == null || (typeof w === 'object' && typeof w.start === 'string' && typeof w.end === 'string' && typeof w.timezone === 'string')) {
      uiPatch.slowDraftPauseWindow = w
    }
  }

  // Commissioner Draft tab fields that live on the LeagueSettings row (draft date, autostart, CPU
  // auto-pick, slow-draft overnight pause). The panel used to send these and nothing stored them.
  const lsPatch: Prisma.LeagueSettingsUpdateInput = {}
  const lsSyncKeys = new Set<string>()
  if (body.draftDate !== undefined) {
    if (body.draftDate === null || body.draftDate === '') lsPatch.draftDateUtc = null
    else {
      const d = new Date(String(body.draftDate))
      if (Number.isNaN(d.getTime())) return NextResponse.json({ error: 'Invalid draft date' }, { status: 400 })
      lsPatch.draftDateUtc = d
    }
  }
  if (typeof body.autostart === 'boolean') lsPatch.autostart = body.autostart
  if (typeof body.cpuAutoPick === 'boolean') {
    lsPatch.cpuAutoPick = body.cpuAutoPick
    lsSyncKeys.add('cpuAutoPick')
  }
  if (typeof configPatch.rounds === 'number') lsPatch.rounds = configPatch.rounds as number
  if (typeof configPatch.timer_seconds === 'number') {
    const { preset, customSeconds } = classifySeconds(configPatch.timer_seconds as number)
    lsPatch.pickTimerPreset = preset
    lsPatch.pickTimerCustomValue = customSeconds
  }
  for (const k of ['slowDraftPauseFrom', 'slowDraftPauseTo'] as const) {
    if (body[k] !== undefined && body[k] !== null && !HHMM_RE.test(String(body[k]))) {
      return NextResponse.json({ error: 'Pause window times must be HH:MM' }, { status: 400 })
    }
  }
  if (typeof body.slowDraftPauseEnabled === 'boolean') {
    const effectiveTimer =
      typeof configPatch.timer_seconds === 'number'
        ? (configPatch.timer_seconds as number)
        : ((await currentVariant()).config?.timer_seconds ?? null)
    // The overnight pause exists only for a slow draft (≥ 30 min per pick).
    const pauseOn = body.slowDraftPauseEnabled && slowDraftPauseAllowed(effectiveTimer)
    const from = typeof body.slowDraftPauseFrom === 'string' ? body.slowDraftPauseFrom : '21:00'
    const to = typeof body.slowDraftPauseTo === 'string' ? body.slowDraftPauseTo : '09:00'
    lsPatch.slowDraftPause = pauseOn
    lsPatch.slowPauseFrom = from
    lsPatch.slowPauseUntil = to
    if (pauseOn) {
      uiPatch.timerMode = 'overnight_pause'
      uiPatch.slowDraftPauseWindow = { start: from, end: to, timezone: leagueForFormat?.timezone ?? 'America/New_York' }
      // Sleeper semantics: during the window the CLOCK stops, but managers may still pick.
      uiPatch.allowPicksDuringOvernightPause = true
    } else if ((await currentVariant()).draftUISettings.timerMode === 'overnight_pause') {
      uiPatch.timerMode = 'per_pick'
    }
  }

  // Slice 1 — typed DraftSession flag patch.
  const sessionFlagsPatch: Record<string, unknown> = {}
  if (typeof body.thirdRoundReversal === 'boolean') {
    sessionFlagsPatch.thirdRoundReversal = body.thirdRoundReversal
  }
  if (
    body.onClockTradeTimerBehavior === 'inherit_remaining' ||
    body.onClockTradeTimerBehavior === 'reset_timer'
  ) {
    sessionFlagsPatch.onClockTradeTimerBehavior = body.onClockTradeTimerBehavior
  }
  if (typeof body.inDraftPlayerTradesEnabled === 'boolean') {
    sessionFlagsPatch.inDraftPlayerTradesEnabled = body.inDraftPlayerTradesEnabled
  }
  if (typeof body.customRankingsEnabled === 'boolean') {
    sessionFlagsPatch.customRankingsEnabled = body.customRankingsEnabled
  }

  const sessionVariantPatch: Record<string, unknown> = {}
  if (body.sessionVariant && typeof body.sessionVariant === 'object') {
    const sv = body.sessionVariant
    if (sv.keeperConfig !== undefined) sessionVariantPatch.keeperConfig = sv.keeperConfig
    if (sv.devyConfig !== undefined) sessionVariantPatch.devyConfig = sv.devyConfig
    if (sv.c2cConfig !== undefined) sessionVariantPatch.c2cConfig = sv.c2cConfig
    if (sv.auctionBudgetPerTeam !== undefined) sessionVariantPatch.auctionBudgetPerTeam = sv.auctionBudgetPerTeam
  }

  let orderModePatch: { draftOrderMode?: string; lotteryConfig?: Record<string, unknown> } | null = null
  if (['randomize', 'manual', 'weighted_lottery'].includes(body.draft_order_mode)) {
    orderModePatch = { draftOrderMode: body.draft_order_mode }
  }
  if (body.lotteryConfig && typeof body.lotteryConfig === 'object') {
    orderModePatch = orderModePatch ?? {}
    orderModePatch.lotteryConfig = body.lotteryConfig as Record<string, unknown>
  }

  // Handle randomize: assign rosters to draft slots randomly
  let randomizedSlotOrder: SlotOrderEntry[] | null = null
  let draftOrderSlotsForSave: Array<{ slot: number; ownerId: string; ownerName: string; avatarUrl: string | null }> | null = null
  if (body.randomize === true) {
    try {
      const [teams, draftSession] = await Promise.all([
        // Randomizing the draft order must not deal a slot to a franchise that left the provider.
        prisma.leagueTeam.findMany({
          where: { leagueId, ...CURRENT_TEAMS },
          select: { externalId: true, teamName: true, ownerName: true, platformUserId: true, id: true, avatarUrl: true },
        }),
        prisma.draftSession.findFirst({
          where: { leagueId },
          orderBy: CURRENT_DRAFT_SESSION_ORDER,
          select: { teamCount: true },
        }),
      ])

      if (teams.length > 0 && draftSession) {
        // Shuffle teams randomly
        const shuffled = [...teams].sort(() => Math.random() - 0.5)

        // Create slotOrder entries for draftSession
        randomizedSlotOrder = shuffled.map((team, index) => ({
          slot: index + 1,
          rosterId: team.externalId,
          displayName: team.ownerName || team.teamName || `Team ${index + 1}`,
          platformUserId: team.platformUserId || undefined,
        }))

        // Create draftOrderSlots for league settings
        draftOrderSlotsForSave = shuffled.map((team, index) => ({
          slot: index + 1,
          ownerId: team.id,
          ownerName: team.ownerName || team.teamName || `Team ${index + 1}`,
          avatarUrl: team.avatarUrl || null,
        }))
      }
    } catch (e) {
      console.error('[draft/settings] randomize failed:', e)
    }
  }

  const hasConfig = Object.keys(configPatch).length > 0
  const hasUI = Object.keys(uiPatch).length > 0
  const hasSessionVariant = Object.keys(sessionVariantPatch).length > 0
  const hasOrderMode = orderModePatch !== null
  const hasSessionFlags = Object.keys(sessionFlagsPatch).length > 0
  const hasLeagueSettings = Object.keys(lsPatch).length > 0

  /** Live snake/linear drafts: never accept structural/config/order/sessionVariant mutations from settings PATCH while actively drafting (in_progress). Allow changes when paused. Room modal only sends UI prefs. */
  const draftSessionRow = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { id: true, status: true },
  })
  const isActiveDraft =
    draftSessionRow &&
    draftSessionRow.status === 'in_progress'
  if (
    isActiveDraft &&
    (hasConfig || hasSessionVariant || hasOrderMode)
  ) {
    return NextResponse.json(
      {
        error:
          'Structural draft settings cannot be changed while the draft is in progress. Pause the draft or finish editing from League settings if your league allows it.',
        code: 'LIVE_DRAFT_STRUCTURAL_LOCKED',
      },
      { status: 409 },
    )
  }

  const orphanManagerSettingTouched =
    Object.prototype.hasOwnProperty.call(uiPatch, 'orphanTeamAiManagerEnabled') ||
    Object.prototype.hasOwnProperty.call(uiPatch, 'orphanDrafterMode')

  if (!hasConfig && !hasUI && !hasSessionVariant && !hasOrderMode && !hasSessionFlags && !hasLeagueSettings) {
    const current = await getDraftVariantSettings(leagueId)
    return NextResponse.json({
      ok: true,
      config: current.config ? { ...current.config, leagueSize: current.leagueSize } : null,
      draftUISettings: current.draftUISettings,
      variantSettings: current,
    })
  }

  const current = await getDraftVariantSettings(leagueId)
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  })
  const leagueSettings = (league?.settings ?? {}) as Record<string, unknown>
  const effectiveForValidation: Record<string, unknown> = {
    league_type: leagueSettings.league_type,
    league_variant: leagueSettings.league_variant ?? null,
    roster_mode: leagueSettings.roster_mode ?? null,
    draft_type: configPatch.draft_type ?? current.config?.draft_type ?? leagueSettings.draft_type,
    auction_budget_per_team: sessionVariantPatch.auctionBudgetPerTeam ?? current.sessionVariant?.auctionBudgetPerTeam ?? leagueSettings.auction_budget_per_team,
    devyConfig: sessionVariantPatch.devyConfig ?? current.sessionVariant?.devyConfig ?? leagueSettings.devyConfig,
    c2cConfig: sessionVariantPatch.c2cConfig ?? current.sessionVariant?.c2cConfig ?? leagueSettings.c2cConfig,
    devy_slots: leagueSettings.devy_slots ?? leagueSettings.devySlots ?? null,
    c2c_college_roster_size:
      leagueSettings.c2c_college_roster_size ??
      leagueSettings.c2cCollegeRosterSize ??
      null,
  }
  const validation = validateLeagueSettings(effectiveForValidation)
  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.errors[0] ?? 'Invalid draft configuration', errors: validation.errors },
      { status: 400 }
    )
  }

  try {
    if (hasOrderMode && orderModePatch) {
      await setDraftOrderModeAndLotteryConfig(leagueId, {
        ...(orderModePatch.draftOrderMode && { draftOrderMode: orderModePatch.draftOrderMode as 'randomize' | 'manual' | 'weighted_lottery' }),
        ...(orderModePatch.lotteryConfig && { lotteryConfig: orderModePatch.lotteryConfig as any }),
      })
    }

    // Update draft session with randomized slot order if needed
    if (randomizedSlotOrder && randomizedSlotOrder.length > 0) {
      // Keyed on the row read above rather than on `leagueId`, which is no longer unique.
      // Absent session still throws, as the previous `update({ where: { leagueId } })` did.
      if (!draftSessionRow) throw new Error('No draft session for this league to order')
      await Promise.all([
        prisma.draftSession.update({
          where: { id: draftSessionRow.id },
          data: { slotOrder: randomizedSlotOrder as unknown as Prisma.InputJsonValue },
        }),
        // Also save to league settings so it persists in the UI
        draftOrderSlotsForSave
          ? prisma.leagueSettings.upsert({
              where: { leagueId },
              create: {
                leagueId,
                draftOrderSlots: draftOrderSlotsForSave as unknown as Prisma.InputJsonValue,
              },
              update: {
                draftOrderSlots: draftOrderSlotsForSave as unknown as Prisma.InputJsonValue,
              },
            })
          : Promise.resolve(),
      ])
    }

    if (hasLeagueSettings) {
      const lsRow = await prisma.leagueSettings.upsert({
        where: { leagueId },
        create: { leagueId, ...(lsPatch as unknown as Omit<Prisma.LeagueSettingsUncheckedCreateInput, 'leagueId'>) },
        update: lsPatch,
      })
      if (lsSyncKeys.size > 0) {
        await syncDraftSessionFromLeagueSettings(leagueId, lsRow, leagueForFormat?.leagueSize ?? 0, lsSyncKeys).catch((e) =>
          console.warn('[draft/settings PATCH] league-settings sync', e),
        )
      }
      // A tournament conference league's new draft time goes back onto the tournament's record for it.
      if (body.draftDate !== undefined) {
        await copyLeagueDraftTimeToTournament(leagueId, lsRow.draftDateUtc ?? null, userId).catch((e) =>
          console.warn('[draft/settings PATCH] tournament draft time copy-back', e instanceof Error ? e.message : 'unknown error'),
        )
      }
    }

    const updated = await updateDraftVariantSettings(leagueId, {
      ...(hasConfig ? { config: configPatch as any } : {}),
      ...(hasUI ? { draftUISettings: uiPatch as any } : {}),
      ...(hasSessionVariant ? { sessionVariant: sessionVariantPatch as any } : {}),
      ...(hasSessionFlags ? { sessionFlags: sessionFlagsPatch as any } : {}),
    })
    // After the settings write above, which rewrites League.settings wholesale.
    if (roundsManual !== null) {
      await markDraftRoundsManual(leagueId, roundsManual).catch((e) =>
        console.warn('[draft/settings PATCH] rounds override flag', e instanceof Error ? e.message : 'unknown error'),
      )
    }
    if (orphanManagerSettingTouched) {
      const orphanModeChanged = current.draftUISettings.orphanDrafterMode !== updated.draftUISettings.orphanDrafterMode
      const orphanEnabledChanged =
        current.draftUISettings.orphanTeamAiManagerEnabled !== updated.draftUISettings.orphanTeamAiManagerEnabled
      if (orphanModeChanged || orphanEnabledChanged) {
        void notifyOrphanAiManagerAssigned(leagueId).catch(() => {})
      }
    }
    const orderModeAndLottery = await getDraftOrderModeAndLotteryConfig(leagueId)
    triggerDraftPoolPrewarmBackground(leagueId)

    // Fetch team details for response if randomized
    let teamsForResponse: Array<{
      position: number
      teamName: string | null
      ownerName: string | null
      avatarUrl: string | null
      isEmpty: boolean
    }> = []
    if (randomizedSlotOrder && randomizedSlotOrder.length > 0) {
      const teamDetails = await prisma.leagueTeam.findMany({
        where: { leagueId },
        select: { externalId: true, teamName: true, ownerName: true },
      })
      teamsForResponse = randomizedSlotOrder.map((entry) => {
        const team = teamDetails.find((t) => t.externalId === entry.rosterId)
        return {
          position: entry.slot,
          teamName: team?.teamName ?? null,
          ownerName: team?.ownerName ?? entry.displayName ?? null,
          avatarUrl: null,
          isEmpty: !team,
        }
      })
    }

    return NextResponse.json({
      ok: true,
      config: updated.config ? { ...updated.config, leagueSize: updated.leagueSize } : null,
      draftUISettings: updated.draftUISettings,
      variantSettings: updated,
      draftOrderMode: orderModeAndLottery.draftOrderMode,
      lotteryConfig: orderModeAndLottery.lotteryConfig,
      lotteryLastSeed: orderModeAndLottery.lotteryLastSeed,
      lotteryLastRunAt: orderModeAndLottery.lotteryLastRunAt,
      teams: teamsForResponse,
    })
  } catch (e) {
    const code = (e as Error & { code?: string })?.code
    if (code === 'THIRD_ROUND_REVERSAL_LOCKED') {
      return NextResponse.json(
        { error: (e as Error).message, code },
        { status: 409 },
      )
    }
    console.error('[draft/settings PATCH]', e)
    return NextResponse.json({ error: (e as Error).message ?? 'Failed to update settings' }, { status: 500 })
  }
}
