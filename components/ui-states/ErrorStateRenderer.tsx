"use client"

import Link from "next/link"
import { AlertTriangle, RotateCcw } from "lucide-react"

/**
 * Handoff 16c — the "error" third of the shared state vocabulary.
 *
 * ⚠ THE COPY CONTRACT IS ENFORCED BY THE PROPS, NOT BY A STYLE GUIDE NOBODY
 * READS. 16c requires every error to say what happened, whether the user's data is
 * safe, and what to press next. `message` is the cause and is required;
 * `dataSafeNote` is the reassurance and renders as its own line so it cannot be
 * lost inside a paragraph; and an error with neither `onRetry` nor `actions` has
 * nothing to press, which is the failure the handoff is written against.
 *
 * ⚠ THE STALE-DATA NOTICE IS A SEPARATE EXPORT, NOT A `tone` ON THIS ONE. Old data
 * is not an outage — the handoff is explicit that the two must not be conflated —
 * and giving them one component with a flag is exactly how they end up looking
 * alike. See StaleDataNotice below.
 */

export interface ErrorStateAction {
  id: string
  label: string
  href?: string
  onClick?: () => void
  testId?: string
}

export interface ErrorStateRendererProps {
  title?: string
  message: string
  onRetry?: () => void
  retryLabel?: string
  actions?: ErrorStateAction[]
  /** Legacy switch, equivalent to inline. */
  compact?: boolean
  /** Single-line banner sitting above content the user has not lost. */
  inline?: boolean
  /**
   * "Everything you'd saved is safe." Rendered as its own sentence after the
   * cause — the second of the three things every error state owes the reader.
   */
  dataSafeNote?: string
  testId?: string
}

export default function ErrorStateRenderer({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Try again",
  actions = [],
  compact = false,
  inline,
  dataSafeNote,
  testId,
}: ErrorStateRendererProps) {
  const isInline = inline ?? compact

  if (isInline) {
    return (
      <div
        className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3"
        data-testid={testId}
        role="alert"
      >
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" aria-hidden />
        <p className="min-w-0 flex-1 text-sm font-semibold text-amber-50">{message}</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-amber-300/45 bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-100 transition hover:bg-amber-500/25"
            data-testid="error-state-retry"
          >
            {retryLabel}
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div
      className="rounded-2xl border border-amber-400/40 bg-amber-500/[0.07] px-5 py-5"
      data-testid={testId}
      role="alert"
    >
      <div className="flex items-start gap-3.5">
        <div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-300/35 bg-amber-500/15 text-amber-200">
          <AlertTriangle className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-black text-[#eef0fa]">{title}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-[#989fc2]">
            {message}
            {dataSafeNote ? <span className="text-[#c3c9e6]"> {dataSafeNote}</span> : null}
          </p>

          {onRetry || actions.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/45 bg-amber-500/15 px-3.5 py-2 text-xs font-bold text-amber-100 transition hover:bg-amber-500/25"
                  data-testid="error-state-retry"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  {retryLabel}
                </button>
              ) : null}
              {actions.map((action) =>
                action.href ? (
                  <Link
                    key={action.id}
                    href={action.href}
                    data-testid={action.testId}
                    className="rounded-lg border border-white/12 bg-white/[0.06] px-3.5 py-2 text-xs font-bold text-[#eef0fa] transition hover:bg-white/[0.12]"
                  >
                    {action.label}
                  </Link>
                ) : (
                  <button
                    key={action.id}
                    type="button"
                    onClick={action.onClick}
                    data-testid={action.testId}
                    className="rounded-lg border border-white/12 bg-white/[0.06] px-3.5 py-2 text-xs font-bold text-[#eef0fa] transition hover:bg-white/[0.12]"
                  >
                    {action.label}
                  </button>
                )
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * "Showing data from 2 hours ago" — old data, not an outage.
 *
 * ⚠ DELIBERATELY NOT PAINTED IN THE ERROR COLOUR, AND role="status" NOT "alert".
 * Nothing is broken and nothing is being guessed: the numbers on screen are real,
 * they are simply from the last successful sync. Dressing that as an error trains
 * people to ignore the colour that means an error. The handoff also requires the
 * source to be NAMED — "ESPN didn't respond" — because "couldn't refresh" leaves
 * the user unable to tell whose problem it is.
 *
 * ⚠ ONLY RENDER THIS WHEN CACHED DATA IS ACTUALLY ON SCREEN. A failed sync with
 * nothing to fall back on is the hard error state above, not this one.
 */
export function StaleDataNotice({
  age,
  source,
  onResync,
  resyncHref,
  resyncLabel = "Re-sync",
  testId,
}: {
  /** e.g. "2 hours ago" — already humanised by the caller. */
  age: string
  /** e.g. "ESPN didn't respond." Name the provider, not "the server". */
  source?: string
  onResync?: () => void
  resyncHref?: string
  resyncLabel?: string
  testId?: string
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3.5"
      data-testid={testId}
      role="status"
    >
      <RotateCcw className="h-4 w-4 shrink-0 text-[#7d84a8]" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-[#eef0fa]">Showing data from {age}</p>
        <p className="mt-0.5 text-[12.5px] text-[#7d84a8]">
          {source ? `${source} ` : ""}Nothing here is guessed — it&rsquo;s just old.
        </p>
      </div>
      {resyncHref ? (
        <Link
          href={resyncHref}
          className="text-xs font-bold text-cyan-300 transition hover:text-cyan-200"
        >
          {resyncLabel}
        </Link>
      ) : onResync ? (
        <button
          type="button"
          onClick={onResync}
          className="text-xs font-bold text-cyan-300 transition hover:text-cyan-200"
          data-testid="stale-data-resync"
        >
          {resyncLabel}
        </button>
      ) : null}
    </div>
  )
}
