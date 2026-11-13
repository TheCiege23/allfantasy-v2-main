"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { DEFAULT_SPORT } from "@/lib/sport-scope"

interface TrendingPlayer {
  playerId: string
  sport: string
  trendScore: number
  trendingDirection: string
  addRate: number
  dropRate: number
  tradeInterest: number
  draftFrequency: number
  lineupStartRate: number
  injuryImpact: number
  updatedAt: string
}

const DIRECTION_COLORS: Record<string, string> = {
  Hot: "text-amber-500",
  Rising: "text-emerald-500",
  Stable: "text-slate-500",
  Falling: "text-orange-500",
  Cold: "text-sky-500",
}

export default function PlayerTrendPanel(props: {
  sport?: string
  list?: "hottest" | "rising" | "fallers"
  timeframe?: "24h" | "7d" | "30d"
  limit?: number
  title?: string
  showAddDrop?: boolean
  refreshKey?: number
}) {
  const { sport, timeframe = "7d", list = "hottest", limit = 10, title, showAddDrop = false, refreshKey = 0 } = props
  const [data, setData] = useState<TrendingPlayer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detailPlayer, setDetailPlayer] = useState<TrendingPlayer | null>(null)
  const [showAddDropToggle, setShowAddDropToggle] = useState(showAddDrop)

  useEffect(() => {
    setShowAddDropToggle(showAddDrop)
  }, [showAddDrop])

  useEffect(() => {
    setLoading(true)
    setError(null)
    setDetailPlayer(null)
    const params = new URLSearchParams({ list, limit: String(limit), timeframe })
    if (sport) params.set("sport", sport)
    fetch(`/api/player-trend?${params}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((res) => {
        if (res.error) {
          setError(res.error)
          setData([])
        } else {
          setData(res.data ?? [])
        }
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [sport, timeframe, list, limit, refreshKey])

  const label = title ?? (list === "hottest" ? "Hottest players" : list === "rising" ? "Fastest rising" : "Biggest fallers")

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</h3>
        <p className="mt-2 text-xs text-slate-500">Loading…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</h3>
        <p className="mt-2 text-xs text-red-500">{error}</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</h3>
        <button
          type="button"
          onClick={() => setShowAddDropToggle((v) => !v)}
          className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          aria-label={showAddDropToggle ? "Hide add/drop rates" : "Show add/drop rates"}
        >
          {showAddDropToggle ? "Hide" : "Show"} add/drop
        </button>
      </div>
      <ul className="mt-2 space-y-1.5">
        {data.slice(0, limit).map((p) => (
          <li key={`${p.playerId}-${p.sport}`} className="flex flex-wrap items-center justify-between gap-x-2 text-xs">
            <span className="truncate text-slate-600 dark:text-slate-400" title={p.playerId}>
              {p.playerId}
            </span>
            <div className="flex items-center gap-2">
              {showAddDropToggle && (
                <span className="tabular-nums text-slate-500">
                  +{p.addRate.toFixed(1)} / −{p.dropRate.toFixed(1)}
                </span>
              )}
              <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                {Math.round(p.trendScore)}
              </span>
              <span className={`${DIRECTION_COLORS[p.trendingDirection] ?? "text-slate-500"}`}>
                {p.trendingDirection}
              </span>
              <button
                type="button"
                onClick={() => setDetailPlayer(p)}
                className="text-violet-600 hover:underline dark:text-violet-400"
                aria-label={`View trend details for ${p.playerId}`}
              >
                Details
              </button>
            </div>
          </li>
        ))}
      </ul>
      {data.length === 0 && <p className="mt-2 text-xs text-slate-500">No trend data yet.</p>}
      <p className="mt-2 text-xs text-slate-500">
        <Link
          href={`/app/trend-feed?sport=${encodeURIComponent(sport ?? DEFAULT_SPORT)}&timeframe=${encodeURIComponent(timeframe)}`}
          className="text-violet-600 hover:underline dark:text-violet-400"
        >
          Trend feed
        </Link>
        {" · "}
        <Link href="/app/meta-insights" className="text-violet-600 hover:underline dark:text-violet-400">
          Meta Insights
        </Link>
        {" · "}
        <Link href="/waiver-ai" className="text-violet-600 hover:underline dark:text-violet-400">
          Waiver AI
        </Link>
      </p>
      {detailPlayer && (
        <div
          className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-800/80"
          role="dialog"
          aria-label="Trend details"
        >
          <div className="flex justify-between">
            <strong className="text-slate-700 dark:text-slate-300">{detailPlayer.playerId}</strong>
            <button
              type="button"
              onClick={() => setDetailPlayer(null)}
              className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              aria-label="Close trend details"
            >
              Close
            </button>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt className="text-slate-500">Add rate</dt>
            <dd className="tabular-nums">{detailPlayer.addRate.toFixed(2)}</dd>
            <dt className="text-slate-500">Drop rate</dt>
            <dd className="tabular-nums">{detailPlayer.dropRate.toFixed(2)}</dd>
            <dt className="text-slate-500">Trade interest</dt>
            <dd className="tabular-nums">{detailPlayer.tradeInterest.toFixed(2)}</dd>
            <dt className="text-slate-500">Draft frequency</dt>
            <dd className="tabular-nums">{detailPlayer.draftFrequency.toFixed(2)}</dd>
            <dt className="text-slate-500">Lineup start %</dt>
            <dd className="tabular-nums">{(detailPlayer.lineupStartRate * 100).toFixed(1)}%</dd>
            <dt className="text-slate-500">Injury impact</dt>
            <dd className="tabular-nums">{detailPlayer.injuryImpact.toFixed(2)}</dd>
          </dl>
          <Link
            href={`/waiver-ai?highlight=${encodeURIComponent(detailPlayer.playerId)}`}
            className="mt-2 inline-block text-xs text-violet-600 hover:underline dark:text-violet-400"
          >
            See in Waiver AI →
          </Link>
        </div>
      )}
    </div>
  )
}
