"use client"

import React, { useEffect, useMemo, useState } from "react"

type RollupRow = {
  bucketStart: string
  bucketType: string
  scope: string
  tool?: string | null
  endpoint?: string | null
  leagueId?: string | null
  count: number
  okCount: number
  errCount: number
  avgMs?: number | null
  p95Ms?: number | null
  maxMs?: number | null
}

type TopRow = { name: string; count: number; err: number; p95: number | null }

type Summary = {
  totals: { count: number; ok: number; err: number; errRate: number; avgMs: number | null }
  topEndpoints: TopRow[]
  topTools: TopRow[]
  topLeagues: TopRow[]
  topErrorEndpoints: TopRow[]
}

type BucketType = "hour" | "day" | "week" | "month"

export function UsageAnalyticsPanel(props: {
  leagueId?: string
  defaultBucketType?: BucketType
  defaultDays?: number
}) {
  const [bucketType, setBucketType] = useState<BucketType>(props.defaultBucketType ?? "day")
  const [days, setDays] = useState<number>(props.defaultDays ?? 30)
  const [scope, setScope] = useState<string>("")
  const [endpoint, setEndpoint] = useState<string>("")
  const [tool, setTool] = useState<string>("")
  const [topN, setTopN] = useState<number>(8)

  const [rows, setRows] = useState<RollupRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const baseParams = useMemo(() => {
    const p = new URLSearchParams()
    p.set("bucketType", bucketType)
    p.set("days", String(days))
    p.set("topN", String(topN))
    if (scope) p.set("scope", scope)
    if (endpoint) p.set("endpoint", endpoint)
    if (tool) p.set("tool", tool)
    if (props.leagueId) p.set("leagueId", props.leagueId)
    return p
  }, [bucketType, days, topN, scope, endpoint, tool, props.leagueId])

  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        setError(null)
        const [usageRes, summaryRes] = await Promise.all([
          fetch(`/api/admin/usage?${baseParams.toString()}`, { cache: "no-store" }),
          fetch(`/api/admin/usage/summary?${baseParams.toString()}`, { cache: "no-store" })
        ])
        if (!usageRes.ok) throw new Error(await usageRes.text())
        if (!summaryRes.ok) throw new Error(await summaryRes.text())
        const usageData = await usageRes.json()
        const summaryData = await summaryRes.json()
        if (!cancelled) {
          setRows(usageData.rows ?? [])
          setSummary(summaryData ?? null)
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load usage")
      }
    }
    run()
    return () => { cancelled = true }
  }, [baseParams])

  const totals = summary?.totals ?? { count: 0, ok: 0, err: 0, errRate: 0, avgMs: null }

  const mostExpensiveEndpoints = useMemo(() => {
    const list = (summary?.topEndpoints ?? []).slice()
    return list.sort((a, b) => Number(b.p95 ?? 0) - Number(a.p95 ?? 0)).slice(0, topN)
  }, [summary, topN])

  /*
   * `af-frame` rather than a bare `--bg` background: this sits alongside the
   * weights and drift panels, and a card painted in the page's own background
   * colour reads as a gap between them rather than a third panel.
   */
  return (
    <div className="af-frame space-y-3" style={{ padding: 16 }}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xl font-bold" style={{ color: "var(--text)" }}>Usage Analytics</div>
          <div className="text-xs" style={{ color: "var(--muted)" }}>
            APIs + Legacy tools rollups by hour/day/week/month
            {props.leagueId ? ` \u2022 League ${props.leagueId}` : ""}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <select
            className="rounded-xl px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
            value={bucketType}
            onChange={(e) => setBucketType(e.target.value as any)}
          >
            <option value="hour">Hour</option>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>

          <input
            className="rounded-xl px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
            type="number"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />

          <select
            className="rounded-xl px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="">All</option>
            <option value="api">API</option>
            <option value="legacy_tool">Legacy tool</option>
          </select>

          <input
            className="rounded-xl px-3 py-2 text-sm min-w-0"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
            placeholder="Filter endpoint (exact)"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
          />

          <input
            className="rounded-xl px-3 py-2 text-sm min-w-0"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
            placeholder="Filter tool (exact)"
            value={tool}
            onChange={(e) => setTool(e.target.value)}
          />

          <input
            className="rounded-xl px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
            type="number"
            value={topN}
            onChange={(e) => setTopN(Number(e.target.value))}
            title="Top N"
          />
        </div>
      </div>

      {/* ⚠ Styled as a fault, not as muted body text. Rendered in `--muted` it sat
          at the same weight as the filter labels above an all-zero table, so a
          failed fetch and a genuinely quiet window looked the same. */}
      {error ? (
        <div className="af-issue" data-severity="bad">
          Usage could not be read: {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        <Stat label="Total" value={totals.count} />
        <Stat label="OK" value={totals.ok} />
        <Stat label="Errors" value={totals.err} />
        <Stat label="Err rate" value={`${totals.errRate}%`} />
        <Stat label="Avg ms" value={totals.avgMs ?? "\u2014"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-2">
        <TopCard title="Top endpoints (most used)" rows={summary?.topEndpoints ?? []} />
        <TopCard title="Top endpoints (most failing)" rows={summary?.topErrorEndpoints ?? []} metric="err" />
        <TopCard title="Top endpoints (most expensive p95)" rows={mostExpensiveEndpoints} metric="p95" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
        <TopCard title="Top tools" rows={summary?.topTools ?? []} />
        {!props.leagueId ? <TopCard title="Top leagues" rows={summary?.topLeagues ?? []} /> : null}
      </div>

      <div className="rounded-2xl p-3" style={{ background: "var(--panel)" }}>
        <div className="font-bold mb-2" style={{ color: "var(--text)" }}>Recent buckets</div>
        <div className="max-h-80 overflow-auto text-sm">
          {rows.slice(-80).map((r, i) => (
            <div key={i} className="flex justify-between py-2" style={{ borderBottomColor: "var(--border)", borderBottomWidth: "1px" }}>
              <div style={{ color: "var(--text)" }}>
                <div className="font-semibold">{String(r.bucketStart).slice(0, 16)}</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {r.scope}
                  {r.tool ? ` \u2022 ${r.tool}` : ""}
                  {r.endpoint ? ` \u2022 ${r.endpoint}` : ""}
                </div>
              </div>
              <div className="text-xs text-right" style={{ color: "var(--muted)" }}>
                <div>Count {r.count}</div>
                <div>Err {r.errCount}</div>
                <div>P95 {r.p95Ms ?? "\u2014"}ms</div>
              </div>
            </div>
          ))}
          {!rows.length ? <div className="text-xs" style={{ color: "var(--muted)" }}>No data yet.</div> : null}
        </div>
      </div>
    </div>
  )
}

function Stat(props: { label: string; value: any }) {
  return (
    <div className="rounded-2xl p-3" style={{ background: "var(--panel)" }}>
      <div className="text-xs" style={{ color: "var(--muted)" }}>{props.label}</div>
      <div className="text-lg font-bold" style={{ color: "var(--text)" }}>{props.value}</div>
    </div>
  )
}

function TopCard(props: { title: string; rows: TopRow[]; metric?: "count" | "err" | "p95" }) {
  const metric = props.metric ?? "count"
  return (
    <div className="rounded-2xl p-3" style={{ background: "var(--panel)" }}>
      <div className="font-bold mb-2" style={{ color: "var(--text)" }}>{props.title}</div>
      {!props.rows.length ? (
        <div className="text-xs" style={{ color: "var(--muted)" }}>No data.</div>
      ) : (
        <div className="space-y-1 text-sm">
          {props.rows.map((r) => (
            <div key={r.name} className="flex justify-between py-1" style={{ borderBottomColor: "var(--border)", borderBottomWidth: "1px" }}>
              <span className="truncate pr-3" style={{ color: "var(--text)" }}>{r.name}</span>
              <span style={{ color: "var(--muted)" }}>
                {metric === "count" ? r.count : metric === "err" ? r.err : `${r.p95 ?? "\u2014"}ms`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
