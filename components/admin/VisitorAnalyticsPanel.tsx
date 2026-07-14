"use client"

import { useCallback, useEffect, useState } from "react"
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts"
import { RefreshCw, Users, MousePointerClick } from "lucide-react"

type WindowKey = "6h" | "12h" | "24h" | "7d" | "1mo" | "6mo" | "12mo"

type WindowSummary = {
  key: WindowKey
  label: string
  totalVisits: number
  uniqueVisitors: number
  newVisitors: number
}
type SeriesPoint = { bucket: string; label: string; total: number; unique: number }
type Payload = {
  generatedAt: string
  summarySource: string
  seriesSource: string
  selectedWindow: WindowKey
  allTimeUniqueVisitors: number
  allTimeVisits: number
  windows: WindowSummary[]
  series: SeriesPoint[]
  notes: string[]
}

const WINDOWS: { key: WindowKey; label: string }[] = [
  { key: "6h", label: "6h" },
  { key: "12h", label: "12h" },
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "1mo", label: "1mo" },
  { key: "6mo", label: "6mo" },
  { key: "12mo", label: "12mo" },
]

const SOURCE_LABEL: Record<string, string> = {
  site_visit: "IP-accurate (SiteVisit)",
  analytics_event: "Session estimate (AnalyticsEvent)",
  visitor_location: "Location estimate",
  none: "No data",
}

function fmt(n: number) {
  return n.toLocaleString("en-US")
}

export function VisitorAnalyticsPanel() {
  const [window, setWindow] = useState<WindowKey>("24h")
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (w: WindowKey) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/visitor-analytics?window=${w}`, { cache: "no-store" })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      setData(body as Payload)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(window)
  }, [window, load])

  const selected = data?.windows.find((w) => w.key === window)

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              onClick={() => setWindow(w.key)}
              className={[
                "min-h-9 rounded-full border px-3.5 text-xs font-black uppercase tracking-wide transition",
                window === w.key
                  ? "border-cyan-300/50 bg-cyan-300/15 text-cyan-100"
                  : "border-white/10 bg-black/25 text-white/55 hover:border-cyan-300/30 hover:text-white",
              ].join(" ")}
            >
              {w.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {data ? (
            <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">
              {SOURCE_LABEL[data.seriesSource] ?? data.seriesSource}
            </span>
          ) : null}
          <button
            onClick={() => load(window)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-white/10 bg-black/25 px-3 text-xs font-bold text-white/70 hover:text-white"
          >
            <RefreshCw className={["h-3.5 w-3.5", loading ? "animate-spin" : ""].join(" ")} aria-hidden />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-300/30 bg-rose-300/10 p-4 text-sm text-rose-100">{error}</div>
      ) : null}

      {/* Headline cards for the selected window */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.06] p-4">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-cyan-100/70">
            <MousePointerClick className="h-3.5 w-3.5" aria-hidden /> Total visits · {selected?.label ?? window}
          </div>
          <div className="mt-2 text-2xl font-black text-white">{selected ? fmt(selected.totalVisits) : "—"}</div>
          <div className="mt-1 text-xs text-white/45">Non-unique — every hit counts</div>
        </div>
        <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.06] p-4">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-100/70">
            <Users className="h-3.5 w-3.5" aria-hidden /> Unique visitors · {selected?.label ?? window}
          </div>
          <div className="mt-2 text-2xl font-black text-white">{selected ? fmt(selected.uniqueVisitors) : "—"}</div>
          <div className="mt-1 text-xs text-white/45">Distinct IPs (or sessions in estimate mode)</div>
        </div>
        <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-4">
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-100/70">New visitors</div>
          <div className="mt-2 text-2xl font-black text-white">{selected ? fmt(selected.newVisitors) : "—"}</div>
          <div className="mt-1 text-xs text-white/45">First seen inside this window</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-white/50">All-time</div>
          <div className="mt-2 text-2xl font-black text-white">{data ? fmt(data.allTimeUniqueVisitors) : "—"}</div>
          <div className="mt-1 text-xs text-white/45">{data ? `${fmt(data.allTimeVisits)} total visits` : "unique IPs"}</div>
        </div>
      </div>

      {/* Excel-style combo chart: bars = total, line = unique */}
      <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/75">
            Traffic over the last {selected?.label ?? window}
          </h3>
          <div className="flex items-center gap-3 text-[11px] text-white/50">
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#22d3ee]" /> Total</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#34d399]" /> Unique</span>
          </div>
        </div>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <ComposedChart data={data?.series ?? []} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.12)" }} interval="preserveStartEnd" minTickGap={16} />
              <YAxis tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
              <Tooltip
                contentStyle={{ background: "#0b1526", border: "1px solid rgba(34,211,238,0.25)", borderRadius: 12, color: "#eaf2ff", fontSize: 12 }}
                labelStyle={{ color: "rgba(255,255,255,0.6)", fontWeight: 700 }}
                cursor={{ fill: "rgba(34,211,238,0.06)" }}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }} />
              <Bar name="Total visits" dataKey="total" fill="#22d3ee" radius={[4, 4, 0, 0]} maxBarSize={38} />
              <Line name="Unique visitors" type="monotone" dataKey="unique" stroke="#34d399" strokeWidth={2.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* All-windows mini table */}
      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/25 p-4">
        <h3 className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-amber-100/75">All windows at a glance</h3>
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead className="text-[10px] uppercase tracking-[0.16em] text-white/42">
            <tr>
              <th className="py-2 pr-3">Window</th>
              <th className="py-2 pr-3">Total visits</th>
              <th className="py-2 pr-3">Unique visitors</th>
              <th className="py-2 pr-3">New</th>
              <th className="py-2 pr-3">Unique %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {(data?.windows ?? []).map((w) => {
              const pct = w.totalVisits > 0 ? Math.round((w.uniqueVisitors / w.totalVisits) * 100) : 0
              return (
                <tr key={w.key} className={w.key === window ? "text-white" : "text-white/70"}>
                  <td className="py-2.5 pr-3 font-black">{w.label}</td>
                  <td className="py-2.5 pr-3">{fmt(w.totalVisits)}</td>
                  <td className="py-2.5 pr-3 text-emerald-200">{fmt(w.uniqueVisitors)}</td>
                  <td className="py-2.5 pr-3 text-amber-100">{fmt(w.newVisitors)}</td>
                  <td className="py-2.5 pr-3 text-white/55">{pct}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {data?.notes?.length ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-[11px] leading-5 text-white/45">
          {data.notes.map((n) => (
            <div key={n}>· {n}</div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
