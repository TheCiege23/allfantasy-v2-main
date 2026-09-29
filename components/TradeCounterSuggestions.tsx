"use client"

import React from "react"
import LegacyOneGrade from "@/components/legacy/LegacyOneGrade"
import type { LegacyPackageGrade } from "@/lib/legacy/legacyPackageGrade"

/*
 * 🛑 EACH COUNTER SHOWS THE ONE TRADE GRADE (2026-09-29).
 *
 * This card printed the second trade engine's "Est. Accept" and "Fairness" on every counter, and its
 * "Apply & Simulate" result printed that engine's verdict, fairness /100 and an animated acceptance
 * percentage. Now each counter carries THE grade of the deal it leaves (graded by the legacy analyzer
 * route), and a simulation shows the grade `/api/engine/trade/simulate-counter` takes on the applied
 * counter. No acceptance odds: nothing measured them. Title odds stay — they are a projection, not a
 * verdict on the deal.
 */

type Candidate = {
  id: string
  name: string
  pos?: string
  team?: string
}

type Counter = {
  label?: string
  changes?: any[]
  whyTheyAccept?: string[]
  whyItHelpsYou?: string[]
  options?: {
    addCandidates?: Candidate[]
    askCandidates?: Candidate[]
  }
  /** THE grade of the deal this counter leaves. */
  grade?: LegacyPackageGrade | null
}

export default function TradeCounterSuggestions({
  counters,
  onAddCandidateToGive,
  onAddCandidateToGet,
  engineRequest,
  championshipEquity,
}: {
  counters: Counter[] | null | undefined
  onAddCandidateToGive: (playerId: string) => void
  onAddCandidateToGet: (playerId: string) => void
  engineRequest?: any
  championshipEquity?: {
    teamA?: { oddsBefore: number; oddsAfter: number; delta: number }
    teamB?: { oddsBefore: number; oddsAfter: number; delta: number }
    confidence?: 'HIGH' | 'MODERATE' | 'LEARNING'
    topReasons?: string[]
  }
}) {
  const [simGrade, setSimGrade] = React.useState<LegacyPackageGrade | null>(null)
  const [simLoading, setSimLoading] = React.useState(false)

  if (!counters || counters.length === 0) return null

  const simulateCounter = async (c: Counter) => {
    const add = c.options?.addCandidates ?? []
    const ask = c.options?.askCandidates ?? []

    if (!engineRequest) return

    setSimLoading(true)
    setSimGrade(null)

    try {
      const appliedCounter: any = {}
      if (add.length > 0) appliedCounter.addToGive = add[0]
      if (ask.length > 0) appliedCounter.addToGet = ask[0]

      const res = await fetch('/api/engine/trade/simulate-counter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalRequest: engineRequest, appliedCounter }),
      })

      const data = await res.json()
      if (data.ok && data.grade) setSimGrade(data.grade as LegacyPackageGrade)
    } catch (_) {}
    setSimLoading(false)
  }

  const applyAndSimulate = (c: Counter) => {
    const add = c.options?.addCandidates ?? []
    const ask = c.options?.askCandidates ?? []

    if (add.length > 0) onAddCandidateToGive(add[0].id)
    if (ask.length > 0) onAddCandidateToGet(ask[0].id)

    if (engineRequest && (add.length > 0 || ask.length > 0)) {
      simulateCounter(c)
    }
  }

  const applyLabel = (c: Counter) => {
    const add = (c.options?.addCandidates ?? []).length > 0
    const ask = (c.options?.askCandidates ?? []).length > 0
    if (add && ask) return "Apply & Simulate"
    if (add) return "Apply Sweetener"
    if (ask) return "Apply Ask-Back"
    return "Apply"
  }

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white/90">
            Counter Suggestions (Clickable)
          </div>
          <div className="mt-1 text-xs text-white/60">
            Click a player to auto-add them, or use <span className="text-white/80">Apply</span>{" "}
            to add them and see the trade grade of the result.
          </div>
        </div>
      </div>

      {championshipEquity?.teamA && (
        <div className="mt-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-3 py-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-cyan-300">
              Title Odds
            </div>
            {championshipEquity.confidence && (
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                championshipEquity.confidence === 'HIGH' ? 'bg-emerald-500/20 text-emerald-300' :
                championshipEquity.confidence === 'MODERATE' ? 'bg-amber-500/20 text-amber-300' :
                'bg-white/10 text-white/50'
              }`}>
                {championshipEquity.confidence}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-lg font-bold text-white">
              {(championshipEquity.teamA.oddsBefore * 100).toFixed(1)}%
            </span>
            <span className="text-white/40">{'->'}</span>
            <span className={`text-lg font-bold ${championshipEquity.teamA.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {(championshipEquity.teamA.oddsAfter * 100).toFixed(1)}%
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              championshipEquity.teamA.delta > 0 ? 'bg-emerald-500/20 text-emerald-300' :
              championshipEquity.teamA.delta < 0 ? 'bg-rose-500/20 text-rose-300' :
              'bg-white/10 text-white/50'
            }`}>
              {championshipEquity.teamA.delta > 0 ? '+' : ''}{(championshipEquity.teamA.delta * 100).toFixed(1)}%
            </span>
          </div>
          {championshipEquity.topReasons && championshipEquity.topReasons.length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              {championshipEquity.topReasons.map((r, i) => (
                <div key={i} className="text-[11px] text-white/50 flex items-start gap-1">
                  <span className="text-cyan-400/60 mt-px">{'>'}</span>
                  <span>{r}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {simGrade && (
        <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 animate-in fade-in duration-300">
          <div className="text-xs font-semibold text-emerald-300 mb-2">
            Trade grade with the counter applied
          </div>
          <LegacyOneGrade grade={simGrade} />
        </div>
      )}

      <div className="mt-4 space-y-4">
        {counters.map((c, idx) => {
          const add = c.options?.addCandidates ?? []
          const ask = c.options?.askCandidates ?? []
          const showAdd = add.length > 0
          const showAsk = ask.length > 0
          const showApply = showAdd || showAsk

          return (
            <div key={idx} className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white/90">
                    {c.label || `Counter Option ${idx + 1}`}
                  </div>
                  <div className="mt-1">
                    <LegacyOneGrade grade={c.grade} compact />
                  </div>
                </div>

                {showApply ? (
                  <button
                    type="button"
                    onClick={() => applyAndSimulate(c)}
                    disabled={simLoading}
                    className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/20 disabled:opacity-50"
                    title="Apply the counter and see its trade grade"
                  >
                    {simLoading ? (
                      <span className="flex items-center gap-1">
                        <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" />
                        </svg>
                        Grading...
                      </span>
                    ) : applyLabel(c)}
                  </button>
                ) : null}
              </div>

              {Array.isArray(c.changes) && c.changes.length > 0 ? (
                <ul className="mt-2 list-disc pl-5 text-xs text-white/70 space-y-1">
                  {c.changes.slice(0, 4).map((ch, i) => (
                    <li key={i}>
                      {typeof ch === "string"
                        ? ch
                        : typeof ch === "object"
                          ? Object.values(ch).filter(Boolean).join(" ")
                          : String(ch)}
                    </li>
                  ))}
                </ul>
              ) : null}

              {showAdd ? (
                <div className="mt-3">
                  <div className="text-xs font-semibold text-cyan-300">
                    Add to Side B (You Give) — pick one:
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {add.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onAddCandidateToGive(p.id)}
                        className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100 hover:bg-cyan-400/20"
                        title="Click to add to You Give"
                      >
                        {p.name}
                        {p.pos ? ` (${p.pos})` : ""}
                        {p.team ? ` • ${p.team}` : ""}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {showAsk ? (
                <div className="mt-3">
                  <div className="text-xs font-semibold text-purple-300">
                    Ask from them (You Get) — pick one:
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ask.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onAddCandidateToGet(p.id)}
                        className="rounded-full border border-purple-400/30 bg-purple-400/10 px-3 py-1 text-xs text-purple-100 hover:bg-purple-400/20"
                        title="Click to add to You Get"
                      >
                        {p.name}
                        {p.pos ? ` (${p.pos})` : ""}
                        {p.team ? ` • ${p.team}` : ""}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
