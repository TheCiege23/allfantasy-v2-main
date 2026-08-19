"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

export interface StrategyMetaRow {
  strategyType: string
  strategyLabel?: string
  sport: string
  usageRate: number
  successRate: number
  trendingDirection: string
  leagueFormat: string
  sampleSize: number
}

export default function StrategyMetaPanel(props: {
  sport?: string
  leagueFormat?: string
  timeframe?: "24h" | "7d" | "30d"
  title?: string
  showSuccessGraph?: boolean
  refreshKey?: number
}) {
  const {
    sport,
    leagueFormat,
    timeframe = "7d",
    title = "Strategy meta",
    showSuccessGraph: initialShowSuccess = true,
    refreshKey = 0,
  } = props
  const [data, setData] = useState<StrategyMetaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showSuccessRate, setShowSuccessRate] = useState(initialShowSuccess)
  const [detailRow, setDetailRow] = useState<StrategyMetaRow | null>(null)

  useEffect(() => {
    setShowSuccessRate(initialShowSuccess)
  }, [initialShowSuccess])

  useEffect(() => {
    setLoading(true)
    setError(null)
    setDetailRow(null)
    const params = new URLSearchParams()
    if (sport) params.set("sport", sport)
    if (leagueFormat) params.set("leagueFormat", leagueFormat)
    params.set("timeframe", timeframe)
    fetch(`/api/strategy-meta?${params}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((res) => {
        if (res.error) setError(res.error)
        else setData(res.data ?? [])
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [sport, leagueFormat, timeframe, refreshKey])

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">{title}</h3>
        <p className="mt-2 text-xs text-slate-500">Loading…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">{title}</h3>
        <p className="mt-2 text-xs text-red-500">{error}</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">{title}</h3>
        <button
          type="button"
          onClick={() => setShowSuccessRate((v) => !v)}
          className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          aria-label={showSuccessRate ? "Hide success rate" : "Show success rate"}
        >
          {showSuccessRate ? "Hide" : "Show"} success rate
        </button>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-600 dark:text-slate-400">
              <th className="py-1 pr-2">Strategy</th>
              <th className="py-1 pr-2">Usage</th>
              {showSuccessRate && <th className="py-1 pr-2">Success</th>}
              <th className="py-1">Trend</th>
              <th className="py-1 w-14" />
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={`${r.strategyType}-${r.sport}-${r.leagueFormat}`} className="border-b border-slate-100 dark:border-slate-700">
                <td className="py-1 pr-2 font-medium text-slate-700 dark:text-slate-300">
                  {r.strategyLabel ?? r.strategyType}
                </td>
                <td className="py-1 pr-2 tabular-nums text-slate-600 dark:text-slate-400">
                  {Math.round(r.usageRate * 100)}%
                </td>
                {showSuccessRate && (
                  <td className="py-1 pr-2">
                    <span className="tabular-nums text-slate-600 dark:text-slate-400">
                      {Math.round(r.successRate * 100)}%
                    </span>
                    <div className="mt-0.5 h-1 w-12 overflow-hidden rounded bg-slate-200 dark:bg-slate-600">
                      <div
                        className="h-full rounded bg-emerald-500 dark:bg-emerald-400"
                        style={{ width: `${Math.round(r.successRate * 100)}%` }}
                      />
                    </div>
                  </td>
                )}
                <td className="py-1 text-slate-500 dark:text-slate-400">{r.trendingDirection}</td>
                <td className="py-1">
                  <button
                    type="button"
                    onClick={() =>
                      setDetailRow(
                        detailRow?.strategyType === r.strategyType &&
                          detailRow?.sport === r.sport &&
                          detailRow?.leagueFormat === r.leagueFormat
                          ? null
                          : r
                      )
                    }
                    className="text-violet-600 hover:underline dark:text-violet-400"
                    aria-label={`View strategy details for ${r.strategyType}`}
                  >
                    Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.length === 0 && <p className="mt-2 text-xs text-slate-500">No strategy reports yet. Run report generation to populate.</p>}
      <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-slate-500">
        <Link href="/app/meta-insights" className="text-violet-600 hover:underline dark:text-violet-400">
          Meta Insights
        </Link>
        <Link href="/app/strategy-meta" className="text-violet-600 hover:underline dark:text-violet-400">
          Strategy meta dashboard
        </Link>
        <Link href="/af-legacy" className="text-violet-600 hover:underline dark:text-violet-400">
          AF Legacy
        </Link>
        <Link href="/mock-draft-simulator" className="text-violet-600 hover:underline dark:text-violet-400">
          Mock draft
        </Link>
        <Link href="/rankings" className="text-violet-600 hover:underline dark:text-violet-400">
          Rankings
        </Link>
      </div>
      {detailRow && (
        <div
          className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-800/80"
          role="dialog"
          aria-label="Strategy details"
        >
          <div className="flex justify-between">
            <strong className="text-slate-700 dark:text-slate-300">
              {detailRow.strategyLabel ?? detailRow.strategyType}
            </strong>
            <button
              type="button"
              onClick={() => setDetailRow(null)}
              className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              aria-label="Close strategy details"
            >
              Close
            </button>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt className="text-slate-500">Sport</dt>
            <dd>{detailRow.sport}</dd>
            <dt className="text-slate-500">League format</dt>
            <dd>{detailRow.leagueFormat}</dd>
            <dt className="text-slate-500">Usage rate</dt>
            <dd className="tabular-nums">{Math.round(detailRow.usageRate * 100)}%</dd>
            <dt className="text-slate-500">Success rate</dt>
            <dd className="tabular-nums">{Math.round(detailRow.successRate * 100)}%</dd>
            <dt className="text-slate-500">Trend</dt>
            <dd>{detailRow.trendingDirection}</dd>
            <dt className="text-slate-500">Sample size</dt>
            <dd className="tabular-nums">{detailRow.sampleSize}</dd>
          </dl>
        </div>
      )}
    </div>
  )
}
