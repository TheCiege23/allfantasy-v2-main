"use client"

import { Sparkles, Trophy } from "lucide-react"
import {
  buildWorldCupRootingGuide,
  type BuildWorldCupRootingGuideInput,
  type RootingImpact,
} from "@/lib/world-cup/worldCupRootingGuide"

const IMPACT_TONE: Record<RootingImpact, string> = {
  High: "border-cyan-300/40 bg-cyan-300/[0.10]",
  Medium: "border-amber-300/35 bg-amber-300/[0.08]",
  Low: "border-white/15 bg-white/[0.04]",
}

export default function WorldCupRootingGuideCard(
  props: BuildWorldCupRootingGuideInput
) {
  const guide = buildWorldCupRootingGuide(props)
  const isPro = Boolean(props.hasBracketBrainAi)

  return (
    <section
      data-testid="world-cup-rooting-guide"
      className="mx-auto max-w-5xl rounded-2xl border border-cyan-300/20 bg-gradient-to-b from-cyan-300/[0.06] to-white/[0.03] p-4 backdrop-blur"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-300/10">
            <Trophy className="h-4 w-4 text-white/85" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-white/40">
              Daily AI
            </p>
            <h3 className="text-base font-black text-white sm:text-lg">
              {guide.title}
            </h3>
            <p
              data-testid="world-cup-rooting-guide-window"
              className="mt-0.5 text-xs text-white/55"
            >
              {guide.windowLabel}
            </p>
          </div>
        </div>
        <span
          data-testid="world-cup-rooting-guide-tier"
          className={
            isPro
              ? "shrink-0 rounded-full border border-cyan-300/30 bg-cyan-300/[0.08] px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-white/90"
              : "shrink-0 rounded-full border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-white/65"
          }
        >
          {isPro ? "AF Pro" : "Basic"}
        </span>
      </div>

      {guide.status === "no_entry" ? (
        <p
          data-testid="world-cup-rooting-guide-empty"
          className="rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-xs text-white/65"
        >
          Create or open a bracket to get rooting recommendations.
        </p>
      ) : null}

      {guide.status === "no_matches" ? (
        <p
          data-testid="world-cup-rooting-guide-empty"
          className="rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-xs text-white/65"
        >
          No World Cup matches are scheduled today. Check back on the next matchday.
        </p>
      ) : null}

      {guide.recommendations.length > 0 ? (
        <ul className="space-y-2">
          {guide.recommendations.map((rec, idx) => (
            <li
              key={`${rec.matchId}:${idx}`}
              data-testid={`world-cup-rooting-guide-rec-${idx}`}
              className={`rounded-xl border px-3 py-2.5 text-white/90 ${IMPACT_TONE[rec.impact]}`}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-white/85" aria-hidden />
                <span className="text-xs font-black uppercase tracking-wider text-white">
                  Root for {rec.teamName}
                </span>
                <span className="rounded-full border border-white/20 bg-black/30 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-white/75">
                  {rec.tag}
                </span>
                <span className="rounded-full border border-white/20 bg-black/30 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-white/75">
                  {rec.impact} impact
                </span>
              </div>
              <p className="mt-1.5 text-[11px] font-bold text-white/75">
                {rec.matchLabel}
              </p>
              <p className="mt-1 text-xs leading-5 text-white/65">{rec.reason}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {guide.lockedLines && guide.lockedLines.length > 0 ? (
        <div className="mt-3 space-y-1">
          {guide.lockedLines.map((line, idx) => (
            <p
              key={idx}
              data-testid={`world-cup-rooting-guide-locked-${idx}`}
              className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[11px] leading-5 text-white/55"
            >
              {line}
            </p>
          ))}
        </div>
      ) : null}

      <p className="mt-3 text-[11px] text-white/40">
        Deterministic — uses only your picks and public match data. No AI call.
      </p>
    </section>
  )
}
