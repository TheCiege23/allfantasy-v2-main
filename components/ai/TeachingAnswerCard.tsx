"use client"

/**
 * TeachingAnswerCard
 *
 * Renders a TeachingAnswer as a structured card.
 * Used for Chimmy responses in World Cup chat, Draft War Room, and anywhere
 * Chimmy should teach rather than just answer.
 *
 * ── Visual sections ─────────────────────────────────────────────────────────
 *  Quick Answer  — always shown; primary color
 *  Why It Matters — shown when non-empty
 *  The Edge       — shown when non-empty; amber accent (premium insight)
 *  Mistake To Avoid — shown when present; rose accent (warning)
 *  Confidence bar — shown always; 0–1 as a visual pill
 *
 * ── Props ────────────────────────────────────────────────────────────────────
 *  answer        — TeachingAnswer object
 *  compact       — true for inline/chat display (no card border, tighter spacing)
 *  dataUsedLabel — optional string to show beneath the card ("Based on: pool data")
 *  onFeedback    — optional callback for 👍/👎 buttons
 */

import type { TeachingAnswer } from "@/lib/ai/teachingAnswer"

export type TeachingAnswerCardProps = {
  answer: TeachingAnswer
  compact?: boolean
  dataUsedLabel?: string
  onFeedback?: (rating: "helpful" | "not_helpful") => void
  /** Aria label for the card region. */
  ariaLabel?: string
}

function ConfidencePill({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100)
  const colorClass =
    pct >= 80
      ? "bg-emerald-400/20 text-emerald-300 border-emerald-400/30"
      : pct >= 55
        ? "bg-amber-400/20 text-amber-300 border-amber-400/30"
        : "bg-slate-400/20 text-slate-300 border-slate-400/30"
  const label = pct >= 80 ? "High confidence" : pct >= 55 ? "Moderate confidence" : "Lower confidence"
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-black ${colorClass}`}
      aria-label={`${label}: ${pct}%`}
    >
      {pct}% confident
    </span>
  )
}

function Section({
  label,
  text,
  accent,
}: {
  label: string
  text: string
  accent?: "cyan" | "amber" | "rose"
}) {
  if (!text) return null
  const labelColor =
    accent === "amber"
      ? "text-amber-300/75"
      : accent === "rose"
        ? "text-rose-300/75"
        : "text-cyan-300/75"
  const textColor =
    accent === "amber"
      ? "text-amber-50/85"
      : accent === "rose"
        ? "text-rose-100/85"
        : "text-slate-100/85"
  return (
    <div>
      <p className={`mb-0.5 text-[11px] font-black uppercase tracking-wider ${labelColor}`}>
        {label}
      </p>
      <p className={`text-sm leading-relaxed ${textColor}`}>{text}</p>
    </div>
  )
}

export function TeachingAnswerCard({
  answer,
  compact = false,
  dataUsedLabel,
  onFeedback,
  ariaLabel,
}: TeachingAnswerCardProps) {
  const wrapperClass = compact
    ? "flex flex-col gap-3 py-1"
    : "flex flex-col gap-3 rounded-2xl border border-cyan-400/15 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.07),transparent_50%),rgba(0,0,0,0.25)] px-4 py-4"

  return (
    <div
      className={wrapperClass}
      data-testid="teaching-answer-card"
      role="region"
      aria-label={ariaLabel ?? "Chimmy answer"}
    >
      {/* Quick Answer — primary section, always shown */}
      <div>
        <p className="mb-0.5 text-[11px] font-black uppercase tracking-wider text-cyan-300/75">
          Quick Answer
        </p>
        <p
          className="text-sm font-semibold leading-relaxed text-white/92"
          data-testid="teaching-quick-answer"
        >
          {answer.quickAnswer}
        </p>
      </div>

      {/* Why It Matters */}
      {answer.whyItMatters ? (
        <Section label="Why It Matters" text={answer.whyItMatters} />
      ) : null}

      {/* The Edge — amber accent (the premium insight) */}
      {answer.theEdge ? (
        <Section label="The Edge" text={answer.theEdge} accent="amber" />
      ) : null}

      {/* Mistake To Avoid — rose accent */}
      {answer.mistakeToAvoid ? (
        <Section label="Mistake To Avoid" text={answer.mistakeToAvoid} accent="rose" />
      ) : null}

      {/* Footer: confidence + data source + feedback */}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <ConfidencePill confidence={answer.confidence} />

        {dataUsedLabel ? (
          <span className="text-[11px] text-white/35">{dataUsedLabel}</span>
        ) : answer.dataUsed.length > 0 ? (
          <span className="text-[11px] text-white/35">
            Based on: {answer.dataUsed.join(", ")}
          </span>
        ) : null}

        {onFeedback ? (
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => onFeedback("helpful")}
              aria-label="Mark as helpful"
              className="rounded-full p-1 text-white/35 transition hover:bg-white/[0.06] hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
              data-testid="teaching-feedback-helpful"
            >
              <span aria-hidden>👍</span>
            </button>
            <button
              type="button"
              onClick={() => onFeedback("not_helpful")}
              aria-label="Mark as not helpful"
              className="rounded-full p-1 text-white/35 transition hover:bg-white/[0.06] hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
              data-testid="teaching-feedback-not-helpful"
            >
              <span aria-hidden>👎</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
