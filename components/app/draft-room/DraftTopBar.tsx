'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowLeftRight, Clock, Copy, Grid2x2, Hash, LayoutGrid, MoreHorizontal, Pause, RefreshCw, Settings2, Sparkles, Tv, User, Volume2, VolumeX, Zap } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { formatTimerRemaining } from '@/lib/live-draft-engine/DraftTimerService'
import { useDraftCountdownSeconds } from '@/lib/draft/useDraftCountdown'
import { resolveScheduledStartCountdown, SCHEDULED_START_GRACE_MS } from '@/lib/draft/scheduledStartCountdown'
import type { TimerMode } from '@/lib/draft-defaults/DraftUISettingsResolver'
import './af-draft-room.css'
import { clockProgressPercent } from '@/lib/draft-room/clockProgress'
import { effectiveDueAt, formatClockTime, isLongPickClock, type QuietWindow } from '@/lib/draft-room/pickClockPlanning'
import { useMessages } from '@/components/i18n/useMessages'
import { pickClockPlannerMessages } from '@/lib/core-app/messages/pickClockPlanner'
import { draftRoomHeaderMessages } from '@/lib/core-app/messages/draftRoomHeader'
import type { LeagueAccent } from '@/lib/draft-room/leagueAccent'
import type { LeagueNote } from '@/lib/draft-room/leagueNote'

type DraftTopBarProps = {
  leagueName: string
  /** Room v2: a chip naming the league type, in its accent color, beside the league name. */
  leagueAccent?: LeagueAccent | null
  /** Room v2 league note: the one rule this type drafts under, beside its chip. */
  leagueNote?: LeagueNote | null
  /** League avatar / logo URL. Rendered next to the name when provided. */
  leagueLogoUrl?: string | null
  sport: string
  draftType: string
  teamCount: number
  rounds: number
  currentManagerOnClock: string | null
  /** Optional avatar for the on-clock roster from league chrome. */
  currentManagerAvatarUrl?: string | null
  /** When true, label on-clock state as "You're on the clock". */
  isCurrentUserOnClock?: boolean
  pickLabel: string | null
  overallPickNumber: number | null
  timerStatus: 'running' | 'paused' | 'expired' | 'none'
  timerRemainingSeconds: number | null
  /** When timer is running, anchor countdown to this ISO time (smooth 1s ticks). */
  timerEndAtIso?: string | null
  timerSeconds?: number | null
  isCommissioner: boolean
  draftStatus: string
  timerMode?: TimerMode
  autoPickEnabled?: boolean
  onToggleAutoPick?: () => void
  inviteLink?: string | null
  /** Called after copy succeeds (parent handles clipboard). `source` distinguishes inline vs overflow menu. */
  onCopyInvite?: (source: 'inline' | 'menu') => void
  onStartDraft?: () => void
  onCommissionerOpen?: () => void
  onPause?: () => void
  onResume?: () => void
  onResetTimer?: () => void
  onUndoPick?: () => void
  commissionerLoading?: boolean
  /** When false, pause/resume commissioner actions are disabled per league automation settings (server-enforced too). */
  commissionerPauseControlsEnabled?: boolean
  /** For reconnect/refresh state */
  isReconnecting?: boolean
  /** Orphan roster on clock: show CPU/Chimmy Manager badge and allow Run pick */
  isOrphanOnClock?: boolean
  /** The team on the clock is a Chimmy manager slot, which picks on its own after a short delay. */
  chimmyManagerOnClock?: boolean
  /** When orphan on clock: 'cpu' | 'ai' - label shows "CPU Manager" or "Chimmy Manager" */
  orphanDrafterMode?: 'cpu' | 'ai'
  /** Selected setting mode; used to show fallback state when requested Chimmy runs in CPU fallback. */
  orphanDrafterRequestedMode?: 'cpu' | 'ai'
  /** True when requested Chimmy mode fell back to CPU due unavailable providers/errors. */
  orphanFallbackActive?: boolean
  onRunAiPick?: () => void
  runAiPickLoading?: boolean
  onTradesClick?: () => void
  pendingTradesCount?: number
  /** Slow draft: when timer expired and user on clock, show "Use queue" and call this */
  onUseQueue?: () => void
  useQueueLoading?: boolean
  /** Show "Use queue" (timer expired, user on clock, has queue) */
  showUseQueue?: boolean
  onResync?: () => void
  resyncLoading?: boolean
  backHref?: string
  /** When set, the settings gear opens league settings on the Draft panel (members + commissioners). */
  leagueDraftSettingsHref?: string | null
  /** When set, the gear opens in-room draft settings (modal) instead of navigating away. Takes precedence over `leagueDraftSettingsHref`. */
  onOpenDraftRoomSettings?: () => void
  /** From session.timer.pauseReason — distinguishes commissioner vs overnight virtual pause. */
  timerPauseReason?: 'commissioner' | 'overnight_window' | null
  /** ISO UTC when overnight quiet window ends (session.timer.overnightResumeAt). */
  overnightResumeAtIso?: string | null
  /** Commissioner quiet hours; moves the shown due time past them, since the clock freezes then. */
  quietWindow?: QuietWindow | null
  /** Number of browsers currently viewing the draft room (from the live-draft presence channel). */
  onlineCount?: number
  /** `redraft_snake` — show format chips and slightly stronger header chrome (snake redraft live URL). */
  draftRoomPresentation?: 'default' | 'redraft_snake'
  /** Slice 2 — surface "3RR ON" badge in header meta line when commissioner enabled Third Round Reversal. */
  thirdRoundReversal?: boolean
  /** When set, the overflow menu shows a "Big Screen / Cast Board" entry that opens this URL in a new tab. */
  bigScreenHref?: string | null
  /** Compact Chimmy recommendation overlay for current-pick strip. */
  aiRecommendationOverlay?: {
    label?: string | null
    playerName?: string | null
    position?: string | null
    team?: string | null
    confidencePct?: number | null
    valueDelta?: number | null
    stackAvailable?: boolean
    byeWeekConflict?: boolean
    note?: string | null
  } | null
  /** Shared toggle controlling whether Chimmy overlays are shown cross-surface. */
  showAiOverlays?: boolean
  poolReadiness?: {
    ready: boolean
    entryCount: number
    source: 'db-cache' | 'memory-cache' | 'cold' | 'missing'
    syncedAt: string | null
  } | null
  startDraftDisabled?: boolean
  /**
   * Dynasty leagues only: the room's dynasty skin (ink/vault ground, trophy-gold hairline) and
   * the draft-kind chip. Redraft rooms leave this false and render exactly as before.
   */
  dynastySkin?: boolean
  /** "Rookie draft · 2027" / "Startup draft" — from `formatDynastyDraftKindLabel`. */
  dynastyDraftKindLabel?: string | null
  /** One line on how a rookie auction converted traded rookie picks; null hides it. */
  rookieAuctionNote?: string | null
  /** Opens whichever Chimmy surface is on screen (the page's `openChimmy`). Hidden when absent. */
  onOpenChimmy?: () => void
  /** Picks until the viewer's next turn; adds "You're up in N" to the pick pill when > 0. */
  picksUntilUser?: number | null
  /** The auto-pick pill. A mock room has no auto-pick to toggle, so it hides it. */
  showAutoPickPill?: boolean
  /**
   * Controls the room supplies itself, at the start of the right-hand cluster. The mock room puts
   * its own Pause / Resume here: the viewer runs the mock but is not a league commissioner, so the
   * commissioner pause pill (and every commissioner menu row) stays off.
   */
  controlsSlot?: ReactNode
  /** Extra rows at the end of the ⋯ menu's room section (the mock room's Reset and Export). */
  extraMenuItems?: Array<{ id: string; label: string; description?: string; testId: string; onSelect: () => void }>
  /**
   * What the clock pill says when no clock is running, in place of the draft status and an empty
   * timer ("in progress –"). The mock room: "CPU picking" while a CPU manager is on the clock.
   */
  idleClockLabel?: string | null
  /** "Invite leaguemates" and the menu's Copy Invite Link. A solo mock has nobody to invite. */
  showInvite?: boolean
  /**
   * The league's scheduled draft time (`LeagueSettings.draftDateUtc`, ISO). Before the draft the
   * middle slot counts down to it ("Starts in 12:34"). Null / absent renders exactly as before.
   */
  scheduledStartIso?: string | null
  /**
   * True when the server starts the draft at that time (`scheduledDraftAutoStarts`). Once the time
   * has passed the countdown then reads "Starting…" for a few minutes; false drops it instead, so
   * the room never promises a start the commissioner has to press.
   */
  scheduledStartAutoStarts?: boolean
  /**
   * An auto draft (execution mode `auto`): the server makes every pick. The pick clock, its beeps
   * and the "you're on the clock" call to act are all off; the middle slot reads "Auto-drafting"
   * with how far along the board is.
   */
  autoDraft?: boolean
}

function translateDraftStatus(draftStatus: string, t: (key: string) => string): string {
  const key = `draftRoom.status.${draftStatus}`
  const out = t(key)
  if (out !== key) return out
  return draftStatus.replace(/_/g, ' ')
}

function translateDraftType(draftType: string, t: (key: string) => string): string {
  const norm = draftType.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
  const key = `draftRoom.draftType.${norm}`
  const out = t(key)
  if (out !== key) return out
  return draftType
}

export function resolveDraftFormatLabel(
  draftType: string,
  thirdRoundReversal: boolean,
  t: (key: string) => string,
): string {
  const norm = draftType.trim().toLowerCase()
  if (norm === 'auction') return t('draftRoom.draftType.auction')
  if (norm === 'linear') return t('draftRoom.draftType.linear')
  if (norm === 'snake') return thirdRoundReversal ? t('draftRoom.topBar.format.snake3rr') : t('draftRoom.draftType.snake')
  return draftType
}

function withCount(template: string, count: number): string {
  return template.replace('{{count}}', String(count))
}

export function formatTimerSummary(timerSeconds: number | null | undefined, t: (key: string) => string): string {
  if (!timerSeconds || timerSeconds <= 0) return t('draftRoom.topBar.timer.untimed')
  if (timerSeconds < 60) return withCount(t('draftRoom.topBar.timer.seconds'), timerSeconds)
  if (timerSeconds < 3600) {
    const minutes = Math.round(timerSeconds / 60)
    return withCount(t(minutes === 1 ? 'draftRoom.topBar.timer.minuteOne' : 'draftRoom.topBar.timer.minutes'), minutes)
  }
  if (timerSeconds < 86400) {
    const hours = Math.round(timerSeconds / 3600)
    return withCount(t(hours === 1 ? 'draftRoom.topBar.timer.hourOne' : 'draftRoom.topBar.timer.hours'), hours)
  }
  const days = Math.round(timerSeconds / 86400)
  return withCount(t(days === 1 ? 'draftRoom.topBar.timer.dayOne' : 'draftRoom.topBar.timer.days'), days)
}

function formatPoolReadinessLabel(
  sport: string,
  poolReadiness: DraftTopBarProps['poolReadiness'],
  t: (key: string) => string,
): string | null {
  if (!poolReadiness) return null
  if (poolReadiness.ready) return withCount(t('draftRoom.topBar.poolReady'), poolReadiness.entryCount)
  return t('draftRoom.topBar.poolPreparing').replace('{{sport}}', sport)
}

/** Shared with the mock room (lib/draft-room/clockProgress.ts); re-exported for existing callers. */
export { clockProgressPercent }

/** Dynasty skin tokens, always with the fallback so the room works before the token sheet lands. */
const DYN = {
  ink: 'var(--dyn-ink,#0B0F17)',
  vault: 'var(--dyn-vault,#121826)',
  line: 'var(--dyn-line,#2A3345)',
  gold: 'var(--dyn-gold,#D4A24C)',
  goldSoft: 'var(--dyn-gold-soft,#F3D79F)',
  faint: 'var(--dyn-faint,#9AA4B2)',
} as const

/** Archivo condensed 700 uppercase — the dynasty pick-label face. */
const DYN_CONDENSED_STYLE: CSSProperties = {
  fontFamily: "'Archivo', ui-sans-serif, system-ui, sans-serif",
  fontStretch: '75%',
  fontWeight: 700,
}

export function DraftTopBar({
  leagueName,
  leagueAccent = null,
  leagueNote = null,
  leagueLogoUrl,
  sport,
  draftType,
  teamCount,
  rounds,
  currentManagerOnClock,
  currentManagerAvatarUrl = null,
  isCurrentUserOnClock = false,
  pickLabel,
  overallPickNumber,
  timerStatus: timerStatusProp,
  timerRemainingSeconds,
  timerEndAtIso = null,
  timerSeconds = null,
  isCommissioner,
  draftStatus,
  timerMode = 'per_pick',
  autoPickEnabled = false,
  inviteLink,
  onCopyInvite,
  onStartDraft,
  onCommissionerOpen,
  onPause,
  onResume,
  onResetTimer,
  onUndoPick,
  commissionerLoading = false,
  commissionerPauseControlsEnabled = true,
  isReconnecting = false,
  isOrphanOnClock = false,
  chimmyManagerOnClock = false,
  orphanDrafterMode = 'cpu',
  orphanDrafterRequestedMode = orphanDrafterMode,
  orphanFallbackActive = false,
  onRunAiPick,
  runAiPickLoading = false,
  onTradesClick,
  pendingTradesCount = 0,
  onUseQueue,
  useQueueLoading = false,
  showUseQueue = false,
  onResync,
  resyncLoading = false,
  backHref,
  leagueDraftSettingsHref = null,
  onOpenDraftRoomSettings,
  onlineCount,
  draftRoomPresentation = 'default',
  onToggleAutoPick,
  timerPauseReason = null,
  overnightResumeAtIso = null,
  quietWindow = null,
  thirdRoundReversal = false,
  bigScreenHref = null,
  aiRecommendationOverlay = null,
  showAiOverlays = true,
  poolReadiness = null,
  startDraftDisabled = false,
  dynastySkin = false,
  dynastyDraftKindLabel = null,
  rookieAuctionNote = null,
  onOpenChimmy,
  picksUntilUser = null,
  // Off by default since 2026-11-19: league auto-pick is a rule, set in Draft settings (the gear).
  showAutoPickPill = false,
  controlsSlot = null,
  extraMenuItems = [],
  idleClockLabel = null,
  showInvite = true,
  scheduledStartIso = null,
  scheduledStartAutoStarts = false,
  autoDraft = false,
}: DraftTopBarProps) {
  // Nobody is on a clock in an auto draft, so no countdown, urgency styling or beeps.
  const timerStatus: DraftTopBarProps['timerStatus'] = autoDraft ? 'none' : timerStatusProp
  const autoDraftLive = autoDraft && (draftStatus === 'in_progress' || draftStatus === 'paused')
  const { t, tInterpolate, language } = useLanguage()
  const pickClockCopy = useMessages(pickClockPlannerMessages)
  const headerCopy = useMessages(draftRoomHeaderMessages)
  const noteText = !leagueNote
    ? null
    : leagueNote.kind === 'guillotine'
      ? headerCopy.noteGuillotine(leagueNote.startWeek, leagueNote.perChop)
      : leagueNote.kind === 'pirate'
        ? headerCopy.notePirate(leagueNote.protect)
        : leagueNote.kind === 'salary_cap'
          ? headerCopy.noteCap(leagueNote.cap)
          : leagueNote.kind === 'zombie'
            ? [leagueNote.universe, leagueNote.level].filter(Boolean).join(' · ') || null
            : leagueNote.kind === 'best_ball'
              ? headerCopy.noteBestBall
              : leagueNote.kind === 'big_brother'
                ? headerCopy.noteBigBrother
                : [leagueNote.conference, leagueNote.round].filter(Boolean).join(' · ') || null
  const liveRemaining = useDraftCountdownSeconds(
    timerStatus,
    timerEndAtIso ?? undefined,
    timerRemainingSeconds,
    { pauseReason: timerPauseReason, overnightResumeAtIso },
  )
  // Pre-draft countdown to the scheduled start. The same hook ticks it once a second; it stops
  // ticking once the time is far enough past that nothing is shown any more.
  const scheduledStartMs = scheduledStartIso ? Date.parse(scheduledStartIso) : Number.NaN
  const scheduledStartLive =
    draftStatus === 'pre_draft' &&
    Number.isFinite(scheduledStartMs) &&
    Date.now() - scheduledStartMs <= SCHEDULED_START_GRACE_MS
  const scheduledStartRemaining = useDraftCountdownSeconds(
    scheduledStartLive ? 'running' : 'none',
    scheduledStartLive ? scheduledStartIso : null,
    null,
  )
  const scheduledStart = resolveScheduledStartCountdown({
    draftStatus,
    scheduledStartIso,
    nowMs: Date.now(),
    autoStarts: scheduledStartAutoStarts,
    remainingSeconds: scheduledStartRemaining,
  })
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)
  const menuDropdownRef = useRef<HTMLDivElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const [copyFeedback, setCopyFeedback] = useState<'idle' | 'copied'>('idle')

  // Audible timer cue. Plays a short beep when the live countdown crosses 10s, 5s,
  // and the final 3/2/1. Mute persists per-user via localStorage so commissioners
  // running multi-day drafts can silence it for the night.
  const [timerMuted, setTimerMuted] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      setTimerMuted(window.localStorage.getItem('af:draft-timer-mute') === '1')
    } catch {
      /* ignore storage failures (private mode, etc.) */
    }
  }, [])
  const lastCountdownTickRef = useRef<number | null>(null)
  useEffect(() => {
    if (timerMuted || timerStatus !== 'running' || liveRemaining == null) {
      lastCountdownTickRef.current = liveRemaining ?? null
      return
    }
    const prev = lastCountdownTickRef.current
    lastCountdownTickRef.current = liveRemaining
    if (prev == null || prev <= liveRemaining) return
    const beepThresholds = new Set([10, 5, 3, 2, 1])
    if (!beepThresholds.has(liveRemaining)) return
    try {
      type AudioCtor = new () => AudioContext
      const w = window as Window & { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor }
      const Ctor = w.AudioContext ?? w.webkitAudioContext
      if (!Ctor) return
      const ctx = new Ctor()
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.type = 'sine'
      oscillator.frequency.value = liveRemaining <= 3 ? 880 : liveRemaining === 5 ? 700 : 540
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18)
      oscillator.start()
      oscillator.stop(ctx.currentTime + 0.2)
      oscillator.onended = () => {
        try {
          void ctx.close()
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* Browser blocked audio (autoplay gesture not yet given) — silent failure is correct. */
    }
  }, [timerMuted, liveRemaining, timerStatus])
  const handleToggleTimerMute = () => {
    setTimerMuted((prev) => {
      const next = !prev
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('af:draft-timer-mute', next ? '1' : '0')
        }
      } catch {
        /* ignore */
      }
      return next
    })
  }

  useEffect(() => {
    if (!menuOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !menuDropdownRef.current?.contains(event.target as Node)
      ) {
        setMenuOpen(false)
      }
    }
    const closeOnResize = () => setMenuOpen(false)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); menuButtonRef.current?.focus() }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('resize', closeOnResize)
    window.visualViewport?.addEventListener('resize', closeOnResize)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', closeOnResize)
      window.visualViewport?.removeEventListener('resize', closeOnResize)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  const effectiveRemaining =
    timerStatus === 'running' && timerEndAtIso != null && timerEndAtIso !== ''
      ? liveRemaining
      : timerRemainingSeconds

  const timerDisplay =
    timerStatus === 'none' || (effectiveRemaining == null && timerStatus !== 'paused' && timerStatus !== 'expired')
      ? '-'
      : timerStatus === 'paused' && effectiveRemaining == null
        ? t('draftRoom.topBar.timerPaused')
        : timerStatus === 'expired'
          ? formatTimerRemaining(0)
          : formatTimerRemaining(effectiveRemaining ?? 0)

  // On a long pick clock (10+ minutes) a countdown alone is hard to plan around — "3h 11m" means
  // working out the time. Show the wall-clock deadline beside it. Not a mode: any draft type.
  // Quiet hours freeze the clock server-side, so the deadline is the effective one, not timerEndAt.
  const dueLabel = useMemo(() => {
    if (timerStatus !== 'running' || !isLongPickClock(timerSeconds) || !timerEndAtIso) return null
    const endMs = Date.parse(timerEndAtIso)
    if (!Number.isFinite(endMs)) return null
    const due = effectiveDueAt(Date.now(), endMs, quietWindow ?? null)
    return pickClockCopy.dueAt(formatClockTime(due, language === 'es' ? 'es-US' : 'en-US'))
  }, [timerStatus, timerSeconds, timerEndAtIso, quietWindow, pickClockCopy, language])

  const timerSummary = useMemo(() => formatTimerSummary(timerSeconds, t), [timerSeconds, t])
  const clockProgress = timerStatus === 'running' ? clockProgressPercent(effectiveRemaining, timerSeconds) : null
  const urgentLowTimer =
    timerStatus === 'running' &&
    timerEndAtIso != null &&
    timerEndAtIso !== '' &&
    liveRemaining != null &&
    liveRemaining <= 10
  /** Critical sub-tier: ≤5s → strong red ring + pulse (stronger than amber urgency). */
  const criticalLowTimer =
    timerStatus === 'running' &&
    timerEndAtIso != null &&
    timerEndAtIso !== '' &&
    liveRemaining != null &&
    liveRemaining <= 5
  /** Danger zone: ≤30s → amber pulse warning (above the existing urgent/critical tiers). */
  const dangerLowTimer =
    timerStatus === 'running' &&
    timerEndAtIso != null &&
    timerEndAtIso !== '' &&
    liveRemaining != null &&
    liveRemaining <= 30 &&
    liveRemaining > 10
  /** Critical + on clock: ≤15s and it's your pick → shake animation. */
  const isCriticalOnClock =
    timerStatus === 'running' &&
    liveRemaining != null &&
    liveRemaining <= 15 &&
    isCurrentUserOnClock
  const statusLabel = translateDraftStatus(draftStatus, t)
  const draftTypeLabel = translateDraftType(draftType, t)
  const draftFormatLabel = resolveDraftFormatLabel(draftType, thirdRoundReversal, t)
  const poolReadinessLabel = formatPoolReadinessLabel(sport, poolReadiness, t)

  /**
   * "Starts in 12:34" before the scheduled draft time, "Starting…" just after it when the server
   * starts the draft. `compact` is the commissioner's version beside the Start Draft button: on a
   * phone it drops the words and keeps clock + time, so the pair still fits a 390px row.
   */
  const scheduledStartPill = (compact: boolean) => {
    if (scheduledStart.phase === 'none') return null
    const starting = scheduledStart.phase === 'starting'
    const startsInLabel = t('draftRoom.topBar.scheduledStart.startsIn')
    const startingLabel = t('draftRoom.topBar.scheduledStart.starting')
    const when = Number.isFinite(scheduledStartMs)
      ? new Date(scheduledStartMs).toLocaleString(language === 'es' ? 'es-US' : 'en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : ''
    return (
      <div
        role="timer"
        aria-label={starting ? startingLabel : `${startsInLabel} ${scheduledStart.time}`}
        title={t('draftRoom.topBar.scheduledStart.title').replace('{{when}}', when)}
        data-testid="draft-topbar-scheduled-countdown"
        data-phase={scheduledStart.phase}
        className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-cyan-400/35 bg-cyan-500/[0.12] text-cyan-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ${
          compact ? 'min-h-[36px] gap-1.5 px-2.5 py-1 text-[12px]' : 'min-h-[40px] gap-2 px-4 py-2 text-sm'
        }`}
      >
        {starting ? (
          <>
            <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300/55 opacity-65" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-300" />
            </span>
            <span className="font-semibold">{startingLabel}</span>
          </>
        ) : (
          <>
            <Clock className={`shrink-0 text-cyan-300/90 ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} aria-hidden />
            <span className={`font-medium text-cyan-100/85 ${compact ? 'max-sm:hidden' : ''}`}>{startsInLabel}</span>
            <span className="font-bold tabular-nums text-white" data-testid="draft-topbar-scheduled-countdown-time">
              {scheduledStart.time}
            </span>
          </>
        )}
      </div>
    )
  }

  const centerCta = (() => {
    /** Completed state: show a clear broadcast "Draft Complete" badge. */
    if (draftStatus === 'completed') {
      return (
        <div className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-emerald-400/35 bg-gradient-to-br from-emerald-500/18 via-[#0a1228] to-[#070d18] px-4 py-2 text-sm font-bold text-emerald-50 shadow-[0_8px_28px_rgba(16,185,129,0.18)]">
          <Sparkles className="h-4 w-4 shrink-0 text-emerald-300" />
          <span>{t('draftRoom.topBar.draftComplete')}</span>
        </div>
      )
    }

    if (draftStatus === 'pre_draft' && isCommissioner && onStartDraft) {
      return (
        <>
          <button
            type="button"
            onClick={onStartDraft}
            disabled={commissionerLoading || startDraftDisabled}
            data-testid="draft-topbar-start-draft"
            className={`inline-flex min-h-[40px] items-center gap-2 rounded-full border border-[#aeb7ff]/40 bg-gradient-to-r from-[#9ca9ff] to-[#8b7fd8] px-5 py-2 text-sm font-semibold text-[#0a1030] shadow-[0_12px_36px_rgba(139,127,216,0.35)] transition duration-150 hover:brightness-110 hover:shadow-[0_14px_40px_rgba(156,169,255,0.4)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 active:scale-[0.98] disabled:opacity-55${
              // Only beside the countdown: keep the label on one line and tighten it on a phone.
              scheduledStart.phase !== 'none' ? ' shrink-0 whitespace-nowrap max-sm:px-3.5' : ''
            }`}
            title={startDraftDisabled ? (poolReadinessLabel ?? t('draftRoom.topBar.poolPreparingGeneric')) : t('draftRoom.topBar.startDraftTitle')}
          >
            <Grid2x2 className="h-4 w-4" />
            {t('draftRoom.topBar.startDraftCta')}
          </button>
          {/* The commissioner keeps Start Draft; the scheduled time counts down beside it. */}
          {scheduledStartPill(true)}
        </>
      )
    }

    /**
     * D.6.2 — top-middle slot is now ALWAYS a prominent timer pill (image 5 spec).
     *   - In-progress draft: live countdown (urgent low-time treatment when ≤10s).
     *   - Paused (commissioner): the pill itself is the click target — clicking it
     *     resumes the draft, with a "Resume" badge so the action is still discoverable.
     *   - Paused (non-commissioner): static label.
     *   - Pre-draft / not running: shows status label.
     *
     * The legacy "RESUME DRAFT" button-shaped CTA is gone; the clock is the focal
     * point and replaces it. Keeps the resume action one-click for commissioners.
     */
    if (autoDraftLive) {
      const totalPicks = Math.max(0, Math.trunc(rounds) * Math.trunc(teamCount))
      const paused = draftStatus === 'paused'
      return (
        <div
          data-testid="draft-topbar-auto-drafting"
          data-paused={paused ? 'true' : 'false'}
          title={headerCopy.autoDraftTitle}
          className={`inline-flex min-h-[36px] items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-bold ${
            paused
              ? 'border-amber-400/45 bg-amber-500/15 text-amber-50'
              : 'border-cyan-400/40 bg-gradient-to-br from-cyan-500/22 to-violet-600/15 text-cyan-50'
          }`}
        >
          <Zap className="h-4 w-4 shrink-0" aria-hidden />
          <span>{paused ? t('draftRoom.topBar.timerPaused') : headerCopy.autoDrafting}</span>
          {overallPickNumber != null && totalPicks > 0 ? (
            <span className="whitespace-nowrap text-[12px] font-semibold tabular-nums text-white/75" data-testid="draft-topbar-auto-progress">
              {headerCopy.autoDraftProgress(Math.min(overallPickNumber, totalPicks), totalPicks)}
            </span>
          ) : null}
        </div>
      )
    }

    const showLiveTimer =
      timerStatus === 'running' || timerStatus === 'paused' || timerStatus === 'expired'
    /*
     * 2026-11-19: the clock no longer doubles as a Resume button. Paused, a commissioner saw TWO
     * resume controls side by side (this pill and the Resume pill on the right). The clock now only
     * reads "Paused" in amber; Resume lives in one place.
     */
    const isPausedCommissioner = false

    if (showLiveTimer || isPausedCommissioner) {
      const handlePillClick = isPausedCommissioner ? onResume : undefined
      const sharedPill = (
        <>
          {timerStatus === 'running' && !urgentLowTimer ? (
            <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300/55 opacity-65" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-300" />
            </span>
          ) : null}
          <Clock className="h-5 w-5 shrink-0 opacity-90" />
          <span data-testid="draft-topbar-timer-value">{timerDisplay}</span>
          {dueLabel ? (
            <span className="whitespace-nowrap text-[11px] font-semibold text-cyan-100/80 max-sm:hidden" data-testid="draft-topbar-timer-due">
              {dueLabel}
            </span>
          ) : null}
          <span className="sr-only" data-testid="draft-topbar-clock-time">{timerDisplay}</span>
          {draftStatus === 'paused' ? (
            <span className="rounded border border-amber-300/40 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-100">
              {t('draftRoom.topBar.timerPaused')}
            </span>
          ) : null}
          {clockProgress != null ? (
            <span className="af-dr-clock-progress" aria-hidden data-testid="draft-topbar-clock-progress">
              <span style={{ width: `${clockProgress}%` }} />
            </span>
          ) : null}
        </>
      )
      const pillClassName = `relative inline-flex min-h-[36px] items-center gap-2 rounded-full border px-3.5 py-1.5 text-xl font-extrabold tabular-nums sm:text-2xl shadow-[0_8px_24px_rgba(0,0,0,0.4)] transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 ${
        criticalLowTimer
          ? 'animate-pulse border-rose-500/65 bg-gradient-to-br from-rose-600/35 to-rose-500/20 text-rose-50 ring-2 ring-rose-500/55 shadow-[0_0_48px_rgba(239,68,68,0.5)]'
          : urgentLowTimer
            ? 'animate-pulse border-rose-400/55 bg-gradient-to-br from-rose-500/30 to-amber-500/20 text-rose-50'
            : dangerLowTimer
              ? 'animate-pulse border-amber-400/45 bg-gradient-to-br from-amber-500/25 to-amber-600/15 text-amber-50'
              : draftStatus === 'paused'
                ? 'border-amber-400/45 bg-gradient-to-br from-amber-500/20 to-amber-600/10 text-amber-50'
                : 'border-cyan-400/40 bg-gradient-to-br from-cyan-500/22 to-violet-600/15 text-cyan-50'
      } ${isCriticalOnClock ? 'animate-[shake_0.5s_ease-in-out_infinite]' : ''} ${
        handlePillClick
          ? 'cursor-pointer hover:shadow-[0_14px_40px_rgba(34,211,238,0.25)] active:scale-[0.98] disabled:opacity-55'
          : 'cursor-default'
      }`
      const pillTooltip = isPausedCommissioner
        ? t('draftRoom.topBarHint.clockResume')
        : draftStatus === 'paused'
          ? t('draftRoom.topBarHint.clockPaused')
          : criticalLowTimer
            ? t('draftRoom.topBarHint.clockUnder5')
            : urgentLowTimer
              ? t('draftRoom.topBarHint.clockUnder10')
              : dangerLowTimer
                ? t('draftRoom.topBarHint.clockUnder30')
                : timerStatus === 'expired'
                ? t('draftRoom.topBarHint.clockExpired')
                : t('draftRoom.topBarHint.clockRunning')
      if (handlePillClick) {
        return (
          <button
            type="button"
            onClick={handlePillClick}
            disabled={commissionerLoading}
            aria-label={t('draftRoom.topBar.aria.resume')}
            title={pillTooltip}
            data-testid={isPausedCommissioner ? 'draft-topbar-resume-draft' : 'draft-topbar-clock'}
            data-paused={draftStatus === 'paused' ? 'true' : 'false'}
            data-urgent={urgentLowTimer ? 'true' : 'false'}
            className={pillClassName}
          >
            {sharedPill}
          </button>
        )
      }
      return (
        <div
          data-testid="draft-topbar-clock"
          data-paused={draftStatus === 'paused' ? 'true' : 'false'}
          data-urgent={urgentLowTimer ? 'true' : 'false'}
          title={pillTooltip}
          className={pillClassName}
        >
          {sharedPill}
        </div>
      )
    }

    // Before the draft, a scheduled time replaces the bare "pre draft" label with its countdown.
    if (scheduledStart.phase !== 'none' && !idleClockLabel) return scheduledStartPill(false)

    return (
      <div className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-4 py-2 text-sm text-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-sm">
        <Clock className="h-4 w-4 shrink-0 text-cyan-300/90" />
        {idleClockLabel ? (
          <span className="font-medium" data-testid="draft-topbar-idle-clock">{idleClockLabel}</span>
        ) : (
          <>
            <span className="font-medium">{statusLabel}</span>
            <span className="font-mono text-xs text-white/55" data-testid="draft-topbar-timer-value">
              {timerDisplay}
            </span>
          </>
        )}
      </div>
    )
  })()

  const handleCopyInvite = async (source: 'inline' | 'menu') => {
    if (onCopyInvite) {
      onCopyInvite(source)
    } else if (inviteLink && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(inviteLink)
    }
    setCopyFeedback('copied')
    window.setTimeout(() => setCopyFeedback('idle'), 1400)
    setMenuOpen(false)
  }

  const orphanModeLabel =
    orphanDrafterRequestedMode === 'ai' && orphanFallbackActive
      ? t('draftRoom.topBar.aiManagerCpuFallback')
      : orphanDrafterMode === 'ai'
        ? t('draftRoom.topBar.aiManager')
        : t('draftRoom.topBar.cpuManager')

  const rs = draftRoomPresentation === 'redraft_snake'
  // The dynasty skin never stacks on the redraft look: page.tsx keeps dynasty out of
  // `redraft_snake`, and this guard keeps it that way if a caller ever passes both.
  const dyn = dynastySkin && !rs

  return (
    <header
      className={`relative z-30 border-b px-3 pb-0.5 pt-0.5 backdrop-blur-xl sm:px-4 ${
        rs
          ? 'border-cyan-400/25 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(34,211,238,0.14),transparent),linear-gradient(180deg,#0b1829_0%,#060f1e_45%,#050814_100%)] shadow-[0_16px_56px_rgba(8,145,178,0.14)]'
          : dyn
            ? ''
            : 'border-white/[0.07] bg-gradient-to-b from-[#070d1c]/95 via-[#060b19]/98 to-[#050814]'
      }`}
      data-dynasty-skin={dyn ? 'true' : undefined}
      style={
        dyn
          ? {
              borderColor: DYN.line,
              background: `radial-gradient(ellipse 120% 80% at 50% -20%, rgba(212,162,76,0.10), transparent), linear-gradient(180deg, ${DYN.vault} 0%, ${DYN.ink} 100%)`,
            }
          : undefined
      }
    >
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-px ${
          dyn ? '' : 'bg-gradient-to-r from-transparent via-cyan-400/25 to-transparent'
        }`}
        style={dyn ? { background: `linear-gradient(90deg, transparent, ${DYN.gold}, transparent)`, opacity: 0.55 } : undefined}
        aria-hidden
      />
      {/*
        Phones get two rows, not six: row 1 is back · league · controls, row 2 is the on-clock
        card (who + timer). The meta line and the Format/Status/Current/Clock card are md+ only;
        the sticky bar under the header carries the pick number, and the menu carries Invite.
      */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-2">
        <div className="min-w-0">
          <div className="flex items-start gap-2">
            {backHref ? (
              <Link
                href={backHref}
                data-testid="draft-back-button"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.06] text-white/78 shadow-sm transition duration-150 hover:bg-white/12 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 active:scale-95"
                aria-label={t('draftRoom.topBar.back')}
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
            ) : null}

            {leagueLogoUrl ? (
              <Image
                src={leagueLogoUrl}
                alt=""
                width={28}
                height={28}
                aria-hidden
                className="h-7 w-7 shrink-0 rounded-lg border border-white/25 bg-white/[0.12] object-cover shadow-[0_4px_20px_rgba(0,0,0,0.35)] ring-1 ring-white/20"
                data-testid="draft-topbar-league-logo"
                unoptimized
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            ) : (
              /*
                The crest is a navy shield (#012d5a) and this header is navy too, so on the old
                translucent tile the shield body vanished and only the white "AF" showed. A light
                plate behind it gives the shield an edge on every header skin (default, redraft, dynasty).
              */
              <span
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-white to-[#cfe6ff] ring-1 ring-cyan-200/70 shadow-[0_2px_10px_rgba(0,0,0,0.35)]"
                data-testid="draft-topbar-brand-plate"
              >
                <Image src="/brand/af-shield-transparent.png" alt="AllFantasy" width={22} height={24} className="h-6 w-[22px] object-contain" data-testid="draft-topbar-brand-logo" />
              </span>
            )}

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-sm font-bold tracking-tight text-white drop-shadow-sm sm:text-base">
                  {leagueName}
                </h1>
                {/* sm+ only: a phone's header row has no room (it ran into Pause at 390px); there the
                    accent stripe under the header carries the color. */}
                {leagueAccent ? (
                  <span
                    data-testid="draft-topbar-league-type"
                    data-league-type={leagueAccent.concept}
                    className="hidden shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold leading-none sm:inline-flex"
                    style={{
                      color: leagueAccent.color,
                      borderColor: `color-mix(in srgb, ${leagueAccent.color} 45%, transparent)`,
                      background: `color-mix(in srgb, ${leagueAccent.color} 14%, transparent)`,
                    }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: leagueAccent.color }} aria-hidden />
                    {leagueAccent.label}
                  </span>
                ) : null}
                {dyn && dynastyDraftKindLabel ? (
                  <span
                    data-testid="draft-topbar-dynasty-kind"
                    className="hidden shrink-0 items-center sm:inline-flex rounded-md border px-1.5 py-0.5 text-[11px] uppercase leading-none tracking-[0.08em]"
                    style={{ ...DYN_CONDENSED_STYLE, borderColor: DYN.gold, color: DYN.goldSoft, background: 'rgba(212,162,76,0.10)' }}
                  >
                    {dynastyDraftKindLabel}
                  </span>
                ) : null}
                {onlineCount != null && onlineCount > 0 && (
                  <span
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/12 px-2 py-0.5 text-[11px] font-semibold text-emerald-100 shadow-[0_0_12px_rgba(16,185,129,0.15)]"
                    title={tInterpolate(onlineCount === 1 ? 'draftRoom.topBarHint.onlineOne' : 'draftRoom.topBarHint.onlineMany', { count: onlineCount })}
                    data-testid="draft-topbar-online-count"
                  >
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/50 opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                    </span>
                    {onlineCount}
                  </span>
                )}
              </div>
              {/* G.1 — REDRAFT / SNAKE / NFL chip row removed.
                  These chips were redundant: the same info already renders in the
                  inline meta line below (`{teamCount} Teams · {rounds} Rounds ·
                  {sport} · {draftTypeLabel}`). Removing them de-clutters the
                  draft-room header without losing any information. */}
              {dyn && dynastyDraftKindLabel ? (
                // Phones: the chip beside the name would squeeze the name to nothing, so the
                // draft kind gets its own line under it instead.
                <p
                  className="mt-0 truncate text-[11px] uppercase tracking-[0.08em] sm:hidden"
                  style={{ ...DYN_CONDENSED_STYLE, color: DYN.goldSoft }}
                  data-testid="draft-topbar-dynasty-kind-mobile"
                >
                  {dynastyDraftKindLabel}
                </p>
              ) : null}
              {poolReadinessLabel && !poolReadiness?.ready ? (
                <p className="mt-0 truncate text-[11px] text-amber-200 md:hidden" data-testid="draft-topbar-pool-readiness-mobile">
                  {poolReadinessLabel}
                </p>
              ) : null}
          <div className="mt-0 hidden flex-wrap items-center gap-x-1 gap-y-0 text-[11px] text-[#97a8d7] md:flex">
                {/*
                  The one rule this league type drafts under, first on the rules line. It sat beside
                  the chip in the title row and, at 1440px, truncated mid-word ("1 te…") while
                  squeezing the league name; here it wraps as a whole item. Accent-coloured so it
                  reads with the chip above.
                */}
                {leagueAccent && noteText ? (
                  <>
                    <span
                      data-testid="draft-topbar-league-note"
                      data-note-kind={leagueNote?.kind}
                      className="whitespace-nowrap font-semibold"
                      style={{ color: leagueAccent.color }}
                    >
                      {noteText}
                    </span>
                    <span className="text-white/24" aria-hidden>·</span>
                  </>
                ) : null}
                <span data-testid="draft-topbar-timer-summary">{autoDraft ? headerCopy.autoDrafting : timerSummary}</span>
                <span className="text-white/24" aria-hidden>·</span>
                <span>{withCount(t('draftRoom.topBar.teamsCount'), teamCount)}</span>
                <span className="text-white/24" aria-hidden>·</span>
                <span>{withCount(t('draftRoom.topBar.roundsCount'), rounds)}</span>
                <span className="text-white/24" aria-hidden>·</span>
                <span className="text-white/55">{sport}</span>
                <span className="text-white/24" aria-hidden>·</span>
                <span title={t('draftRoom.topBar.draftTypeTitle').replace('{{type}}', draftTypeLabel)}>{draftFormatLabel}</span>
                {poolReadinessLabel ? (
                  <>
                    <span className="text-white/24" aria-hidden>·</span>
                    <span
                      data-testid="draft-topbar-pool-readiness"
                      className={poolReadiness?.ready ? 'text-emerald-200' : 'text-amber-200'}
                    >
                      {poolReadinessLabel}
                    </span>
                  </>
                ) : null}
                {thirdRoundReversal ? (
                  <>
                    <span className="text-white/24" aria-hidden>·</span>
                    <span
                      data-testid="draft-topbar-third-round-reversal-badge"
                      title={t('draftRoom.topBar.thirdRoundReversalTitle')}
                      className="inline-flex items-center rounded-md border border-cyan-300/35 bg-cyan-500/14 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-100"
                    >
                      {t('draftRoom.topBar.thirdRoundReversalOn')}
                    </span>
                  </>
                ) : null}
                {showInvite ? (
                  <>
                <span className="text-white/24" aria-hidden>·</span>
                <button
                  type="button"
                  onClick={() => {
                    void handleCopyInvite('inline')
                  }}
                  data-testid="draft-copy-invite-inline"
                  className="inline-flex items-center gap-1 text-[#c6d0ff] transition duration-150 hover:text-white"
                >
                  {t('draftRoom.topBar.inviteLeaguemates')}
                  <Copy className="h-3.5 w-3.5" />
                </button>
                {copyFeedback === 'copied' ? <span className="text-cyan-300">{t('draftRoom.topBar.copied')}</span> : null}
                  </>
                ) : null}
              </div>
              {dyn && rookieAuctionNote ? (
                <p
                  data-testid="draft-topbar-rookie-auction-note"
                  className="mt-0.5 truncate text-[11px]"
                  style={{ color: DYN.faint }}
                  title={rookieAuctionNote}
                >
                  {rookieAuctionNote}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-0 flex flex-wrap items-center gap-1 sm:gap-1">
            {showAiOverlays && aiRecommendationOverlay ? (
              <div
                className="inline-flex max-w-full items-center gap-1 rounded-lg border border-cyan-300/35 bg-cyan-500/12 px-2 py-1 text-[11px] text-cyan-100"
                data-testid="draft-topbar-ai-overlay"
                title={aiRecommendationOverlay.note ?? t('draftRoom.topBarHint.aiOverlay')}
              >
                {aiRecommendationOverlay.label ? (
                  <span className="rounded border border-cyan-300/35 bg-cyan-500/20 px-1 py-0.5 font-semibold uppercase tracking-[0.1em] text-[11px]">
                    {aiRecommendationOverlay.label}
                  </span>
                ) : null}
                {aiRecommendationOverlay.playerName ? (
                  <span className="truncate max-w-[120px] font-semibold text-white">
                    {aiRecommendationOverlay.playerName}
                  </span>
                ) : null}
                {aiRecommendationOverlay.valueDelta != null && Number.isFinite(aiRecommendationOverlay.valueDelta) ? (
                  <span className={aiRecommendationOverlay.valueDelta >= 0 ? 'text-emerald-200' : 'text-amber-200'}>
                    {aiRecommendationOverlay.valueDelta >= 0
                      ? tInterpolate('draftRoom.topBarHint.valuePlus', { value: aiRecommendationOverlay.valueDelta.toFixed(1) })
                      : tInterpolate('draftRoom.topBarHint.reach', { value: aiRecommendationOverlay.valueDelta.toFixed(1) })}
                  </span>
                ) : null}
                {aiRecommendationOverlay.stackAvailable ? (
                  <span className="text-violet-100">{t('draftRoom.topBarHint.stack')}</span>
                ) : null}
                {aiRecommendationOverlay.byeWeekConflict ? (
                  <span className="text-amber-200">{t('draftRoom.topBarHint.byeConflict')}</span>
                ) : null}
                {aiRecommendationOverlay.confidencePct != null ? (
                  <span className="text-cyan-100/85">{aiRecommendationOverlay.confidencePct}%</span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {/*
          On-the-clock card: the pick number and who is on the clock sit beside the clock, so the
          one question this header answers ("whose pick, how long") reads as a single unit.
          These chips used to sit under the league name, away from the timer.
        */}
        {/*
          Room v2 (2026-11): pick, who is on the clock, the clock and "you're up in N" read as ONE
          pill, the answer to "whose pick, how long, when am I up". The pieces keep their own
          meaning (gold only when it is you, the clock's urgency colours) inside one shape.
        */}
        <div
          className="order-3 col-span-2 flex min-h-[36px] w-full flex-nowrap items-center justify-center gap-1 md:w-auto md:justify-self-center md:rounded-full md:border md:border-white/12 md:bg-[#0d1020]/85 md:p-1 md:shadow-[0_8px_28px_rgba(0,0,0,0.35)] lg:order-none lg:col-span-1 lg:min-w-[9.5rem]"
          data-testid="draft-topbar-center-slot"
          data-room-v2-pill="true"
        >
          {pickLabel ? (
            <div className="hidden items-center gap-1.5 px-2 py-1 md:inline-flex">
              <Hash className="h-4 w-4 shrink-0 text-cyan-300" />
              <span className="text-[13px] font-bold tracking-tight text-white">{pickLabel}</span>
              {overallPickNumber != null ? (
                <span className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white/60">
                  #{overallPickNumber}
                </span>
              ) : null}
            </div>
          ) : null}

          {currentManagerOnClock ? (
            /*
              8b: gold is the "act now, and it is YOU" signal.

              This chip previously rendered violet for whoever was on the clock, which made your
              own turn look exactly like everybody else's — the one state on this screen that
              demands you do something was styled identically to the eleven states that do not.
              Gold + pulse now fires only when `isCurrentUserOnClock`; another manager's turn
              stays violet, because it is information, not a call to act.

              ⚠ 8b build rule 1 asks for gold to appear NOWHERE ELSE in the product, and this
              file alone already spends amber on six other meanings: the paused state, the ≤30s
              danger timer, pool-not-ready, reach warnings, bye conflicts, and a toggle. Making
              gold literally exclusive is a colour audit across the whole draft room, not a
              top-bar change, so it is deliberately not attempted here — flagged rather than
              half-done.
            */
            <div
              className={`inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 ${
                isCurrentUserOnClock && !autoDraft
                  ? 'animate-pulse bg-amber-500/18 ring-1 ring-amber-400/45'
                  : 'md:bg-transparent max-md:border max-md:border-violet-400/25 max-md:bg-violet-500/[0.12]'
              }`}
              data-on-clock-self={isCurrentUserOnClock && !autoDraft ? 'true' : undefined}
            >
              {currentManagerAvatarUrl ? (
                <Image
                  src={currentManagerAvatarUrl}
                  alt=""
                  width={20}
                  height={20}
                  aria-hidden
                  className="h-5 w-5 shrink-0 rounded-full border border-white/20 object-cover"
                  unoptimized
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              ) : (
                <User
                  className={`h-4 w-4 shrink-0 ${
                    isCurrentUserOnClock && !autoDraft ? 'text-amber-300' : 'text-violet-300'
                  }`}
                />
              )}
              <span
                className="min-w-0 truncate text-[13px] font-bold text-white"
                data-testid="draft-topbar-on-clock-manager"
              >
                {currentManagerOnClock}
              </span>
              <span
                /* Test hook for the orphan CPU/AI label. Only set while an orphan roster is
                   on the clock, because this span otherwise renders "You're on the clock". */
                data-testid={isOrphanOnClock ? 'draft-topbar-orphan-mode-label' : undefined}
                className={`shrink-0 text-[11px] font-semibold uppercase tracking-wide ${
                  isCurrentUserOnClock && !autoDraft ? 'text-amber-100' : 'text-violet-200/75'
                }`}
              >
                {autoDraft
                  ? isCurrentUserOnClock ? headerCopy.yourAutoPick : headerCopy.autoPick
                  : isOrphanOnClock && chimmyManagerOnClock
                  ? t('draftRoom.topBarHint.chimmyPicking')
                  : isOrphanOnClock
                  ? orphanModeLabel
                  : isCurrentUserOnClock
                    ? t('draftRoom.topBarHint.youOnClock')
                    : t('draftRoom.topBar.onTheClock')}
              </span>
            </div>
          ) : null}
          {centerCta}
          {picksUntilUser != null && picksUntilUser > 0 && !isCurrentUserOnClock && draftStatus === 'in_progress' ? (
            <span
              className="hidden shrink-0 items-center rounded-full bg-cyan-400/14 px-3 py-1 text-[12px] font-extrabold text-cyan-200 md:inline-flex"
              data-testid="draft-topbar-up-in"
            >
              {headerCopy.upIn(picksUntilUser)}
            </span>
          ) : null}
        </div>

        <div className="order-2 flex flex-wrap items-center justify-end gap-1 lg:order-none">
          {controlsSlot}
          {isCommissioner && (draftStatus === 'in_progress' || draftStatus === 'paused') && ((draftStatus === 'in_progress' && onPause) || (draftStatus === 'paused' && onResume)) ? (
            <button
              type="button"
              onClick={draftStatus === 'paused' ? onResume : onPause}
              disabled={commissionerLoading || !commissionerPauseControlsEnabled}
              data-testid={draftStatus === 'paused' ? 'draft-topbar-resume-pill' : 'draft-topbar-pause-pill'}
              aria-label={draftStatus === 'paused' ? t('draftRoom.topBar.resume') : t('draftRoom.topBar.pause')}
              className={`inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition duration-150 ${
                draftStatus === 'paused'
                  ? 'border-emerald-400/40 bg-emerald-500/14 text-emerald-100 hover:bg-emerald-500/20'
                  : 'border-amber-400/40 bg-amber-500/12 text-amber-100 hover:bg-amber-500/20'
              } disabled:cursor-not-allowed disabled:opacity-45`}
              title={draftStatus === 'paused' ? t('draftRoom.topBarHint.resumeTheDraft') : t('draftRoom.topBarHint.pauseTheDraft')}
            >
              {draftStatus === 'paused' ? <Sparkles className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              {/* Icon-only on a phone: four buttons left the league name a few letters wide. */}
              <span className="max-sm:sr-only">{draftStatus === 'paused' ? t('draftRoom.topBar.resume') : t('draftRoom.topBar.pause')}</span>
            </button>
          ) : null}
          {showAutoPickPill ? (
          <button
            type="button"
            onClick={onToggleAutoPick}
            disabled={!onToggleAutoPick}
            className={`inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition duration-150 cursor-pointer ${
              autoPickEnabled
                ? 'border-emerald-400/40 bg-emerald-500/14 text-emerald-100 shadow-[0_0_16px_rgba(16,185,129,0.12)] hover:bg-emerald-500/20'
                : 'border-white/14 bg-white/6 text-white/62 hover:border-white/25 hover:bg-white/10'
            } disabled:cursor-not-allowed disabled:opacity-50`}
            data-testid="draft-topbar-autopick-pill"
            title={t('draftRoom.topBarHint.autoPickToggle')}
          >
            <span
              className={`h-2 w-2 rounded-full ${autoPickEnabled ? 'bg-emerald-300 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-white/35'}`}
              aria-hidden
            />
            <span className="hidden sm:inline">{`${t('draftRoom.topBarHint.autoPickLong')} `}</span>
            <span className="sm:hidden">{`${t('draftRoom.topBarHint.autoPickShort')} `}</span>
            {autoPickEnabled ? t('draftRoom.topBarHint.autoPickOn') : t('draftRoom.topBarHint.autoPickOff')}
          </button>
          ) : null}

          {onOpenDraftRoomSettings ? (
            /* Draft settings for everyone: commissioners and co-commissioners edit, everyone else reads,
               and after the draft nobody edits (DraftRoomSettingsModal enforces both). This replaced
               "Ask Chimmy" (Chimmy is a tab in the side dock). */
            <button
              type="button"
              onClick={onOpenDraftRoomSettings}
              data-testid="draft-topbar-settings"
              aria-label={isCommissioner ? t('draftRoom.topBarMenu.roomPreferences') : t('draftRoom.topBar.viewDraftSettings')}
              title={isCommissioner ? t('draftRoom.topBarMenu.roomPreferences') : t('draftRoom.topBar.viewDraftSettings')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/12 bg-[#7180a8]/20 text-white/85 transition duration-150 hover:bg-[#7b89af]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 active:scale-95"
            >
              <Settings2 className="h-4 w-4" aria-hidden />
            </button>
          ) : null}

          <div className="relative" ref={menuRef}>
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => {
                if (!menuOpen && menuButtonRef.current) {
                  const rect = menuButtonRef.current.getBoundingClientRect()
                  setMenuPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right })
                }
                setMenuOpen((prev) => !prev)
              }}
              data-testid="draft-topbar-menu-toggle"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/12 bg-[#7180a8]/20 text-white/85 transition duration-150 hover:bg-[#7b89af]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 active:scale-95"
              aria-expanded={menuOpen}
              aria-label={t('draftRoom.topBarHint.draftOptions')}
              title={headerCopy.roomMenu}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>

            {menuOpen && menuPos
              ? createPortal(
                <div
                  ref={menuDropdownRef}
                  className="fixed z-[9999] w-64 overflow-y-auto overscroll-contain rounded-2xl border border-white/12 bg-[#1d2638] p-2 shadow-[0_24px_80px_rgba(0,0,0,0.55)] af-draft-dark"
                  style={{ top: menuPos.top, right: Math.max(8, menuPos.right), maxHeight: `calc(100dvh - ${menuPos.top + 16}px - env(safe-area-inset-bottom, 0px))`, maxWidth: 'calc(100vw - 16px)' }}
                  data-testid="draft-topbar-menu"
                >
                <button
                  type="button"
                  onClick={handleToggleTimerMute}
                  data-testid="draft-topbar-timer-mute-toggle"
                  aria-pressed={!timerMuted}
                  title={timerMuted ? t('draftRoom.topBarHint.beepsMuted') : t('draftRoom.topBarHint.muteBeeps')}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition duration-150 hover:bg-white/8"
                >
                  {timerMuted ? <VolumeX className="h-4 w-4 shrink-0 text-white/55" /> : <Volume2 className="h-4 w-4 shrink-0 text-cyan-200" />}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-semibold text-white">{headerCopy.sound}</span>
                    <span className="text-[11px] text-white/55">{headerCopy.soundHint}</span>
                  </span>
                  <span className={`text-xs font-bold ${timerMuted ? 'text-white/55' : 'text-cyan-200'}`}>
                    {timerMuted ? headerCopy.soundOff : headerCopy.soundOn}
                  </span>
                </button>
                {showInvite ? (
                <button
                  type="button"
                  onClick={() => {
                    void handleCopyInvite('menu')
                  }}
                  data-testid="draft-topbar-copy-invite"
                  className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition duration-150 hover:bg-white/8"
                >
                  <Copy className="mt-0.5 h-4 w-4 text-[#dbe1ff]" />
                  <span>
                    <span className="block text-sm font-semibold text-white">{t('draftRoom.topBarMenu.copyInvite')}</span>
                    <span className="block text-xs text-white/55">
                      {t('draftRoom.topBarMenu.copyInviteDesc')}
                    </span>
                  </span>
                </button>
                ) : null}

                {bigScreenHref ? (
                  <Link
                    href={bigScreenHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMenuOpen(false)}
                    data-testid="draft-topbar-big-screen"
                    className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition duration-150 hover:bg-white/8"
                  >
                    <Tv className="mt-0.5 h-4 w-4 text-[#dbe1ff]" aria-hidden />
                    <span>
                      <span className="block text-sm font-semibold text-white">{t('draftRoom.topBarMenu.bigScreen')}</span>
                      <span className="block text-xs text-white/55">
                        {t('draftRoom.topBarMenu.bigScreenDesc')}
                      </span>
                    </span>
                  </Link>
                ) : null}

                {isCommissioner ? (
                  <button
                    type="button"
                    onClick={() => {
                      onCommissionerOpen?.()
                      setMenuOpen(false)
                    }}
                    data-testid="draft-topbar-set-order"
                    className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition duration-150 hover:bg-white/8"
                  >
                    <LayoutGrid className="mt-0.5 h-4 w-4 text-[#dbe1ff]" />
                    <span>
                      <span className="block text-sm font-semibold text-white">{t('draftRoom.topBarMenu.setOrder')}</span>
                      <span className="block text-xs text-white/55">{t('draftRoom.topBarMenu.setOrderDesc')}</span>
                    </span>
                  </button>
                ) : null}

                {onTradesClick ? (
                  <button
                    type="button"
                    onClick={() => {
                      onTradesClick()
                      setMenuOpen(false)
                    }}
                    data-testid="draft-open-trades-button"
                    className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition duration-150 hover:bg-white/8"
                  >
                    <ArrowLeftRight className="mt-0.5 h-4 w-4 text-[#dbe1ff]" />
                    <span>
                      <span className="block text-sm font-semibold text-white">{t('draftRoom.topBar.trades')}</span>
                      <span className="block text-xs text-white/55">
                        {pendingTradesCount > 0 ? tInterpolate(pendingTradesCount === 1 ? 'draftRoom.topBarMenu.pendingTradesOne' : 'draftRoom.topBarMenu.pendingTradesMany', { count: pendingTradesCount }) : t('draftRoom.topBarMenu.openTradeCenter')}
                      </span>
                    </span>
                  </button>
                ) : null}

                {onResync ? (
                  <button
                    type="button"
                    onClick={() => {
                      onResync()
                      setMenuOpen(false)
                    }}
                    disabled={resyncLoading}
                    data-testid="draft-resync-button"
                    className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition duration-150 hover:bg-white/8 disabled:opacity-55"
                  >
                    <RefreshCw className={`mt-0.5 h-4 w-4 text-[#dbe1ff] ${resyncLoading ? 'animate-spin' : ''}`} />
                    <span>
                      <span className="block text-sm font-semibold text-white">{t('draftRoom.topBar.resync')}</span>
                      <span className="block text-xs text-white/55">{t('draftRoom.topBarMenu.resyncDesc')}</span>
                    </span>
                  </button>
                ) : null}

                {onOpenDraftRoomSettings ? null : leagueDraftSettingsHref ? (
                  <Link
                    href={leagueDraftSettingsHref}
                    onClick={() => setMenuOpen(false)}
                    data-testid="draft-topbar-league-draft-settings"
                    className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition duration-150 hover:bg-white/8"
                  >
                    <Settings2 className="mt-0.5 h-4 w-4 text-[#dbe1ff]" />
                    <span>
                      <span className="block text-sm font-semibold text-white">{t('draftRoom.topBar.leagueDraftSettings')}</span>
                      <span className="block text-xs text-white/55">{t('draftRoom.topBarMenu.openFullSettings')}</span>
                    </span>
                  </Link>
                ) : null}

                {extraMenuItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      item.onSelect()
                      setMenuOpen(false)
                    }}
                    data-testid={item.testId}
                    className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition duration-150 hover:bg-white/8"
                  >
                    <Settings2 className="mt-0.5 h-4 w-4 text-[#dbe1ff]" aria-hidden />
                    <span>
                      <span className="block text-sm font-semibold text-white">{item.label}</span>
                      {item.description ? <span className="block text-xs text-white/55">{item.description}</span> : null}
                    </span>
                  </button>
                ))}

                {isCommissioner ? (
                  <button
                    type="button"
                    onClick={() => {
                      onCommissionerOpen?.()
                      setMenuOpen(false)
                    }}
                    data-testid="draft-topbar-open-settings"
                    title={t('draftRoom.topBarMenu.controlCenterTitle')}
                    className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition duration-150 hover:bg-white/8"
                  >
                    <Settings2 className="mt-0.5 h-4 w-4 text-[#dbe1ff]" />
                      <span>
                      <span className="block text-sm font-semibold text-white">{t('draftRoom.topBarMenu.controlCenter')}</span>
                      <span className="block text-xs text-white/55">
                        {t('draftRoom.topBarMenu.controlCenterDesc')}
                      </span>
                    </span>
                  </button>
                ) : null}

                {draftStatus === 'pre_draft' && isCommissioner && onStartDraft ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (startDraftDisabled) return
                      onStartDraft()
                      setMenuOpen(false)
                    }}
                    disabled={startDraftDisabled || commissionerLoading}
                    data-testid="draft-topbar-menu-start"
                    title={startDraftDisabled ? (poolReadinessLabel ?? t('draftRoom.topBarMenu.preparingPool')) : t('draftRoom.topBarMenu.startDraftTitle')}
                    className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition duration-150 hover:bg-white/8 disabled:opacity-45"
                  >
                    <Sparkles className="mt-0.5 h-4 w-4 text-[#dbe1ff]" />
                    <span>
                      <span className="block text-sm font-semibold text-white">{t('draftRoom.topBarMenu.startDraft')}</span>
                      <span className="block text-xs text-white/55">{t('draftRoom.topBarMenu.startDraftDesc')}</span>
                    </span>
                  </button>
                ) : null}

                {(draftStatus === 'in_progress' || draftStatus === 'paused') &&
                isCommissioner &&
                ((draftStatus === 'in_progress' && onPause) || (draftStatus === 'paused' && onResume)) ? (
                  <button
                    type="button"
                    data-testid={
                      draftStatus === 'paused' ? 'draft-topbar-menu-resume' : 'draft-topbar-menu-pause'
                    }
                    onClick={() => {
                      if (draftStatus === 'paused') {
                        onResume?.()
                      } else {
                        onPause?.()
                      }
                      setMenuOpen(false)
                    }}
                    disabled={commissionerLoading || !commissionerPauseControlsEnabled}
                    title={
                      commissionerPauseControlsEnabled
                        ? undefined
                        : t('draftRoom.topBarMenu.pauseDisabled')
                    }
                    className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition duration-150 hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Clock className="mt-0.5 h-4 w-4 text-[#dbe1ff]" />
                    <span>
                      <span className="block text-sm font-semibold text-white">
                        {draftStatus === 'paused' ? t('draftRoom.topBarMenu.resumeDraft') : t('draftRoom.topBarMenu.pauseDraft')}
                      </span>
                      <span className="block text-xs text-white/55">
                        {draftStatus === 'paused' ? t('draftRoom.topBarMenu.resumeDraftDesc') : t('draftRoom.topBarMenu.pauseDraftDesc')}
                      </span>
                    </span>
                  </button>
                ) : null}

                {isCommissioner && onRunAiPick && isOrphanOnClock ? (
                  <button
                    type="button"
                    onClick={() => {
                      onRunAiPick()
                      setMenuOpen(false)
                    }}
                    disabled={runAiPickLoading}
                    className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition duration-150 hover:bg-white/8 disabled:opacity-55"
                  >
                    <Sparkles className="mt-0.5 h-4 w-4 text-violet-200" />
                    <span>
                      <span className="block text-sm font-semibold text-white">
                        {runAiPickLoading ? t('draftRoom.topBarMenu.runningAiPick') : t('draftRoom.topBarMenu.runAiPick')}
                      </span>
                      <span className="block text-xs text-white/55">
                        {t('draftRoom.topBarMenu.runAiPickDesc')}
                      </span>
                    </span>
                  </button>
                ) : null}

                {isCommissioner && (onResetTimer || onUndoPick) ? (
                  <div className="mt-1 grid grid-cols-2 gap-2 border-t border-white/8 px-1 pt-3">
                    {onResetTimer ? (
                      <button
                        type="button"
                        onClick={() => {
                          onResetTimer()
                          setMenuOpen(false)
                        }}
                        disabled={commissionerLoading}
                        data-testid="draft-topbar-reset-timer"
                        className="rounded-xl border border-white/12 bg-white/5 px-3 py-2 text-xs text-white/82 transition duration-150 hover:bg-white/12 disabled:opacity-45"
                      >
                        {t('draftRoom.topBarMenu.resetTimer')}
                      </button>
                    ) : null}
                    {onUndoPick ? (
                      <button
                        type="button"
                        onClick={() => {
                          onUndoPick()
                          setMenuOpen(false)
                        }}
                        disabled={commissionerLoading}
                        data-testid="draft-topbar-undo-pick"
                        className="rounded-xl border border-red-400/25 bg-red-500/12 px-3 py-2 text-xs text-red-100 transition duration-150 hover:bg-red-500/20 disabled:opacity-45"
                      >
                        {t('draftRoom.topBarMenu.undoPick')}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>,
                document.body
              )
              : null}
          </div>

          {isReconnecting ? (
            <span
              className={`self-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
                rs
                  ? 'border-amber-400/35 bg-amber-500/15 text-amber-100 shadow-[0_0_20px_rgba(251,191,36,0.25)]'
                  : 'text-amber-300'
              }`}
              title={t('draftRoom.topBarHint.syncIssueTitle')}
            >
              {t('draftRoom.topBarHint.syncIssue')}
            </span>
          ) : null}
        </div>
      </div>

      {showUseQueue && onUseQueue ? (
        <div className="mt-3 flex justify-start lg:justify-end">
          <button
            type="button"
            onClick={onUseQueue}
            disabled={useQueueLoading}
            data-testid="draft-use-queue-button"
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-full border border-cyan-300/35 bg-gradient-to-r from-cyan-500/18 to-violet-500/12 px-4 py-2 text-xs font-semibold text-cyan-100 shadow-[0_8px_28px_rgba(34,211,238,0.15)] transition duration-150 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/45 disabled:opacity-55 active:scale-[0.98]"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {useQueueLoading ? t('draftRoom.topBarHint.usingQueue') : t('draftRoom.topBar.useQueue')}
          </button>
        </div>
      ) : null}
    </header>
  )
}
