import "server-only"

import { prisma } from "@/lib/prisma"
import { getAdminProductionReadiness } from "@/lib/admin-dashboard/AdminProductionReadinessService"

export type HealthStatus = "operational" | "degraded" | "down" | "unknown"

export type HealthService = {
  id: string
  name: string
  category: string
  status: HealthStatus
  httpStatus: number | null
  latencyMs: number | null
  note: string
}

export type HealthError = {
  severity: "critical" | "warning"
  source: string
  message: string
}

export type ApiHealthReport = {
  generatedAt: string
  summary: { operational: number; degraded: number; down: number; unknown: number }
  services: HealthService[]
  errors: HealthError[]
}

const PROBE_TIMEOUT_MS = 4500

async function timedFetch(url: string): Promise<{ ok: boolean; status: number | null; latencyMs: number | null; error?: string }> {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(url, { method: "GET", cache: "no-store", signal: controller.signal })
    return { ok: res.status < 500, status: res.status, latencyMs: Date.now() - started }
  } catch (e) {
    return { ok: false, status: null, latencyMs: Date.now() - started, error: e instanceof Error ? e.message : "network error" }
  } finally {
    clearTimeout(timer)
  }
}

function classify(status: number | null, networkError: boolean): HealthStatus {
  if (networkError) return "down"
  if (status == null) return "unknown"
  if (status >= 500) return "degraded"
  return "operational" // <500 (incl. 401/403 from auth-gated routes) = reachable
}

/**
 * Aggregate API / dependency health for the admin console.
 * `origin` should be the request origin (e.g. https://allfantasy.app) so internal
 * self-pings resolve. Auth-gated endpoints returning 401/403 count as reachable.
 */
export async function getApiHealthReport(origin: string): Promise<ApiHealthReport> {
  const services: HealthService[] = []
  const errors: HealthError[] = []

  // 1) Database — direct latency ping
  {
    const started = Date.now()
    try {
      await prisma.$queryRawUnsafe(`SELECT 1`)
      services.push({
        id: "database",
        name: "Database (Postgres/Neon)",
        category: "Platform",
        status: "operational",
        httpStatus: null,
        latencyMs: Date.now() - started,
        note: "SELECT 1 succeeded",
      })
    } catch (e) {
      services.push({
        id: "database",
        name: "Database (Postgres/Neon)",
        category: "Platform",
        status: "down",
        httpStatus: null,
        latencyMs: Date.now() - started,
        note: e instanceof Error ? e.message : "DB unreachable",
      })
      errors.push({ severity: "critical", source: "Database", message: "Database ping failed — all cached data reads are at risk." })
    }
  }

  // 2) Lightweight public self-pings
  const probes: Array<{ id: string; name: string; category: string; path: string }> = [
    { id: "app-health", name: "App health endpoint", category: "Platform", path: "/api/health" },
    { id: "geo", name: "Geo / restriction check", category: "Compliance", path: "/api/geo/check" },
  ]
  for (const probe of probes) {
    const r = await timedFetch(`${origin}${probe.path}`)
    const status = classify(r.status, !!r.error)
    services.push({
      id: probe.id,
      name: probe.name,
      category: probe.category,
      status,
      httpStatus: r.status,
      latencyMs: r.latencyMs,
      note: r.error ? r.error : `HTTP ${r.status}`,
    })
    if (status === "down") errors.push({ severity: "critical", source: probe.name, message: `${probe.path} is unreachable (${r.error ?? "no response"}).` })
    else if (status === "degraded") errors.push({ severity: "warning", source: probe.name, message: `${probe.path} returned ${r.status}.` })
  }

  // 3) Env / provider / cron readiness → health + potential errors
  try {
    const readiness = await getAdminProductionReadiness()

    const criticalMissing = readiness.env.filter((e) => e.status === "missing" && e.severity === "critical")
    const warnMissing = readiness.env.filter((e) => e.status === "missing" && e.severity === "warning")
    services.push({
      id: "env-config",
      name: "Environment & provider keys",
      category: "Configuration",
      status: criticalMissing.length ? "degraded" : warnMissing.length ? "degraded" : "operational",
      httpStatus: null,
      latencyMs: null,
      note: criticalMissing.length
        ? `${criticalMissing.length} critical group(s) missing`
        : warnMissing.length
          ? `${warnMissing.length} warning group(s) missing`
          : "All required groups configured",
    })
    for (const e of criticalMissing) {
      errors.push({ severity: "critical", source: `Env · ${e.category}`, message: `${e.label} missing (${e.required}).` })
    }
    for (const e of warnMissing) {
      errors.push({ severity: "warning", source: `Env · ${e.category}`, message: `${e.label} not configured (${e.required}).` })
    }

    const cronGaps = readiness.crons.filter((c) => c.status !== "configured")
    services.push({
      id: "cron",
      name: "Scheduled sync jobs",
      category: "Data pipeline",
      status: cronGaps.some((c) => c.status === "missing") ? "degraded" : cronGaps.length ? "degraded" : "operational",
      httpStatus: null,
      latencyMs: null,
      note: cronGaps.length ? `${cronGaps.length} cron group(s) incomplete` : "All cron groups configured",
    })
    for (const c of cronGaps) {
      errors.push({
        severity: c.status === "missing" ? "critical" : "warning",
        source: `Cron · ${c.category}`,
        message: `${c.label} ${c.status} — ${c.recommended}`,
      })
    }
  } catch (e) {
    services.push({
      id: "env-config",
      name: "Environment & provider keys",
      category: "Configuration",
      status: "unknown",
      httpStatus: null,
      latencyMs: null,
      note: e instanceof Error ? e.message : "readiness check failed",
    })
  }

  const summary = {
    operational: services.filter((s) => s.status === "operational").length,
    degraded: services.filter((s) => s.status === "degraded").length,
    down: services.filter((s) => s.status === "down").length,
    unknown: services.filter((s) => s.status === "unknown").length,
  }

  // Most severe first
  errors.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1))

  return { generatedAt: new Date().toISOString(), summary, services, errors }
}
