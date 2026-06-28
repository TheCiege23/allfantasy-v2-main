import { redirect } from "next/navigation"
import Link from "next/link"

import { getAdminAccessState } from "@/lib/adminAuth"
import { getSystemHealth } from "@/lib/production-health/ProductionHealthService"
import {
  TRAFFIC_LIGHT_EMOJI,
  type CronState,
  type TrafficLight,
} from "@/lib/production-health/productionHealthCore"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const CRON_STATE_LABEL: Record<CronState, string> = {
  healthy: "Healthy",
  running: "Running",
  warning: "Warning",
  failed: "Failed",
  never_executed: "Never executed",
  disabled: "Disabled",
  missing_route: "Missing route",
  provider_offline: "Provider offline",
  cache_stale: "Cache stale",
}

function Light({ light }: { light: TrafficLight }) {
  const label =
    light === "healthy" ? "Healthy" : light === "warning" ? "Warning" : light === "failed" ? "Failed" : "No data"
  const color =
    light === "healthy"
      ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
      : light === "warning"
        ? "text-amber-300 border-amber-500/30 bg-amber-500/10"
        : light === "failed"
          ? "text-rose-300 border-rose-500/30 bg-rose-500/10"
          : "text-white/40 border-white/10 bg-white/[0.03]"
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${color}`}>
      <span aria-hidden>{TRAFFIC_LIGHT_EMOJI[light]}</span>
      {label}
    </span>
  )
}

function Card({ title, light, children }: { title: string; light: TrafficLight; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-black uppercase tracking-[0.16em] text-white/70">{title}</h2>
        <Light light={light} />
      </div>
      {children}
    </section>
  )
}

export default async function ProductionHealthPage() {
  const gate = await getAdminAccessState()
  if (gate.status === "unauthenticated") {
    redirect("/admin-login?next=/admin/production-health")
  }
  if (gate.status === "forbidden") {
    return (
      <main className="min-h-dvh bg-[#020817] p-8 text-white">
        <p className="text-rose-300">Forbidden — admin access required.</p>
      </main>
    )
  }

  const health = await getSystemHealth(["NFL", "NCAAF"])

  return (
    <main className="min-h-dvh bg-[#020817] text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black">Production Health</h1>
            <p className="mt-1 text-sm text-white/45">{health.summary}</p>
          </div>
          <div className="flex items-center gap-3">
            <Light light={health.trafficLight} />
            <Link href="/admin" className="text-[12px] text-cyan-300/70 hover:text-cyan-200">
              ← Admin
            </Link>
          </div>
        </header>

        <p className="text-[11px] text-white/30">Generated {new Date(health.generatedAt).toLocaleString()}</p>

        {/* Sports */}
        <div className="grid gap-4 lg:grid-cols-2">
          {health.sports.map((sport) => (
            <Card key={sport.sport} title={sport.label} light={sport.trafficLight}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {sport.dataTypes.map((dt) => (
                  <div key={dt.dataType} className="rounded-xl border border-white/[0.07] bg-black/20 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold capitalize text-white/70">{dt.dataType}</span>
                      <span aria-hidden>{TRAFFIC_LIGHT_EMOJI[dt.trafficLight]}</span>
                    </div>
                    <div className="mt-1 text-[10px] text-white/35">
                      {dt.count != null ? `${dt.count.toLocaleString()} rows · ` : ""}
                      {dt.freshness}
                    </div>
                  </div>
                ))}
              </div>
              {sport.dataWarnings.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {sport.dataWarnings.map((w) => (
                    <li
                      key={`${w.sport}-${w.dataType}`}
                      className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${
                        w.severity === "critical"
                          ? "border-rose-500/20 bg-rose-500/[0.06] text-rose-200/80"
                          : "border-amber-500/15 bg-amber-500/[0.05] text-amber-200/80"
                      }`}
                    >
                      {w.message}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>

        {/* Crons */}
        <Card title="Scheduled Jobs (runtime)" light={health.crons.trafficLight}>
          <div className="mb-3 flex flex-wrap gap-2 text-[10px]">
            <span className="text-white/40">
              {health.crons.totalDeclared} declared · {health.crons.coveragePct}% instrumented
            </span>
            {(Object.entries(health.crons.counts) as Array<[string, number]>)
              .filter(([, n]) => n > 0)
              .map(([state, n]) => (
                <span key={state} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-white/55">
                  {CRON_STATE_LABEL[state as keyof typeof CRON_STATE_LABEL] ?? state}: {n}
                </span>
              ))}
          </div>
          <div className="max-h-80 space-y-1 overflow-auto">
            {health.crons.entries.map((entry) => (
              <div
                key={entry.path}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2"
              >
                <div className="min-w-0">
                  <span aria-hidden className="mr-2">{TRAFFIC_LIGHT_EMOJI[entry.trafficLight]}</span>
                  <span className="text-[12px] font-semibold text-white/80">{entry.pathname}</span>
                  <span className="ml-2 rounded border border-white/10 px-1 text-[9px] uppercase text-white/40">
                    {CRON_STATE_LABEL[entry.state] ?? entry.state}
                  </span>
                  {entry.duplicate && (
                    <span className="ml-1 rounded border border-amber-500/25 px-1 text-[9px] uppercase text-amber-300/70">dup</span>
                  )}
                  <span className="ml-2 text-[10px] text-white/35">{entry.message}</span>
                </div>
                <span className="text-[10px] text-white/30">
                  {entry.lastSuccessAt ? `ok ${new Date(entry.lastSuccessAt).toLocaleString()}` : entry.schedule}
                </span>
              </div>
            ))}
          </div>
          {health.crons.missingRoutes.length > 0 && (
            <p className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-3 py-2 text-[11px] text-rose-200/80">
              {health.crons.missingRoutes.length} cron(s) reference a missing route:{" "}
              {health.crons.missingRoutes.slice(0, 12).join(", ")}
              {health.crons.missingRoutes.length > 12 ? "…" : ""}
            </p>
          )}
          {health.crons.duplicates.length > 0 && (
            <p className="mt-2 rounded-lg border border-amber-500/15 bg-amber-500/[0.05] px-3 py-2 text-[11px] text-amber-200/75">
              {health.crons.duplicates.length} duplicate cron definition(s):{" "}
              {health.crons.duplicates.map((d) => d.path).join(", ")}
            </p>
          )}
        </Card>

        {/* Providers */}
        <Card title="Providers" light={health.providers.trafficLight}>
          {health.providers.providers.length === 0 ? (
            <p className="text-[12px] text-white/40">No provider sync telemetry recorded yet.</p>
          ) : (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {health.providers.providers.map((p) => (
                <div key={p.provider} className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
                  <span className="text-[12px] font-semibold text-white/80">
                    <span aria-hidden className="mr-2">{TRAFFIC_LIGHT_EMOJI[p.trafficLight]}</span>
                    {p.provider}
                  </span>
                  <span className="truncate text-[10px] text-white/35">{p.message}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Cache + imports */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Cache" light={health.cache.trafficLight}>
            <div className="space-y-1.5">
              {health.cache.scopes.map((s) => (
                <div key={s.name} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="text-white/70">
                    <span aria-hidden className="mr-2">{TRAFFIC_LIGHT_EMOJI[s.trafficLight]}</span>
                    {s.name}
                  </span>
                  <span className="text-white/35">{s.count.toLocaleString()} entries</span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Imports (24h)" light={health.imports.failedLast24h > 0 ? "warning" : "healthy"}>
            <p className="text-[12px] text-white/60">
              {health.imports.succeededLast24h} succeeded · {health.imports.failedLast24h} failed
            </p>
            <div className="mt-2 max-h-44 space-y-1 overflow-auto">
              {health.imports.recent.slice(0, 12).map((r, i) => (
                <div key={`${r.jobName}-${i}`} className="flex items-center justify-between gap-2 text-[10px] text-white/40">
                  <span className="truncate">{r.jobName}{r.scope ? ` (${r.scope})` : ""}</span>
                  <span>{r.status}{r.rowsWritten ? ` · ${r.rowsWritten} rows` : ""}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </main>
  )
}
