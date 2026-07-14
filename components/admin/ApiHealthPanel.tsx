"use client"

import { useCallback, useEffect, useState } from "react"
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from "recharts"
import { RefreshCw, AlertTriangle, CheckCircle2, XCircle, AlertCircle } from "lucide-react"

type HealthStatus = "operational" | "degraded" | "down" | "unknown"
type HealthService = { id: string; name: string; category: string; status: HealthStatus; httpStatus: number | null; latencyMs: number | null; note: string }
type HealthError = { severity: "critical" | "warning"; source: string; message: string }
type Report = {
  generatedAt: string
  summary: { operational: number; degraded: number; down: number; unknown: number }
  services: HealthService[]
  errors: HealthError[]
}

const STATUS_META: Record<HealthStatus, { label: string; cls: string; color: string; Icon: typeof CheckCircle2 }> = {
  operational: { label: "Operational", cls: "border-emerald-300/35 bg-emerald-300/10 text-emerald-100", color: "#34d399", Icon: CheckCircle2 },
  degraded: { label: "Degraded", cls: "border-amber-300/35 bg-amber-300/10 text-amber-100", color: "#fbbf24", Icon: AlertCircle },
  down: { label: "Down", cls: "border-rose-300/35 bg-rose-300/10 text-rose-100", color: "#fb7185", Icon: XCircle },
  unknown: { label: "Unknown", cls: "border-white/15 bg-white/[0.06] text-white/60", color: "#94a3b8", Icon: AlertCircle },
}

export function ApiHealthPanel() {
  const [data, setData] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/api-health`, { cache: "no-store" })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      setData(body as Report)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const latencyData = (data?.services ?? [])
    .filter((s) => s.latencyMs != null)
    .map((s) => ({ name: s.name.split(" ")[0], latency: s.latencyMs as number, color: STATUS_META[s.status].color }))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(["operational", "degraded", "down", "unknown"] as HealthStatus[]).map((s) => (
            <span key={s} className={`rounded-full border px-3 py-1 text-[11px] font-black ${STATUS_META[s].cls}`}>
              {data?.summary[s] ?? 0} {STATUS_META[s].label}
            </span>
          ))}
        </div>
        <button
          onClick={load}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-white/10 bg-black/25 px-3 text-xs font-bold text-white/70 hover:text-white"
        >
          <RefreshCw className={["h-3.5 w-3.5", loading ? "animate-spin" : ""].join(" ")} aria-hidden />
          Re-check
        </button>
      </div>

      {error ? <div className="rounded-2xl border border-rose-300/30 bg-rose-300/10 p-4 text-sm text-rose-100">{error}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
        {/* Services table */}
        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/25 p-4">
          <h3 className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-cyan-100/75">Service health</h3>
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-[10px] uppercase tracking-[0.16em] text-white/42">
              <tr>
                <th className="py-2 pr-3">Service</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">HTTP</th>
                <th className="py-2 pr-3">Latency</th>
                <th className="py-2 pr-3">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {(data?.services ?? []).map((s) => {
                const meta = STATUS_META[s.status]
                return (
                  <tr key={s.id} className="align-top text-white/72">
                    <td className="py-3 pr-3">
                      <div className="font-black text-white">{s.name}</div>
                      <div className="text-[11px] uppercase tracking-[0.12em] text-cyan-100/45">{s.category}</div>
                    </td>
                    <td className="py-3 pr-3">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-black ${meta.cls}`}>
                        <meta.Icon className="h-3 w-3" aria-hidden /> {meta.label}
                      </span>
                    </td>
                    <td className="py-3 pr-3 font-mono text-xs text-white/60">{s.httpStatus ?? "—"}</td>
                    <td className="py-3 pr-3 text-xs text-white/60">{s.latencyMs != null ? `${s.latencyMs}ms` : "—"}</td>
                    <td className="max-w-[240px] py-3 pr-3 text-[11px] leading-4 text-white/50">{s.note}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {latencyData.length > 0 ? (
            <div className="mt-4" style={{ width: "100%", height: 180 }}>
              <ResponsiveContainer>
                <BarChart data={latencyData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.12)" }} />
                  <YAxis tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} tickLine={false} axisLine={false} width={44} unit="ms" />
                  <Tooltip
                    contentStyle={{ background: "#0b1526", border: "1px solid rgba(34,211,238,0.25)", borderRadius: 12, color: "#eaf2ff", fontSize: 12 }}
                    cursor={{ fill: "rgba(34,211,238,0.06)" }}
                  />
                  <Bar dataKey="latency" radius={[4, 4, 0, 0]} maxBarSize={44}>
                    {latencyData.map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : null}
        </div>

        {/* Potential errors */}
        <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-amber-100/75">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Potential errors ({data?.errors.length ?? 0})
          </h3>
          {data && data.errors.length === 0 ? (
            <p className="rounded-xl border border-emerald-300/20 bg-emerald-300/[0.06] p-3 text-sm text-emerald-100">
              No configuration or reachability problems detected.
            </p>
          ) : (
            <ul className="space-y-2">
              {(data?.errors ?? []).map((e, i) => (
                <li
                  key={i}
                  className={`rounded-xl border p-3 text-xs ${
                    e.severity === "critical" ? "border-rose-300/25 bg-rose-300/[0.08] text-rose-100" : "border-amber-300/25 bg-amber-300/[0.08] text-amber-100"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-black uppercase tracking-[0.12em]">{e.severity}</span>
                    <span className="text-white/45">{e.source}</span>
                  </div>
                  <div className="mt-1.5 leading-5 text-white/70">{e.message}</div>
                </li>
              ))}
            </ul>
          )}
          {data ? (
            <p className="mt-3 text-[11px] text-white/40">
              Checked {new Date(data.generatedAt).toLocaleString("en-US", { timeZone: "America/New_York" })}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
