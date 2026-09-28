"use client"

import type { ChimmyTradeDeepDive } from "@/lib/trade-value-console/chimmyDeepDive"

/**
 * The Trade Value tool's "Ask Chimmy" answer (2026-09-27). It used to be the raw model output in a
 * browser alert dialog, led by a `verdict` and a 0-100 `confidence` Chimmy made up,
 * with no grade anywhere. Now the one AllFantasy grade leads, from the analysis itself (never from the
 * AI), and Chimmy's words sit under it as the explanation of that letter.
 */
export type DeepDiveGrade = {
  graded?: boolean
  reason?: string
  letter?: string
  partnerLetter?: string
  label?: string
  giveValue?: number
  getValue?: number
} | null | undefined

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div className="mt-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-white/40">{title}</div>
      <ul className="mt-1 space-y-1">
        {items.map((item, i) => (
          <li key={`${title}-${i}`} className="text-[12px] leading-snug text-white/70">
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ChimmyTradeDeepDivePanel({ grade, deepDive }: { grade: DeepDiveGrade; deepDive: ChimmyTradeDeepDive }) {
  const graded = Boolean(grade?.graded && grade.letter && grade.partnerLetter)
  return (
    <div data-testid="chimmy-trade-deep-dive" className="mt-3 rounded-xl border border-purple-500/25 bg-purple-500/[0.06] p-4">
      {graded ? (
        <div data-testid="chimmy-deep-dive-grade" className="text-[13px] font-semibold text-[#c8d4f0]">
          Your grade {grade!.letter} · Their grade {grade!.partnerLetter}
          {grade!.label ? <span className="font-normal text-white/60"> — {grade!.label}</span> : null}
          {typeof grade!.getValue === "number" && typeof grade!.giveValue === "number" ? (
            <span className="block text-[11px] font-normal text-white/45">
              You get {grade!.getValue.toLocaleString()} for {grade!.giveValue.toLocaleString()} in league value
            </span>
          ) : null}
        </div>
      ) : (
        <div data-testid="chimmy-deep-dive-withheld" className="text-[12px] text-amber-200/90">
          Not graded{grade?.reason ? `: ${grade.reason}` : "."}
        </div>
      )}
      <p className="mt-2 text-[13px] leading-relaxed text-white/80">{deepDive.explanation}</p>
      {deepDive.bestCase || deepDive.worstCase ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {deepDive.bestCase ? (
            <div className="text-[12px] text-white/70">
              <span className="font-semibold text-emerald-300/90">Best case: </span>
              {deepDive.bestCase}
            </div>
          ) : null}
          {deepDive.worstCase ? (
            <div className="text-[12px] text-white/70">
              <span className="font-semibold text-red-300/90">Worst case: </span>
              {deepDive.worstCase}
            </div>
          ) : null}
        </div>
      ) : null}
      <Section title="Ways to rebalance" items={deepDive.rebalanceIdeas} />
      <Section title="Other targets" items={deepDive.alternateTargets} />
      <Section title="Watch out for" items={deepDive.warnings} />
      {deepDive.leagueNote ? <p className="mt-3 text-[11px] text-white/45">{deepDive.leagueNote}</p> : null}
    </div>
  )
}
