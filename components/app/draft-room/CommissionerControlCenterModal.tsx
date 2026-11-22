'use client'

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import {
  X,
  Play,
  Pause,
  RotateCcw,
  Undo2,
  SkipForward,
  Clock,
  Settings,
  Megaphone,
  RefreshCw,
  CheckSquare,
  Upload,
  Zap,
  FastForward,
  AlertTriangle,
} from 'lucide-react'
import type { DraftUISettings, TimerMode } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { CUSTOM_TIMER_MAX_SECONDS } from '@/lib/draft/draftSettingsPolicy'
import { DEFAULT_TRADE_RULES } from '@/lib/commissioner-ai-draft-manager/types'
import { DraftImportFlow } from './DraftImportFlow'
import { SwapManagerModal } from './SwapManagerModal'
import { TimerPresetSelect } from '@/components/draft/TimerPresetSelect'
import { DRAFT_ROOM } from '@/lib/analytics/eventNames'
import { sendProductAnalyticsBeacon } from '@/lib/analytics/client'
import { draftAiSaveMessage, type ChimmySeasonResult } from '@/lib/commissioner-ai-draft-manager/chimmySeason'

const TIMER_MODE_OPTIONS: Array<{ value: TimerMode; label: string }> = [
  { value: 'per_pick', label: 'Per pick' },
  { value: 'soft_pause', label: 'Soft pause' },
  { value: 'overnight_pause', label: 'Overnight pause' },
  { value: 'none', label: 'No timer' },
]

export type CommissionerControlCenterModalProps = {
  leagueId: string
  draftStatus: string
  draftType?: string
  draftUISettings: DraftUISettings | null
  skipPickAllowed?: boolean
  orphanStatus?: {
    orphanRosterIds: string[]
    recentActions: Array<{ action: string; createdAt: string; reason: string | null; rosterId?: string }>
  } | null
  isOrphanOnClock?: boolean
  orphanDrafterMode?: 'cpu' | 'ai'
  orphanDrafterEffectiveMode?: 'cpu' | 'ai'
  orphanAiProviderAvailable?: boolean
  timerSeconds: number | null
  rounds?: number
  devyConfig?: { enabled: boolean; devyRounds: number[] } | null
  c2cConfig?: { enabled: boolean; collegeRounds: number[] } | null
  poolReadiness?: {
    ready: boolean
    entryCount: number
    source: 'db-cache' | 'memory-cache' | 'cold' | 'missing'
    syncedAt: string | null
  } | null
  startDraftDisabled?: boolean
  onClose: () => void
  onAction: (action: string, payload?: Record<string, unknown>) => Promise<unknown>
  /** League concept (redraft, guillotine, survivor...). Options for other league types are hidden. */
  leagueType?: string | null
  /** One row per seat for the Managers section. */
  seats?: Array<{ slot: number; rosterId: string; displayName: string; status: 'human' | 'auto' | 'chimmy' | 'empty' }>
  /** Opens the room's pick editor on one pick (Fix a pick). */
  onOpenPickEditor?: (overall: number) => void
  teamCount?: number
  /** Who is on the clock right now, for the status line at the top. Optional: the line just leaves it out. */
  onTheClock?: { teamName: string; pickLabel: string } | null
  onSettingsPatch: (patch: Partial<DraftUISettings>) => Promise<void>
  onSaveDevyConfig?: (input: { enabled: boolean; devyRounds: number[] }) => Promise<{ ok?: boolean; error?: string; session?: unknown } | void>
  onSaveC2CConfig?: (input: { enabled: boolean; collegeRounds: number[] }) => Promise<{ ok?: boolean; error?: string; session?: unknown } | void>
  onStartDraft?: () => Promise<{ session?: unknown } | void>
  onRunAiPick?: () => Promise<unknown> | void
  runAiPickLoading?: boolean
  onBroadcast?: () => void
  onOpenDraftRoomSettings?: () => void
  onResync: () => void
  loading?: boolean
  /** Draft-order team names, so the Chimmy manager rows name teams instead of roster ids. */
  teamNameByRosterId?: Record<string, string>
  commissionerAiDraft?: {
    assignedAiTeams: Array<{ teamId: string; teamName: string; aiStyle: string; tradeAggression: string; active: boolean }>
    tradeRules: {
      allowOutbound: boolean
      allowInbound: boolean
      blockAiToAi: boolean
      proposalCooldownSeconds: number
      maxProposalsPerRound: number
      acceptConfidenceMin: number
    }
  } | null
  onSaveCommissionerAiDraft?: (payload: {
    assignedAiTeams: Array<{ teamId: string; aiStyle: string; tradeAggression: string; active: boolean }>
    tradeRules: Record<string, unknown>
  }) => Promise<{ ok?: boolean; error?: string } | void>
}

export function CommissionerControlCenterModal({
  leagueId,
  draftStatus,
  draftType,
  draftUISettings,
  skipPickAllowed = false,
  orphanStatus = null,
  isOrphanOnClock = false,
  orphanDrafterMode = 'cpu',
  orphanDrafterEffectiveMode = orphanDrafterMode,
  orphanAiProviderAvailable = true,
  timerSeconds,
  rounds = 15,
  devyConfig = null,
  c2cConfig = null,
  poolReadiness = null,
  startDraftDisabled = false,
  onClose,
  onAction,
  onSettingsPatch,
  onSaveDevyConfig,
  onSaveC2CConfig,
  onStartDraft,
  onRunAiPick,
  runAiPickLoading = false,
  onBroadcast,
  onOpenDraftRoomSettings,
  onResync,
  loading = false,
  commissionerAiDraft = null,
  onSaveCommissionerAiDraft,
  teamNameByRosterId = {},
  leagueType = null,
  seats = [],
  onOpenPickEditor,
  teamCount = 0,
  onTheClock = null,
}: CommissionerControlCenterModalProps) {
  // The one scroll container, and the section the jump bar highlights.
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [activeSection, setActiveSection] = useState<SectionKey | null>(null)
  // What "Set timer" will send. null = Off (0 seconds); starts from the draft's current timer.
  const [pendingTimerSeconds, setPendingTimerSeconds] = useState<number | null>(timerSeconds && timerSeconds > 0 ? timerSeconds : null)
  // Follow the draft's timer when it changes elsewhere (another commissioner, a settings save).
  useEffect(() => {
    setPendingTimerSeconds(timerSeconds && timerSeconds > 0 ? timerSeconds : null)
  }, [timerSeconds])
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionApiError, setActionApiError] = useState<string | null>(null)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [showImportFlow, setShowImportFlow] = useState(false)
  const [devyEnabledInput, setDevyEnabledInput] = useState(Boolean(devyConfig?.enabled))
  const [devyRoundsInput, setDevyRoundsInput] = useState((devyConfig?.devyRounds ?? []).join(', '))
  const [devySaving, setDevySaving] = useState(false)
  const [devyMessage, setDevyMessage] = useState<string | null>(null)
  const [c2cEnabledInput, setC2CEnabledInput] = useState(Boolean(c2cConfig?.enabled))
  const [c2cRoundsInput, setC2CRoundsInput] = useState((c2cConfig?.collegeRounds ?? []).join(', '))
  const [c2cSaving, setC2CSaving] = useState(false)
  const [c2cMessage, setC2CMessage] = useState<string | null>(null)
  const [aiMgrSaving, setAiMgrSaving] = useState(false)
  const [aiMgrMessage, setAiMgrMessage] = useState<string | null>(null)
  const [aiTradeRules, setAiTradeRules] = useState(() => ({ ...DEFAULT_TRADE_RULES }))
  const [aiRowState, setAiRowState] = useState<
    Record<string, { aiStyle: string; tradeAggression: string; active: boolean }>
  >({})
  const [transitionLoading, setTransitionLoading] = useState(false)
  const [transitionMessage, setTransitionMessage] = useState<string | null>(null)
  // Slice 5 — swap-managers modal state.
  const [showSwapManager, setShowSwapManager] = useState(false)
  // Slice 4 — undo-with-reason prompt state.
  const [undoPromptOpen, setUndoPromptOpen] = useState(false)
  const [undoReason, setUndoReason] = useState('')
  const [undoSubmitting, setUndoSubmitting] = useState(false)
  const [undoError, setUndoError] = useState<string | null>(null)
  // Phase 4 (2026-11-19): Fix a pick, Penalties and Reset.
  const [fixRound, setFixRound] = useState(1)
  const [fixPick, setFixPick] = useState(1)
  const [forfeitRosterId, setForfeitRosterId] = useState('')
  const [forfeitRound, setForfeitRound] = useState(1)
  const [forfeitReason, setForfeitReason] = useState('')
  const [forfeitMessage, setForfeitMessage] = useState<string | null>(null)
  const [resetText, setResetText] = useState('')

  useEffect(() => {
    if (commissionerAiDraft?.tradeRules) {
      setAiTradeRules({ ...DEFAULT_TRADE_RULES, ...commissionerAiDraft.tradeRules })
    } else {
      setAiTradeRules({ ...DEFAULT_TRADE_RULES })
    }
    const next: Record<string, { aiStyle: string; tradeAggression: string; active: boolean }> = {}
    for (const rid of (orphanStatus?.orphanRosterIds ?? []).slice(0, 4)) {
      const ex = commissionerAiDraft?.assignedAiTeams?.find((t) => t.teamId === rid)
      next[rid] = {
        aiStyle: ex?.aiStyle ?? 'BALANCED',
        tradeAggression: ex?.tradeAggression ?? 'medium',
        // Chimmy is opt-in per team: a team only gets an AI manager when the commissioner ticks it.
        // (This defaulted to true, so saving the panel for any reason assigned every orphan.)
        active: ex?.active ?? false,
      }
    }
    setAiRowState(next)
  }, [commissionerAiDraft, orphanStatus?.orphanRosterIds])

  const ui = draftUISettings ?? ({} as Partial<DraftUISettings>)
  const isPreDraft = draftStatus === 'pre_draft'
  const isInProgress = draftStatus === 'in_progress'
  const isPaused = draftStatus === 'paused'
  const isAuctionDraft = String(draftType ?? '').toLowerCase() === 'auction'
  /** After the draft nothing changes: it is on the record. */
  const isFinal = draftStatus === 'completed'
  const concept = String(leagueType ?? '').toLowerCase()
  /* League-type options show only in that league type (a redraft league saw Guillotine and Survivor video toggles). */
  const showGuillotineOptions = concept.includes('guillotine')
  const showSurvivorOptions = concept.includes('survivor')
  /*
   * ⚠ PRESENCE, NOT ENABLED-NESS. These previously read
   * `enabled || rounds.length > 0`, which meant the section holding the ENABLE toggle
   * only rendered once the feature was already enabled — so a commissioner who turned
   * devy or C2C off could never turn it back on. The pool API now reports a stored
   * config whichever way it is set (getResolvedDraftPoolForLeague.ts), so the object's
   * presence is what says "this league has the concept" and `enabled` says whether it
   * is currently on. A league with neither still sends no object and stays hidden.
   */
  const hasDevyDraftConfig = devyConfig != null
  const hasC2CDraftConfig = c2cConfig != null
  const pauseControlsEnabled = ui.commissionerPauseControlsEnabled ?? true
  const poolReadinessLabel = poolReadiness?.ready
    ? `Draft pool ready: ${poolReadiness.entryCount} players`
    : 'Preparing NFL draft pool...'
  const startDraftBlocked = startDraftDisabled || (isPreDraft && poolReadiness?.ready === false)
  const requestedOrphanMode = ui.orphanDrafterMode ?? orphanDrafterMode ?? 'cpu'
  const effectiveOrphanMode =
    requestedOrphanMode === (orphanDrafterMode ?? 'cpu')
      ? (orphanDrafterEffectiveMode ?? (requestedOrphanMode === 'ai' && !orphanAiProviderAvailable ? 'cpu' : requestedOrphanMode))
      : (requestedOrphanMode === 'ai' && !orphanAiProviderAvailable ? 'cpu' : requestedOrphanMode)
  const orphanModeFallbackActive = requestedOrphanMode === 'ai' && effectiveOrphanMode === 'cpu'
  const runOrphanPickLabel = requestedOrphanMode === 'ai'
    ? orphanModeFallbackActive
      ? 'Run Chimmy pick now (CPU fallback)'
      : 'Run Chimmy pick now'
    : 'Run CPU pick now'

  useEffect(() => {
    setDevyEnabledInput(Boolean(devyConfig?.enabled))
    setDevyRoundsInput((devyConfig?.devyRounds ?? []).join(', '))
  }, [devyConfig?.enabled, devyConfig?.devyRounds])

  useEffect(() => {
    setC2CEnabledInput(Boolean(c2cConfig?.enabled))
    setC2CRoundsInput((c2cConfig?.collegeRounds ?? []).join(', '))
  }, [c2cConfig?.enabled, c2cConfig?.collegeRounds])

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setActionLoading(key)
    setActionApiError(null)
    try {
      const result = (await fn()) as { ok?: boolean; error?: string; cancelled?: boolean } | void
      if (result && typeof result === 'object') {
        if ('cancelled' in result && result.cancelled) return
        if (result.ok === false && typeof result.error === 'string') setActionApiError(result.error)
      }
    } finally {
      setActionLoading(null)
    }
  }

  const handleRefreshAdp = async () => {
    await run('refresh_adp', async () => {
      try {
        const res = await fetch(`/api/leagues/${leagueId}/draft/refresh-adp`, {
          method: 'POST',
          cache: 'no-store',
        })
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          error?: string
          adpEntriesFetched?: number
        }
        if (!res.ok || !data.ok) {
          return { ok: false, error: data.error ?? `Refresh failed (${res.status})` }
        }
        setActionApiError(
          data.adpEntriesFetched && data.adpEntriesFetched > 0
            ? `ADP refreshed (${data.adpEntriesFetched} players). Reload the pool to see updated values.`
            : 'ADP cache cleared, but no entries were returned. Check the FantasyFootballCalculator API or analytics import.',
        )
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Network error' }
      }
    })
  }

  const handleSetTimer = () => {
    // The preset select hands back null for "Off"; the engine stores Off as 0 seconds.
    const sec = Math.max(0, Math.min(CUSTOM_TIMER_MAX_SECONDS, pendingTimerSeconds ?? 0))
    run('set_timer', () => onAction('set_timer_seconds', { seconds: sec, resetCurrentTimer: true }))
  }

  const handleTransitionToDrafting = async () => {
    setTransitionLoading(true)
    setTransitionMessage(null)
    try {
      const response = await fetch(`/api/leagues/${leagueId}/draft/transition-to-drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const result = await response.json()
      if (response.ok) {
        setTransitionMessage('✓ League transitioned to drafting state. Refresh to see changes.')
        setTimeout(() => onResync(), 2000)
      } else {
        setActionApiError(result.error || 'Failed to transition league')
      }
    } catch (err) {
      setActionApiError((err as Error).message || 'Failed to transition league')
    } finally {
      setTransitionLoading(false)
    }
  }

  const handleToggle = async (key: keyof DraftUISettings, value: boolean) => {
    setSettingsSaving(true)
    try {
      await onSettingsPatch({ [key]: value })
      if (key === 'autoPickEnabled') {
        sendProductAnalyticsBeacon(DRAFT_ROOM.COMMISSIONER_AUTOPICK_LEAGUE, { leagueId, enabled: value })
      } else if (key === 'commissionerForceAutoPickEnabled') {
        sendProductAnalyticsBeacon(DRAFT_ROOM.COMMISSIONER_FORCE_AUTOPICK, { leagueId, enabled: value })
      }
    } finally {
      setSettingsSaving(false)
    }
  }

  const handleTimerModeChange = async (value: TimerMode) => {
    setSettingsSaving(true)
    try {
      await onSettingsPatch({ timerMode: value })
    } finally {
      setSettingsSaving(false)
    }
  }

  const handleOrphanModeChange = async (value: 'cpu' | 'ai') => {
    setSettingsSaving(true)
    try {
      await onSettingsPatch({ orphanDrafterMode: value })
    } finally {
      setSettingsSaving(false)
    }
  }

  const parseDevyRounds = (value: string): number[] => {
    return parseRoundInput(value, rounds)
  }

  const parseC2CRounds = (value: string): number[] => {
    return parseRoundInput(value, rounds)
  }

  const parseRoundInput = (value: string, maxRounds: number): number[] => {
    const tokens = value
      .split(/[,\s]+/)
      .map((token) => token.trim())
      .filter(Boolean)
    const parsed = tokens
      .map((token) => Number.parseInt(token, 10))
      .filter((round) => Number.isFinite(round) && round >= 1 && round <= maxRounds)
    return Array.from(new Set(parsed)).sort((a, b) => a - b)
  }

  const handleSaveDevyConfig = async () => {
    if (!onSaveDevyConfig) return
    setDevySaving(true)
    setDevyMessage(null)
    try {
      const nextRounds = parseDevyRounds(devyRoundsInput)
      const result = await onSaveDevyConfig({ enabled: devyEnabledInput, devyRounds: nextRounds })
      if (result && typeof result === 'object' && typeof (result as { error?: string }).error === 'string') {
        setDevyMessage((result as { error?: string }).error ?? 'Failed to save devy config.')
        return
      }
      setDevyRoundsInput(nextRounds.join(', '))
      setDevyMessage(`Devy config saved (${nextRounds.length} round${nextRounds.length === 1 ? '' : 's'}).`)
    } catch {
      setDevyMessage('Failed to save devy config.')
    } finally {
      setDevySaving(false)
    }
  }

  const handleSaveC2CConfig = async () => {
    if (!onSaveC2CConfig) return
    setC2CSaving(true)
    setC2CMessage(null)
    try {
      const nextRounds = parseC2CRounds(c2cRoundsInput)
      const result = await onSaveC2CConfig({ enabled: c2cEnabledInput, collegeRounds: nextRounds })
      if (result && typeof result === 'object' && typeof (result as { error?: string }).error === 'string') {
        setC2CMessage((result as { error?: string }).error ?? 'Failed to save C2C config.')
        return
      }
      setC2CRoundsInput(nextRounds.join(', '))
      setC2CMessage(`C2C config saved (${nextRounds.length} college round${nextRounds.length === 1 ? '' : 's'}).`)
    } catch {
      setC2CMessage('Failed to save C2C config.')
    } finally {
      setC2CSaving(false)
    }
  }

  // ── What the panel says, worked out once ────────────────────────────────────────────────
  const isLiveOrPaused = isInProgress || isPaused
  const busy = loading || actionLoading !== null
  const forceAutoPickOn = ui.commissionerForceAutoPickEnabled ?? false
  const statusLabel = isFinal
    ? 'Final'
    : isInProgress
      ? 'Live'
      : isPaused
        ? 'Paused'
        : isPreDraft
          ? 'Not started'
          : String(draftStatus || 'Unknown').replace(/_/g, ' ')
  const statusPillClass = isFinal
    ? 'border-white/20 bg-white/10 text-white/80'
    : isInProgress
      ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100'
      : isPaused
        ? 'border-amber-400/40 bg-amber-500/15 text-amber-100'
        : 'border-cyan-300/35 bg-cyan-500/12 text-cyan-100'
  const statusHint = isPaused
    ? 'Every clock is stopped. Live actions happen now. Rules save as you change them.'
    : isPreDraft
      ? 'Start the draft when everyone is ready. Rules save as you change them.'
      : 'Live actions happen now. Rules save as you change them.'
  const pauseOffReason = pauseControlsEnabled ? undefined : 'Pause controls are off in automation settings.'
  const showFixCard = !isFinal && !isAuctionDraft && (Boolean(onOpenPickEditor) || seats.length > 0)
  const showFinish = !isFinal && (isInProgress || isPaused || isPreDraft)
  const orphanCount = orphanStatus?.orphanRosterIds?.length ?? 0
  const orphanManagerOn = ui.orphanTeamAiManagerEnabled ?? false
  const orphanTeamsPhrase = `${orphanCount} ${orphanCount === 1 ? 'team has' : 'teams have'} no manager.`
  const orphanSummary =
    orphanCount === 0
      ? orphanManagerOn
        ? 'Every team has a manager. If a team loses its manager, it will draft on its own.'
        : 'Every team has a manager.'
      : orphanManagerOn
        ? `${orphanTeamsPhrase} ${effectiveOrphanMode === 'ai' ? 'Chimmy drafts for them' : 'They pick by the rankings'} when they come on the clock.`
        : `${orphanTeamsPhrase} Chimmy is not drafting for them — turn on “Chimmy runs empty teams” below, or ${
            ui.autoPickEnabled ? 'they auto-pick when their clock runs out.' : 'their picks wait or are skipped when their clock runs out, per league rules.'
          }`

  const jumpTargets: Array<{ key: SectionKey; label: string }> = [
    ...(!isFinal ? [{ key: 'live' as const, label: 'Live' }] : []),
    ...(showFixCard ? [{ key: 'fix' as const, label: 'Fix picks' }] : []),
    { key: 'rules', label: 'Rules' },
    { key: 'teams', label: 'Teams & Chimmy' },
    ...(showFinish ? [{ key: 'finish' as const, label: 'Finish' }] : []),
    { key: 'tools', label: 'Tools' },
  ]

  const jumpTo = (key: SectionKey) => {
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-cc-section="${key}"]`)
    setActiveSection(key)
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleBodyScroll = () => {
    const body = bodyRef.current
    if (!body) return
    const top = body.getBoundingClientRect().top
    let current: SectionKey | null = null
    body.querySelectorAll<HTMLElement>('[data-cc-section]').forEach((el) => {
      if (el.getBoundingClientRect().top - top <= 32) current = el.dataset.ccSection as SectionKey
    })
    // At the very bottom the last section may never reach the top; call it current.
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) {
      const all = body.querySelectorAll<HTMLElement>('[data-cc-section]')
      const last = all[all.length - 1]
      if (last) current = last.dataset.ccSection as SectionKey
    }
    setActiveSection((prev) => (prev === current ? prev : current))
  }

  const selectClass =
    'min-h-[44px] w-full rounded-lg border border-white/15 bg-[#0d1526] px-3 text-sm text-white disabled:opacity-50'
  const inputClass =
    'min-h-[44px] w-full rounded-lg border border-white/15 bg-[#0d1526] px-3 text-sm text-white placeholder:text-white/35 disabled:opacity-50'

  return (
    <div className="flex max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-xl border border-white/12 bg-[#070f21] shadow-2xl sm:max-h-[90vh]" data-testid="draft-commissioner-modal">
      {/* Header: what is happening, in one line. */}
      <div className="shrink-0 border-b border-white/8 px-4 pb-3 pt-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Settings className="h-5 w-5 shrink-0 text-cyan-400" />
            <h2 className="text-base font-semibold leading-tight text-white">Commissioner controls</h2>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                onOpenDraftRoomSettings?.()
                onClose()
              }}
              data-testid="draft-commissioner-open-draft-settings"
              disabled={!onOpenDraftRoomSettings}
              className="min-h-[44px] rounded-lg border border-white/15 px-3 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              <span className="sm:hidden">Settings</span>
              <span className="hidden sm:inline">Draft settings</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              data-testid="draft-commissioner-close"
              className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="draft-commissioner-status">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${statusPillClass}`}>
            {isInProgress ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" aria-hidden /> : null}
            {statusLabel}
          </span>
          {isLiveOrPaused && onTheClock ? (
            <span className="min-w-0 text-[13px] text-white/85">
              <span className="font-semibold text-white">{onTheClock.teamName}</span> is on the clock
              <span className="text-white/40"> · </span>
              Pick <span className="tabular-nums">{onTheClock.pickLabel}</span>
            </span>
          ) : null}
        </div>
        {isFinal ? (
          <p className="mt-1.5 text-[12px] leading-snug text-white/65" data-testid="draft-commissioner-final">
            This draft is final — it&apos;s on the record. Settings below are shown for reference.
          </p>
        ) : (
          <p className="mt-1.5 text-[12px] leading-snug text-white/55">{statusHint}</p>
        )}
      </div>

      {/* Jump bar: every section stays on the page; these only scroll to it. */}
      <nav
        aria-label="Jump to section"
        className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-white/8 bg-[#081329] px-4 py-2 [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden"
        data-testid="draft-commissioner-jump-bar"
      >
        {jumpTargets.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => jumpTo(t.key)}
            data-testid={`draft-commissioner-jump-${t.key}`}
            aria-current={activeSection === t.key ? 'true' : undefined}
            className={`min-h-[44px] shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition-colors sm:min-h-[36px] ${
              activeSection === t.key
                ? 'border-cyan-300/50 bg-cyan-500/20 text-cyan-50'
                : 'border-white/12 bg-white/[0.03] text-white/70 hover:bg-white/10 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {actionApiError || transitionMessage ? (
        <div className="shrink-0 space-y-2 border-b border-white/8 px-4 py-2">
          {actionApiError ? (
            <div
              role="alert"
              data-testid="draft-commissioner-action-error"
              className="flex items-start justify-between gap-2 rounded-lg border border-rose-400/35 bg-rose-500/12 px-3 py-2 text-[12px] text-rose-50"
            >
              <span>{actionApiError}</span>
              <button
                type="button"
                onClick={() => setActionApiError(null)}
                className="-my-1 inline-flex min-h-[32px] min-w-[32px] shrink-0 items-center justify-center rounded text-rose-200 hover:bg-rose-500/25"
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          ) : null}
          {transitionMessage ? (
            <div className="flex items-start justify-between gap-2 rounded-lg border border-emerald-400/35 bg-emerald-500/12 px-3 py-2 text-[12px] text-emerald-50">
              <span>{transitionMessage}</span>
              <button
                type="button"
                onClick={() => setTransitionMessage(null)}
                className="-my-1 inline-flex min-h-[32px] min-w-[32px] shrink-0 items-center justify-center rounded text-emerald-200 hover:bg-emerald-500/25"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {showSwapManager ? (
        <SwapManagerModal
          leagueId={leagueId}
          onAction={onAction}
          onClose={() => setShowSwapManager(false)}
        />
      ) : null}
      {undoPromptOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Undo last pick"
          data-testid="draft-commissioner-undo-prompt"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/12 bg-[#070f21] p-5 shadow-2xl">
            <h3 className="mb-1 text-base font-semibold text-white">Undo last pick</h3>
            <p className="mb-3 text-xs text-white/60">
              A reason is required and will be stored in the commissioner-only audit log.
            </p>
            <label className="block text-xs font-medium text-white/70" htmlFor="draft-commissioner-undo-reason">
              Reason
            </label>
            <textarea
              id="draft-commissioner-undo-reason"
              data-testid="draft-commissioner-undo-reason"
              value={undoReason}
              onChange={(e) => setUndoReason(e.target.value.slice(0, 500))}
              maxLength={500}
              rows={3}
              placeholder="e.g. wrong player picked by accident; pre-arranged correction"
              className="mt-1 w-full rounded-md border border-white/15 bg-black/30 p-2 text-sm text-white placeholder:text-white/30"
            />
            <div className="mt-1 flex items-center justify-between text-[11px] text-white/40">
              <span>{undoReason.length}/500</span>
              {undoError ? <span className="text-rose-300" role="alert">{undoError}</span> : null}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setUndoPromptOpen(false)}
                disabled={undoSubmitting}
                data-testid="draft-commissioner-undo-cancel"
                className="min-h-[44px] rounded-lg border border-white/15 px-4 text-sm text-white/80 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={undoSubmitting || undoReason.trim().length === 0}
                data-testid="draft-commissioner-undo-confirm"
                onClick={async () => {
                  const trimmed = undoReason.trim()
                  if (!trimmed) {
                    setUndoError('Reason is required.')
                    return
                  }
                  setUndoSubmitting(true)
                  setUndoError(null)
                  try {
                    const result = (await onAction('undo_pick', { reason: trimmed })) as
                      | { ok?: boolean; error?: string; code?: string }
                      | undefined
                    if (result && result.ok === false) {
                      setUndoError(result.error ?? 'Undo failed')
                      return
                    }
                    setUndoPromptOpen(false)
                  } catch (err) {
                    setUndoError(err instanceof Error ? err.message : 'Undo failed')
                  } finally {
                    setUndoSubmitting(false)
                  }
                }}
                className="min-h-[44px] rounded-lg bg-rose-600 px-4 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50"
              >
                {undoSubmitting ? 'Undoing…' : 'Confirm undo'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* The only scroll container. */}
      <div
        ref={bodyRef}
        onScroll={handleBodyScroll}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3 sm:p-4"
        data-testid="draft-commissioner-body"
      >
        {/* ── Live ─────────────────────────────────────────────────────────────── */}
        <PanelSection
          sectionKey="live"
          title="Live"
          purpose="These take effect the moment you press them."
          className={isFinal ? 'hidden' : undefined}
        >
          {isPreDraft && poolReadiness ? (
            <div
              className={`rounded-lg border px-3 py-2 text-[12px] ${
                poolReadiness.ready
                  ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-100'
                  : 'border-amber-400/35 bg-amber-500/10 text-amber-100'
              }`}
              data-testid="draft-commissioner-pool-readiness"
            >
              {poolReadinessLabel}
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="draft-commissioner-live-help">
            {isPreDraft && onStartDraft && (
              <ActionButton
                testId="draft-commissioner-start"
                icon={Play}
                tone="emerald"
                label="Start draft"
                caption="Opens the draft and puts pick 1 on the clock."
                reason={startDraftBlocked ? poolReadinessLabel : undefined}
                onClick={() => run('start', onStartDraft)}
                disabled={busy || startDraftBlocked}
                title={startDraftBlocked ? poolReadinessLabel : 'Start draft'}
              />
            )}
            {isInProgress && (
              <ActionButton
                testId="draft-commissioner-pause"
                icon={Pause}
                tone="amber"
                label="Pause"
                caption="Stops every clock until you start it again."
                reason={pauseOffReason}
                onClick={() => run('pause', () => onAction('pause'))}
                disabled={busy || !pauseControlsEnabled}
                title={pauseControlsEnabled ? 'Pause draft' : 'Pause controls are disabled in automation settings'}
              />
            )}
            {isPaused && (
              <ActionButton
                testId="draft-commissioner-resume"
                icon={Play}
                tone="emerald"
                label="Resume"
                caption="Starts every clock again where it stopped."
                reason={pauseOffReason}
                onClick={() => run('resume', () => onAction('resume'))}
                disabled={busy || !pauseControlsEnabled}
                title={pauseControlsEnabled ? 'Resume draft' : 'Pause controls are disabled in automation settings'}
              />
            )}
            {isLiveOrPaused && (
              <>
                <ActionButton
                  testId="draft-commissioner-reset-timer"
                  icon={RotateCcw}
                  label="Reset timer"
                  caption="Gives the team on the clock a full clock."
                  reason={pauseOffReason}
                  onClick={() => run('reset_timer', () => onAction('reset_timer'))}
                  disabled={busy || !pauseControlsEnabled}
                  title={pauseControlsEnabled ? 'Reset timer' : 'Pause controls are disabled in automation settings'}
                />
                <ActionButton
                  testId="draft-commissioner-undo"
                  icon={Undo2}
                  tone="rose"
                  label="Undo last pick"
                  caption="Takes it back: puts that player back in the pool and that team back on the clock."
                  onClick={() => {
                    setUndoReason('')
                    setUndoError(null)
                    setUndoPromptOpen(true)
                  }}
                  disabled={busy}
                />
                <ActionButton
                  testId="draft-commissioner-skip"
                  icon={SkipForward}
                  label="Skip pick"
                  caption="Moves on with no player for the team on the clock."
                  reason={skipPickAllowed ? undefined : "Skip pick is off in this league's rules."}
                  onClick={() => run('skip_pick', () => onAction('skip_pick'))}
                  disabled={busy || !skipPickAllowed}
                  title={
                    skipPickAllowed
                      ? 'Advance draft without a player (skipped pick)'
                      : 'Skip pick requires league auto-pick behavior set to skip'
                  }
                />
                <ActionButton
                  testId="draft-commissioner-force-autopick-now"
                  icon={FastForward}
                  tone="cyan"
                  label="Force auto-pick now"
                  caption="Picks for the team on the clock right now (their queue first)."
                  reason={forceAutoPickOn ? undefined : 'Turn on “Commissioner force auto-pick” under Rules first.'}
                  onClick={() => run('force_autopick', () => onAction('force_autopick'))}
                  disabled={busy || !forceAutoPickOn}
                  title={
                    forceAutoPickOn
                      ? 'Force deterministic auto-pick for the current on-clock roster'
                      : 'Enable "Commissioner force auto-pick" in Draft settings first'
                  }
                />
                {isAuctionDraft && (
                  <>
                    <ActionButton
                      testId="draft-commissioner-resolve-auction"
                      icon={CheckSquare}
                      tone="emerald"
                      label="Resolve auction now"
                      caption="Settles the player up for bid right now."
                      onClick={() => run('resolve_auction', () => onAction('resolve_auction'))}
                      disabled={busy}
                    />
                    <ActionButton
                      testId="draft-commissioner-auction-tick"
                      icon={RefreshCw}
                      tone="cyan"
                      label="Run auction automation"
                      caption="Runs the auction's automatic steps once, by hand."
                      onClick={() => run('auction_tick', () => onAction('auction_tick'))}
                      disabled={busy}
                    />
                  </>
                )}
              </>
            )}
          </div>

          {isLiveOrPaused && (
            <div className="space-y-2 border-t border-white/8 pt-3">
              <SubHeading>Pick clock</SubHeading>
              <p className="text-[12px] leading-snug text-white/55">
                Change how long each pick gets. Setting it restarts the clock for the team on the clock.
              </p>
              {/* Sleeper-style presets + Off + "Set amount" (components/draft/TimerPresetSelect.tsx). */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start" data-testid="timer-preset-select-active">
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <Clock className="mt-3 h-4 w-4 shrink-0 text-white/45" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <TimerPresetSelect
                      seconds={pendingTimerSeconds}
                      onChange={setPendingTimerSeconds}
                      disabled={busy || !pauseControlsEnabled}
                      testIdPrefix="draft-commissioner-timer"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSetTimer}
                  disabled={busy || !pauseControlsEnabled}
                  data-testid="draft-commissioner-set-timer"
                  className="min-h-[44px] shrink-0 rounded-lg border border-cyan-300/35 bg-cyan-500/15 px-4 text-sm font-medium text-cyan-50 hover:bg-cyan-500/25 disabled:opacity-50"
                  title={pauseControlsEnabled ? 'Set timer' : 'Pause controls are disabled in automation settings'}
                >
                  Set timer
                </button>
              </div>
              {pauseOffReason ? <p className="text-[12px] text-amber-200/90">{pauseOffReason}</p> : null}
            </div>
          )}
        </PanelSection>

        {/* ── Fix picks ────────────────────────────────────────────────────────── */}
        {showFixCard ? (
          <PanelSection sectionKey="fix" title="Fix picks" purpose="Correct a pick that went wrong, or take a pick away as a penalty.">
            {onOpenPickEditor ? (
              <div className="space-y-2" data-testid="draft-commissioner-fix-pick">
                <SubHeading>Fix a pick</SubHeading>
                <p className="text-[12px] leading-snug text-white/55">
                  Choose a pick, then remove the player so that team picks again, replace him, fill an empty pick, or
                  move the pick to another team. The draft pauses while you edit. You can also click any pick on the board.
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[7rem_7rem_1fr] sm:items-end">
                  <FieldLabel label="Round">
                    <select
                      value={fixRound}
                      onChange={(e) => setFixRound(Number(e.target.value))}
                      data-testid="draft-commissioner-fix-round"
                      className={selectClass}
                    >
                      {Array.from({ length: Math.max(1, rounds) }, (_, i) => i + 1).map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </FieldLabel>
                  <FieldLabel label="Pick">
                    <select
                      value={fixPick}
                      onChange={(e) => setFixPick(Number(e.target.value))}
                      data-testid="draft-commissioner-fix-pick-number"
                      className={selectClass}
                    >
                      {Array.from({ length: Math.max(1, teamCount) }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </FieldLabel>
                  <button
                    type="button"
                    onClick={() => onOpenPickEditor((fixRound - 1) * Math.max(1, teamCount) + fixPick)}
                    data-testid="draft-commissioner-open-pick-editor"
                    className="col-span-2 min-h-[44px] rounded-lg border border-amber-300/40 bg-amber-500/15 px-4 text-sm font-medium text-amber-50 hover:bg-amber-500/25 sm:col-span-1 sm:justify-self-start"
                  >
                    Edit pick {fixRound}.{String(fixPick).padStart(2, '0')}
                  </button>
                </div>
              </div>
            ) : null}

            {seats.length > 0 ? (
              <div className={`space-y-2 ${onOpenPickEditor ? 'border-t border-white/8 pt-3' : ''}`} data-testid="draft-commissioner-penalties">
                <SubHeading>Forfeit a pick</SubHeading>
                <p className="text-[12px] leading-snug text-white/55">
                  That team&apos;s pick in the round you choose is skipped when the draft reaches it and shows as
                  &quot;Forfeited&quot; on the board. It can&apos;t be a pick already made.
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_7rem]">
                  <FieldLabel label="Team">
                    <select
                      value={forfeitRosterId}
                      onChange={(e) => setForfeitRosterId(e.target.value)}
                      data-testid="draft-commissioner-forfeit-team"
                      aria-label="Team"
                      className={selectClass}
                    >
                      <option value="">Choose team…</option>
                      {seats.map((seat) => (
                        <option key={seat.rosterId} value={seat.rosterId}>{seat.displayName}</option>
                      ))}
                    </select>
                  </FieldLabel>
                  <FieldLabel label="Round">
                    <select
                      value={forfeitRound}
                      onChange={(e) => setForfeitRound(Number(e.target.value))}
                      data-testid="draft-commissioner-forfeit-round"
                      className={selectClass}
                    >
                      {Array.from({ length: Math.max(1, rounds) }, (_, i) => i + 1).map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </FieldLabel>
                  <FieldLabel label="Reason (shown in the log)" className="sm:col-span-2">
                    <input
                      value={forfeitReason}
                      onChange={(e) => setForfeitReason(e.target.value.slice(0, 100))}
                      placeholder="e.g. late dues"
                      data-testid="draft-commissioner-forfeit-reason"
                      className={inputClass}
                    />
                  </FieldLabel>
                </div>
                <button
                  type="button"
                  disabled={!forfeitRosterId || actionLoading !== null || loading}
                  onClick={() =>
                    run('forfeit_pick', async () => {
                      setForfeitMessage(null)
                      const result = (await onAction('forfeit_pick', {
                        rosterId: forfeitRosterId,
                        round: forfeitRound,
                        reason: forfeitReason,
                      })) as { ok?: boolean; error?: string } | undefined
                      if (result && result.ok === false) return result
                      const team = seats.find((x) => x.rosterId === forfeitRosterId)?.displayName ?? 'That team'
                      setForfeitMessage(`${team}'s round ${forfeitRound} pick is forfeited.`)
                      setForfeitReason('')
                      return result
                    })
                  }
                  data-testid="draft-commissioner-forfeit-submit"
                  className="min-h-[44px] w-full rounded-lg border border-rose-400/40 bg-rose-500/15 px-4 text-sm font-medium text-rose-50 hover:bg-rose-500/25 disabled:opacity-50 sm:w-auto"
                >
                  {forfeitRosterId ? `Forfeit round ${forfeitRound} pick` : 'Forfeit pick'}
                </button>
                {forfeitMessage ? (
                  <p className="text-[12px] text-emerald-200" role="status" data-testid="draft-commissioner-forfeit-message">{forfeitMessage}</p>
                ) : null}
              </div>
            ) : null}
          </PanelSection>
        ) : null}

        {/* ── Rules ────────────────────────────────────────────────────────────── */}
        <PanelSection sectionKey="rules" title="Rules" purpose="How the draft behaves. Each change saves as soon as you make it.">
          <fieldset disabled={isFinal} className="min-w-0 space-y-4">
            <RuleGroup title="Board display">
              <SwitchRow
                label="Traded pick color"
                helper="Colour a traded pick by the team that now owns it."
                checked={ui.tradedPickColorModeEnabled ?? true}
                disabled={settingsSaving}
                testId="draft-commissioner-toggle-traded-color"
                onToggle={() => handleToggle('tradedPickColorModeEnabled', !(ui.tradedPickColorModeEnabled ?? true))}
              />
              <SwitchRow
                label="Traded pick owner name in red"
                helper="Show the new owner's name in red on a traded pick."
                checked={ui.tradedPickOwnerNameRedEnabled ?? true}
                disabled={settingsSaving}
                testId="draft-commissioner-toggle-traded-owner-red"
                onToggle={() => handleToggle('tradedPickOwnerNameRedEnabled', !(ui.tradedPickOwnerNameRedEnabled ?? true))}
              />
              <SwitchRow
                label="Chimmy ADP"
                helper="Show Chimmy's ADP beside market ADP in the player pool."
                checked={ui.aiAdpEnabled ?? true}
                disabled={settingsSaving}
                testId="draft-commissioner-toggle-ai-adp"
                onToggle={() => handleToggle('aiAdpEnabled', !(ui.aiAdpEnabled ?? true))}
              />
            </RuleGroup>

            <RuleGroup title="Clock & auto-pick">
              <SwitchRow
                label="Auto-pick enabled"
                helper="When a clock runs out, pick for that team (their queue first). Off: the pick waits or is skipped, per league rules."
                checked={ui.autoPickEnabled ?? false}
                disabled={settingsSaving}
                testId="draft-commissioner-toggle-auto-pick-enabled"
                onToggle={() => handleToggle('autoPickEnabled', !(ui.autoPickEnabled ?? false))}
              />
              <ControlRow
                label="Timer mode"
                helper="Per pick: every pick has a clock. Soft or overnight pause: the clock stops overnight. No timer: picks wait."
              >
                <select
                  value={ui.timerMode ?? 'per_pick'}
                  disabled={settingsSaving}
                  data-testid="draft-commissioner-select-timer-mode"
                  onChange={(event) => handleTimerModeChange(event.target.value as TimerMode)}
                  className={`${selectClass} sm:w-44`}
                >
                  {TIMER_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </ControlRow>
              <SwitchRow
                label="Commissioner force auto-pick"
                helper="Allows the “Force auto-pick now” button under Live."
                checked={forceAutoPickOn}
                disabled={settingsSaving}
                testId="draft-commissioner-toggle-force-autopick"
                onToggle={() => handleToggle('commissionerForceAutoPickEnabled', !(ui.commissionerForceAutoPickEnabled ?? false))}
              />
              {isAuctionDraft && (
                <SwitchRow
                  label="Auction auto nomination"
                  helper="Nominate for a team whose nomination clock runs out."
                  checked={ui.auctionAutoNominationEnabled ?? true}
                  disabled={settingsSaving}
                  testId="draft-commissioner-toggle-auction-auto-nomination"
                  onToggle={() => handleToggle('auctionAutoNominationEnabled', !(ui.auctionAutoNominationEnabled ?? true))}
                />
              )}
            </RuleGroup>

            <RuleGroup title="Chimmy">
              <SwitchRow
                label="Chimmy queue reorder"
                helper="Let Chimmy reorder a manager's queue when they ask."
                checked={ui.aiQueueReorderEnabled ?? true}
                disabled={settingsSaving}
                testId="draft-commissioner-toggle-ai-queue-reorder"
                onToggle={() => handleToggle('aiQueueReorderEnabled', !(ui.aiQueueReorderEnabled ?? true))}
              />
            </RuleGroup>

            <RuleGroup title="Chat">
              <SwitchRow
                label="Live draft ↔ league chat sync"
                helper="Draft chat and league chat become one conversation."
                checked={ui.liveDraftChatSyncEnabled ?? false}
                disabled={settingsSaving}
                testId="draft-commissioner-toggle-chat-sync"
                onToggle={() => handleToggle('liveDraftChatSyncEnabled', !(ui.liveDraftChatSyncEnabled ?? false))}
              />
            </RuleGroup>

            <RuleGroup title="Import">
              <SwitchRow
                label="Draft import enabled"
                helper="Allows importing the draft order and picks from a file (under Tools)."
                checked={ui.importEnabled ?? true}
                disabled={settingsSaving}
                testId="draft-commissioner-toggle-import-enabled"
                onToggle={() => handleToggle('importEnabled', !(ui.importEnabled ?? true))}
              />
            </RuleGroup>

            {showGuillotineOptions || showSurvivorOptions ? (
              <RuleGroup title="League event videos">
                {showGuillotineOptions ? (
                  <SwitchRow
                    label="Guilly elimination auto-video"
                    helper="Make a video automatically when a team is eliminated."
                    checked={ui.guillotineAutoHeyGenEnabled ?? true}
                    disabled={settingsSaving}
                    testId="draft-commissioner-toggle-guillotine-auto-heygen"
                    onToggle={() => handleToggle('guillotineAutoHeyGenEnabled', !(ui.guillotineAutoHeyGenEnabled ?? true))}
                  />
                ) : null}
                {showSurvivorOptions ? (
                  <SwitchRow
                    label="Survivor winner reveal auto-video"
                    helper="Make a video automatically to reveal the Survivor winner."
                    checked={ui.survivorFinaleAutoHeyGenEnabled ?? true}
                    disabled={settingsSaving}
                    testId="draft-commissioner-toggle-survivor-auto-heygen"
                    onToggle={() => handleToggle('survivorFinaleAutoHeyGenEnabled', !(ui.survivorFinaleAutoHeyGenEnabled ?? true))}
                  />
                ) : null}
              </RuleGroup>
            ) : null}
          </fieldset>
        </PanelSection>

        {/* ── Devy rounds (devy leagues only) ──────────────────────────────────── */}
        {hasDevyDraftConfig ? (
          <PanelSection title="Devy rounds" purpose="Choose which rounds draft college (devy) players. Locked once the draft starts.">
            <div className="divide-y divide-white/6 rounded-lg border border-white/10 bg-black/20">
              <SwitchRow
                label="Enable devy draft rounds"
                checked={devyEnabledInput}
                disabled={devySaving || !isPreDraft}
                testId="draft-commissioner-toggle-devy-enabled"
                tone="violet"
                onToggle={() => setDevyEnabledInput((prev) => !prev)}
              />
              <ControlRow label="Devy rounds" helper={isPreDraft ? `Comma-separated, 1-${rounds}. Duplicates and invalid rounds are dropped.` : 'Devy config is locked after draft start.'}>
                <input
                  type="text"
                  value={devyRoundsInput}
                  onChange={(event) => setDevyRoundsInput(event.target.value)}
                  disabled={devySaving || !isPreDraft}
                  data-testid="draft-commissioner-input-devy-rounds"
                  placeholder="e.g. 1, 3, 5"
                  className={`${inputClass} sm:w-40`}
                />
              </ControlRow>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSaveDevyConfig}
                disabled={devySaving || !isPreDraft || loading || actionLoading !== null}
                data-testid="draft-commissioner-save-devy-config"
                className="min-h-[44px] rounded-lg border border-violet-300/40 bg-violet-500/15 px-4 text-sm font-medium text-violet-50 hover:bg-violet-500/25 disabled:opacity-50"
              >
                {devySaving ? 'Saving…' : 'Save devy rounds'}
              </button>
              {devyMessage && (
                <p className="text-[12px] text-white/70" data-testid="draft-commissioner-devy-config-message">
                  {devyMessage}
                </p>
              )}
            </div>
          </PanelSection>
        ) : null}

        {/* ── C2C rounds (C2C leagues only) ────────────────────────────────────── */}
        {hasC2CDraftConfig ? (
          <PanelSection title="College rounds (C2C)" purpose="Choose which rounds draft college players; every other round drafts pros. Locked once the draft starts.">
            <div className="divide-y divide-white/6 rounded-lg border border-white/10 bg-black/20">
              <SwitchRow
                label="Enable C2C college/pro rounds"
                checked={c2cEnabledInput}
                disabled={c2cSaving || !isPreDraft}
                testId="draft-commissioner-toggle-c2c-enabled"
                tone="violet"
                onToggle={() => setC2CEnabledInput((prev) => !prev)}
              />
              <ControlRow label="College rounds" helper={isPreDraft ? `Comma-separated, 1-${rounds}.` : 'C2C config is locked after draft start.'}>
                <input
                  type="text"
                  value={c2cRoundsInput}
                  onChange={(event) => setC2CRoundsInput(event.target.value)}
                  disabled={c2cSaving || !isPreDraft}
                  data-testid="draft-commissioner-input-c2c-rounds"
                  placeholder="e.g. 1, 3, 5"
                  className={`${inputClass} sm:w-40`}
                />
              </ControlRow>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSaveC2CConfig}
                disabled={c2cSaving || !isPreDraft || loading || actionLoading !== null}
                data-testid="draft-commissioner-save-c2c-config"
                className="min-h-[44px] rounded-lg border border-violet-300/40 bg-violet-500/15 px-4 text-sm font-medium text-violet-50 hover:bg-violet-500/25 disabled:opacity-50"
              >
                {c2cSaving ? 'Saving…' : 'Save college rounds'}
              </button>
              {c2cMessage && (
                <p className="text-[12px] text-white/70" data-testid="draft-commissioner-c2c-config-message">
                  {c2cMessage}
                </p>
              )}
            </div>
          </PanelSection>
        ) : null}

        {/* ── Teams & Chimmy ───────────────────────────────────────────────────── */}
        <PanelSection
          sectionKey="teams"
          testId="draft-commissioner-managers"
          title="Teams & Chimmy"
          purpose="Who drafts for each team, and what happens to a team with no manager."
        >
          {seats.length ? (
            <div className="overflow-hidden rounded-lg border border-white/10 bg-black/20">
              <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-2 border-b border-white/8 bg-white/[0.03] px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-white/45">
                <span>#</span>
                <span>Team</span>
                <span>Drafted by</span>
              </div>
              <ul className="divide-y divide-white/5 text-[13px]">
                {seats.map((seat) => (
                  <li
                    key={seat.rosterId}
                    className="grid min-h-[40px] grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5"
                    data-testid={`draft-commissioner-seat-${seat.slot}`}
                  >
                    <span className="tabular-nums text-white/40">{seat.slot}</span>
                    <span className="truncate text-white/90">{seat.displayName}</span>
                    <SeatBadge status={seat.status} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-[12px] leading-snug text-white/50">
            <span className="text-white/75">Manager</span>: a person drafts. <span className="text-white/75">Auto</span>: the
            team picks by itself. <span className="text-white/75">Chimmy</span>: Chimmy runs a team with no manager.
          </p>
          {!isFinal ? (
            <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/20 p-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => setShowSwapManager(true)}
                data-testid="draft-commissioner-open-swap-manager"
                className="min-h-[44px] shrink-0 rounded-lg border border-white/15 bg-white/[0.04] px-4 text-sm font-medium text-white/90 hover:bg-white/10 hover:text-white"
              >
                Swap two managers
              </button>
              <span className="text-[12px] leading-snug text-white/55">
                Trades who controls two draft slots from now on (for example, a manager who joined late takes over the right team). Picks already made stay where they are.
              </span>
            </div>
          ) : null}

          <fieldset disabled={isFinal} className="min-w-0 space-y-3 border-t border-white/8 pt-3">
            <SubHeading>Teams with no manager</SubHeading>
            <div
              className={`rounded-lg border px-3 py-2.5 text-[13px] leading-snug ${
                orphanCount > 0 && !orphanManagerOn
                  ? 'border-amber-400/30 bg-amber-500/[0.07] text-amber-50'
                  : 'border-white/10 bg-black/20 text-white/85'
              }`}
              data-testid="draft-commissioner-orphan-status"
            >
              <p>{orphanSummary}</p>
              {orphanManagerOn && (
                <p className="mt-1 text-[12px] text-white/55">
                  Requested mode: <span className="text-white/85">{requestedOrphanMode === 'ai' ? 'Chimmy' : requestedOrphanMode.toUpperCase()}</span>
                  {' · '}Effective mode:{' '}
                  <span className="text-white/85">{effectiveOrphanMode === 'ai' ? 'Chimmy' : effectiveOrphanMode.toUpperCase()}</span>
                </p>
              )}
              {orphanModeFallbackActive && (
                <p className="mt-1 text-[12px] text-amber-300" data-testid="draft-commissioner-orphan-mode-fallback-note">
                  Chimmy is chosen but isn&apos;t available right now, so empty teams pick by the rankings (CPU) until it is.
                </p>
              )}
              <p className="mt-1 text-[12px] text-white/50">
                {orphanStatus?.recentActions?.length
                  ? `Last automatic action: ${orphanStatus.recentActions[0]?.action ?? '—'}`
                  : 'Nothing has been picked automatically yet.'}
              </p>
              {isOrphanOnClock && orphanManagerOn && onRunAiPick && (
                <button
                  type="button"
                  onClick={() => run('run_ai_pick', async () => { await Promise.resolve(onRunAiPick()) })}
                  disabled={busy || runAiPickLoading}
                  data-testid="draft-commissioner-run-ai-pick"
                  className="mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-violet-400/40 bg-violet-500/15 px-4 text-sm font-medium text-violet-50 hover:bg-violet-500/25 disabled:opacity-50"
                >
                  {runAiPickLoading ? 'Running…' : runOrphanPickLabel}
                </button>
              )}
            </div>
            <div className="divide-y divide-white/6 rounded-lg border border-white/10 bg-black/20">
              <SwitchRow
                label="Chimmy runs empty teams"
                helper="A team with no manager drafts on its own, the way you choose below."
                checked={orphanManagerOn}
                disabled={settingsSaving}
                testId="draft-commissioner-toggle-orphan-ai"
                onToggle={() => handleToggle('orphanTeamAiManagerEnabled', !(ui.orphanTeamAiManagerEnabled ?? false))}
              />
              {orphanManagerOn && (
                <ControlRow label="How empty teams pick" helper="Rankings only is instant. Chimmy also says why it made each pick.">
                  <select
                    value={requestedOrphanMode}
                    disabled={settingsSaving}
                    data-testid="draft-commissioner-select-orphan-drafter-mode"
                    onChange={(event) => handleOrphanModeChange((event.target.value === 'ai' ? 'ai' : 'cpu'))}
                    className={`${selectClass} sm:w-52`}
                  >
                    <option value="cpu">Rankings only (CPU)</option>
                    <option value="ai">Chimmy (explains each pick)</option>
                  </select>
                </ControlRow>
              )}
            </div>

            {onSaveCommissionerAiDraft && (
              <div
                className="space-y-3 rounded-lg border border-emerald-400/25 bg-emerald-500/[0.06] p-3"
                data-testid="draft-commissioner-ai-managers-panel"
              >
                <div>
                  <p className="text-sm font-semibold text-emerald-50">Chimmy managers (up to 4 open teams)</p>
                  <p className="mt-0.5 text-[12px] leading-snug text-white/60">
                    Tick an open team to hand it to Chimmy. Chimmy drafts for it a few seconds after it comes on the
                    clock, in the style you choose. Needs “Chimmy runs empty teams” on.
                  </p>
                </div>

                <div className="space-y-2">
                  {(orphanStatus?.orphanRosterIds ?? []).slice(0, 4).map((rid) => {
                    const row = aiRowState[rid] ?? { aiStyle: 'BALANCED', tradeAggression: 'medium', active: false }
                    return (
                      <div key={rid} className="space-y-2 rounded-lg border border-white/10 bg-black/25 p-2.5">
                        <label className="flex min-h-[44px] items-center gap-3 text-sm text-white/90">
                          <input
                            type="checkbox"
                            className="h-5 w-5 shrink-0 accent-emerald-400"
                            checked={row.active}
                            onChange={(e) =>
                              setAiRowState((s) => ({
                                ...s,
                                [rid]: { ...row, active: e.target.checked },
                              }))
                            }
                          />
                          <span data-testid={`draft-commissioner-ai-team-${rid}`}>
                            {teamNameByRosterId[rid] ?? `Open team ${rid.slice(0, 6)}`}
                          </span>
                        </label>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <FieldLabel label="Draft style">
                            <select
                              className={selectClass}
                              value={row.aiStyle}
                              data-testid={`draft-commissioner-ai-style-${rid}`}
                              onChange={(e) =>
                                setAiRowState((s) => ({ ...s, [rid]: { ...row, aiStyle: e.target.value } }))
                              }
                            >
                              {['BPA', 'NEEDS', 'BALANCED', 'UPSIDE', 'SAFE', 'YOUTH', 'STARS_AND_SCRUBS'].map((s) => (
                                <option key={s} value={s}>
                                  {AI_STYLE_LABELS[s] ?? s}
                                </option>
                              ))}
                            </select>
                          </FieldLabel>
                          <FieldLabel label="Trades">
                            <select
                              className={selectClass}
                              value={row.tradeAggression}
                              data-testid={`draft-commissioner-ai-agg-${rid}`}
                              onChange={(e) =>
                                setAiRowState((s) => ({ ...s, [rid]: { ...row, tradeAggression: e.target.value } }))
                              }
                            >
                              {['none', 'low', 'medium', 'high'].map((s) => (
                                <option key={s} value={s}>
                                  {AI_AGGRESSION_LABELS[s] ?? s}
                                </option>
                              ))}
                            </select>
                          </FieldLabel>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="space-y-2 border-t border-white/8 pt-3">
                  <SubHeading>Chimmy trade rules</SubHeading>
                  <div className="divide-y divide-white/6 rounded-lg border border-white/10 bg-black/20">
                    {(
                      [
                        ['allowOutbound', 'Chimmy sends trade offers', 'Chimmy teams may offer trades to other teams.'],
                        ['allowInbound', 'Chimmy answers trade offers', 'Chimmy teams accept or decline offers from people.'],
                        ['blockAiToAi', 'Block Chimmy ↔ Chimmy trades', 'Two Chimmy teams never trade with each other.'],
                      ] as const
                    ).map(([key, label, helper]) => (
                      <label key={key} className="flex min-h-[52px] items-center justify-between gap-3 px-3 py-2">
                        <span className="min-w-0">
                          <span className="block text-sm text-white/90">{label}</span>
                          <span className="block text-[12px] leading-snug text-white/50">{helper}</span>
                        </span>
                        <input
                          type="checkbox"
                          className="h-5 w-5 shrink-0 accent-emerald-400"
                          checked={Boolean(aiTradeRules[key])}
                          onChange={(e) => setAiTradeRules((r) => ({ ...r, [key]: e.target.checked }))}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <FieldLabel label="Seconds between trade offers" hint="0 to 600">
                      <input
                        type="number"
                        min={0}
                        max={600}
                        className={inputClass}
                        value={aiTradeRules.proposalCooldownSeconds}
                        onChange={(e) =>
                          setAiTradeRules((r) => ({ ...r, proposalCooldownSeconds: Number(e.target.value) || 0 }))
                        }
                      />
                    </FieldLabel>
                    <FieldLabel label="Most offers per round" hint="0 to 20">
                      <input
                        type="number"
                        min={0}
                        max={20}
                        className={inputClass}
                        value={aiTradeRules.maxProposalsPerRound}
                        onChange={(e) =>
                          setAiTradeRules((r) => ({ ...r, maxProposalsPerRound: Number(e.target.value) || 0 }))
                        }
                      />
                    </FieldLabel>
                    <FieldLabel label="How sure to accept" hint="0 to 1 — 0.6 means 60% sure it is a good trade">
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.01}
                        className={inputClass}
                        value={aiTradeRules.acceptConfidenceMin}
                        onChange={(e) =>
                          setAiTradeRules((r) => ({
                            ...r,
                            acceptConfidenceMin: Math.min(1, Math.max(0, Number(e.target.value) || 0)),
                          }))
                        }
                      />
                    </FieldLabel>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={aiMgrSaving || !orphanStatus?.orphanRosterIds?.length}
                    className="min-h-[44px] rounded-lg border border-emerald-400/40 bg-emerald-500/20 px-4 text-sm font-medium text-emerald-50 hover:bg-emerald-500/30 disabled:opacity-50"
                    data-testid="draft-commissioner-ai-managers-save"
                    onClick={async () => {
                      if (!onSaveCommissionerAiDraft) return
                      setAiMgrSaving(true)
                      setAiMgrMessage(null)
                      try {
                        const assignedAiTeams = (orphanStatus?.orphanRosterIds ?? []).slice(0, 4).map((rid) => {
                          const row = aiRowState[rid] ?? { aiStyle: 'BALANCED', tradeAggression: 'medium', active: false }
                          return {
                            teamId: rid,
                            aiStyle: row.aiStyle,
                            tradeAggression: row.tradeAggression,
                            active: row.active,
                          }
                        })
                        const res = await onSaveCommissionerAiDraft({ assignedAiTeams, tradeRules: aiTradeRules })
                        if (res && typeof res === 'object' && 'error' in res && res.error) {
                          setAiMgrMessage(String(res.error))
                        } else {
                          // Say whether Chimmy will also run them all season, and why one could not be handed over.
                          const season = res && typeof res === 'object' && 'chimmySeason' in res ? (res as { chimmySeason?: ChimmySeasonResult[] }).chimmySeason : null
                          setAiMgrMessage(draftAiSaveMessage(season))
                          void onResync()
                        }
                      } finally {
                        setAiMgrSaving(false)
                      }
                    }}
                  >
                    {aiMgrSaving ? 'Saving…' : 'Save Chimmy assignments'}
                  </button>
                  {!orphanStatus?.orphanRosterIds?.length ? (
                    <span className="text-[12px] text-white/45">No open teams to hand over.</span>
                  ) : null}
                  {aiMgrMessage ? <p className="text-[12px] text-white/65">{aiMgrMessage}</p> : null}
                </div>
              </div>
            )}
          </fieldset>
        </PanelSection>

        {/* ── Finish ───────────────────────────────────────────────────────────── */}
        {showFinish ? (
          <PanelSection sectionKey="finish" testId="draft-commissioner-finish" title="Finish" purpose="End the draft, or wipe it and start over. Both change the whole draft at once.">
            <div className="space-y-3 rounded-lg border border-rose-500/45 bg-rose-500/[0.06] p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-rose-200">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                Danger zone
              </p>
              {isLiveOrPaused && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white">Complete draft</p>
                    <p className="text-[12px] leading-snug text-white/60">Ends the draft now and locks it — it&apos;s on the record.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => run('complete', () => onAction('complete'))}
                    disabled={busy}
                    data-testid="draft-commissioner-complete"
                    className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-lg border border-rose-400/40 bg-rose-500/10 px-4 text-sm font-medium text-rose-50 hover:bg-rose-500/20 disabled:opacity-50"
                  >
                    <CheckSquare className="h-4 w-4" />
                    Complete draft
                  </button>
                </div>
              )}
              <div className={`space-y-2 ${isLiveOrPaused ? 'border-t border-rose-500/20 pt-3' : ''}`}>
                <div>
                  <p className="text-sm font-medium text-white">Reset whole draft</p>
                  <p className="text-[12px] leading-snug text-white/60">Removes every pick and starts again from pick 1. Type RESET to confirm.</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={resetText}
                    onChange={(e) => setResetText(e.target.value)}
                    placeholder='Type RESET'
                    aria-label="Type RESET to confirm"
                    data-testid="draft-commissioner-reset-confirm-text"
                    className={`${inputClass} sm:w-40`}
                  />
                  <button
                    type="button"
                    disabled={resetText.trim().toUpperCase() !== 'RESET' || actionLoading !== null || loading}
                    onClick={() =>
                      run('reset_draft', async () => {
                        const result = await onAction('reset_draft')
                        setResetText('')
                        return result
                      })
                    }
                    data-testid="draft-commissioner-reset-draft"
                    className="min-h-[44px] rounded-lg border border-rose-500/60 bg-rose-600/30 px-4 text-sm font-semibold text-rose-50 hover:bg-rose-600/45 disabled:opacity-40"
                  >
                    Reset whole draft
                  </button>
                </div>
              </div>
            </div>
          </PanelSection>
        ) : null}

        {/* ── Tools ────────────────────────────────────────────────────────────── */}
        <PanelSection sectionKey="tools" title="Tools" purpose="Messages, reloads, imports, and rarely needed fixes.">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {onBroadcast && (
              <ActionButton
                testId="draft-commissioner-open-broadcast"
                icon={Megaphone}
                tone="amber"
                label="Broadcast to leagues"
                caption="Send one message to your leagues."
                onClick={onBroadcast}
              />
            )}
            <ActionButton
              testId="draft-commissioner-resync"
              icon={RefreshCw}
              label="Reload the draft"
              caption="Re-reads the draft, settings and queues if something looks stuck."
              onClick={onResync}
              disabled={loading}
              title="Reload session, settings, queue"
            />
          </div>

          <div className="space-y-2 border-t border-white/8 pt-3">
            <SubHeading>Import</SubHeading>
            {(ui.importEnabled ?? true) ? (!showImportFlow ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <ActionButton
                  testId="draft-commissioner-open-import"
                  icon={Upload}
                  label="Import draft data"
                  caption="Bring in a draft order, picks and traded picks from a file."
                  onClick={() => setShowImportFlow(true)}
                  title="Import draft order, picks, and traded picks"
                />
              </div>
            ) : (
              <DraftImportFlow
                leagueId={leagueId}
                onSuccess={() => {
                  setShowImportFlow(false)
                  onResync()
                }}
                onClose={() => setShowImportFlow(false)}
              />
            )) : (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-100" data-testid="draft-commissioner-import-disabled-note">
                Draft import is off. Turn on “Draft import enabled” under Rules to use it.
              </p>
            )}
          </div>

          <div className="space-y-2 border-t border-white/8 pt-3" data-testid="draft-commissioner-advanced">
            <SubHeading>Advanced</SubHeading>
            <p className="text-[12px] leading-snug text-white/55">
              Rarely needed: fix a league stuck in setup, re-read ADP, or run the automation by hand.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ActionButton
                icon={Zap}
                tone="blue"
                label={transitionLoading ? 'Transitioning…' : 'Transition to drafting'}
                caption="Fixes a league stuck in setup so the draft can open."
                onClick={handleTransitionToDrafting}
                disabled={transitionLoading || busy || startDraftBlocked}
                title="Manually transition league to drafting state (fixes stuck setup state)"
              />
              {isLiveOrPaused && (
                <>
                  <ActionButton
                    testId="draft-commissioner-refresh-adp"
                    icon={RefreshCw}
                    tone="violet"
                    label={actionLoading === 'refresh_adp' ? 'Refreshing ADP…' : 'Refresh ADP'}
                    caption="Re-reads ADP for the player pool."
                    onClick={handleRefreshAdp}
                    disabled={busy}
                    title="Re-fetch ADP from FantasyFootballCalculator and refresh the player pool's ADP column"
                  />
                  {!isAuctionDraft && (
                    <ActionButton
                      testId="draft-commissioner-slow-tick"
                      icon={RefreshCw}
                      tone="cyan"
                      label="Run slow draft automation"
                      caption="Runs the slow-draft clock check once, by hand."
                      onClick={() => run('slow_tick', () => onAction('slow_tick'))}
                      disabled={busy}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </PanelSection>
      </div>

      {(actionLoading || settingsSaving || devySaving || c2cSaving) && (
        <div className="shrink-0 border-t border-white/8 px-4 py-2 text-xs text-white/55" role="status">
          {actionLoading
            ? `${ACTION_LABELS[actionLoading] ?? 'Working'}…`
            : settingsSaving
              ? 'Saving settings…'
              : devySaving
                ? 'Saving devy config…'
                : c2cSaving
                  ? 'Saving C2C config…'
                  : ''}
        </div>
      )}
    </div>
  )
}

export default CommissionerControlCenterModal

// ── Presentation pieces (kept in this file on purpose: source-text tests read it) ──────────

type SectionKey = 'live' | 'fix' | 'rules' | 'teams' | 'finish' | 'tools'

const ACTION_LABELS: Record<string, string> = {
  start: 'Starting the draft',
  pause: 'Pausing',
  resume: 'Resuming',
  reset_timer: 'Resetting the timer',
  skip_pick: 'Skipping the pick',
  force_autopick: 'Auto-picking',
  resolve_auction: 'Resolving the auction',
  auction_tick: 'Running auction automation',
  set_timer: 'Setting the timer',
  forfeit_pick: 'Forfeiting the pick',
  complete: 'Completing the draft',
  reset_draft: 'Resetting the draft',
  refresh_adp: 'Refreshing ADP',
  slow_tick: 'Running slow draft automation',
  run_ai_pick: 'Running the pick',
}

const AI_STYLE_LABELS: Record<string, string> = {
  BPA: 'Best player available',
  NEEDS: 'Fill roster needs',
  BALANCED: 'Balanced',
  UPSIDE: 'Chase upside',
  SAFE: 'Safe floor',
  YOUTH: 'Young players',
  STARS_AND_SCRUBS: 'Stars and scrubs',
}

const AI_AGGRESSION_LABELS: Record<string, string> = {
  none: 'Never trades',
  low: 'Rarely trades',
  medium: 'Sometimes trades',
  high: 'Trades often',
}

type Tone = 'neutral' | 'emerald' | 'amber' | 'rose' | 'cyan' | 'violet' | 'blue'

const TONES: Record<Tone, { box: string; icon: string }> = {
  neutral: { box: 'border-white/12 bg-white/[0.035] hover:bg-white/[0.08]', icon: 'bg-white/10 text-white/80' },
  emerald: { box: 'border-emerald-400/30 bg-emerald-500/[0.08] hover:bg-emerald-500/15', icon: 'bg-emerald-500/20 text-emerald-200' },
  amber: { box: 'border-amber-400/30 bg-amber-500/[0.08] hover:bg-amber-500/15', icon: 'bg-amber-500/20 text-amber-200' },
  rose: { box: 'border-rose-400/30 bg-rose-500/[0.08] hover:bg-rose-500/15', icon: 'bg-rose-500/20 text-rose-200' },
  cyan: { box: 'border-cyan-300/30 bg-cyan-500/[0.08] hover:bg-cyan-500/15', icon: 'bg-cyan-500/20 text-cyan-200' },
  violet: { box: 'border-violet-300/30 bg-violet-500/[0.08] hover:bg-violet-500/15', icon: 'bg-violet-500/20 text-violet-200' },
  blue: { box: 'border-blue-400/30 bg-blue-500/[0.08] hover:bg-blue-500/15', icon: 'bg-blue-500/20 text-blue-200' },
}

/** One card per section: a short title, one sentence on what it is for, then its controls. */
function PanelSection({
  sectionKey,
  testId,
  title,
  purpose,
  className,
  children,
}: {
  sectionKey?: SectionKey
  testId?: string
  title: string
  purpose: string
  className?: string
  children: ReactNode
}) {
  return (
    <section
      data-cc-section={sectionKey}
      data-testid={testId}
      className={`scroll-mt-3 rounded-xl border border-white/10 bg-white/[0.025] p-3 sm:p-4 ${className ?? ''}`}
    >
      <h3 className="text-[15px] font-semibold text-white">{title}</h3>
      <p className="mt-0.5 text-[12px] leading-snug text-white/55">{purpose}</p>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h4 className="text-[11px] font-semibold uppercase tracking-wider text-white/45">{children}</h4>
}

/** A titled group of rule rows, drawn as one bordered list. */
function RuleGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <SubHeading>{title}</SubHeading>
      <div className="divide-y divide-white/6 rounded-lg border border-white/10 bg-black/20">{children}</div>
    </div>
  )
}

/** A large button that says what it does underneath, or why it is off. */
function ActionButton({
  testId,
  icon: Icon,
  label,
  caption,
  reason,
  tone = 'neutral',
  onClick,
  disabled,
  title,
}: {
  testId?: string
  icon: ComponentType<{ className?: string }>
  label: string
  caption: string
  /** Shown instead of the caption when a setting turns this button off. */
  reason?: string
  tone?: Tone
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  const t = TONES[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      title={title}
      className={`group flex min-h-[64px] w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/[0.02] ${t.box}`}
    >
      <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md group-disabled:bg-white/5 group-disabled:text-white/35 ${t.icon}`}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-white group-disabled:text-white/50">{label}</span>
        {reason ? (
          <span className="mt-0.5 block text-[12px] leading-snug text-amber-200/90">{reason}</span>
        ) : (
          <span className="mt-0.5 block text-[12px] leading-snug text-white/60 group-disabled:text-white/35">{caption}</span>
        )}
      </span>
    </button>
  )
}

/** Label and one-line helper on the left, the control on the right. Stacks on a phone. */
function ControlRow({ label, helper, children }: { label: string; helper?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="min-w-0">
        <span className="block text-sm text-white/90">{label}</span>
        {helper ? <span className="mt-0.5 block text-[12px] leading-snug text-white/50">{helper}</span> : null}
      </span>
      <span className="shrink-0">{children}</span>
    </label>
  )
}

/** One rule: label and helper on the left, the On/Off switch on the right. */
function SwitchRow({
  label,
  helper,
  checked,
  disabled,
  testId,
  tone = 'cyan',
  onToggle,
}: {
  label: string
  helper?: string
  checked: boolean
  disabled?: boolean
  testId: string
  tone?: 'cyan' | 'violet'
  onToggle: () => void
}) {
  const onTrack = tone === 'violet' ? 'bg-violet-400' : 'bg-cyan-400'
  return (
    <label className="flex min-h-[56px] items-center justify-between gap-3 px-3 py-2">
      <span className="min-w-0">
        <span className="block text-sm text-white/90">{label}</span>
        {helper ? <span className="mt-0.5 block text-[12px] leading-snug text-white/50">{helper}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        data-testid={testId}
        onClick={onToggle}
        className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-lg px-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span
          aria-hidden
          className={`relative inline-block h-6 w-11 rounded-full border transition-colors ${
            checked ? `${onTrack} border-transparent` : 'border-white/20 bg-white/10'
          }`}
        >
          <span
            className={`absolute top-1/2 h-[18px] w-[18px] -translate-y-1/2 rounded-full bg-white shadow transition-all ${
              checked ? 'left-[22px]' : 'left-[2px]'
            }`}
          />
        </span>
        <span className={`w-7 text-left ${checked ? 'text-white' : 'text-white/55'}`}>{checked ? 'On' : 'Off'}</span>
      </button>
    </label>
  )
}

function FieldLabel({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <label className={`block min-w-0 ${className ?? ''}`}>
      <span className="mb-1 block text-[12px] font-medium text-white/65">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] leading-snug text-white/40">{hint}</span> : null}
    </label>
  )
}

function SeatBadge({ status }: { status: 'human' | 'auto' | 'chimmy' | 'empty' }) {
  const cls =
    status === 'chimmy'
      ? 'border-violet-400/35 bg-violet-500/20 text-violet-100'
      : status === 'auto'
        ? 'border-emerald-400/35 bg-emerald-500/15 text-emerald-100'
        : status === 'empty'
          ? 'border-amber-400/35 bg-amber-500/15 text-amber-100'
          : 'border-white/15 bg-white/[0.06] text-white/75'
  return (
    <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}>
      {status === 'chimmy' ? 'Chimmy' : status === 'auto' ? 'Auto' : status === 'empty' ? 'No manager' : 'Manager'}
    </span>
  )
}
