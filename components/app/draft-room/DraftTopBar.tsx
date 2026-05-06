'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowLeftRight,
  Clock,
  Copy,
  Grid2x2,
  Hash,
  LayoutGrid,
  Menu,
  Pause,
  RefreshCw,
  Settings2,
  Shield,
  Sparkles,
  Tv,
  User,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { formatTimerRemaining } from '@/lib/live-draft-engine/DraftTimerService'
import { useDraftCountdownSeconds } from '@/lib/draft/useDraftCountdown'
import type { TimerMode } from '@/lib/draft-defaults/DraftUISettingsResolver'

export type DraftTopBarProps = {
  leagueName: string
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
  /** Orphan roster on clock: show CPU/AI Manager badge and allow Run pick */
  isOrphanOnClock?: boolean
  /** When orphan on clock: 'cpu' | 'ai' - label shows "CPU Manager" or "AI Manager" */
  orphanDrafterMode?: 'cpu' | 'ai'
  /** Selected setting mode; used to show fallback state when requested AI runs in CPU fallback. */
  orphanDrafterRequestedMode?: 'cpu' | 'ai'
  /** True when requested AI mode fell back to CPU due unavailable providers/errors. */
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
  /** Number of browsers currently viewing the draft room (from the live-draft presence channel). */
  onlineCount?: number
  /** `redraft_snake` — show format chips and slightly stronger header chrome (snake redraft live URL). */
  draftRoomPresentation?: 'default' | 'redraft_snake'
  /** Slice 2 — surface "3RR ON" badge in header meta line when commissioner enabled Third Round Reversal. */
  thirdRoundReversal?: boolean
  /** When set, the overflow menu shows a "Big Screen / Cast Board" entry that opens this URL in a new tab. */
  bigScreenHref?: string | null
}

const TIMER_COLORS = {
  running: 'text-emerald-300 border-emerald-400/25 bg-emerald-500/10',
  paused: 'text-amber-200 border-amber-400/25 bg-amber-500/10',
  expired: 'text-red-200 border-red-400/25 bg-red-500/10',
  none: 'text-white/70 border-white/12 bg-white/5',
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

function translateTimerMode(mode: TimerMode, t: (key: string) => string): string {
  const key = `draftRoom.timerMode.${mode}`
  const out = t(key)
  if (out !== key) return out
  return mode.replace(/_/g, ' ')
}

function resolveDraftFormatLabel(
  draftType: string,
  thirdRoundReversal: boolean,
): string {
  const norm = draftType.trim().toLowerCase()
  if (norm === 'auction') return 'Auction'
  if (norm === 'linear') return 'Linear'
  if (norm === 'snake') return thirdRoundReversal ? 'Snake + 3RR' : 'Snake'
  return draftType
}

function formatTimerSummary(timerSeconds: number | null | undefined): string {
  if (!timerSeconds || timerSeconds <= 0) return 'Untimed picks'
  if (timerSeconds < 60) return `${timerSeconds} Seconds Per Pick`
  if (timerSeconds < 3600) {
    const minutes = Math.round(timerSeconds / 60)
    return `${minutes} Minute${minutes === 1 ? '' : 's'} Per Pick`
  }
  if (timerSeconds < 86400) {
    const hours = Math.round(timerSeconds / 3600)
    return `${hours} Hour${hours === 1 ? '' : 's'} Per Pick`
  }
  const days = Math.round(timerSeconds / 86400)
  return `${days} Day${days === 1 ? '' : 's'} Per Pick`
}

export function DraftTopBar({
  leagueName,
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
  timerStatus,
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
  thirdRoundReversal = false,
  bigScreenHref = null,
}: DraftTopBarProps) {
  const { t } = useLanguage()
  const liveRemaining = useDraftCountdownSeconds(
    timerStatus,
    timerEndAtIso ?? undefined,
    timerRemainingSeconds,
    { pauseReason: timerPauseReason, overnightResumeAtIso },
  )
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
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
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [menuOpen])

  const effectiveRemaining =
    timerStatus === 'running' && timerEndAtIso != null && timerEndAtIso !== ''
      ? liveRemaining
      : timerRemainingSeconds

  const resumeInSeconds =
    timerPauseReason === 'overnight_window' && overnightResumeAtIso
      ? Math.max(
          0,
          Math.ceil((new Date(overnightResumeAtIso).getTime() - Date.now()) / 1000),
        )
      : null

  const timerDisplay =
    timerStatus === 'none' || (effectiveRemaining == null && timerStatus !== 'paused' && timerStatus !== 'expired')
      ? '-'
      : timerStatus === 'paused' && effectiveRemaining == null
        ? t('draftRoom.topBar.timerPaused')
        : timerStatus === 'expired'
          ? formatTimerRemaining(0)
          : formatTimerRemaining(effectiveRemaining ?? 0)

  const timerSummary = useMemo(() => formatTimerSummary(timerSeconds), [timerSeconds])
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
  const statusLabel = translateDraftStatus(draftStatus, t)
  const draftTypeLabel = translateDraftType(draftType, t)
  const draftFormatLabel = resolveDraftFormatLabel(draftType, thirdRoundReversal)
  const timerModeLabel = translateTimerMode(timerMode, t)

  const centerCta = (() => {
    /** Completed state: show a clear broadcast "Draft Complete" badge. */
    if (draftStatus === 'completed') {
      return (
        <div className="inline-flex min-h-[44px] items-center gap-2.5 rounded-full border border-emerald-400/35 bg-gradient-to-br from-emerald-500/18 via-[#0a1228] to-[#070d18] px-5 py-2.5 text-sm font-bold text-emerald-50 shadow-[0_8px_28px_rgba(16,185,129,0.18)]">
          <Sparkles className="h-4 w-4 shrink-0 text-emerald-300" />
          <span>Draft Complete</span>
        </div>
      )
    }

    if (draftStatus === 'pre_draft' && isCommissioner && onStartDraft) {
      return (
        <button
          type="button"
          onClick={onStartDraft}
          disabled={commissionerLoading}
          data-testid="draft-topbar-start-draft"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[#aeb7ff]/40 bg-gradient-to-r from-[#9ca9ff] to-[#8b7fd8] px-6 py-3 text-sm font-semibold text-[#0a1030] shadow-[0_12px_36px_rgba(139,127,216,0.35)] transition duration-150 hover:brightness-110 hover:shadow-[0_14px_40px_rgba(156,169,255,0.4)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 active:scale-[0.98] disabled:opacity-55"
        >
          <Grid2x2 className="h-4 w-4" />
          START DRAFT
        </button>
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
    const showLiveTimer =
      timerStatus === 'running' || timerStatus === 'paused' || timerStatus === 'expired'
    const isPausedCommissioner = draftStatus === 'paused' && isCommissioner && Boolean(onResume)

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
          <span data-testid="draft-topbar-clock-time">{timerDisplay}</span>
          {isPausedCommissioner ? (
            <span className="rounded border border-emerald-300/45 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-50">
              Resume
            </span>
          ) : draftStatus === 'paused' ? (
            <span className="rounded border border-white/15 bg-white/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/75">
              Paused
            </span>
          ) : null}
        </>
      )
      const pillClassName = `inline-flex min-h-[52px] items-center gap-3 rounded-full border px-6 py-3 text-2xl font-extrabold tabular-nums shadow-[0_10px_32px_rgba(0,0,0,0.4)] transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 ${
        criticalLowTimer
          ? 'animate-pulse border-rose-500/65 bg-gradient-to-br from-rose-600/35 to-rose-500/20 text-rose-50 ring-2 ring-rose-500/55 shadow-[0_0_48px_rgba(239,68,68,0.5)]'
          : urgentLowTimer
            ? 'animate-pulse border-rose-400/55 bg-gradient-to-br from-rose-500/30 to-amber-500/20 text-rose-50'
            : draftStatus === 'paused'
              ? 'border-emerald-400/45 bg-gradient-to-br from-emerald-500/25 to-emerald-600/15 text-emerald-50 hover:brightness-110'
              : 'border-cyan-400/40 bg-gradient-to-br from-cyan-500/22 to-violet-600/15 text-cyan-50'
      } ${
        handlePillClick
          ? 'cursor-pointer hover:shadow-[0_14px_40px_rgba(34,211,238,0.25)] active:scale-[0.98] disabled:opacity-55'
          : 'cursor-default'
      }`
      const pillTooltip = isPausedCommissioner
        ? 'Click to resume the draft. Time remaining is restored from when it was paused.'
        : draftStatus === 'paused'
          ? 'Draft is paused by the commissioner. Resume from the commissioner control center.'
          : criticalLowTimer
            ? 'Pick clock under 5 seconds — autopick about to fire.'
            : urgentLowTimer
              ? 'Pick clock under 10 seconds.'
              : timerStatus === 'expired'
                ? 'Pick clock expired. Soft timer leagues wait for a manual pick.'
                : 'On-the-clock pick timer.'
      if (handlePillClick) {
        return (
          <button
            type="button"
            onClick={handlePillClick}
            disabled={commissionerLoading}
            aria-label="Resume draft"
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

    return (
      <div className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-4 py-3 text-sm text-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-sm">
        <Clock className="h-4 w-4 shrink-0 text-cyan-300/90" />
        <span className="font-medium">{statusLabel}</span>
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

  return (
    <header
      className={`relative border-b px-3 pb-2 pt-2 backdrop-blur-xl sm:px-4 ${
        rs
          ? 'border-cyan-400/25 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(34,211,238,0.14),transparent),linear-gradient(180deg,#0b1829_0%,#060f1e_45%,#050814_100%)] shadow-[0_16px_56px_rgba(8,145,178,0.14)]'
          : 'border-white/[0.07] bg-gradient-to-b from-[#070d1c]/95 via-[#060b19]/98 to-[#050814]'
      }`}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/25 to-transparent"
        aria-hidden
      />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-start lg:gap-4">
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            {backHref ? (
              <Link
                href={backHref}
                data-testid="draft-back-button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.06] text-white/78 shadow-sm transition duration-150 hover:bg-white/12 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 active:scale-95"
                aria-label={t('draftRoom.topBar.back')}
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
            ) : null}

            {leagueLogoUrl ? (
              <Image
                src={leagueLogoUrl}
                alt=""
                width={40}
                height={40}
                aria-hidden
                className="h-10 w-10 shrink-0 rounded-xl border border-white/15 bg-gradient-to-br from-white/[0.08] to-white/[0.02] object-cover shadow-[0_4px_20px_rgba(0,0,0,0.35)] ring-1 ring-white/10"
                data-testid="draft-topbar-league-logo"
                unoptimized
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            ) : null}

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-bold tracking-tight text-white drop-shadow-sm sm:text-xl">
                  {leagueName}
                </h1>
                {onlineCount != null && onlineCount > 0 && (
                  <span
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/12 px-2 py-0.5 text-[10px] font-semibold text-emerald-100 shadow-[0_0_12px_rgba(16,185,129,0.15)]"
                    title={`${onlineCount} manager${onlineCount === 1 ? '' : 's'} online`}
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
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#97a8d7]">
                <span>{timerSummary}</span>
                <span className="text-white/24">·</span>
                <span>{teamCount} Teams</span>
                <span className="text-white/24">·</span>
                <span>{rounds} Rounds</span>
                <span className="text-white/24">·</span>
                <span className="text-white/55">{sport}</span>
                <span className="text-white/24">·</span>
                <span title={`Draft type: ${draftTypeLabel}`}>{draftFormatLabel}</span>
                {thirdRoundReversal ? (
                  <>
                    <span className="text-white/24">·</span>
                    <span
                      data-testid="draft-topbar-third-round-reversal-badge"
                      title="Third Round Reversal: rounds 2 and 3 go in the same direction."
                      className="inline-flex items-center rounded-md border border-cyan-300/35 bg-cyan-500/14 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-100"
                    >
                      3RR On
                    </span>
                  </>
                ) : null}
                <span className="text-white/24">·</span>
                <button
                  type="button"
                  onClick={() => {
                    void handleCopyInvite('inline')
                  }}
                  data-testid="draft-copy-invite-inline"
                  className="inline-flex items-center gap-1 text-[#c6d0ff] transition duration-150 hover:text-white"
                >
                  Invite Leaguemates
                  <Copy className="h-3.5 w-3.5" />
                </button>
                {copyFeedback === 'copied' ? <span className="text-cyan-300">Copied</span> : null}
              </div>
              <div
                className="mt-2 grid grid-cols-2 gap-1.5 rounded-lg border border-white/10 bg-black/20 p-2 text-[10px] text-white/75 md:hidden"
                data-testid="draft-topbar-mobile-compact"
              >
                <div className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1">
                  <span className="block text-[9px] uppercase tracking-[0.14em] text-white/45">Format</span>
                  <span className="block font-semibold text-cyan-100">{draftFormatLabel}</span>
                </div>
                <div className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1">
                  <span className="block text-[9px] uppercase tracking-[0.14em] text-white/45">Status</span>
                  <span className="block font-semibold text-white">{statusLabel}</span>
                </div>
                <div className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1">
                  <span className="block text-[9px] uppercase tracking-[0.14em] text-white/45">Current</span>
                  <span className="block font-semibold text-white">{pickLabel ?? '—'}</span>
                </div>
                <div className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1">
                  <span className="block text-[9px] uppercase tracking-[0.14em] text-white/45">Clock</span>
                  <span className="block font-semibold text-cyan-100">{timerDisplay}</span>
                </div>
              </div>
              {isCommissioner && onCommissionerOpen ? (
                <button
                  type="button"
                  onClick={onCommissionerOpen}
                  data-testid="draft-topbar-commissioner-primary"
                  disabled={commissionerLoading}
                  className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-amber-400/45 bg-amber-500/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-100 shadow-[0_4px_20px_rgba(245,158,11,0.18)] transition duration-150 hover:bg-amber-500/22 hover:border-amber-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/55 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.99]"
                >
                  <Shield className="h-4 w-4 shrink-0 text-amber-100" aria-hidden />
                  Commissioner control center
                </button>
              ) : null}
            </div>
          </div>

          {rs && isCommissioner && (draftStatus === 'in_progress' || draftStatus === 'paused') && (onPause || onResume) ? (
            <div
              className="mt-3 flex max-w-xl flex-wrap items-center gap-2 sm:max-w-2xl"
              data-testid="draft-topbar-commissioner-governance"
            >
              {draftStatus === 'in_progress' && onPause ? (
                <button
                  type="button"
                  data-testid="draft-topbar-pause-draft"
                  onClick={onPause}
                  disabled={commissionerLoading || !commissionerPauseControlsEnabled}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-500/12 px-3.5 py-2 text-xs font-semibold text-amber-100 shadow-sm transition duration-150 hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/50 disabled:cursor-not-allowed disabled:opacity-45"
                  title={
                    commissionerPauseControlsEnabled
                      ? 'Pause the draft for everyone'
                      : 'Pause controls are off in league draft / automation settings'
                  }
                >
                  <Pause className="h-3.5 w-3.5" />
                  Pause
                </button>
              ) : null}
              {draftStatus === 'paused' && onResume ? (
                <button
                  type="button"
                  onClick={onResume}
                  disabled={commissionerLoading || !commissionerPauseControlsEnabled}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-3.5 py-2 text-xs font-semibold text-emerald-50 shadow-sm transition duration-150 hover:bg-emerald-500/22 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/45 disabled:cursor-not-allowed disabled:opacity-45"
                  title={
                    commissionerPauseControlsEnabled
                      ? 'Resume the draft for everyone'
                      : 'Pause controls are off in league draft / automation settings'
                  }
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Resume
                </button>
              ) : null}
              {draftStatus === 'in_progress' && onResetTimer ? (
                <button
                  type="button"
                  onClick={onResetTimer}
                  disabled={commissionerLoading}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-cyan-400/35 bg-cyan-500/10 px-3.5 py-2 text-xs font-semibold text-cyan-50 transition duration-150 hover:bg-cyan-500/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/45 disabled:opacity-45"
                  title="Reset pick clock for the current pick"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Reset timer
                </button>
              ) : null}
              {onCommissionerOpen ? (
                <button
                  type="button"
                  onClick={onCommissionerOpen}
                  disabled={commissionerLoading}
                  data-testid="draft-topbar-assign-pick-open"
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-violet-400/35 bg-violet-500/12 px-3.5 py-2 text-xs font-semibold text-violet-100 transition duration-150 hover:bg-violet-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/45 disabled:opacity-45"
                  title="Open commissioner tools to assign or edit a pick"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  Assign pick
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-2 sm:gap-2.5">
            {pickLabel ? (
              <div
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 shadow-[0_4px_24px_rgba(34,211,238,0.12)] ring-1 ring-cyan-400/15 ${
                  rs
                    ? 'border-cyan-400/35 bg-gradient-to-br from-cyan-500/18 via-[#0c1828]/95 to-[#081018]/98 shadow-[0_8px_36px_rgba(34,211,238,0.18)]'
                    : 'border-cyan-400/25 bg-gradient-to-br from-cyan-500/[0.12] to-[#0a1528]/90'
                }`}
              >
                <Hash className="h-4 w-4 shrink-0 text-cyan-300" />
                <span className="text-sm font-bold tracking-tight text-white sm:text-base">{pickLabel}</span>
                {overallPickNumber != null ? (
                  <span className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white/60">
                    #{overallPickNumber}
                  </span>
                ) : null}
              </div>
            ) : null}

            {currentManagerOnClock ? (
              <div
                className={`inline-flex max-w-full items-center gap-2 rounded-xl border px-3 py-1.5 ring-1 ${
                  rs
                    ? 'border-violet-400/40 bg-[radial-gradient(ellipse_at_30%_0%,rgba(139,92,246,0.28),transparent),linear-gradient(145deg,rgba(109,40,217,0.22),rgba(8,15,28,0.96))] shadow-[0_12px_40px_rgba(139,92,246,0.22)] ring-violet-400/25'
                    : 'border-violet-400/25 bg-gradient-to-br from-violet-500/[0.14] to-[#0a1228]/95 shadow-[0_6px_28px_rgba(139,92,246,0.15)] ring-violet-400/10'
                }`}
              >
                {currentManagerAvatarUrl ? (
                  <Image
                    src={currentManagerAvatarUrl}
                    alt=""
                    width={22}
                    height={22}
                    aria-hidden
                    className="h-[22px] w-[22px] shrink-0 rounded-full border border-white/20 object-cover"
                    unoptimized
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                    }}
                  />
                ) : (
                  <User className="h-4 w-4 shrink-0 text-violet-300" />
                )}
                <span
                  className="min-w-0 truncate text-sm font-bold text-white sm:text-base"
                  data-testid="draft-topbar-on-clock-manager"
                >
                  {currentManagerOnClock}
                </span>
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-violet-200/75">
                  {isOrphanOnClock
                    ? orphanModeLabel
                    : isCurrentUserOnClock
                      ? "You're on the clock"
                      : t('draftRoom.topBar.onTheClock')}
                </span>
              </div>
            ) : null}

            <div className="flex min-w-[7.25rem] flex-col items-stretch gap-0.5 sm:min-w-[8rem]">
              <div
                className={`inline-flex min-h-[44px] min-w-full items-center gap-2 rounded-2xl border px-4 py-2 transition-all duration-200 sm:min-h-[52px] sm:justify-center ${criticalLowTimer ? 'text-rose-50 border-rose-500/55 bg-rose-500/15' : TIMER_COLORS[timerStatus]} ${
                  criticalLowTimer
                    ? 'relative z-0 shadow-[0_0_56px_rgba(239,68,68,0.55)] ring-2 ring-rose-500/65 animate-pulse sm:scale-105'
                    : urgentLowTimer
                      ? 'relative z-0 shadow-[0_0_48px_rgba(251,191,36,0.5)] ring-2 ring-amber-400/70 animate-pulse sm:scale-105'
                      : rs
                      ? 'shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_8px_32px_rgba(0,0,0,0.35)]'
                      : 'shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                }`}
                title={`${timerModeLabel} · Auto-pick ${autoPickEnabled ? 'on' : 'off'}`}
              >
                <Clock
                  className={`h-4 w-4 shrink-0 ${urgentLowTimer ? 'text-amber-100 drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]' : ''}`}
                  aria-hidden
                />
                <span
                  className={`font-bold tabular-nums tracking-tight transition-all duration-200 ${
                    urgentLowTimer ? 'text-2xl text-amber-50 sm:text-3xl' : 'text-sm font-semibold'
                  }`}
                  data-testid="draft-topbar-timer-value"
                >
                  {timerDisplay}
                </span>
              </div>
              {timerPauseReason === 'overnight_window' && resumeInSeconds != null && overnightResumeAtIso ? (
                <p
                  className="text-center text-[10px] font-medium leading-tight text-amber-100/80"
                  data-testid="draft-topbar-overnight-resume"
                >
                  Quiet window · resumes in {formatTimerRemaining(resumeInSeconds)} (
                  {new Date(overnightResumeAtIso).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                  )
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <div
          className="flex min-h-[52px] w-full items-center justify-center lg:w-auto lg:min-w-[13.5rem]"
          data-testid="draft-topbar-center-slot"
        >
          {centerCta}
        </div>

        <div className="flex flex-wrap items-start justify-start gap-2 lg:justify-end">
          <button
            type="button"
            onClick={onToggleAutoPick}
            disabled={!onToggleAutoPick}
            className={`inline-flex h-9 items-center gap-2 rounded-full border px-3 text-[10px] font-semibold uppercase tracking-[0.14em] transition duration-150 cursor-pointer ${
              autoPickEnabled
                ? 'border-emerald-400/40 bg-emerald-500/14 text-emerald-100 shadow-[0_0_16px_rgba(16,185,129,0.12)] hover:bg-emerald-500/20'
                : 'border-white/14 bg-white/6 text-white/62 hover:border-white/25 hover:bg-white/10'
            } disabled:cursor-not-allowed disabled:opacity-50`}
            data-testid="draft-topbar-autopick-pill"
            title="Toggle autopick: when enabled, will auto-pick when timer expires"
          >
            <span
              className={`h-2 w-2 rounded-full ${autoPickEnabled ? 'bg-emerald-300 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-white/35'}`}
              aria-hidden
            />
            Auto-pick {autoPickEnabled ? 'On' : 'Off'}
          </button>

          <button
            type="button"
            onClick={handleToggleTimerMute}
            data-testid="draft-topbar-timer-mute-toggle"
            aria-pressed={timerMuted}
            title={timerMuted ? 'Timer beeps muted — click to enable' : 'Mute timer beeps (10s / 5s / final)'}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition duration-150 cursor-pointer ${
              timerMuted
                ? 'border-white/14 bg-white/6 text-white/55 hover:border-white/25 hover:bg-white/10'
                : 'border-cyan-400/30 bg-cyan-500/12 text-cyan-100 shadow-[0_0_10px_rgba(34,211,238,0.12)] hover:bg-cyan-500/18'
            }`}
          >
            {timerMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>

          {onTradesClick ? (
            <button
              type="button"
              onClick={onTradesClick}
              data-testid="draft-open-trades-button"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/12 bg-[#7180a8]/20 px-3 text-[11px] font-medium text-white/90 shadow-sm transition duration-150 hover:border-cyan-400/30 hover:bg-[#7b89af]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 active:scale-95"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              Trades
              {pendingTradesCount > 0 ? (
                <span className="rounded-full border border-cyan-400/35 bg-cyan-500/18 px-1.5 py-0.5 text-[10px] font-bold text-cyan-100">
                  {pendingTradesCount}
                </span>
              ) : null}
            </button>
          ) : null}

          {onResync ? (
            <button
              type="button"
              onClick={onResync}
              disabled={resyncLoading}
              data-testid="draft-resync-button"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/12 bg-[#7180a8]/20 px-3 text-[11px] font-medium text-white/85 transition duration-150 hover:bg-[#7b89af]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 disabled:opacity-55 active:scale-95"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${resyncLoading ? 'animate-spin' : ''}`} />
              Resync
            </button>
          ) : null}

          {onOpenDraftRoomSettings ? (
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={onOpenDraftRoomSettings}
                data-testid="draft-topbar-league-draft-settings"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/12 bg-[#7180a8]/20 text-white/85 transition duration-150 hover:bg-[#7b89af]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 active:scale-95"
                aria-label={
                  isCommissioner
                    ? t('draftRoom.topBar.aria.editDraftSettings')
                    : t('draftRoom.topBar.aria.viewDraftSettings')
                }
                title={isCommissioner ? t('draftRoom.topBar.editDraftSettings') : t('draftRoom.topBar.viewDraftSettings')}
              >
                <Settings2 className="h-4 w-4" />
              </button>
            </div>
          ) : leagueDraftSettingsHref ? (
            <div className="inline-flex items-center gap-1">
              <Link
                href={leagueDraftSettingsHref}
                data-testid="draft-topbar-league-draft-settings"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/12 bg-[#7180a8]/20 text-white/85 transition duration-150 hover:bg-[#7b89af]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 active:scale-95"
                aria-label={t('draftRoom.topBar.aria.leagueDraftSettings')}
                title={t('draftRoom.topBar.leagueDraftSettings')}
              >
                <Settings2 className="h-4 w-4" />
              </Link>
            </div>
          ) : isCommissioner ? (
            <button
              type="button"
              onClick={onCommissionerOpen}
              data-testid="draft-open-commissioner-controls"
              disabled={commissionerLoading}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/12 bg-[#7180a8]/20 text-white/85 transition duration-150 hover:bg-[#7b89af]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 disabled:opacity-55 active:scale-95"
              aria-label={t('draftRoom.topBar.aria.commissioner')}
              title={t('draftRoom.topBar.commissioner')}
            >
              <Settings2 className="h-4 w-4" />
            </button>
          ) : null}

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              data-testid="draft-topbar-menu-toggle"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/12 bg-[#7180a8]/20 text-white/85 transition duration-150 hover:bg-[#7b89af]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 active:scale-95"
              aria-expanded={menuOpen}
              aria-label="Draft options"
            >
              <Menu className="h-4 w-4" />
            </button>

            {menuOpen ? (
              <div
                className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-2xl border border-white/12 bg-[#1d2638]/96 p-2 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl"
                data-testid="draft-topbar-menu"
              >
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
                    <span className="block text-sm font-semibold text-white">Copy Invite Link</span>
                    <span className="block text-xs text-white/55">
                      Your friends can join via this link
                    </span>
                  </span>
                </button>

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
                      <span className="block text-sm font-semibold text-white">Big Screen Mode</span>
                      <span className="block text-xs text-white/55">
                        Read-only board view for casting to a TV.
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
                      <span className="block text-sm font-semibold text-white">Set Draft Order</span>
                      <span className="block text-xs text-white/55">Set or edit the draft order</span>
                    </span>
                  </button>
                ) : null}

                {isCommissioner ? (
                  <button
                    type="button"
                    onClick={() => {
                      onCommissionerOpen?.()
                      setMenuOpen(false)
                    }}
                    data-testid="draft-topbar-open-settings"
                    title="Commissioner control center"
                    className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition duration-150 hover:bg-white/8"
                  >
                    <Settings2 className="mt-0.5 h-4 w-4 text-[#dbe1ff]" />
                    <span>
                      <span className="block text-sm font-semibold text-white">Draft Settings</span>
                      <span className="block text-xs text-white/55">
                        Draft order, timer, scoring, and more
                      </span>
                    </span>
                  </button>
                ) : null}

                {draftStatus === 'pre_draft' && isCommissioner && onStartDraft ? (
                  <button
                    type="button"
                    onClick={() => {
                      onStartDraft()
                      setMenuOpen(false)
                    }}
                    data-testid="draft-topbar-menu-start"
                    className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition duration-150 hover:bg-white/8"
                  >
                    <Sparkles className="mt-0.5 h-4 w-4 text-[#dbe1ff]" />
                    <span>
                      <span className="block text-sm font-semibold text-white">Start Draft</span>
                      <span className="block text-xs text-white/55">Finalize settings and start the draft now</span>
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
                        : 'Pause controls are disabled in league draft / automation settings'
                    }
                    className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition duration-150 hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Clock className="mt-0.5 h-4 w-4 text-[#dbe1ff]" />
                    <span>
                      <span className="block text-sm font-semibold text-white">
                        {draftStatus === 'paused' ? 'Resume Draft' : 'Pause Draft'}
                      </span>
                      <span className="block text-xs text-white/55">
                        {draftStatus === 'paused' ? 'Restart the draft timer' : 'Pause the current draft clock'}
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
                        {runAiPickLoading ? 'Running AI Pick' : 'Run AI Pick'}
                      </span>
                      <span className="block text-xs text-white/55">
                        Trigger the orphan team drafter for the current pick
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
                        className="rounded-xl border border-white/12 bg-white/5 px-3 py-2 text-xs text-white/82 transition duration-150 hover:bg-white/12 disabled:opacity-45"
                      >
                        Reset Timer
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
                        className="rounded-xl border border-red-400/25 bg-red-500/12 px-3 py-2 text-xs text-red-100 transition duration-150 hover:bg-red-500/20 disabled:opacity-45"
                      >
                        Undo Pick
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {isReconnecting ? (
            <span
              className={`self-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                rs
                  ? 'border-amber-400/35 bg-amber-500/15 text-amber-100 shadow-[0_0_20px_rgba(251,191,36,0.25)]'
                  : 'text-amber-300'
              }`}
              title="Draft session poll failed several times in a row. The room keeps your last good snapshot; polls retry automatically."
            >
              Sync issue
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
            {useQueueLoading ? 'Using Queue...' : t('draftRoom.topBar.useQueue')}
          </button>
        </div>
      ) : null}
    </header>
  )
}
