"use client"

import { useState } from "react"

/**
 * Admin: re-ingest player game stats for a date range and rescore native redraft weeks.
 * A thin form over POST /api/admin/redraft/stat-reingest — see lib/admin/statReingest.ts.
 * Order of use: Preview (writes nothing) → Ingest + preview → Apply.
 */
type Mode = "dry" | "ingest" | "apply" | "apply-flips"

export function StatReingestPanel() {
  const [sport, setSport] = useState("NHL")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [leagueId, setLeagueId] = useState("")
  const [weeks, setWeeks] = useState("")
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function run(mode: Mode) {
    setBusy(true)
    setResult(null)
    const weekList = weeks
      .split(/[\s,]+/)
      .map((w) => Number(w))
      .filter((n) => Number.isInteger(n) && n > 0)
    const body: Record<string, unknown> = { sport, from, to, dryRun: mode === "dry" }
    if (leagueId.trim()) {
      body.leagueId = leagueId.trim()
      body.weeks = weekList
    }
    if (mode === "apply") {
      body.confirm = true
      body.skipIngest = true
    }
    if (mode === "apply-flips") {
      body.confirm = "allow-flips"
      body.skipIngest = true
    }
    try {
      const res = await fetch("/api/admin/redraft/stat-reingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      setResult(JSON.stringify(json, null, 2))
    } catch (e) {
      setResult(String(e))
    } finally {
      setBusy(false)
    }
  }

  const input = "rounded-xl border border-cyan-300/20 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
  const button =
    "rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-cyan-100 disabled:opacity-40"

  return (
    <div className="space-y-3 text-sm text-slate-200">
      <p className="text-slate-300">
        Re-reads game stats for the dates, then rescores the league&apos;s weeks. Preview writes nothing. Apply writes
        only if no result flips; use &quot;Apply, allow flips&quot; to override.
      </p>
      <div className="grid gap-2 sm:grid-cols-5">
        <select aria-label="Sport" className={input} value={sport} onChange={(e) => setSport(e.target.value)}>
          {["NHL", "NBA", "MLB", "NFL"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input aria-label="From" className={input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input aria-label="To" className={input} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <input aria-label="League id" className={input} placeholder="League id (optional)" value={leagueId} onChange={(e) => setLeagueId(e.target.value)} />
        <input aria-label="Weeks" className={input} placeholder="Weeks, e.g. 1,2" value={weeks} onChange={(e) => setWeeks(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy || !from || !to} onClick={() => run("dry")}>
          Preview
        </button>
        <button type="button" className={button} disabled={busy || !from || !to} onClick={() => run("ingest")}>
          Ingest + preview
        </button>
        <button type="button" className={button} disabled={busy || !from || !to || !leagueId} onClick={() => run("apply")}>
          Apply
        </button>
        <button type="button" className={button} disabled={busy || !from || !to || !leagueId} onClick={() => run("apply-flips")}>
          Apply, allow flips
        </button>
      </div>
      {busy ? <p className="text-cyan-100/70">Working…</p> : null}
      {result ? (
        <pre className="max-h-96 overflow-auto rounded-xl border border-cyan-300/15 bg-slate-950/80 p-3 text-xs text-slate-200">{result}</pre>
      ) : null}
    </div>
  )
}
