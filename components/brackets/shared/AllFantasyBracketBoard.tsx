"use client"

import { type ReactNode, useCallback, useState } from "react"
import { Trophy } from "lucide-react"
import { cn } from "@/lib/utils"

/** Public marketing assets under `public/` */
export const ALLFANTASY_BRACKET_PREVIEW_IMAGE = "/images/brackets/allfantasy-bracket-preview.png"
export const ALLFANTASY_BRACKET_PREVIEW_VIDEO = "/videos/brackets/allfantasy-bracket-preview.mp4"

export type AllFantasyBracketBoardMode = "preview" | "pick" | "ai"

export type AllFantasyBracketPickPayload = { matchId: string; side: "home" | "away" }

export type AllFantasyBracketBoardProps = {
  title?: string
  subtitle?: string
  mode: AllFantasyBracketBoardMode
  /** When true, use AF bracket art + optional video (ai) as a skin behind live `children`. */
  showBranding?: boolean
  /**
   * Pick-mode backdrop: `arena` uses the AllFantasy bracket art (pointer-events none) like preview;
   * `flat` keeps a minimal solid backdrop for low-end / debugging.
   */
  pickVisualDensity?: "arena" | "flat"
  /**
   * Display-only surfaces (e.g. pool dashboard preview) vs editable pick mode.
   * When true with mode preview, interactions on the bracket surface are disabled.
   */
  isReadOnly?: boolean
  /** Optional map for future pick highlighting (informational; wiring lives in sport-specific children). */
  selectedPicks?: Record<string, string>
  /**
   * Optional pick handler for pick mode; sport-specific boards usually call their own `onPick`.
   */
  onPick?: (payload: AllFantasyBracketPickPayload) => void
  toolbar?: ReactNode
  children: ReactNode
  className?: string
  frameClassName?: string
  contentClassName?: string
}

/**
 * Reusable AllFantasy bracket frame: preview/AI modes use full art; pick mode stays minimal so taps reach cards.
 */
export default function AllFantasyBracketBoard({
  title,
  subtitle,
  mode,
  showBranding = true,
  pickVisualDensity = "arena",
  isReadOnly = false,
  selectedPicks: _selectedPicks,
  onPick: _onPick,
  toolbar,
  children,
  className,
  frameClassName,
  contentClassName,
}: AllFantasyBracketBoardProps) {
  const [imageFailed, setImageFailed] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)

  const handleImageError = useCallback(() => setImageFailed(true), [])
  const handleVideoError = useCallback(() => setVideoFailed(true), [])

  const freezeSurface = mode === "preview" || mode === "ai" || isReadOnly

  const isPickSkin = mode === "pick"
  const arenaPickSkin = isPickSkin && pickVisualDensity !== "flat"

  const showHeavyBrandingLayer = showBranding && !imageFailed && (!isPickSkin || arenaPickSkin)

  const showVideoLayer = showBranding && mode === "ai" && !videoFailed

  /** Marketing PNG — preview/AI; pick `arena` keeps the split-bracket art under the interactive stack (always below matchup cards). */
  const imageOpacity =
    mode === "ai"
      ? "opacity-[0.13]"
      : mode === "preview"
        ? "opacity-[0.12]"
        : arenaPickSkin
          ? "opacity-[0.11]"
          : "opacity-0"

  return (
    <div className={cn("space-y-3", className)}>
      {toolbar}
      {(title || subtitle) && (
        <div className="px-0.5">
          {title ? <h3 className="text-lg font-black text-white">{title}</h3> : null}
          {subtitle ? <p className="mt-1 text-xs leading-5 text-white/50">{subtitle}</p> : null}
        </div>
      )}

      <div
        className={cn(
          "relative isolate overflow-hidden rounded-3xl border border-cyan-300/18 bg-[#050a16] shadow-[0_0_0_1px_rgba(34,211,238,0.06),0_28px_90px_-18px_rgba(0,0,0,0.75),0_0_70px_-20px_rgba(34,211,238,0.14)]",
          frameClassName
        )}
      >
        {showHeavyBrandingLayer ? (
          <img
            src={ALLFANTASY_BRACKET_PREVIEW_IMAGE}
            alt=""
            className={cn(
              "pointer-events-none absolute inset-0 z-0 h-full w-full select-none object-cover saturate-[0.85]",
              arenaPickSkin ? "object-[center_28%]" : "object-[center_top]",
              imageOpacity
            )}
            draggable={false}
            onError={handleImageError}
          />
        ) : null}

        {showVideoLayer ? (
          <video
            className="pointer-events-none absolute inset-0 z-[1] h-full w-full object-cover opacity-[0.22]"
            src={ALLFANTASY_BRACKET_PREVIEW_VIDEO}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden
            onError={handleVideoError}
          />
        ) : null}

        {isPickSkin && !arenaPickSkin ? (
          <>
            <div className="pointer-events-none absolute inset-0 z-[1] bg-[#050a16]" aria-hidden />
            <div
              className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-b from-[#040915]/90 via-[#050a16]/95 to-[#040915]/98"
              aria-hidden
            />
            {showBranding ? (
              <div
                className="pointer-events-none absolute left-1/2 top-1/2 z-[3] h-[min(42%,280px)] w-[min(55%,360px)] -translate-x-1/2 -translate-y-1/2 opacity-[0.05]"
                aria-hidden
              >
                <img src="/af-crest.svg" alt="" className="h-full w-full object-contain" draggable={false} />
              </div>
            ) : null}
            <div
              className="pointer-events-none absolute inset-x-0 top-0 z-[4] flex items-start px-3 pt-2 sm:px-4 sm:pt-3"
              aria-hidden
            >
              <span className="text-[11px] font-black uppercase tracking-[0.35em] text-cyan-200/50 sm:text-[11px]">
                AllFantasy
              </span>
            </div>
          </>
        ) : isPickSkin ? (
          <>
            <div className="pointer-events-none absolute inset-0 z-[1] bg-[#040915]/55" aria-hidden />
            <div
              className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-r from-black/70 via-[#050a16]/88 to-black/70"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute inset-0 z-[3] bg-[radial-gradient(ellipse_at_50%_42%,rgba(34,211,238,0.09)_0%,transparent_62%)]"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute inset-x-0 top-0 z-[4] flex items-start px-3 pt-2 sm:px-4 sm:pt-3"
              aria-hidden
            >
              <span className="text-[11px] font-black uppercase tracking-[0.35em] text-cyan-200/55 sm:text-[11px]">
                AllFantasy
              </span>
            </div>
          </>
        ) : (
          <>
            {/* Readable scrims — non–pick modes */}
            <div
              className={cn(
                "pointer-events-none absolute inset-0 z-[2]",
                mode === "ai" ? "bg-[#040915]/70" : "bg-[#040915]/78"
              )}
            />
            <div className="pointer-events-none absolute inset-0 z-[3] bg-gradient-to-b from-[#040915]/82 via-[#0a1228]/88 to-[#040915]/93" />
            <div className="pointer-events-none absolute inset-0 z-[4] bg-[radial-gradient(ellipse_at_50%_-10%,rgba(34,211,238,0.11)_0%,transparent_55%)]" />
            <div className="pointer-events-none absolute inset-0 z-[4] bg-[radial-gradient(ellipse_at_100%_50%,rgba(59,130,246,0.05)_0%,transparent_45%)]" />

            <div
              className="pointer-events-none absolute left-1/2 top-[46%] z-[5] h-[min(58%,400px)] w-[min(78%,560px)] -translate-x-1/2 -translate-y-1/2 opacity-[0.035]"
              aria-hidden
            >
              <img src="/af-crest.svg" alt="" className="h-full w-full object-contain" draggable={false} />
            </div>

            <div
              className="pointer-events-none absolute inset-x-0 top-0 z-[6] flex items-start justify-between gap-3 bg-gradient-to-b from-black/50 via-black/18 to-transparent px-3 pb-8 pt-3 sm:px-5 sm:pt-4"
              aria-hidden
            >
              <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                <img
                  src="/af-crest.svg"
                  alt=""
                  className="h-8 w-8 shrink-0 rounded-xl border border-white/10 bg-black/30 object-contain p-1 shadow-lg shadow-black/40 sm:h-9 sm:w-9"
                  draggable={false}
                />
                <div className="min-w-0 text-[11px] font-black uppercase tracking-[0.28em] text-cyan-100/85 sm:text-[11px]">
                  Bracket board
                </div>
              </div>
            </div>

            {showBranding ? (
              <div
                className="pointer-events-none absolute left-1/2 top-[56%] z-[7] flex max-w-[min(340px,52vw)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 sm:top-[54%] sm:max-w-[min(380px,46vw)]"
                aria-hidden
              >
                <span className="text-[11px] font-black uppercase tracking-[0.42em] text-cyan-100 drop-shadow-[0_2px_12px_rgba(0,0,0,0.85)] sm:text-xs sm:tracking-[0.48em]">
                  AllFantasy
                </span>
                <div className="relative flex items-center justify-center">
                  <div className="absolute inset-0 rounded-[1.75rem] bg-gradient-to-t from-cyan-400/25 via-transparent to-transparent blur-xl" />
                  <img
                    src="/af-robot-king.png"
                    alt=""
                    className="relative h-[7.25rem] w-[7.25rem] rounded-[1.35rem] border border-white/15 object-cover shadow-[0_22px_60px_-12px_rgba(0,0,0,0.85)] ring-1 ring-cyan-300/25 sm:h-[8.75rem] sm:w-[8.75rem]"
                    draggable={false}
                  />
                  <div className="absolute -bottom-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-300 to-sky-500 text-black shadow-lg shadow-cyan-500/40 ring-2 ring-black/60 sm:h-12 sm:w-12">
                    <Trophy className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={2.25} />
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}

        <div
          className={cn(
            "relative z-20 min-w-0 pt-4 sm:pt-5",
            isPickSkin && "pt-6 sm:pt-7",
            freezeSurface && "pointer-events-none select-none",
            contentClassName
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

/** Lightweight skeleton while entry picks hydrate (horizontal round columns). */
export function AllFantasyBracketPickSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex min-h-[260px] gap-2 overflow-x-auto px-3 pb-6 pt-4 [-webkit-overflow-scrolling:touch]",
        className
      )}
      aria-busy
      aria-label="Loading bracket"
    >
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="flex h-[220px] w-[120px] shrink-0 animate-pulse flex-col gap-2 rounded-2xl bg-white/[0.05] p-2 ring-1 ring-white/10 shadow-inner shadow-black/25"
        >
          <div className="h-3 w-14 rounded bg-white/15" />
          <div className="mt-2 space-y-2">
            <div className="h-12 rounded-lg bg-white/10" />
            <div className="h-12 rounded-lg bg-white/10" />
            <div className="h-12 rounded-lg bg-white/10" />
          </div>
        </div>
      ))}
    </div>
  )
}
