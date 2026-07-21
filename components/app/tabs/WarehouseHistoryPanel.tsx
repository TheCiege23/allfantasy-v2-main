"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { DEFAULT_SPORT, SUPPORTED_SPORTS, normalizeToSupportedSport } from "@/lib/sport-scope"
import { useUserTimezone } from "@/hooks/useUserTimezone"

type WarehouseView =
  | "summary"
  | "matchups"
  | "standings"
  | "rosters"
  | "draft"
  | "transactions"
  | "player"
  | "team"
  | "ai"

const VIEWS: Array<{ value: WarehouseView; label: string }> = [
  { value: "summary", label: "Summary" },
  { value: "matchups", label: "Matchups" },
  { value: "standings", label: "Standings" },
  { value: "rosters", label: "Roster snapshots" },
  { value: "draft", label: "Draft history" },
  { value: "transactions", label: "Transactions" },
  { value: "player", label: "Player drill-down" },
  { value: "team", label: "Team drill-down" },
  { value: "ai", label: "AI insight" },
]

type WarehouseSummary = {
  leagueId: string
  sport: string
  season?: number
  matchupCount: number
  standingCount: number
  rosterSnapshotCount: number
  draftFactCount: number
  transactionCount: number
  playerGameFactCount: number
  teamGameFactCount: number
}

type WarehouseDataState = {
  status: "AVAILABLE" | "PARTIAL" | "PENDING_IMPORT" | "UNAVAILABLE"
  coverage?: {
    sourcePlayerGameStats: number
    generatedPlayerFacts: number
    sourceWeeks: number
    factWeeks: number
    earliestSeason: number | null
    latestSeason: number | null
  }
  warnings?: string[]
}

type WarehousePayload = {
  leagueId: string
  view: WarehouseView
  summary: WarehouseSummary
  dataState?: WarehouseDataState
  data?: Record<string, unknown>
}

// Truthful empty states: an empty result set is only "no history" when statistics have
// actually been imported — otherwise it's a missing import and must say so.
const DATA_STATE_BANNERS: Record<Exclude<WarehouseDataState["status"], "AVAILABLE">, { tone: string; text: string }> = {
  PENDING_IMPORT: {
    tone: "border-amber-400/40 bg-amber-400/10 text-amber-200",
    text: "Player game statistics have not been imported for this sport yet. Historical player data will appear after the next stats import completes — an empty view here does not mean your league has no history.",
  },
  UNAVAILABLE: {
    tone: "border-amber-400/40 bg-amber-400/10 text-amber-200",
    text: "Player statistics exist but warehouse history has not been generated from them yet. Historical views may be empty until processing completes.",
  },
  PARTIAL: {
    tone: "border-sky-400/40 bg-sky-400/10 text-sky-200",
    text: "Historical player data is partial — some weeks have not been processed yet, so totals may be incomplete.",
  },
}

function toIntOrUndefined(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

export default function WarehouseHistoryPanel({
  leagueId,
  onBackToOverview,
}: {
  leagueId: string
  onBackToOverview?: () => void
}) {
  const { formatInTimezone } = useUserTimezone()
  const [view, setView] = useState<WarehouseView>("summary")
  const [sport, setSport] = useState<string>(DEFAULT_SPORT)
  const [season, setSeason] = useState<string>("")
  const [fromWeek, setFromWeek] = useState<string>("")
  const [toWeek, setToWeek] = useState<string>("")
  const [teamId, setTeamId] = useState<string>("")
  const [playerId, setPlayerId] = useState<string>("")
  const [showCharts, setShowCharts] = useState(true)
  const [applyToken, setApplyToken] = useState(0)

  const [payload, setPayload] = useState<WarehousePayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [selectedMatchup, setSelectedMatchup] = useState<{
    teamA: string
    teamB: string
    scoreA: number
    scoreB: number
    winnerTeamId?: string | null
    weekOrPeriod?: number
  } | null>(null)

  const canApply = useMemo(() => {
    if (view === "player") return playerId.trim().length > 0
    if (view === "team" || view === "rosters") return teamId.trim().length > 0
    return true
  }, [playerId, teamId, view])

  const fetchWarehouseData = useCallback(async () => {
    if (!leagueId) return
    if (!canApply) return

    setLoading(true)
    setError(null)
    setSelectedMatchup(null)
    try {
      const params = new URLSearchParams({
        leagueId,
        view,
        sport: normalizeToSupportedSport(sport),
      })
      const seasonInt = toIntOrUndefined(season)
      const fromWeekInt = toIntOrUndefined(fromWeek)
      const toWeekInt = toIntOrUndefined(toWeek)
      if (seasonInt != null) params.set("season", String(seasonInt))
      if (fromWeekInt != null) params.set("fromWeek", String(fromWeekInt))
      if (toWeekInt != null) params.set("toWeek", String(toWeekInt))
      if (teamId.trim()) params.set("teamId", teamId.trim())
      if (playerId.trim()) params.set("playerId", playerId.trim())

      const res = await fetch(`/api/warehouse/league-history?${params}`, { cache: "no-store" })
      const json = await res.json()
      if (!res.ok || json?.error) {
        throw new Error(json?.error || "Failed to load warehouse data")
      }
      setPayload(json as WarehousePayload)
      if ((json as WarehousePayload)?.summary?.sport) {
        setSport(normalizeToSupportedSport((json as WarehousePayload).summary.sport))
      }
      setLastUpdated(new Date().toISOString())
    } catch (e) {
      setPayload(null)
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [applyToken, canApply, fromWeek, leagueId, playerId, season, sport, teamId, toWeek, view])

  useEffect(() => {
    void fetchWarehouseData()
  }, [fetchWarehouseData])

  const exportCurrentView = useCallback(() => {
    if (!payload) return
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `warehouse-${leagueId}-${view}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [leagueId, payload, view])

  const summary = payload?.summary
  const matchups = Array.isArray(payload?.data?.matchups) ? (payload?.data?.matchups as Array<Record<string, unknown>>) : []
  const standings = Array.isArray(payload?.data?.standings) ? (payload?.data?.standings as Array<Record<string, unknown>>) : []
  const snapshots = Array.isArray(payload?.data?.snapshots) ? (payload?.data?.snapshots as Array<Record<string, unknown>>) : []
  const draftRows = Array.isArray(payload?.data?.draft) ? (payload?.data?.draft as Array<Record<string, unknown>>) : []
  const transactionRows = Array.isArray(payload?.data?.transactions) ? (payload?.data?.transactions as Array<Record<string, unknown>>) : []
  const playerFacts = Array.isArray(payload?.data?.playerFacts) ? (payload?.data?.playerFacts as Array<Record<string, unknown>>) : []
  const teamMatchups = Array.isArray(payload?.data?.teamMatchups) ? (payload?.data?.teamMatchups as Array<Record<string, unknown>>) : []

  const maxMatchupScore = matchups.reduce((max, row) => {
    const a = typeof row.scoreA === "number" ? row.scoreA : 0
    const b = typeof row.scoreB === "number" ? row.scoreB : 0
    return Math.max(max, a, b)
  }, 1)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={view}
          onChange={(e) => setView(e.target.value as WarehouseView)}
          className="rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white"
          aria-label="Warehouse view"
        >
          {VIEWS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={sport}
          onChange={(e) => setSport(normalizeToSupportedSport(e.target.value))}
          className="rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white"
          aria-label="Warehouse sport filter"
        >
          {SUPPORTED_SPORTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          value={season}
          onChange={(e) => setSeason(e.target.value)}
          placeholder="Season"
          aria-label="Season filter"
          className="w-20 rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white placeholder:text-white/40"
        />
        <input
          value={fromWeek}
          onChange={(e) => setFromWeek(e.target.value)}
          placeholder="From"
          aria-label="From week"
          className="w-16 rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white placeholder:text-white/40"
        />
        <input
          value={toWeek}
          onChange={(e) => setToWeek(e.target.value)}
          placeholder="To"
          aria-label="To week"
          className="w-16 rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white placeholder:text-white/40"
        />
        {(view === "team" || view === "rosters") && (
          <input
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            placeholder="Team ID"
            aria-label="Team ID filter"
            className="w-36 rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white placeholder:text-white/40"
          />
        )}
        {view === "player" && (
          <input
            value={playerId}
            onChange={(e) => setPlayerId(e.target.value)}
            placeholder="Player ID"
            aria-label="Player ID filter"
            className="w-36 rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white placeholder:text-white/40"
          />
        )}
        <button
          type="button"
          onClick={() => setApplyToken((v) => v + 1)}
          disabled={!canApply}
          className="rounded border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
          aria-label="Apply warehouse filters"
        >
          Apply filters
        </button>
        <button
          type="button"
          onClick={() => setApplyToken((v) => v + 1)}
          className="rounded border border-white/20 px-2 py-1 text-xs hover:bg-white/10"
          aria-label="Refresh warehouse data"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={() => setShowCharts((v) => !v)}
          className="rounded border border-white/20 px-2 py-1 text-xs hover:bg-white/10"
          aria-label={showCharts ? "Hide warehouse charts" : "Show warehouse charts"}
        >
          {showCharts ? "Hide charts" : "Show charts"}
        </button>
        <button
          type="button"
          onClick={() => {
            setView("ai")
            setApplyToken((v) => v + 1)
          }}
          className="rounded border border-violet-400/30 bg-violet-500/10 px-2 py-1 text-xs text-violet-200 hover:bg-violet-500/20"
          aria-label="Launch AI warehouse insight"
        >
          AI insight
        </button>
        <button
          type="button"
          onClick={exportCurrentView}
          disabled={!payload}
          className="rounded border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
          aria-label="Export warehouse data"
        >
          Export JSON
        </button>
        {onBackToOverview && (
          <button
            type="button"
            onClick={onBackToOverview}
            className="rounded border border-white/20 px-2 py-1 text-xs hover:bg-white/10"
            aria-label="Back to Overview tab"
          >
            Back to Overview
          </button>
        )}
      </div>

      {loading && <p className="text-sm text-white/60">Loading historical data…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && !error && payload?.dataState && payload.dataState.status !== "AVAILABLE" && (
        <div
          className={`rounded-lg border p-3 text-sm ${DATA_STATE_BANNERS[payload.dataState.status].tone}`}
          role="status"
        >
          {DATA_STATE_BANNERS[payload.dataState.status].text}
        </div>
      )}

      {!loading && !error && summary && (
        <div className="rounded-lg border border-white/10 p-3 text-sm text-white/80">
          <p className="mb-2 font-medium">Warehouse summary ({summary.sport}{summary.season != null ? ` · ${summary.season}` : ""})</p>
          <ul className="list-disc list-inside text-xs text-white/70">
            <li>Matchups: {summary.matchupCount}</li>
            <li>Standings snapshots: {summary.standingCount}</li>
            <li>Roster snapshots: {summary.rosterSnapshotCount}</li>
            <li>Draft picks: {summary.draftFactCount}</li>
            <li>Transactions: {summary.transactionCount}</li>
            <li>Player game facts: {summary.playerGameFactCount}</li>
            <li>Team game facts: {summary.teamGameFactCount}</li>
          </ul>
          {lastUpdated && <p className="mt-2 text-[11px] text-white/50">Last refresh: {formatInTimezone(lastUpdated)}</p>}
        </div>
      )}

      {!loading && !error && view === "matchups" && (
        <div className="space-y-2">
          {matchups.length === 0 ? (
            <p className="text-sm text-white/60">No matchup history in this range.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-left text-white/60">
                    <th className="px-2 py-1">Week</th>
                    <th className="px-2 py-1">Team A</th>
                    <th className="px-2 py-1">Team B</th>
                    <th className="px-2 py-1">Score</th>
                    <th className="px-2 py-1">Winner</th>
                    <th className="px-2 py-1">Drill-down</th>
                  </tr>
                </thead>
                <tbody>
                  {matchups.map((row, idx) => {
                    const scoreA = typeof row.scoreA === "number" ? row.scoreA : 0
                    const scoreB = typeof row.scoreB === "number" ? row.scoreB : 0
                    return (
                      <tr key={`${row.matchupId ?? idx}`} className="border-b border-white/5">
                        <td className="px-2 py-1">{String(row.weekOrPeriod ?? "-")}</td>
                        <td className="px-2 py-1">{String(row.teamA ?? "-")}</td>
                        <td className="px-2 py-1">{String(row.teamB ?? "-")}</td>
                        <td className="px-2 py-1">
                          {scoreA.toFixed(1)} - {scoreB.toFixed(1)}
                          {showCharts && (
                            <div className="mt-1 h-1.5 w-24 overflow-hidden rounded bg-white/10">
                              <div
                                className="h-full bg-cyan-400"
                                style={{ width: `${Math.max(2, Math.round((Math.max(scoreA, scoreB) / maxMatchupScore) * 100))}%` }}
                              />
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1">{String(row.winnerTeamId ?? "Tie")}</td>
                        <td className="px-2 py-1">
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedMatchup({
                                teamA: String(row.teamA ?? ""),
                                teamB: String(row.teamB ?? ""),
                                scoreA,
                                scoreB,
                                winnerTeamId: typeof row.winnerTeamId === "string" ? row.winnerTeamId : null,
                                weekOrPeriod: typeof row.weekOrPeriod === "number" ? row.weekOrPeriod : undefined,
                              })
                            }
                            className="text-violet-300 hover:underline"
                            aria-label={`View matchup details for week ${String(row.weekOrPeriod ?? "-")}`}
                          >
                            Details
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {selectedMatchup && (
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs" role="dialog" aria-label="Matchup details">
              <div className="flex items-center justify-between gap-2">
                <strong>
                  Week {selectedMatchup.weekOrPeriod ?? "-"} · {selectedMatchup.teamA} vs {selectedMatchup.teamB}
                </strong>
                <button
                  type="button"
                  onClick={() => setSelectedMatchup(null)}
                  className="text-white/70 hover:text-white"
                  aria-label="Close matchup details"
                >
                  Close
                </button>
              </div>
              <p className="mt-1 text-white/70">
                Score {selectedMatchup.scoreA.toFixed(1)} - {selectedMatchup.scoreB.toFixed(1)} · Winner: {selectedMatchup.winnerTeamId ?? "Tie"}
              </p>
            </div>
          )}
        </div>
      )}

      {!loading && !error && view === "standings" && (
        standings.length === 0 ? (
          <p className="text-sm text-white/60">No standings rows in this season.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 text-left text-white/60">
                  <th className="px-2 py-1">Rank</th>
                  <th className="px-2 py-1">Team</th>
                  <th className="px-2 py-1">W-L-T</th>
                  <th className="px-2 py-1">PF</th>
                  <th className="px-2 py-1">PA</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((row, idx) => (
                  <tr key={`${row.standingId ?? idx}`} className="border-b border-white/5">
                    <td className="px-2 py-1">{String(row.rank ?? "-")}</td>
                    <td className="px-2 py-1">{String(row.teamId ?? "-")}</td>
                    <td className="px-2 py-1">{String(row.wins ?? 0)}-{String(row.losses ?? 0)}-{String(row.ties ?? 0)}</td>
                    <td className="px-2 py-1">{String(row.pointsFor ?? 0)}</td>
                    <td className="px-2 py-1">{String(row.pointsAgainst ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {!loading && !error && view === "rosters" && (
        snapshots.length === 0 ? (
          <p className="text-sm text-white/60">No roster snapshots in this filter range.</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {snapshots.map((row, idx) => (
              <li key={`${row.snapshotId ?? idx}`} className="rounded border border-white/10 p-2">
                <p>Week {String(row.weekOrPeriod ?? "-")} · Team {String(row.teamId ?? "-")}</p>
                <p className="text-white/60">
                  Roster: {Array.isArray(row.rosterPlayers) ? row.rosterPlayers.length : 0} ·
                  Lineup: {Array.isArray(row.lineupPlayers) ? row.lineupPlayers.length : 0} ·
                  Bench: {Array.isArray(row.benchPlayers) ? row.benchPlayers.length : 0}
                </p>
              </li>
            ))}
          </ul>
        )
      )}

      {!loading && !error && view === "draft" && (
        draftRows.length === 0 ? (
          <p className="text-sm text-white/60">No draft facts found.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 text-left text-white/60">
                  <th className="px-2 py-1">Round</th>
                  <th className="px-2 py-1">Pick</th>
                  <th className="px-2 py-1">Player</th>
                  <th className="px-2 py-1">Manager</th>
                </tr>
              </thead>
              <tbody>
                {draftRows.map((row, idx) => (
                  <tr key={`${row.draftId ?? idx}`} className="border-b border-white/5">
                    <td className="px-2 py-1">{String(row.round ?? "-")}</td>
                    <td className="px-2 py-1">{String(row.pickNumber ?? "-")}</td>
                    <td className="px-2 py-1">{String(row.playerId ?? "-")}</td>
                    <td className="px-2 py-1">{String(row.managerId ?? "-")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {!loading && !error && view === "transactions" && (
        transactionRows.length === 0 ? (
          <p className="text-sm text-white/60">No transactions found.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 text-left text-white/60">
                  <th className="px-2 py-1">Type</th>
                  <th className="px-2 py-1">Player</th>
                  <th className="px-2 py-1">Manager</th>
                  <th className="px-2 py-1">Created</th>
                </tr>
              </thead>
              <tbody>
                {transactionRows.map((row, idx) => (
                  <tr key={`${row.transactionId ?? idx}`} className="border-b border-white/5">
                    <td className="px-2 py-1">{String(row.type ?? "-")}</td>
                    <td className="px-2 py-1">{String(row.playerId ?? "-")}</td>
                    <td className="px-2 py-1">{String(row.managerId ?? "-")}</td>
                    <td className="px-2 py-1">{String(row.createdAt ?? "-")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {!loading && !error && view === "player" && (
        playerFacts.length === 0 ? (
          <p className="text-sm text-white/60">No player facts found for this filter.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 text-left text-white/60">
                  <th className="px-2 py-1">Week</th>
                  <th className="px-2 py-1">Fantasy Pts</th>
                  <th className="px-2 py-1">Game</th>
                </tr>
              </thead>
              <tbody>
                {playerFacts.map((row, idx) => {
                  const fantasyPoints = typeof row.fantasyPoints === "number" ? row.fantasyPoints : 0
                  return (
                    <tr key={`${row.factId ?? idx}`} className="border-b border-white/5">
                      <td className="px-2 py-1">{String(row.weekOrRound ?? "-")}</td>
                      <td className="px-2 py-1">
                        {fantasyPoints.toFixed(1)}
                        {showCharts && (
                          <div className="mt-1 h-1.5 w-24 overflow-hidden rounded bg-white/10">
                            <div
                              className="h-full bg-emerald-400"
                              style={{ width: `${Math.max(2, Math.round(Math.min(100, fantasyPoints * 2)))}%` }}
                            />
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1">{String(row.gameId ?? "-")}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {!loading && !error && view === "team" && (
        teamMatchups.length === 0 ? (
          <p className="text-sm text-white/60">No team history found in this range.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 text-left text-white/60">
                  <th className="px-2 py-1">Week</th>
                  <th className="px-2 py-1">Opponent</th>
                  <th className="px-2 py-1">Score</th>
                  <th className="px-2 py-1">Result</th>
                </tr>
              </thead>
              <tbody>
                {teamMatchups.map((row, idx) => (
                  <tr key={`${row.matchupId ?? idx}`} className="border-b border-white/5">
                    <td className="px-2 py-1">{String(row.weekOrPeriod ?? "-")}</td>
                    <td className="px-2 py-1">{String(row.opponentTeamId ?? "-")}</td>
                    <td className="px-2 py-1">{String(row.teamScore ?? "-")} - {String(row.opponentScore ?? "-")}</td>
                    <td className="px-2 py-1">{String(row.result ?? "-")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {!loading && !error && view === "ai" && (
        <div className="rounded-lg border border-violet-400/30 bg-violet-500/10 p-3 text-sm">
          <p className="font-medium text-violet-100">Warehouse AI insight context</p>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-xs text-violet-100/90">
            {JSON.stringify(payload?.data ?? {}, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

