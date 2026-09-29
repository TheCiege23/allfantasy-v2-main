"use client"

import { useMemo, useState } from "react"
import { LegalSafeAIFraming } from "@/components/LegalSafeAIFraming"

type Props = {
  userId: string
  tournamentId: string
  tournamentName: string
}

type SimStatus =
  | { state: "idle" }
  | { state: "queued"; jobId: string }
  | { state: "running"; jobId: string; progress: number }
  | { state: "done"; jobId: string; result: any }
  | { state: "error"; message: string }

export function LabDashboardShell({ userId, tournamentId, tournamentName }: Props) {
  const [activeTab, setActiveTab] = useState<"overview" | "sim" | "compare">("overview")
  const [bracketId, setBracketId] = useState<string>("")
  const [status, setStatus] = useState<SimStatus>({ state: "idle" })

  const canRun = useMemo(() => bracketId.trim().length > 0, [bracketId])

  async function enqueueSim() {
    if (!canRun) return
    setStatus({ state: "queued", jobId: "pending" })

    try {
      const res = await fetch("/api/lab/simulations/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bracketId,
          tournamentId,
          runs: 10000,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "Failed to enqueue")

      setStatus({ state: "queued", jobId: data.jobId })
      pollResult(data.jobId)
    } catch (e: any) {
      setStatus({ state: "error", message: e?.message ?? "Unknown error" })
    }
  }

  async function pollResult(jobId: string) {
    setStatus({ state: "running", jobId, progress: 0 })
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1500))
      try {
        const res = await fetch(`/api/lab/simulations/status?jobId=${encodeURIComponent(jobId)}`)
        const data = await res.json()
        if (!res.ok) continue
        if (data.state === "completed") {
          setStatus({ state: "done", jobId, result: data.result })
          return
        }
        if (data.state === "failed") {
          setStatus({ state: "error", message: data.error ?? "Job failed" })
          return
        }
        if (data.state === "active") {
          setStatus({ state: "running", jobId, progress: data.progress ?? 0 })
        } else if (data.state === "waiting" || data.state === "delayed") {
          setStatus({ state: "queued", jobId })
        }
      } catch {}
    }
    setStatus({ state: "error", message: "Timed out waiting for results" })
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs text-white/60">Bracket Lab</div>
            <h1 className="text-2xl font-semibold">{tournamentName}</h1>
            <p className="mt-1 text-sm text-white/70">
              Simulations + comparisons (research tools). No guarantees. Same scoring/gameplay for everyone.
            </p>
          </div>

          <a
            href="/"
            className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold hover:bg-white/10"
          >
            Back to Brackets
          </a>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Tab active={activeTab === "overview"} onClick={() => setActiveTab("overview")}>
            Overview
          </Tab>
          <Tab active={activeTab === "sim"} onClick={() => setActiveTab("sim")}>
            Simulations
          </Tab>
          <Tab active={activeTab === "compare"} onClick={() => setActiveTab("compare")}>
            Compare Styles
          </Tab>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-3xl border border-white/10 bg-white/5 p-6">
            {activeTab === "overview" && <OverviewPanel tournamentId={tournamentId} />}
            {activeTab === "sim" && (
              <SimPanel
                bracketId={bracketId}
                setBracketId={setBracketId}
                canRun={canRun}
                enqueueSim={enqueueSim}
                status={status}
              />
            )}
            {activeTab === "compare" && <ComparePanel />}
          </div>

          <div className="space-y-4">
            <LegalSafeAIFraming />
            <MiniCard title="Lab Access">
              <div className="text-sm text-white/70">
                User: <span className="text-white/90">{userId.slice(0, 8)}...</span>
              </div>
              <div className="mt-1 text-sm text-white/70">
                Tournament: <span className="text-white/90">{tournamentName}</span>
              </div>
            </MiniCard>
            <MiniCard title="Tip">
              <div className="text-sm text-white/70">
                Start with one bracket, run simulations, then compare against Chalk vs Chaos templates.
              </div>
            </MiniCard>
          </div>
        </div>
      </div>
    </div>
  )
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded-xl px-4 py-2 text-sm font-semibold transition",
        active
          ? "bg-gradient-to-r from-cyan-400 to-violet-500 text-slate-950"
          : "border border-white/15 bg-white/5 text-white hover:bg-white/10",
      ].join(" ")}
    >
      {children}
    </button>
  )
}

function MiniCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function OverviewPanel({ tournamentId }: { tournamentId: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold">Overview</h2>
      <p className="mt-2 text-sm text-white/70">
        Your bracket health, volatility meter, and round-by-round scenario summary will appear here as games are played.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-5">
          <div className="text-xs text-white/40 uppercase tracking-wider">Bracket Health</div>
          <div className="mt-2 text-2xl font-bold text-emerald-400">--</div>
          <div className="mt-1 text-xs text-white/40">Available after R64</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-5">
          <div className="text-xs text-white/40 uppercase tracking-wider">Volatility</div>
          <div className="mt-2 text-2xl font-bold text-amber-400">--</div>
          <div className="mt-1 text-xs text-white/40">Available after R64</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-5">
          <div className="text-xs text-white/40 uppercase tracking-wider">Win Probability</div>
          <div className="mt-2 text-2xl font-bold text-cyan-400">--</div>
          <div className="mt-1 text-xs text-white/40">Run simulations first</div>
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-5">
        <div className="text-sm font-semibold">Data last updated</div>
        <div className="mt-1 text-sm text-white/50">Provider timestamps will appear here when data is ingested.</div>
      </div>
    </div>
  )
}

function SimPanel({
  bracketId,
  setBracketId,
  canRun,
  enqueueSim,
  status,
}: {
  bracketId: string
  setBracketId: (v: string) => void
  canRun: boolean
  enqueueSim: () => void
  status: SimStatus
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold">Simulations</h2>
      <p className="mt-2 text-sm text-white/70">
        Run Monte Carlo simulations (10,000+) and cache results per bracket.
      </p>

      <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/40 p-5">
        <label className="text-sm font-semibold">Bracket ID</label>
        <input
          value={bracketId}
          onChange={(e) => setBracketId(e.target.value)}
          placeholder="Paste a bracketId"
          className="mt-2 w-full rounded-xl border border-white/15 bg-slate-950/40 px-4 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25"
        />

        <button
          disabled={!canRun || status.state === "queued" || status.state === "running"}
          onClick={enqueueSim}
          className="mt-4 w-full rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:opacity-95 disabled:opacity-60 transition"
        >
          {status.state === "running" ? "Running..." : "Run 10,000 Simulations"}
        </button>

        <div className="mt-4 text-sm text-white/70">
          Status: <span className="text-white/90">{status.state}</span>
          {"jobId" in status && (
            <span className="ml-2 text-white/60">({(status as any).jobId})</span>
          )}
        </div>

        {status.state === "running" && (
          <div className="mt-3">
            <div className="w-full rounded-full h-1.5 overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  background: "linear-gradient(90deg, #06b6d4, #8b5cf6)",
                  width: `${Math.max(5, status.progress)}%`,
                }}
              />
            </div>
            <p className="text-xs text-white/40 mt-1.5">
              Simulating tournament outcomes... {status.progress > 0 ? `${status.progress}%` : ""}
            </p>
          </div>
        )}

        {status.state === "done" && (
          <div className="mt-4">
            <div className="grid gap-2 sm:grid-cols-3 mb-3">
              {status.result?.summary && (
                <>
                  <ResultStat label="Beat Chalk %" value={`${status.result.summary.winPct ?? 0}%`} color="text-emerald-400" />
                  <ResultStat label="Avg Score" value={String(status.result.summary.avgScore ?? 0)} color="text-cyan-400" />
                  <ResultStat label="Avg Upset Hits" value={String(status.result.summary.upsetRate ?? 0)} color="text-amber-400" />
                </>
              )}
            </div>
            {status.result?.summary && (
              <div className="grid gap-2 sm:grid-cols-3 mb-3">
                <ResultStat label="Chalk Baseline" value={String(status.result.summary.chalkBaseline ?? 0)} color="text-white/70" />
                <ResultStat label="Best Run" value={String(status.result.summary.maxScore ?? 0)} color="text-emerald-300" />
                <ResultStat label="Worst Run" value={String(status.result.summary.minScore ?? 0)} color="text-red-300" />
              </div>
            )}
            {status.result?.summary?.p50 != null && (
              <div className="grid gap-2 sm:grid-cols-4 mb-3">
                <ResultStat label="Median (p50)" value={String(status.result.summary.p50)} color="text-blue-300" />
                <ResultStat label="p90" value={String(status.result.summary.p90)} color="text-violet-300" />
                <ResultStat label="p99" value={String(status.result.summary.p99)} color="text-pink-300" />
                <ResultStat label="Volatility" value={String(status.result.summary.volatility)} color="text-orange-300" />
              </div>
            )}
            {status.result?.roundBreakdown && (
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3 mb-3">
                <div className="text-[11px] uppercase tracking-wider text-white/40 mb-2">Avg Points by Round</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(status.result.roundBreakdown).map(([round, pts]) => (
                    <div key={round} className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-1.5 text-xs">
                      <span className="text-white/40">{round}:</span>{" "}
                      <span className="text-white/90 font-semibold">{String(pts)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {status.result?.scoring && (
              <div className="text-[11px] text-white/30 mb-2">{status.result.scoring}</div>
            )}
            <details className="mt-2">
              <summary className="text-xs text-white/40 cursor-pointer hover:text-white/60 transition">Raw result data</summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-xs text-white/80">
                {JSON.stringify(status.result, null, 2)}
              </pre>
            </details>
          </div>
        )}

        {status.state === "error" && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {status.message}
          </div>
        )}
      </div>
    </div>
  )
}

function ComparePanel() {
  return (
    <div>
      <h2 className="text-lg font-semibold">Compare Styles</h2>
      <p className="mt-2 text-sm text-white/70">
        Side-by-side comparisons for Chalk vs Balanced vs Chaos bracket templates.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          { name: "Chalk", desc: "Follow the seeds. Minimal upsets.", color: "text-emerald-400", border: "border-emerald-500/20" },
          { name: "Balanced", desc: "Mix of favorites and calculated upsets.", color: "text-blue-400", border: "border-blue-500/20" },
          { name: "Chaos", desc: "Maximum upsets. High risk, high reward.", color: "text-red-400", border: "border-red-500/20" },
        ].map((style) => (
          <div key={style.name} className={`rounded-2xl border ${style.border} bg-slate-950/40 p-4`}>
            <div className={`text-sm font-semibold ${style.color}`}>{style.name}</div>
            <div className="mt-1 text-xs text-white/50">{style.desc}</div>
            <div className="mt-3 space-y-1.5">
              <StatRow label="Avg Score" value="--" />
              <StatRow label="Win Rate" value="--" />
              <StatRow label="Bust Rate" value="--" />
            </div>
            <div className="mt-3 text-[11px] text-white/30">Run simulations to populate</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ResultStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
      <div className="text-[11px] uppercase tracking-wider text-white/40">{label}</div>
      <div className={`text-xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-white/40">{label}</span>
      <span className="text-white/70 font-semibold">{value}</span>
    </div>
  )
}
