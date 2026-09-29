"use client"

import React from "react"

type Candidate = {
  id: string
  name: string
  pos?: string
  team?: string
}

type Counter = {
  label?: string
  changes?: any[]
  acceptProb?: number
  fairnessScore?: number
  whyTheyAccept?: string[]
  whyItHelpsYou?: string[]
  options?: {
    addCandidates?: Candidate[]
    askCandidates?: Candidate[]
  }
}

type SimulationResult = {
  fairness: number
  acceptance: number
  starterNet: number
  champBefore: number
  champAfter: number
  champDelta: number
  verdict: string
} | null

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
  const [simResult, setSimResult] = React.useState<SimulationResult>(null)
  const [simLoading, setSimLoading] = React.useState(false)
  const [animatedAccept, setAnimatedAccept] = React.useState<number | null>(null)

  if (!counters || counters.length === 0) return null

  const simulateCounter = async (c: Counter) => {
    const add = c.options?.addCandidates ?? []
    const ask = c.options?.askCandidates ?? []

    if (!engineRequest) return

    setSimLoading(true)
    setSimResult(null)

    try {
      const appliedCounter: any = {}
      if (add.length > 0) appliedCounter.addToGive = add[0]
      if (ask.length > 0) appliedCounter.addToGet = ask[0]

      const currentAccept = c.acceptProb ?? 0.5
      const currentFair = c.fairnessScore ?? 50

      const res = await fetch('/api/engine/trade/simulate-counter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalRequest: engineRequest,
          appliedCounter,
          previousFairness: currentFair,
          previousAcceptProb: currentAccept,
          previousStarterNet: 0,
          previousChampOdds: championshipEquity?.teamA?.oddsAfter ?? 0,
        }),
      })

      const data = await res.json()
      if (data.ok && data.analysis) {
        const a = data.analysis
        const ce = a.championshipEquity?.teamA
        setSimResult({
          fairness: a.fairness?.score ?? 0,
          acceptance: a.acceptanceProbability?.final ?? 0,
          starterNet: a.meta?.starterImpact?.teamA?.net ?? 0,
          champBefore: ce?.oddsBefore ?? 0,
          champAfter: ce?.oddsAfter ?? 0,
          champDelta: ce?.delta ?? 0,
          verdict: a.verdict ?? '?',
        })

        const targetAccept = Math.round((a.acceptanceProbability?.final ?? 0) * 100)
        let start = Math.max(0, targetAccept - 15)
        setAnimatedAccept(start)
        const interval = setInterval(() => {
          start += 1
          if (start >= targetAccept) {
            clearInterval(interval)
          }
          setAnimatedAccept(start)
        }, 20)
      }
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
    } else {
      if (typeof c.acceptProb === "number") {
        let start = Math.max(0, Math.round((c.acceptProb - 0.15) * 100))
        const target = Math.round(c.acceptProb * 100)
        setAnimatedAccept(start)
        const interval = setInterval(() => {
          start += 1
          if (start >= target) {
            clearInterval(interval)
          }
          setAnimatedAccept(start)
        }, 15)
      }
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
            to add and simulate the impact live.
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

      {simResult && (
        <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 animate-in fade-in duration-300">
          <div className="text-xs font-semibold text-emerald-300 mb-2">
            Live Simulation Result
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-white/50">Verdict:</span>{" "}
              <span className={`font-semibold ${
                simResult.verdict === 'accept' ? 'text-emerald-400' :
                simResult.verdict === 'counter' ? 'text-amber-400' : 'text-rose-400'
              }`}>
                {simResult.verdict.toUpperCase()}
              </span>
            </div>
            <div>
              <span className="text-white/50">Fairness:</span>{" "}
              <span className="font-semibold text-white">{simResult.fairness}/100</span>
            </div>
            <div>
              <span className="text-white/50">Accept:</span>{" "}
              <span className="font-semibold text-white">
                {animatedAccept !== null ? animatedAccept : Math.round(simResult.acceptance * 100)}%
              </span>
            </div>
            <div>
              <span className="text-white/50">Starter Impact:</span>{" "}
              <span className={`font-semibold ${simResult.starterNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {simResult.starterNet >= 0 ? '+' : ''}{simResult.starterNet.toLocaleString()}
              </span>
            </div>
            {simResult.champAfter > 0 && (
              <div className="col-span-2">
                <span className="text-white/50">Title Odds:</span>{" "}
                <span className="text-white font-semibold">{(simResult.champBefore * 100).toFixed(1)}%</span>
                <span className="text-white/40 mx-1">{'->'}</span>
                <span className={`font-semibold ${simResult.champDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {(simResult.champAfter * 100).toFixed(1)}%
                </span>
                <span className={`ml-1 text-xs ${simResult.champDelta >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                  ({simResult.champDelta >= 0 ? '+' : ''}{(simResult.champDelta * 100).toFixed(1)}%)
                </span>
              </div>
            )}
          </div>
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
                <div>
                  <div className="text-sm font-semibold text-white/90">
                    {c.label || `Counter Option ${idx + 1}`}
                  </div>
                  <div className="mt-1 text-xs text-white/60">
                    {typeof c.acceptProb === "number" ? (
                      <>Est. Accept: {!simResult && animatedAccept !== null ? animatedAccept : (c.acceptProb * 100).toFixed(0)}%</>
                    ) : (
                      <>Est. Accept: —</>
                    )}
                    {typeof c.fairnessScore === "number" ? (
                      <span className="ml-2">Fairness: {c.fairnessScore}</span>
                    ) : null}
                  </div>
                </div>

                {showApply ? (
                  <button
                    type="button"
                    onClick={() => applyAndSimulate(c)}
                    disabled={simLoading}
                    className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/20 disabled:opacity-50"
                    title="Apply the counter and simulate its impact live"
                  >
                    {simLoading ? (
                      <span className="flex items-center gap-1">
                        <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" />
                        </svg>
                        Simulating...
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
