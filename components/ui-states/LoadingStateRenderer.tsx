"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

/**
 * Handoff 16c — the "loading" third of the shared state vocabulary.
 *
 * ⚠ THE SLOW VARIANT IS THE POINT OF THIS COMPONENT, NOT AN EXTRA. 16c's rule is
 * that a spinner must never be the whole message once a wait stops being brief:
 * past the threshold the user is told what is being fetched and roughly how much
 * longer, because "no blank screens, no infinite spinners" is the stated contract.
 * Passing `reason` opts a call site into that; without one the component keeps
 * showing the plain spinner rather than inventing an explanation it does not have.
 *
 * ⚠ THE THRESHOLD IS 4s AND IT IS A GUESS THAT ENG SHOULD REPLACE. The handoff
 * says "e.g. 3–5s — get exact threshold from eng" and no exact figure came back,
 * so the midpoint is used and named here rather than buried, and it is overridable
 * per call site.
 */

export interface LoadingStateRendererProps {
  label?: string
  compact?: boolean
  testId?: string
  /**
   * What is actually being waited on, e.g. "This one has 14 seasons of history."
   * Shown only once the load crosses the slow threshold.
   */
  reason?: string
  /** Milliseconds before swapping to the reasoned variant. */
  slowAfterMs?: number
  /** Render the reasoned variant immediately, for a load already known to be slow. */
  slow?: boolean
}

export default function LoadingStateRenderer({
  label = "Loading...",
  compact = false,
  testId,
  reason,
  slowAfterMs = 4000,
  slow = false,
}: LoadingStateRendererProps) {
  const [elapsedSlow, setElapsedSlow] = useState(slow)

  useEffect(() => {
    if (slow || !reason) return
    const id = window.setTimeout(() => setElapsedSlow(true), slowAfterMs)
    return () => window.clearTimeout(id)
  }, [slow, reason, slowAfterMs])

  const showReason = Boolean(reason) && (slow || elapsedSlow)

  if (showReason) {
    return (
      <div
        className={`rounded-2xl border border-white/10 bg-white/[0.02] ${
          compact ? "px-4 py-4" : "px-5 py-5"
        }`}
        data-testid={testId}
        aria-busy="true"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-cyan-300" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#eef0fa]">{label}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-[#989fc2]">{reason}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.02] ${
        compact ? "px-4 py-5" : "px-6 py-10"
      }`}
      data-testid={testId}
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-center justify-center gap-2.5 text-sm text-[#989fc2]">
        <Loader2 className="h-4 w-4 animate-spin text-cyan-300" aria-hidden />
        <span>{label}</span>
      </div>
    </div>
  )
}

/**
 * Skeleton rows — the handoff's "used when the eventual shape is known" variant:
 * avatar, two text lines, action pill.
 *
 * ⚠ aria-hidden PLUS A LIVE LABEL ON THE WRAPPER. The bars carry no information a
 * screen reader can use, and announcing a dozen empty divs is worse than silence —
 * but the wrapper still has to say that something is loading, or a non-visual user
 * gets nothing at all where a sighted user sees motion.
 */
export function SkeletonRowsRenderer({
  rows = 3,
  label = "Loading…",
  testId,
}: {
  rows?: number
  label?: string
  testId?: string
}) {
  return (
    <div
      className="rounded-2xl border border-white/10 bg-white/[0.02] p-4"
      data-testid={testId}
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      <div className="flex flex-col gap-3" aria-hidden>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-white/[0.07]" />
            <div className="min-w-0 flex-1">
              {/*
                Varying widths per row so the block reads as a list of different
                items rather than a striped placeholder — the handoff draws the
                three rows at visibly different lengths.
              */}
              <div
                className="h-2.5 animate-pulse rounded bg-white/[0.07]"
                style={{ width: `${[46, 58, 38][i % 3]}%` }}
              />
              <div
                className="mt-2 h-2 animate-pulse rounded bg-white/[0.05]"
                style={{ width: `${[28, 34, 22][i % 3]}%` }}
              />
            </div>
            <div className="h-7 w-14 shrink-0 animate-pulse rounded-lg bg-white/[0.06]" />
          </div>
        ))}
      </div>
    </div>
  )
}
