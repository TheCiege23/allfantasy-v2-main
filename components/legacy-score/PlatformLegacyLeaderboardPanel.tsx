"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { SUPPORTED_SPORTS, normalizeToSupportedSport } from "@/lib/sport-scope"

interface LegacyPlatformRow {
  id: string
  entityType: string
  entityId: string
  sport: string
  leagueId: string | null
  overallLegacyScore: number
  championshipScore: number
  playoffScore: number
  consistencyScore: number
  rivalryScore: number
  awardsScore: number
  dynastyScore: number
  updatedAt: string
}

const ENTITY_TYPES = ["MANAGER", "TEAM", "FRANCHISE"] as const

export default function PlatformLegacyLeaderboardPanel() {
  const [sportFilter, setSportFilter] = useState("")
  const [entityTypeFilter, setEntityTypeFilter] = useState("MANAGER")
  const [leagueIdFilter, setLeagueIdFilter] = useState("")
  const [rows, setRows] = useState<LegacyPlatformRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [narrative, setNarrative] = useState<string | null>(null)
  const [narrativeKey, setNarrativeKey] = useState<string | null>(null)

  const queryString = useMemo(() => {
    const qp = new URLSearchParams()
    if (sportFilter) qp.set("sport", normalizeToSupportedSport(sportFilter))
    if (entityTypeFilter) qp.set("entityType", entityTypeFilter)
    if (leagueIdFilter.trim()) qp.set("leagueId", leagueIdFilter.trim())
    qp.set("limit", "100")
    return qp.toString()
  }, [sportFilter, entityTypeFilter, leagueIdFilter])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/legacy-score/leaderboard?${queryString}`, {
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? "Failed to load platform legacy leaderboard")
      setRows(Array.isArray(data?.records) ? data.records : [])
      setTotal(typeof data?.total === "number" ? data.total : 0)
    } catch (e: any) {
      setRows([])
      setTotal(0)
      setError(e?.message ?? "Failed to load platform legacy leaderboard")
    } finally {
      setLoading(false)
    }
  }, [queryString])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function explainRow(row: LegacyPlatformRow) {
    const key = `${row.entityType}:${row.entityId}:${row.leagueId ?? "platform"}`
    if (narrativeKey === key && narrative) {
      setNarrativeKey(null)
      setNarrative(null)
      return
    }
    setNarrativeKey(key)
    setNarrative(null)
    if (!row.leagueId) {
      setNarrative("This entry is platform-scoped. Open a league-scoped record to generate a detailed AI explanation.")
      return
    }
    const res = await fetch(`/api/leagues/${encodeURIComponent(row.leagueId)}/legacy-score/explain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityType: row.entityType,
        entityId: row.entityId,
        sport: row.sport,
      }),
    })
    const data = await res.json().catch(() => ({}))
    setNarrative(data?.narrative ?? data?.error ?? "No explanation available.")
  }

  return (
    <main className="space-y-4 p-4">
      <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <h1 className="text-lg font-semibold text-white">Platform Legacy Leaderboard</h1>
        <p className="mt-1 text-xs text-white/65">
          Cross-league legacy rankings from the legacy score engine. Filter by sport, entity type, or league.
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-5">
          <select
            value={sportFilter}
            onChange={(e) => setSportFilter(e.target.value)}
            className="rounded-lg border border-white/20 bg-zinc-950 px-2 py-1.5 text-sm text-white"
            data-testid="platform-legacy-sport-filter"
          >
            <option value="">All sports</option>
            {SUPPORTED_SPORTS.map((s) => (
              <option key={s} value={s}>
                {s === "NCAAB" ? "NCAA Basketball" : s === "NCAAF" ? "NCAA Football" : s}
              </option>
            ))}
          </select>
          <select
            value={entityTypeFilter}
            onChange={(e) => setEntityTypeFilter(e.target.value)}
            className="rounded-lg border border-white/20 bg-zinc-950 px-2 py-1.5 text-sm text-white"
            data-testid="platform-legacy-entity-filter"
          >
            {ENTITY_TYPES.map((row) => (
              <option key={row} value={row}>
                {row}
              </option>
            ))}
          </select>
          <input
            value={leagueIdFilter}
            onChange={(e) => setLeagueIdFilter(e.target.value)}
            className="rounded-lg border border-white/20 bg-zinc-950 px-2 py-1.5 text-sm text-white"
            placeholder="League ID (optional)"
            data-testid="platform-legacy-league-filter"
          />
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/15"
            data-testid="platform-legacy-refresh"
          >
            Refresh
          </button>
          <Link
            href="/power-rankings"
            className="rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-center text-sm text-cyan-200 hover:bg-cyan-500/25"
          >
            Platform power rankings
          </Link>
        </div>
      </section>

      {error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>
      )}
      {loading && <p className="text-sm text-white/60">Loading platform legacy leaderboard...</p>}

      {!loading && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-white/85">
            Leaderboard {total > 0 ? `(${rows.length}/${total})` : ""}
          </h2>
          {rows.length === 0 && (
            <p className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/60">
              No platform legacy scores for this scope.
            </p>
          )}
          {rows.map((row, index) => {
            const key = `${row.entityType}:${row.entityId}:${row.leagueId ?? "platform"}`
            return (
              <article key={row.id} className="rounded-lg border border-white/10 bg-zinc-950/60 p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-white">
                      #{index + 1} {row.entityType} {row.entityId}
                    </p>
                    <p className="text-white/60">
                      {row.sport}
                      {row.leagueId ? ` · league ${row.leagueId}` : " · platform scope"}
                    </p>
                  </div>
                  <p className="font-bold text-amber-300">{row.overallLegacyScore.toFixed(1)}</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-white/70">
                  <span>Champ {row.championshipScore.toFixed(1)}</span>
                  <span>Playoff {row.playoffScore.toFixed(1)}</span>
                  <span>Consistency {row.consistencyScore.toFixed(1)}</span>
                  <span>Rivalry {row.rivalryScore.toFixed(1)}</span>
                  <span>Awards {row.awardsScore.toFixed(1)}</span>
                  <span>Dynasty {row.dynastyScore.toFixed(1)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {row.leagueId && (
                    <Link
                      href={`/league/${encodeURIComponent(row.leagueId)}?tab=Legacy`}
                      className="text-amber-300 hover:underline"
                    >
                      Open league Legacy tab
                    </Link>
                  )}
                  {row.leagueId && (
                    <Link
                      href={`/app/league/${encodeURIComponent(row.leagueId)}/legacy/breakdown?entityType=${encodeURIComponent(row.entityType)}&entityId=${encodeURIComponent(row.entityId)}&sport=${encodeURIComponent(row.sport)}`}
                      className="text-cyan-300 hover:underline"
                    >
                      Why is this score high?
                    </Link>
                  )}
                  <button
                    type="button"
                    className="text-cyan-300 hover:underline"
                    onClick={() => void explainRow(row)}
                    data-testid={`platform-legacy-explain-${key}`}
                  >
                    AI explain
                  </button>
                </div>
              </article>
            )
          })}
        </section>
      )}

      {narrative && narrativeKey && (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
          <p className="font-medium">Narrative ({narrativeKey})</p>
          <p className="mt-1">{narrative}</p>
        </section>
      )}
    </main>
  )
}
