"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useLegacyScoreLeaderboard } from "@/hooks/useLegacyScoreLeaderboard"
import { Award, Shield } from "lucide-react"
import type { LegacyScoreRecordRow } from "@/hooks/useLegacyScoreLeaderboard"
import type { LeagueTabProps } from "@/components/app/tabs/types"
import { SUPPORTED_SPORTS, normalizeToSupportedSport } from "@/lib/sport-scope"

const ENTITY_TYPES = ["MANAGER", "TEAM", "FRANCHISE"] as const

export default function LegacyTab({ leagueId }: LeagueTabProps) {
  const [sportFilter, setSportFilter] = useState("")
  const [entityTypeFilter, setEntityTypeFilter] = useState("MANAGER")
  const [explainKey, setExplainKey] = useState<string | null>(null)
  const [explainNarrative, setExplainNarrative] = useState<string | null>(null)
  const [explainLoading, setExplainLoading] = useState<string | null>(null)
  const [runLoading, setRunLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [runSummary, setRunSummary] = useState<string | null>(null)
  const [compareA, setCompareA] = useState("")
  const [compareB, setCompareB] = useState("")

  const { records, total, loading, error, refresh } = useLegacyScoreLeaderboard({
    leagueId,
    sport: sportFilter || null,
    entityType: entityTypeFilter || null,
  })

  useEffect(() => {
    if (records.length === 0) {
      setCompareA("")
      setCompareB("")
      return
    }
    const keys = records.map((r) => `${r.entityType}:${r.entityId}`)
    if (!keys.includes(compareA)) setCompareA(keys[0] ?? "")
    if (!keys.includes(compareB)) setCompareB(keys[1] ?? keys[0] ?? "")
  }, [records, compareA, compareB])

  const comparePair = useMemo(() => {
    const a = records.find((r) => `${r.entityType}:${r.entityId}` === compareA) ?? null
    const b = records.find((r) => `${r.entityType}:${r.entityId}` === compareB) ?? null
    return { a, b }
  }, [records, compareA, compareB])

  const runEngine = useCallback(async () => {
    setRunLoading(true)
    setActionError(null)
    setRunSummary(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/legacy-score/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(sportFilter ? { sport: normalizeToSupportedSport(sportFilter) } : {}),
          entityTypes: ["MANAGER", "TEAM", "FRANCHISE"],
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? "Failed to run legacy score engine")
      await refresh()
      setRunSummary(
        `Engine complete: ${data?.processed ?? 0} processed (${data?.managerProcessed ?? 0} managers, ${data?.teamProcessed ?? 0} teams, ${data?.franchiseProcessed ?? 0} franchises).`
      )
    } catch (e: any) {
      setActionError(e?.message ?? "Failed to run legacy score engine")
    } finally {
      setRunLoading(false)
    }
  }, [leagueId, refresh, sportFilter])

  const explain = useCallback(
    async (record: LegacyScoreRecordRow) => {
      const key = `${record.entityType}:${record.entityId}`
      if (explainKey === key && explainNarrative !== null) {
        setExplainKey(null)
        setExplainNarrative(null)
        setExplainLoading(null)
        return
      }
      setExplainKey(key)
      setExplainNarrative(null)
      setExplainLoading(key)
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/legacy-score/explain`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entityType: record.entityType,
            entityId: record.entityId,
            sport: record.sport,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error ?? "Could not load explanation.")
        setExplainNarrative(data?.narrative ?? "No explanation available.")
      } catch (e: any) {
        setExplainNarrative(e?.message ?? "Could not load explanation.")
      } finally {
        setExplainLoading(null)
      }
    },
    [leagueId, explainKey, explainNarrative]
  )

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-white">Legacy Score</h2>
            <p className="text-xs text-white/60">
              Long-term greatness: championships, playoffs, consistency, rivalry, awards, and dynasty staying power.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm"
              value={sportFilter}
              onChange={(e) => setSportFilter(e.target.value)}
              data-testid="legacy-sport-filter"
            >
              <option value="">All sports</option>
              {SUPPORTED_SPORTS.map((s) => (
                <option key={s} value={s}>
                  {s === "NCAAB" ? "NCAA Basketball" : s === "NCAAF" ? "NCAA Football" : s}
                </option>
              ))}
            </select>
            <select
              className="rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm"
              value={entityTypeFilter}
              onChange={(e) => setEntityTypeFilter(e.target.value)}
              data-testid="legacy-entity-type-filter"
            >
              {ENTITY_TYPES.map((row) => (
                <option key={row} value={row}>
                  {row}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-xl bg-zinc-700 text-white px-3 py-2 text-sm disabled:opacity-60"
              disabled={loading}
              onClick={() => refresh()}
              data-testid="legacy-refresh"
            >
              Refresh
            </button>
            <button
              type="button"
              className="rounded-xl bg-amber-600 text-white px-3 py-2 text-sm disabled:opacity-60"
              disabled={runLoading}
              onClick={runEngine}
              data-testid="legacy-run-engine"
            >
              {runLoading ? "Running…" : "Run legacy engine"}
            </button>
          </div>
        </div>

        <p className="mt-2 text-xs text-amber-200/80">
          Legacy scores are computed from season history, championships, playoffs, rivalry, awards, and consistency.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={`/league/${encodeURIComponent(leagueId)}?tab=Hall of Fame`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/25"
          >
            <Award className="h-3.5 w-3.5" /> Hall of Fame
          </Link>
          <Link
            href={`/league/${encodeURIComponent(leagueId)}?tab=Settings&settingsTab=${encodeURIComponent("Reputation")}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/25"
          >
            <Shield className="h-3.5 w-3.5" /> Trust scores (Reputation)
          </Link>
          <Link
            href="/app/legacy-score"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/90 hover:bg-white/20"
          >
            Platform legacy leaderboard
          </Link>
        </div>
      </div>

      {actionError && (
        <div className="rounded-xl bg-red-900/20 border border-red-500/30 p-3 text-sm text-red-200">
          {actionError}
        </div>
      )}
      {runSummary && (
        <div className="rounded-xl bg-emerald-900/20 border border-emerald-500/30 p-3 text-sm text-emerald-200">
          {runSummary}
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-red-900/20 border border-red-500/30 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading && <div className="text-sm text-white/50">Loading legacy leaderboard…</div>}

      {!loading && records.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-white/80">Legacy leaderboard ({total})</h3>
          <div className="space-y-2">
            {records.slice(0, 30).map((r, idx) => (
              <LegacyScoreCard
                key={r.id}
                rank={idx + 1}
                record={r}
                leagueId={leagueId}
                explainKey={explainKey}
                explainNarrative={explainNarrative}
                explainLoading={explainLoading}
                onExplain={() => explain(r)}
              />
            ))}
          </div>
        </div>
      )}

      {!loading && records.length > 1 && comparePair.a && comparePair.b && (
        <section className="rounded-xl border border-white/10 bg-zinc-950/50 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white/90">Comparison view</h3>
          <div className="flex flex-wrap gap-2">
            <select
              value={compareA}
              onChange={(e) => setCompareA(e.target.value)}
              className="rounded-lg border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              data-testid="legacy-compare-a"
            >
              {records.map((row) => (
                <option key={`${row.entityType}:${row.entityId}`} value={`${row.entityType}:${row.entityId}`}>
                  {row.entityType} {row.entityId}
                </option>
              ))}
            </select>
            <select
              value={compareB}
              onChange={(e) => setCompareB(e.target.value)}
              className="rounded-lg border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              data-testid="legacy-compare-b"
            >
              {records.map((row) => (
                <option key={`${row.entityType}:${row.entityId}`} value={`${row.entityType}:${row.entityId}`}>
                  {row.entityType} {row.entityId}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {[comparePair.a, comparePair.b].map((row) => (
              <article key={`${row.entityType}:${row.entityId}`} className="rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-white/85">
                <p className="font-semibold">{row.entityType} {row.entityId}</p>
                <p className="text-white/60">{row.sport}</p>
                <p className="mt-1">Overall: <span className="text-amber-300">{row.overallLegacyScore.toFixed(1)}</span></p>
                <p>Championship: {row.championshipScore.toFixed(1)}</p>
                <p>Playoff: {row.playoffScore.toFixed(1)}</p>
                <p>Consistency: {row.consistencyScore.toFixed(1)}</p>
                <p>Rivalry: {row.rivalryScore.toFixed(1)}</p>
                <p>Awards: {row.awardsScore.toFixed(1)}</p>
                <p>Dynasty: {row.dynastyScore.toFixed(1)}</p>
                <Link
                  href={`/app/league/${encodeURIComponent(leagueId)}/legacy/breakdown?entityType=${encodeURIComponent(row.entityType)}&entityId=${encodeURIComponent(row.entityId)}&sport=${encodeURIComponent(row.sport)}`}
                  className="mt-2 inline-flex text-amber-300 hover:underline"
                >
                  Score breakdown
                </Link>
              </article>
            ))}
          </div>
        </section>
      )}

      {!loading && records.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center text-sm text-white/60">
          No legacy scores yet. Click &quot;Run legacy engine&quot; to compute scores from league history.
        </div>
      )}
    </div>
  )
}

function LegacyScoreCard({
  rank,
  record,
  leagueId,
  explainKey,
  explainNarrative,
  explainLoading,
  onExplain,
}: {
  rank: number
  record: LegacyScoreRecordRow
  leagueId: string
  explainKey: string | null
  explainNarrative: string | null
  explainLoading: string | null
  onExplain: () => void
}) {
  const rowKey = `${record.entityType}:${record.entityId}`
  return (
    <article className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 w-6">#{rank}</span>
          <span className="font-medium text-white">
            {record.entityType} {record.entityId}
          </span>
          <span className="text-xs text-zinc-400">{record.sport}</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="font-bold text-amber-400">{record.overallLegacyScore.toFixed(0)}</span>
          <Link
            href={`/app/league/${encodeURIComponent(leagueId)}/legacy/breakdown?entityType=${encodeURIComponent(record.entityType)}&entityId=${encodeURIComponent(record.entityId)}&sport=${encodeURIComponent(record.sport)}`}
            className="text-xs text-amber-400 hover:underline"
            data-testid={`legacy-breakdown-link-${rowKey}`}
          >
            Why is this score high?
          </Link>
          <button
            type="button"
            className="text-xs text-amber-400 hover:underline disabled:opacity-50"
            disabled={explainLoading === rowKey}
            onClick={onExplain}
            data-testid={`legacy-ai-explain-${rowKey}`}
          >
            {explainLoading === rowKey
              ? "…"
              : explainKey === rowKey && explainNarrative
                ? "Hide"
                : "Explain with Chimmy"}
          </button>
        </div>
      </div>
      {explainKey === rowKey && explainNarrative && (
        <div className="mt-2 rounded-lg bg-zinc-900 p-2 text-xs text-zinc-300">
          {explainNarrative}
        </div>
      )}
    </article>
  )
}
