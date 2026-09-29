"use client"

/**
 * WorldCupHeroMedia — cinematic video/poster card for the WC landing page.
 *
 * Behaviour:
 * - Plays the hero MP4 (autoplay, muted, loop, playsInline).
 * - If prefers-reduced-motion is set, shows the poster image instead.
 * - If the video fails to load (404, codec error), falls back to the poster.
 * - Never blocks SSR — renders a poster-only fallback on first render and
 *   flips to video after hydration so there's no content/class mismatch.
 * - Gradient overlay keeps any text placed on top readable.
 * - Optional badge overlay (e.g. "48 Teams", "Free Pools").
 * - Fires analytics callbacks on video view / play / fallback.
 */

import { useEffect, useRef, useState } from "react"
import Image from "next/image"

type BadgeColor = "cyan" | "amber" | "emerald" | "violet" | "rose"

type WcHeroMediaBadge = {
  label: string
  color: BadgeColor
}

type WorldCupHeroMediaProps = {
  videoSrc: string
  posterSrc: string
  logoSrc?: string
  badges?: WcHeroMediaBadge[]
  className?: string
  /** Fired when the video element is mounted/visible (impression) */
  onVideoViewed?: () => void
  /** Fired on the first play event */
  onVideoPlayed?: () => void
  /** Fired when the poster fallback is shown instead of video */
  onFallbackShown?: () => void
}

const BADGE_CLASSES: Record<BadgeColor, string> = {
  cyan:    "border-cyan-300/40 bg-cyan-300/[0.14] text-cyan-200",
  amber:   "border-amber-300/40 bg-amber-300/[0.14] text-amber-200",
  emerald: "border-emerald-300/40 bg-emerald-300/[0.14] text-emerald-200",
  violet:  "border-violet-400/40 bg-violet-400/[0.14] text-violet-200",
  rose:    "border-rose-400/40 bg-rose-400/[0.14] text-rose-200",
}

export function WorldCupHeroMedia({
  videoSrc,
  posterSrc,
  logoSrc,
  badges,
  className,
  onVideoViewed,
  onVideoPlayed,
  onFallbackShown,
}: WorldCupHeroMediaProps) {
  // Start with false so the initial SSR render is deterministic (no video)
  const [hydrated, setHydrated] = useState(false)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)
  const [videoError, setVideoError] = useState(false)
  const [hasPlayed, setHasPlayed] = useState(false)
  const viewedRef = useRef(false)

  // Hydration gate + media-query listener
  useEffect(() => {
    setHydrated(true)
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setPrefersReducedMotion(mq.matches)
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  // Analytics: view impression
  useEffect(() => {
    if (!hydrated) return
    if (viewedRef.current) return
    viewedRef.current = true
    if (prefersReducedMotion || videoError) {
      onFallbackShown?.()
    } else {
      onVideoViewed?.()
    }
  }, [hydrated, prefersReducedMotion, videoError, onVideoViewed, onFallbackShown])

  const showVideo = hydrated && !prefersReducedMotion && !videoError

  return (
    <div
      className={`relative overflow-hidden rounded-3xl border border-cyan-300/20 bg-[#02050b] ${className ?? ""}`}
      style={{ aspectRatio: "16/9" }}
      data-testid="wc-hero-media"
    >
      {/* ── Media layer ──────────────────────────────────────────────── */}
      {showVideo ? (
        <video
          src={videoSrc}
          poster={posterSrc}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
          onPlay={() => {
            if (!hasPlayed) {
              setHasPlayed(true)
              onVideoPlayed?.()
            }
          }}
          onError={() => setVideoError(true)}
        />
      ) : (
        <Image
          src={posterSrc}
          alt="2026 FIFA World Cup — AllFantasy.AI"
          fill
          sizes="(max-width: 768px) 100vw, 560px"
          className="object-cover"
          priority
        />
      )}

      {/* ── Gradient overlay ─────────────────────────────────────────── */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-[#02050b]/80 via-[#02050b]/25 to-transparent"
      />

      {/* ── Logo (top-left) ──────────────────────────────────────────── */}
      {logoSrc && (
        <div className="absolute left-3 top-3 flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-black/55 p-1 backdrop-blur">
          <Image
            src={logoSrc}
            alt="AF World Cup"
            width={32}
            height={32}
            className="h-full w-full object-contain drop-shadow-[0_2px_6px_rgba(34,211,238,0.35)]"
          />
        </div>
      )}

      {/* ── Badge overlay (bottom-left) ───────────────────────────────── */}
      {badges && badges.length > 0 && (
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap gap-1.5 p-3 sm:p-4">
          {badges.map(({ label, color }) => (
            <span
              key={label}
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wide backdrop-blur-sm ${BADGE_CLASSES[color]}`}
            >
              {label}
            </span>
          ))}
        </div>
      )}

      {/* ── Ambient glow (decorative) ────────────────────────────────── */}
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-6 left-1/2 h-24 w-[120%] -translate-x-1/2 rounded-full bg-cyan-400/[0.08] blur-2xl"
      />
    </div>
  )
}
