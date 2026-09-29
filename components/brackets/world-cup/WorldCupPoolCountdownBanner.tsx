"use client"
import { useEffect, useMemo, useState } from "react"
import { ChevronRight, Clock, Lock, Trophy } from "lucide-react"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorldCupCountdownFirstMatch {
  homeTeamName: string
  awayTeamName: string
  startsAt: string | null
  venueName?: string | null
  venueCity?: string | null
}

type BannerState = "countdown" | "urgent24h" | "urgent1h" | "locked" | "no_lock_time"

interface TimeLeft {
  days: number
  hours: number
  minutes: number
  seconds: number
  totalMs: number
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function calcTimeLeft(lockAtIso: string): TimeLeft {
  const ms = Math.max(0, new Date(lockAtIso).getTime() - Date.now())
  const totalS = Math.floor(ms / 1000)
  return {
    days: Math.floor(totalS / 86400),
    hours: Math.floor((totalS % 86400) / 3600),
    minutes: Math.floor((totalS % 3600) / 60),
    seconds: totalS % 60,
    totalMs: ms,
  }
}

function formatKickoffLocal(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

// ── Digit cell ────────────────────────────────────────────────────────────────

function DigitBlock({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className={`text-2xl font-black leading-none tabular-nums sm:text-3xl ${color}`}>{value}</span>
      <span className="mt-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/30">{label}</span>
    </div>
  )
}

function Colon({ color }: { color: string }) {
  return (
    <span className={`mb-3 text-xl font-black leading-none tabular-nums ${color} opacity-50`}>:</span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function WorldCupPoolCountdownBanner({
  lockAt,
  isLocked,
  firstMatch,
  onFinishPicks,
  onViewLeaderboard,
}: {
  /** ISO string — resolved effective pick-lock time (same value the lock system uses). */
  lockAt: string | null
  isLocked: boolean
  /** Optional first match info to surface in the banner. */
  firstMatch?: WorldCupCountdownFirstMatch
  /** Called when the user clicks the "Make/Finish Picks" CTA. */
  onFinishPicks: () => void
  /** Called when the user clicks "View Leaderboard". */
  onViewLeaderboard: () => void
}) {
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])

  // Hydration-safe: null on server, populated after mount.
  const [timeLeft, setTimeLeft] = useState<TimeLeft | null>(null)

  useEffect(() => {
    if (!lockAt || isLocked) return
    setTimeLeft(calcTimeLeft(lockAt))
    const id = window.setInterval(() => {
      const tl = calcTimeLeft(lockAt)
      setTimeLeft(tl)
      if (tl.totalMs === 0) window.clearInterval(id)
    }, 1000)
    return () => window.clearInterval(id)
  }, [lockAt, isLocked])

  // ── Derive banner state ──────────────────────────────────────────────

  let state: BannerState
  if (isLocked || (timeLeft !== null && timeLeft.totalMs === 0)) {
    state = "locked"
  } else if (!lockAt) {
    state = "no_lock_time"
  } else if (timeLeft === null) {
    // Still hydrating — treat as countdown to avoid flash
    state = "countdown"
  } else if (timeLeft.totalMs < 60 * 60 * 1000) {
    state = "urgent1h"
  } else if (timeLeft.totalMs < 24 * 60 * 60 * 1000) {
    state = "urgent24h"
  } else {
    state = "countdown"
  }

  // ── Fallback (no lock time known) ────────────────────────────────────

  if (state === "no_lock_time") {
    return (
      <div
        data-testid="wc-countdown-banner-fallback"
        className="mx-3 mb-1 mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 sm:mx-4"
      >
        <div className="flex items-center gap-2 text-xs text-white/50">
          <Clock className="h-3.5 w-3.5 shrink-0 text-white/30" aria-hidden />
          <span>
            <span className="font-bold text-white/60">{t("wc.countdown.banner.fallback")}.</span>{" "}
            {t("wc.countdown.banner.fallbackHint")}
          </span>
        </div>
      </div>
    )
  }

  // ── Locked state ─────────────────────────────────────────────────────

  if (state === "locked") {
    return (
      <div
        data-testid="wc-countdown-banner-locked"
        className="mx-3 mb-1 mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 sm:mx-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Lock className="h-4 w-4 shrink-0 text-white/40" aria-hidden />
            <div>
              <p className="text-sm font-black text-white/75">
                {t("wc.countdown.banner.locked.title")}
              </p>
              <p className="mt-0.5 text-xs text-white/40">
                {t("wc.countdown.banner.locked.subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onViewLeaderboard}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-black text-white/65 transition-colors hover:bg-white/[0.09]"
          >
            {t("wc.countdown.banner.cta.leaderboard")}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
    )
  }

  // ── Live countdown states (countdown / urgent24h / urgent1h) ─────────

  const shown = timeLeft ?? calcTimeLeft(lockAt!)

  const urgencyLabel =
    state === "urgent1h" ? t("wc.countdown.banner.urgent1h")
    : state === "urgent24h" ? t("wc.countdown.banner.urgent24h")
    : t("wc.countdown.banner.startsIn")

  const ctaLabel =
    state === "urgent1h" ? t("wc.countdown.banner.cta.finishNow")
    : state === "urgent24h" ? t("wc.countdown.banner.cta.finish")
    : t("wc.countdown.banner.cta.make")

  const accentColor =
    state === "urgent1h" ? "text-rose-300"
    : state === "urgent24h" ? "text-amber-300"
    : "text-cyan-300"

  const borderClass =
    state === "urgent1h"
      ? "border-rose-500/35 shadow-[0_0_0_1px_rgba(244,63,94,0.12)]"
      : state === "urgent24h"
        ? "border-amber-400/30 shadow-[0_0_0_1px_rgba(251,191,36,0.08)]"
        : "border-white/10"

  const bgClass =
    state === "urgent1h" ? "bg-rose-500/[0.06]"
    : state === "urgent24h" ? "bg-amber-400/[0.05]"
    : "bg-white/[0.03]"

  const ctaClass =
    state === "urgent1h"
      ? "bg-rose-500 text-white hover:bg-rose-400 shadow-[0_4px_16px_-6px_rgba(244,63,94,0.55)]"
      : state === "urgent24h"
        ? "bg-amber-400 text-black hover:bg-amber-300 shadow-[0_4px_16px_-6px_rgba(251,191,36,0.45)]"
        : "bg-cyan-300 text-black hover:bg-cyan-200 shadow-[0_4px_16px_-6px_rgba(34,211,238,0.45)]"

  // First-match display
  const homeIsReal =
    firstMatch?.homeTeamName &&
    !/^TBD/i.test(firstMatch.homeTeamName) &&
    firstMatch.homeTeamName !== ""
  const awayIsReal =
    firstMatch?.awayTeamName &&
    !/^TBD/i.test(firstMatch.awayTeamName) &&
    firstMatch.awayTeamName !== ""
  const showTeamNames = homeIsReal && awayIsReal

  const matchLine =
    showTeamNames
      ? `${firstMatch!.homeTeamName} vs ${firstMatch!.awayTeamName}`
      : t("wc.countdown.banner.firstMatchFallback")

  const timeLine =
    firstMatch?.startsAt
      ? formatKickoffLocal(firstMatch.startsAt)
      : lockAt
        ? formatKickoffLocal(lockAt)
        : null

  return (
    <div
      data-testid="wc-countdown-banner"
      className={`mx-3 mb-1 mt-3 rounded-xl border px-4 py-3 sm:mx-4 ${borderClass} ${bgClass}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">

        {/* ── Left: label + digit clock + match info ── */}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white/45">
            {urgencyLabel}
          </p>

          {/* Digit clock */}
          <div
            className="mt-1.5 flex items-end gap-1.5"
            aria-live="polite"
            aria-label={`${shown.days > 0 ? shown.days + " days " : ""}${shown.hours} hours ${shown.minutes} minutes ${shown.seconds} seconds`}
          >
            {shown.days > 0 && (
              <>
                <DigitBlock value={String(shown.days)} label="day" color={accentColor} />
                <Colon color={accentColor} />
              </>
            )}
            <DigitBlock value={pad2(shown.hours)} label="hr" color={accentColor} />
            <Colon color={accentColor} />
            <DigitBlock value={pad2(shown.minutes)} label="min" color={accentColor} />
            <Colon color={accentColor} />
            <DigitBlock value={pad2(shown.seconds)} label="sec" color={accentColor} />
          </div>

          {/* Match / lock info line */}
          <p className="mt-2 text-[11px] text-white/40">
            <span className="font-bold text-white/55">{matchLine}</span>
            {timeLine && <span className="ml-1 font-normal">· {timeLine}</span>}
          </p>
          {state === "countdown" && (
            <p className="mt-0.5 text-[11px] text-white/30">
              {t("wc.countdown.banner.locksNote")}
            </p>
          )}
        </div>

        {/* ── Right: CTA ── */}
        <button
          type="button"
          onClick={onFinishPicks}
          className={`inline-flex shrink-0 items-center gap-1.5 self-start rounded-xl px-4 py-2.5 text-xs font-black transition-colors sm:self-auto ${ctaClass}`}
        >
          <Trophy className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {ctaLabel}
        </button>

      </div>
    </div>
  )
}
