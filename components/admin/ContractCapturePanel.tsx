"use client"

import { useEffect, useState } from "react"

/**
 * Admin: one-time provider contract capture (owner decision 2026-11-25). A thin form over
 * GET/POST /api/admin/contract-capture — see lib/admin/contractCapture/contractCaptureService.ts.
 * Uses only YOUR connected Yahoo/ESPN account and only your own leagues; the file is redacted on
 * the server before it is sent, and nothing is saved.
 */
type LeagueOption = { id: string; provider: "yahoo" | "espn"; name: string; season: number }

export function ContractCapturePanel() {
  const [leagues, setLeagues] = useState<LeagueOption[] | null>(null)
  const [leagueId, setLeagueId] = useState("")
  const [week, setWeek] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/admin/contract-capture", { credentials: "include" })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setLeagues([])
          setMessage(json?.error ?? `HTTP ${res.status}`)
          return
        }
        const list: LeagueOption[] = Array.isArray(json?.leagues) ? json.leagues : []
        setLeagues(list)
        if (list[0]) setLeagueId(list[0].id)
      })
      .catch(() => !cancelled && setLeagues([]))
    return () => {
      cancelled = true
    }
  }, [])

  const selected = leagues?.find((l) => l.id === leagueId) ?? null
  const needsWeek = selected?.provider === "yahoo"

  async function download() {
    if (!selected) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch("/api/admin/contract-capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ leagueId: selected.id, week: needsWeek ? Number(week) : undefined }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setMessage(json?.error ?? `HTTP ${res.status}`)
        return
      }
      const disposition = res.headers.get("content-disposition") ?? ""
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "af-contract-capture.json"
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setMessage(`Downloaded ${filename}.`)
    } catch (e) {
      setMessage(String(e))
    } finally {
      setBusy(false)
    }
  }

  const input = "rounded-xl border border-cyan-300/20 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
  const button =
    "rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-cyan-100 disabled:opacity-40"

  return (
    <div className="space-y-3 text-sm text-slate-200" data-testid="contract-capture-panel">
      <p className="text-slate-300">
        One-time contract capture: reads one of your own leagues with your own connected account and downloads a
        redacted JSON file for <code>contracts/</code>. Names, ids and credentials are removed on the server; nothing is
        saved.
      </p>
      <div className="grid gap-2 sm:grid-cols-4">
        <input aria-label="Provider" className={input} readOnly value={selected ? selected.provider.toUpperCase() : "—"} />
        <select
          aria-label="League"
          className={`${input} sm:col-span-2`}
          value={leagueId}
          onChange={(e) => setLeagueId(e.target.value)}
          disabled={!leagues || leagues.length === 0}
        >
          {leagues === null ? <option value="">Loading your leagues…</option> : null}
          {leagues && leagues.length === 0 ? <option value="">No Yahoo or ESPN NFL leagues on your account</option> : null}
          {(leagues ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.provider.toUpperCase()} · {l.season} · {l.name}
            </option>
          ))}
        </select>
        <input
          aria-label="Week"
          className={input}
          inputMode="numeric"
          placeholder={needsWeek ? "Finished week, e.g. 11" : "Week (Yahoo only)"}
          value={week}
          disabled={!needsWeek}
          onChange={(e) => setWeek(e.target.value.replace(/\D/g, "").slice(0, 2))}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          disabled={busy || !selected || (needsWeek && !week)}
          onClick={download}
        >
          {busy ? "Capturing…" : "Download capture"}
        </button>
      </div>
      {leagues && leagues.length > 1 ? (
        <p className="text-xs text-slate-400">
          {leagues.length} leagues on your account ({leagues.filter((l) => l.provider === "espn").length} ESPN,{" "}
          {leagues.filter((l) => l.provider === "yahoo").length} Yahoo) — open the League list to pick one.
        </p>
      ) : null}
      {message ? <p className="text-xs text-slate-300">{message}</p> : null}
    </div>
  )
}
