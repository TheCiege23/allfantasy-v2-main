'use client'

/**
 * Cinematic header for Tournament + Zombie universe commissioner hubs.
 *
 * Mirrors the visual vocabulary of `components/league-home/LeagueHomeHero.tsx`:
 *   - Ambient MP4 backdrop (autoplay, loop, muted) with onError fallback
 *   - Dark vignette + accent radial overlay for readability
 *   - Chip row, title, subtitle, stat card grid
 */

import { useRef } from 'react'
import type { ReactNode } from 'react'
import type { AccentTone } from '@/lib/create-league-v2/theme'

export interface CommissionerHubStat {
  label: string
  value: ReactNode
}

export interface CommissionerHubHeaderProps {
  /** Short chip label rendered above the title (e.g. "TOURNAMENT · Round 2"). */
  chip: string
  /** Main hub name (e.g. "The Gauntlet 2026"). */
  title: string
  /** Subtitle line (e.g. "Dynasty · 128 teams · 4 conferences"). */
  subtitle?: string
  /** Accent tone for glow + text highlights. */
  accent: AccentTone
  /** Primary MP4 backdrop. */
  videoSrc: string
  /** Fallback MP4 if the primary 404s. */
  videoFallback?: string | null
  /** Poster shown while the video loads. */
  posterSrc?: string | null
  /** Up to 4 stat cards rendered in a 2/4-up grid under the title. */
  stats?: CommissionerHubStat[]
  /** Optional CTA row to the right of the title (e.g. "Copy invite"). */
  actions?: ReactNode
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string
  value: ReactNode
  accent: AccentTone
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.04] to-white/[0.015] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <p className={`text-[11px] font-bold uppercase tracking-[0.16em] ${accent.text}`}>
        {label}
      </p>
      <div className="mt-1 text-base font-bold text-white/95 sm:text-lg">{value}</div>
    </div>
  )
}

export function CommissionerHubHeader({
  chip,
  title,
  subtitle,
  accent,
  videoSrc,
  videoFallback = null,
  posterSrc = null,
  stats = [],
  actions = null,
}: CommissionerHubHeaderProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const fallbackTriedRef = useRef(false)

  return (
    <section className="relative mb-5 overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-b from-white/[0.06] to-white/[0.02] shadow-[0_24px_80px_-20px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.06)]">
      {/* Ambient video backdrop */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <video
          ref={videoRef}
          key={videoSrc}
          className="h-full w-full object-cover opacity-40"
          src={videoSrc}
          poster={posterSrc ?? undefined}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          aria-hidden
          onError={() => {
            const el = videoRef.current
            if (!el || fallbackTriedRef.current) return
            fallbackTriedRef.current = true
            if (videoFallback && el.src !== window.location.origin + videoFallback) {
              el.src = videoFallback
              el.load()
            }
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(180deg, rgba(6,10,24,0.30) 0%, rgba(6,10,24,0.75) 60%, rgba(6,10,24,0.95) 100%), radial-gradient(80% 80% at 50% 0%, ${accent.hex}22, transparent 70%)`,
          }}
          aria-hidden
        />
      </div>

      <div className="relative z-10 p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-3">
            <span
              className="inline-flex items-center gap-1.5 self-start rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white/80 backdrop-blur-md"
              style={{ boxShadow: `0 0 16px -6px ${accent.hex}` }}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: accent.hex, boxShadow: `0 0 8px ${accent.hex}` }}
                aria-hidden
              />
              <span className={accent.text}>{chip}</span>
            </span>
            <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
              {title}
            </h1>
            {subtitle ? (
              <p className="text-sm text-white/55">{subtitle}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>

        {stats.length > 0 ? (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.slice(0, 4).map((s) => (
              <StatCard key={s.label} label={s.label} value={s.value} accent={accent} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
