"use client"
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Database,
  Key,
  RefreshCw,
  Wifi,
  XCircle,
} from "lucide-react"
import type { WorldCupDiagnosticsResult } from "@/lib/world-cup/worldCupDiagnosticsService"

function StatusIcon({ ok }: { ok: boolean | null }) {
  if (ok === null) return <AlertTriangle className="h-4 w-4 text-amber-300" />
  return ok ? (
    <CheckCircle className="h-4 w-4 text-emerald-400" />
  ) : (
    <XCircle className="h-4 w-4 text-rose-400" />
  )
}

function Row({ label, value, ok }: { label: string; value: React.ReactNode; ok?: boolean | null }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 py-2.5">
      <span className="text-sm text-white/55">{label}</span>
      <div className="flex items-center gap-2 text-sm font-bold text-white">
        {ok !== undefined && <StatusIcon ok={ok ?? null} />}
        {value}
      </div>
    </div>
  )
}

export default function WorldCupHealthDashboard() {
  const [diagnostics, setDiagnostics] = useState<WorldCupDiagnosticsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<string | null>(null)

  const runCheck = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/brackets/world-cup/admin/health")
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? `HTTP ${res.status}`)
      }
      const d = await res.json()
      setDiagnostics(d.diagnostics)
      setLastRun(new Date().toLocaleTimeString())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Health check failed")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    runCheck()
  }, [runCheck])

  async function runTestSync() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/brackets/world-cup/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
      alert(`Sync complete. Brackets updated: ${d.results?.length ?? 0}`)
      await runCheck()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed")
    } finally {
      setLoading(false)
    }
  }

  const d = diagnostics

  return (
    <div className="min-h-screen bg-[#05070b] px-4 py-8 text-white">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <Link
            href="/dashboard/admin/world-cup"
            className="rounded-lg border border-white/10 bg-white/[0.04] p-2 text-white/60 hover:bg-white/[0.08]"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-black">World Cup Health</h1>
            {lastRun && <p className="text-xs text-white/35">Last checked: {lastRun}</p>}
          </div>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={runCheck}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-white/70 hover:bg-white/[0.08] disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Run Check
            </button>
            <button
              type="button"
              onClick={runTestSync}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-cyan-300 px-3 py-2 text-xs font-black text-black disabled:opacity-50"
            >
              <Activity className="h-3.5 w-3.5" />
              Test Sync
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        )}

        {loading && !d && (
          <div className="flex items-center justify-center py-16 text-white/30">
            <RefreshCw className="h-6 w-6 animate-spin" />
          </div>
        )}

        {d && (
          <div className="space-y-6">
            {/* API / Config */}
            <section className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wider text-white/50">
                <Key className="h-4 w-4" /> API Configuration
              </h2>
              <Row label="API Key configured" value={d.apiKeyConfigured ? "Yes" : "Not set"} ok={d.apiKeyConfigured} />
              <Row
                label="League ID configured"
                value={d.leagueIdConfigured ? `ID: ${d.leagueId}` : "Not set"}
                ok={d.leagueIdConfigured}
              />
              <Row
                label="API sample fetch"
                value={d.apiFetchSample}
                ok={d.apiFetchSample === "ok" ? true : d.apiFetchSample === "skipped" ? null : false}
              />
              {d.apiFetchError && (
                <div className="mt-2 rounded bg-rose-400/10 px-3 py-2 text-xs text-rose-200">{d.apiFetchError}</div>
              )}
              <Row label="Can normalize status" value={d.canNormalizeStatus ? "Pass" : "Fail"} ok={d.canNormalizeStatus} />
              <Row
                label="Can identify PEN winner"
                value={d.canIdentifyWinner ? "Pass" : "Fail"}
                ok={d.canIdentifyWinner}
              />
            </section>

            {/* Database */}
            <section className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wider text-white/50">
                <Database className="h-4 w-4" /> Database
              </h2>
              <Row label="DB connection" value={d.dbConnected ? "Connected" : "Failed"} ok={d.dbConnected} />
              <Row
                label="World Cup tables"
                value={d.worldCupTablesAvailable ? "Available" : "Missing"}
                ok={d.worldCupTablesAvailable}
              />
              <Row label="Teams loaded" value={d.teamCount} ok={d.teamCount > 0} />
              <Row label="Fixture rows (with API ID)" value={d.fixtureCount} />
              <Row label="Participants total" value={d.participantCount} />
            </section>

            {/* Brackets */}
            <section className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wider text-white/50">
                <Activity className="h-4 w-4" /> Brackets
              </h2>
              <Row label="Open brackets" value={d.openBracketCount} />
              <Row label="Live brackets" value={d.liveBracketCount} />
              <Row label="Final brackets" value={d.finalBracketCount} />
            </section>

            {/* Sync Status */}
            <section className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wider text-white/50">
                <Wifi className="h-4 w-4" /> Sync Status
              </h2>
              <Row
                label="Last successful sync"
                value={
                  d.lastSuccessfulSync
                    ? new Date(d.lastSuccessfulSync).toLocaleString()
                    : "Never"
                }
                ok={Boolean(d.lastSuccessfulSync)}
              />
              <Row
                label="Last sync error"
                value={d.lastSyncError ?? "None"}
                ok={!d.lastSyncError}
              />
            </section>

            {/* Any errors from diagnostics run */}
            {d.errors.length > 0 && (
              <section className="rounded-lg border border-rose-400/25 bg-rose-400/5 p-5">
                <h2 className="mb-3 text-sm font-black text-rose-300">Diagnostic Errors</h2>
                <ul className="space-y-1">
                  {d.errors.map((e, i) => (
                    <li key={i} className="text-xs text-rose-200">
                      {e}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
