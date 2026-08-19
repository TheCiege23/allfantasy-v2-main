"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { DEFAULT_SPORT, normalizeToSupportedSport } from "@/lib/sport-scope"

/** Live meta snapshot for draft War Room: trending players + top strategies. */
export default function WarRoomMetaWidget(props: {
  sport?: string
  timeframe?: "24h" | "7d" | "30d"
  refreshKey?: number
  /** Dark navy panel for league hub / embed (Sleeper-hybrid). */
  variant?: "default" | "embed"
}) {
  const { sport = DEFAULT_SPORT, timeframe = "7d", refreshKey = 0, variant = "default" } = props
  const embed = variant === "embed"
  const normalizedSport = normalizeToSupportedSport(sport)
  const [trending, setTrending] = useState<Array<{ playerId: string; trendScore: number; trendingDirection: string }>>([])
  const [strategies, setStrategies] = useState<Array<{ strategyType: string; strategyLabel?: string; usageRate: number; successRate: number; trendingDirection?: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detailPlayer, setDetailPlayer] = useState<{ playerId: string; trendScore: number; trendingDirection: string } | null>(null)
  const [detailStrategy, setDetailStrategy] = useState<{ strategyType: string; strategyLabel?: string; usageRate: number; successRate: number; trendingDirection?: string } | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setDetailPlayer(null)
    setDetailStrategy(null)
    const params = new URLSearchParams({ sport: normalizedSport, limit: "5", timeframe })
    Promise.all([
      fetch(`/api/player-trend?list=hottest&${params}`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/strategy-meta?${params}`, { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([trendRes, stratRes]) => {
        const err = trendRes.error || stratRes.error || null
        if (err) setError(err)
        else setError(null)
        setTrending((trendRes.data ?? []).slice(0, 5))
        setStrategies((stratRes.data ?? []).slice(0, 5))
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [normalizedSport, timeframe, refreshKey])

  const shell = embed
    ? "rounded-xl border border-white/[0.08] bg-[#0c0c1e] p-4"
    : "rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
  const titleCls = embed ? "text-sm font-semibold text-white" : "text-sm font-medium text-slate-700 dark:text-slate-300"
  const subCls = embed ? "mt-1 text-xs text-white/45" : "mt-1 text-xs text-slate-500"
  const labelCls = embed ? "text-xs font-medium text-white/55" : "text-xs font-medium text-slate-600 dark:text-slate-400"
  const listCls = embed ? "mt-1 space-y-0.5 text-xs text-white/50" : "mt-1 space-y-0.5 text-xs text-slate-600 dark:text-slate-400"
  const btnCls = embed
    ? "mr-1 text-cyan-300/90 hover:underline"
    : "mr-1 text-violet-600 hover:underline dark:text-violet-400"
  const emptyCls = embed ? "text-white/35" : "text-slate-500"
  const linkCls = embed ? "text-cyan-400/90 hover:underline" : "text-violet-600 hover:underline dark:text-violet-400"
  const detailShell = embed
    ? "mt-3 rounded border border-white/[0.08] bg-[#07071a] p-2 text-xs"
    : "mt-3 rounded border border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-600 dark:bg-slate-800/80"

  if (loading) {
    return (
      <div className={shell}>
        <h3 className={titleCls}>AF Legacy meta</h3>
        <p className={embed ? "mt-2 text-xs text-white/45" : "mt-2 text-xs text-slate-500"}>Loading…</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className={shell}>
        <h3 className={titleCls}>AF Legacy meta</h3>
        <p className={embed ? "mt-2 text-xs text-rose-400/90" : "mt-2 text-xs text-red-500"}>{error}</p>
      </div>
    )
  }

  return (
    <div className={shell} data-variant={variant}>
      <h3 className={titleCls}>AF Legacy meta</h3>
      <p className={subCls}>Live insights for drafts</p>
      <div className="mt-3 space-y-3">
        <div>
          <p className={labelCls}>Hottest (by trend)</p>
          <ul className={listCls}>
            {trending.map((p) => (
              <li key={p.playerId}>
                <button
                  type="button"
                  onClick={() => setDetailPlayer(detailPlayer?.playerId === p.playerId ? null : p)}
                  className={btnCls}
                  aria-label={`View trend details for ${p.playerId}`}
                >
                  {p.playerId}
                </button>
                <span>
                  {Math.round(p.trendScore)} ({p.trendingDirection})
                </span>
              </li>
            ))}
            {trending.length === 0 && <li className={emptyCls}>No data</li>}
          </ul>
        </div>
        <div>
          <p className={labelCls}>Top strategies</p>
          <ul className={listCls}>
            {strategies.map((s) => (
              <li key={s.strategyType}>
                <button
                  type="button"
                  onClick={() => setDetailStrategy(detailStrategy?.strategyType === s.strategyType ? null : s)}
                  className={btnCls}
                  aria-label={`View strategy details for ${s.strategyType}`}
                >
                  {s.strategyLabel ?? s.strategyType}
                </button>
                <span>
                  {Math.round(s.usageRate * 100)}% usage, {Math.round(s.successRate * 100)}% success
                </span>
              </li>
            ))}
            {strategies.length === 0 && <li className={emptyCls}>No data</li>}
          </ul>
        </div>
      </div>
      {detailPlayer && (
        <div className={detailShell} role="dialog" aria-label="War room trend details">
          <p className={embed ? "font-medium text-white/90" : "font-medium text-slate-700 dark:text-slate-300"}>
            {detailPlayer.playerId}
          </p>
          <p className={embed ? "mt-1 text-white/50" : "mt-1 text-slate-600 dark:text-slate-400"}>
            Trend score {Math.round(detailPlayer.trendScore)} · {detailPlayer.trendingDirection}
          </p>
          <Link
            href={`/app/trend-feed?sport=${encodeURIComponent(normalizedSport)}&timeframe=${encodeURIComponent(timeframe)}`}
            className={`mt-1 inline-block ${linkCls}`}
          >
            Open player trend context
          </Link>
        </div>
      )}
      {detailStrategy && (
        <div className={detailShell} role="dialog" aria-label="War room strategy details">
          <p className={embed ? "font-medium text-white/90" : "font-medium text-slate-700 dark:text-slate-300"}>
            {detailStrategy.strategyLabel ?? detailStrategy.strategyType}
          </p>
          <p className={embed ? "mt-1 text-white/50" : "mt-1 text-slate-600 dark:text-slate-400"}>
            Usage {Math.round(detailStrategy.usageRate * 100)}% · Success {Math.round(detailStrategy.successRate * 100)}%
            {detailStrategy.trendingDirection ? ` · ${detailStrategy.trendingDirection}` : ''}
          </p>
        </div>
      )}
      <p className={embed ? "mt-2 text-xs text-white/40" : "mt-2 text-xs text-slate-500"}>
        <Link href="/app/meta-insights" className={linkCls}>
          View full strategy meta
        </Link>
        {" · "}
        <Link
          href={`/app/strategy-meta?sport=${encodeURIComponent(normalizedSport)}&timeframe=${encodeURIComponent(timeframe)}`}
          className={linkCls}
        >
          Strategy dashboard
        </Link>
        {" · "}
        <Link href="/mock-draft-simulator" className={linkCls}>
          Mock draft
        </Link>
      </p>
    </div>
  )
}
