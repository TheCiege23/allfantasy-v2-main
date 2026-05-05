/**
 * Draft room UI/behavior settings (commissioner-controlled).
 * Stored in League.settings under draft_* keys.
 */

import { prisma } from '@/lib/prisma'

export type TimerMode = 'per_pick' | 'soft_pause' | 'overnight_pause' | 'none'

/** Optional overnight pause window for slow drafts (e.g. no picks 10pm–8am league time). */
export interface SlowDraftPauseWindow {
  /** "22:00" = 10pm */
  start: string
  /** "08:00" = 8am (next day if overnight) */
  end: string
  /** IANA timezone, e.g. "America/New_York" */
  timezone: string
}

/** Commissioner choice for empty/orphan teams: CPU (rules-based, no API) or AI (optional API, fallback to CPU). */
export type OrphanDrafterMode = 'cpu' | 'ai'

/** How the draft is run: live room, auto-draft, or offline (commissioner logs picks from an in-person draft). */
export type DraftExecutionMode = 'live' | 'auto' | 'offline'

export interface DraftUISettings {
  tradedPickColorModeEnabled: boolean
  tradedPickOwnerNameRedEnabled: boolean
  aiAdpEnabled: boolean
  aiQueueReorderEnabled: boolean
  orphanTeamAiManagerEnabled: boolean
  /** When orphan AI manager is on: 'cpu' = rules-based only; 'ai' = try AI then fallback to CPU. */
  orphanDrafterMode: OrphanDrafterMode
  liveDraftChatSyncEnabled: boolean
  autoPickEnabled: boolean
  timerMode: TimerMode
  commissionerForceAutoPickEnabled: boolean
  /** Allow commissioner pause/resume/reset timer controls in live draft room. */
  commissionerPauseControlsEnabled?: boolean
  /** Slow draft: pause window when timerMode is overnight_pause. */
  slowDraftPauseWindow?: SlowDraftPauseWindow | null
  /** When overnight_pause: allow managers to submit picks during the quiet window (server-enforced). */
  allowPicksDuringOvernightPause?: boolean
  /** Allow randomizing draft order (e.g. at start of draft). */
  draftOrderRandomizationEnabled: boolean
  /** Allow trading picks (during/after draft). */
  pickTradeEnabled: boolean
  /** Auction: when nominator doesn't act in time, system auto-nominates next player (deterministic). */
  auctionAutoNominationEnabled: boolean
  /** Draft import flow availability for commissioner tools. */
  importEnabled: boolean
  /** Execution mode — drives draft-room UI (offline banner, commissioner-elevated pick source). */
  executionMode: DraftExecutionMode
  /** Redraft snake premium on-screen banner after each Round 1 selection (commissioner toggle). */
  roundOnePickAnnouncementEnabled: boolean
  /**
   * Fire-and-forget HeyGen narration clip after Round 1 picks when server has HEYGEN_API_KEY.
   * Does not block drafting; commissioner-only UX toggle.
   */
  roundOneHeyGenHighlightEnabled: boolean
  /** Auto-generate HeyGen clips when guillotine elimination events are processed. */
  guillotineAutoHeyGenEnabled: boolean
  /** Auto-generate HeyGen winner reveal clip once survivor finale voting closes. */
  survivorFinaleAutoHeyGenEnabled: boolean
}

const DRAFT_UI_DEFAULTS: DraftUISettings = {
  tradedPickColorModeEnabled: true,
  tradedPickOwnerNameRedEnabled: true,
  aiAdpEnabled: true,
  aiQueueReorderEnabled: true,
  orphanTeamAiManagerEnabled: false,
  orphanDrafterMode: 'cpu',
  liveDraftChatSyncEnabled: false,
  autoPickEnabled: false,
  timerMode: 'per_pick',
  commissionerForceAutoPickEnabled: false,
  commissionerPauseControlsEnabled: true,
  allowPicksDuringOvernightPause: false,
  draftOrderRandomizationEnabled: false,
  pickTradeEnabled: true,
  auctionAutoNominationEnabled: false,
  importEnabled: true,
  executionMode: 'live',
  roundOnePickAnnouncementEnabled: true,
  roundOneHeyGenHighlightEnabled: false,
  guillotineAutoHeyGenEnabled: true,
  survivorFinaleAutoHeyGenEnabled: true,
}

const SETTINGS_KEYS: Record<keyof DraftUISettings, string> = {
  tradedPickColorModeEnabled: 'draft_traded_pick_color_mode_enabled',
  tradedPickOwnerNameRedEnabled: 'draft_traded_pick_owner_name_red_enabled',
  aiAdpEnabled: 'draft_ai_adp_enabled',
  aiQueueReorderEnabled: 'draft_ai_queue_reorder_enabled',
  orphanTeamAiManagerEnabled: 'draft_orphan_team_ai_manager_enabled',
  orphanDrafterMode: 'draft_orphan_drafter_mode',
  liveDraftChatSyncEnabled: 'draft_live_chat_sync_enabled',
  autoPickEnabled: 'draft_auto_pick_enabled',
  timerMode: 'draft_timer_mode',
  commissionerForceAutoPickEnabled: 'draft_commissioner_force_autopick_enabled',
  commissionerPauseControlsEnabled: 'draft_commissioner_pause_controls_enabled',
  slowDraftPauseWindow: 'draft_slow_pause_window',
  allowPicksDuringOvernightPause: 'draft_allow_picks_during_overnight_pause',
  draftOrderRandomizationEnabled: 'draft_order_randomization_enabled',
  pickTradeEnabled: 'draft_pick_trade_enabled',
  auctionAutoNominationEnabled: 'draft_auction_auto_nomination_enabled',
  importEnabled: 'draft_import_enabled',
  executionMode: 'draft_execution_mode',
  roundOnePickAnnouncementEnabled: 'draft_round_one_pick_announcement_enabled',
  roundOneHeyGenHighlightEnabled: 'draft_round_one_heygen_highlight_enabled',
  guillotineAutoHeyGenEnabled: 'draft_guillotine_auto_heygen_enabled',
  survivorFinaleAutoHeyGenEnabled: 'draft_survivor_finale_auto_heygen_enabled',
}

function fromStorage(settings: Record<string, unknown>): DraftUISettings {
  const mode = settings[SETTINGS_KEYS.orphanDrafterMode] as OrphanDrafterMode | undefined
  return {
    tradedPickColorModeEnabled: settings[SETTINGS_KEYS.tradedPickColorModeEnabled] as boolean ?? DRAFT_UI_DEFAULTS.tradedPickColorModeEnabled,
    tradedPickOwnerNameRedEnabled: settings[SETTINGS_KEYS.tradedPickOwnerNameRedEnabled] as boolean ?? DRAFT_UI_DEFAULTS.tradedPickOwnerNameRedEnabled,
    aiAdpEnabled: settings[SETTINGS_KEYS.aiAdpEnabled] as boolean ?? DRAFT_UI_DEFAULTS.aiAdpEnabled,
    aiQueueReorderEnabled: settings[SETTINGS_KEYS.aiQueueReorderEnabled] as boolean ?? DRAFT_UI_DEFAULTS.aiQueueReorderEnabled,
    orphanTeamAiManagerEnabled: settings[SETTINGS_KEYS.orphanTeamAiManagerEnabled] as boolean ?? DRAFT_UI_DEFAULTS.orphanTeamAiManagerEnabled,
    orphanDrafterMode: (mode === 'cpu' || mode === 'ai' ? mode : DRAFT_UI_DEFAULTS.orphanDrafterMode),
    liveDraftChatSyncEnabled: settings[SETTINGS_KEYS.liveDraftChatSyncEnabled] as boolean ?? DRAFT_UI_DEFAULTS.liveDraftChatSyncEnabled,
    autoPickEnabled: settings[SETTINGS_KEYS.autoPickEnabled] as boolean ?? DRAFT_UI_DEFAULTS.autoPickEnabled,
    timerMode: (settings[SETTINGS_KEYS.timerMode] as TimerMode) ?? DRAFT_UI_DEFAULTS.timerMode,
    commissionerForceAutoPickEnabled: settings[SETTINGS_KEYS.commissionerForceAutoPickEnabled] as boolean ?? DRAFT_UI_DEFAULTS.commissionerForceAutoPickEnabled,
    commissionerPauseControlsEnabled: settings[SETTINGS_KEYS.commissionerPauseControlsEnabled] as boolean ?? DRAFT_UI_DEFAULTS.commissionerPauseControlsEnabled,
    slowDraftPauseWindow: (settings[SETTINGS_KEYS.slowDraftPauseWindow] as SlowDraftPauseWindow | null | undefined) ?? undefined,
    allowPicksDuringOvernightPause:
      (settings[SETTINGS_KEYS.allowPicksDuringOvernightPause] as boolean | undefined) ??
      DRAFT_UI_DEFAULTS.allowPicksDuringOvernightPause,
    draftOrderRandomizationEnabled: settings[SETTINGS_KEYS.draftOrderRandomizationEnabled] as boolean ?? DRAFT_UI_DEFAULTS.draftOrderRandomizationEnabled,
    pickTradeEnabled: settings[SETTINGS_KEYS.pickTradeEnabled] as boolean ?? DRAFT_UI_DEFAULTS.pickTradeEnabled,
    auctionAutoNominationEnabled: settings[SETTINGS_KEYS.auctionAutoNominationEnabled] as boolean ?? DRAFT_UI_DEFAULTS.auctionAutoNominationEnabled,
    importEnabled: settings[SETTINGS_KEYS.importEnabled] as boolean ?? DRAFT_UI_DEFAULTS.importEnabled,
    executionMode: resolveExecutionMode(settings),
    roundOnePickAnnouncementEnabled:
      settings[SETTINGS_KEYS.roundOnePickAnnouncementEnabled] as boolean ??
      DRAFT_UI_DEFAULTS.roundOnePickAnnouncementEnabled,
    roundOneHeyGenHighlightEnabled:
      settings[SETTINGS_KEYS.roundOneHeyGenHighlightEnabled] as boolean ??
      DRAFT_UI_DEFAULTS.roundOneHeyGenHighlightEnabled,
    guillotineAutoHeyGenEnabled:
      settings[SETTINGS_KEYS.guillotineAutoHeyGenEnabled] as boolean ??
      DRAFT_UI_DEFAULTS.guillotineAutoHeyGenEnabled,
    survivorFinaleAutoHeyGenEnabled:
      settings[SETTINGS_KEYS.survivorFinaleAutoHeyGenEnabled] as boolean ??
      DRAFT_UI_DEFAULTS.survivorFinaleAutoHeyGenEnabled,
  }
}

function resolveExecutionMode(settings: Record<string, unknown>): DraftExecutionMode {
  const direct = settings[SETTINGS_KEYS.executionMode]
  if (direct === 'live' || direct === 'auto' || direct === 'offline') return direct
  if (settings.draft_execution_offline === true) return 'offline'
  if (settings.draft_execution_auto === true) return 'auto'
  const requested = String(settings.requested_draft_type ?? settings.draft_type ?? '').toLowerCase()
  if (requested === 'offline') return 'offline'
  if (requested === 'auto') return 'auto'
  return DRAFT_UI_DEFAULTS.executionMode
}

/**
 * Slice 3 — single source of truth for "is soft timer active?".
 * Soft timer = expired clocks do NOT auto-pick; draft waits for a manager / commissioner / NPC action.
 * Mapped from `timerMode === 'soft_pause'` so we don't duplicate timer state.
 */
export function isSoftTimerEnabled(uiSettings: Pick<DraftUISettings, 'timerMode'> | null | undefined): boolean {
  return uiSettings?.timerMode === 'soft_pause'
}

/**
 * Get draft UI settings for a league (for draft room and settings panel).
 */
export async function getDraftUISettingsForLeague(leagueId: string): Promise<DraftUISettings> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  })
  const settings = (league?.settings as Record<string, unknown>) ?? {}
  return fromStorage(settings)
}

/**
 * Update draft UI settings (commissioner only). Merges into existing League.settings.
 */
export async function updateDraftUISettings(
  leagueId: string,
  patch: Partial<DraftUISettings>
): Promise<DraftUISettings> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  })
  if (!league) throw new Error('League not found')

  const current = (league.settings as Record<string, unknown>) ?? {}
  const next = { ...current }

  if (patch.tradedPickColorModeEnabled !== undefined)
    next[SETTINGS_KEYS.tradedPickColorModeEnabled] = patch.tradedPickColorModeEnabled
  if (patch.tradedPickOwnerNameRedEnabled !== undefined)
    next[SETTINGS_KEYS.tradedPickOwnerNameRedEnabled] = patch.tradedPickOwnerNameRedEnabled
  if (patch.aiAdpEnabled !== undefined)
    next[SETTINGS_KEYS.aiAdpEnabled] = patch.aiAdpEnabled
  if (patch.aiQueueReorderEnabled !== undefined)
    next[SETTINGS_KEYS.aiQueueReorderEnabled] = patch.aiQueueReorderEnabled
  if (patch.orphanTeamAiManagerEnabled !== undefined)
    next[SETTINGS_KEYS.orphanTeamAiManagerEnabled] = patch.orphanTeamAiManagerEnabled
  if (patch.orphanDrafterMode !== undefined && (patch.orphanDrafterMode === 'cpu' || patch.orphanDrafterMode === 'ai'))
    next[SETTINGS_KEYS.orphanDrafterMode] = patch.orphanDrafterMode
  if (patch.liveDraftChatSyncEnabled !== undefined)
    next[SETTINGS_KEYS.liveDraftChatSyncEnabled] = patch.liveDraftChatSyncEnabled
  if (patch.autoPickEnabled !== undefined)
    next[SETTINGS_KEYS.autoPickEnabled] = patch.autoPickEnabled
  if (patch.timerMode !== undefined)
    next[SETTINGS_KEYS.timerMode] = patch.timerMode
  if (patch.commissionerForceAutoPickEnabled !== undefined)
    next[SETTINGS_KEYS.commissionerForceAutoPickEnabled] = patch.commissionerForceAutoPickEnabled
  if (patch.commissionerPauseControlsEnabled !== undefined)
    next[SETTINGS_KEYS.commissionerPauseControlsEnabled] = patch.commissionerPauseControlsEnabled
  if (patch.slowDraftPauseWindow !== undefined)
    next[SETTINGS_KEYS.slowDraftPauseWindow] = patch.slowDraftPauseWindow
  if (patch.allowPicksDuringOvernightPause !== undefined)
    next[SETTINGS_KEYS.allowPicksDuringOvernightPause] = patch.allowPicksDuringOvernightPause
  if (patch.draftOrderRandomizationEnabled !== undefined)
    next[SETTINGS_KEYS.draftOrderRandomizationEnabled] = patch.draftOrderRandomizationEnabled
  if (patch.pickTradeEnabled !== undefined)
    next[SETTINGS_KEYS.pickTradeEnabled] = patch.pickTradeEnabled
  if (patch.auctionAutoNominationEnabled !== undefined)
    next[SETTINGS_KEYS.auctionAutoNominationEnabled] = patch.auctionAutoNominationEnabled
  if (patch.importEnabled !== undefined)
    next[SETTINGS_KEYS.importEnabled] = patch.importEnabled
  if (patch.executionMode !== undefined && (patch.executionMode === 'live' || patch.executionMode === 'auto' || patch.executionMode === 'offline'))
    next[SETTINGS_KEYS.executionMode] = patch.executionMode
  if (patch.roundOnePickAnnouncementEnabled !== undefined)
    next[SETTINGS_KEYS.roundOnePickAnnouncementEnabled] = patch.roundOnePickAnnouncementEnabled
  if (patch.roundOneHeyGenHighlightEnabled !== undefined)
    next[SETTINGS_KEYS.roundOneHeyGenHighlightEnabled] = patch.roundOneHeyGenHighlightEnabled
  if (patch.guillotineAutoHeyGenEnabled !== undefined)
    next[SETTINGS_KEYS.guillotineAutoHeyGenEnabled] = patch.guillotineAutoHeyGenEnabled
  if (patch.survivorFinaleAutoHeyGenEnabled !== undefined)
    next[SETTINGS_KEYS.survivorFinaleAutoHeyGenEnabled] = patch.survivorFinaleAutoHeyGenEnabled

  await prisma.league.update({
    where: { id: leagueId },
    data: { settings: next as any, updatedAt: new Date() },
  })

  return fromStorage(next)
}
