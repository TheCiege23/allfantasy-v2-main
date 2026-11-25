"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Loader2, Trophy, Award, Target, Zap } from "lucide-react"

type BoardId = "draft_grades" | "championships" | "win_pct" | "active"

interface LeaderboardEntry {
  rank: number
  managerId: string
  displayName: string | null
  value: number
  extra?: { count?: number; grade?: string }
}

interface LeaderboardResult {
  entries: LeaderboardEntry[]
  total: number
  generatedAt: string
}

/** `short` is the tab's label (2026-11-25): four tabs fit two across on a phone. `label` heads the list. */
const BOARDS: { id: BoardId; label: string; short: string; icon: typeof Trophy; valueLabel: string }[] = [
  { id: "draft_grades", label: "Best draft grades", short: "Draft grades", icon: Award, valueLabel: "Avg grade" },
  { id: "championships", label: "Most championships", short: "Titles", icon: Trophy, valueLabel: "Championships" },
  { id: "win_pct", label: "Highest win %", short: "Win %", icon: Target, valueLabel: "Win %" },
  { id: "active", label: "Most active managers", short: "Most active", icon: Zap, valueLabel: "Activity score" },
]

function formatValue(boardId: BoardId, value: number): string {
  if (boardId === "win_pct") return `${value.toFixed(1)}%`
  return String(value)
}

export default function LeaderboardsPage() {
  const [activeBoard, setActiveBoard] = useState<BoardId>("draft_grades")
  const [data, setData] = useState<LeaderboardResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchBoard = useCallback(async (board: BoardId) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/leaderboards?board=${board}&limit=25`, { cache: "no-store" })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? "Failed to load")
      setData(json)
    } catch (e) {
      setData(null)
      setError(e instanceof Error ? e.message : "Failed to load leaderboard")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBoard(activeBoard)
  }, [activeBoard, fetchBoard])

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6" data-testid="leaderboards-page">
      <div className="mb-6">
        <Link
          href="/"
          className="text-sm font-medium text-white/60 hover:text-white/90"
        >
          ← Home
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-white">
          Platform leaderboards
        </h1>
        {/* No intro line (2026-11-25, the simplify pass): it listed the four tabs right below it. */}
      </div>

      {/* Two across on a phone, one row from sm (2026-11-25): the long labels wrapped onto three rows. */}
      <div className="grid grid-cols-2 gap-2 border-b border-white/10 pb-3 sm:flex sm:flex-wrap" data-testid="leaderboards-tabs">
        {BOARDS.map((b) => {
          const Icon = b.icon
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => setActiveBoard(b.id)}
              data-testid={`leaderboards-tab-${b.id}`}
              className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors sm:justify-start ${
                activeBoard === b.id
                  ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-200"
                  : "border-white/20 bg-white/5 text-white/80 hover:bg-white/10"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {b.short}
            </button>
          )
        })}
      </div>

      <section className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-6" data-testid="leaderboards-panel">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-white/50" />
          </div>
        ) : error ? (
          <p className="py-8 text-center text-sm text-amber-400">{error}</p>
        ) : !data?.entries?.length ? (
          <p className="py-8 text-center text-sm text-white/50">
            No data for this leaderboard yet.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm text-white/60">
              {(() => {
                const b = BOARDS.find((x) => x.id === activeBoard)!
                const Icon = b.icon
                return (
                  <>
                    <Icon className="h-4 w-4" />
                    <span data-testid="leaderboards-current-board">{b.label}</span>
                    <span className="ml-auto">{data.total} managers</span>
                  </>
                )
              })()}
            </div>
            <ul className="mt-4 divide-y divide-white/10" data-testid="leaderboards-list">
              {data.entries.map((e) => (
                <li
                  key={`${e.managerId}-${e.rank}`}
                  data-testid={`leaderboards-row-${e.rank}`}
                  className="flex items-center gap-3 py-2.5 first:pt-0"
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      e.rank === 1
                        ? "bg-amber-500/30 text-amber-200"
                        : e.rank === 2
                          ? "bg-white/20 text-white/90"
                          : e.rank === 3
                            ? "bg-orange-500/20 text-orange-200"
                            : "bg-white/10 text-white/70"
                    }`}
                  >
                    {e.rank}
                  </span>
                  {/*
                    Name on one line, its detail on one line under it (2026-11-25, the simplify pass): run
                    together, "(3 seasons) Grade: A" wrapped every row onto two ragged lines on a phone.
                    A manager with no name reads "Unnamed manager", not the first 12 characters of an id.
                  */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-white">
                      {e.displayName || "Unnamed manager"}
                    </p>
                    {(e.extra?.grade || (e.extra?.count != null && e.extra.count > 0)) && (
                      <p className="truncate text-xs text-white/50" data-testid={`leaderboards-row-detail-${e.rank}`}>
                        {e.extra?.grade ? (
                          <span className="text-cyan-300">
                            {activeBoard === "draft_grades" ? `Grade ${e.extra.grade}` : e.extra.grade}
                          </span>
                        ) : null}
                        {e.extra?.grade && e.extra?.count != null && e.extra.count > 0 ? " · " : null}
                        {e.extra?.count != null && e.extra.count > 0
                          ? `${e.extra.count} ${activeBoard === "active" ? "actions" : activeBoard === "championships" ? "titles" : "seasons"}`
                          : null}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 font-semibold text-cyan-300">
                    {formatValue(activeBoard, e.value)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <p className="mt-4 text-center text-xs text-white/40">
        Link and sync your leagues to show up here.
      </p>
    </main>
  )
}
