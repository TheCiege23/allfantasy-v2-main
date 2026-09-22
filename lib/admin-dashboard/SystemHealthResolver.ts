/**
 * System health for admin: API status, database ping.
 * Worker queue health can be added when a queue exists.
 */

import { prisma } from "@/lib/prisma"
import type { SystemHealthStatus } from "./types"
import { getSportsAlertLatency } from "./SportsAlertLatencyResolver"
import { getTheAudioDbApiKeyOrFallback, getTheSportsDbApiKeyOrFallback } from '@/lib/env/sports-media-keys'
import { ESPN_SITE_API_BASE } from '@/lib/providers/espnUrls'
import { probeAiProviders, type AiProviderProbeResult } from './aiProviderEntitlementProbe'

const API_KEYS = ["sleeper", "yahoo", "mfl", "fantrax", "fantasycalc", "thesportsdb", "theaudiodb", "espn"] as const
const ENDPOINTS: Record<string, string> = {
  sleeper: "https://api.sleeper.app/v1/state/nfl", // db-first-exception: live provider health probe
  yahoo: "https://fantasysports.yahooapis.com", // db-first-exception: live provider health probe
  mfl: "https://api.myfantasyleague.com/2024/export", // db-first-exception: live provider health probe
  fantrax: "https://www.fantrax.com", // db-first-exception: live provider health probe
  fantasycalc: "https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=1&numTeams=12&ppr=1", // db-first-exception: live provider health probe
  thesportsdb: `https://www.thesportsdb.com/api/v1/json/${getTheSportsDbApiKeyOrFallback('123')}/all_leagues.php`, // db-first-exception: live provider health probe
  theaudiodb: `https://www.theaudiodb.com/api/v1/json/${getTheAudioDbApiKeyOrFallback('2')}/album.php?i=112024`, // db-first-exception: live provider health probe
  espn: `${ESPN_SITE_API_BASE}/football/nfl/scoreboard`, // db-first-exception: live provider health probe
}

/*
 * 🛑 THE AI PROVIDERS WERE PROBED WITHOUT A KEY, AND THE 401 COUNTED AS "active".
 *
 * `openai` and `grok` hit `/v1/models` with no Authorization header, and `checkApi` treats
 * 401/403/404 as up — reasonable for a public data API that answers anonymously, and meaningless
 * for an AI provider, where the 401 is guaranteed. So both always read "active". Measured
 * 2026-09-22 with a real completion: OpenAI 429 `billing_not_active`, xAI 403 "used all
 * available credits" — neither could answer a request, and this said both were healthy.
 *
 * ⚠ AND AN AUTHENTICATED MODELS CALL WOULD NOT FIX IT. A models list returns 200 on an account
 * that cannot bill; only a completion carries the billing error. So the AI rows come from the
 * shared live probe (one max_tokens=1 completion per provider, cached 10 min) instead.
 */
const AI_PROVIDER_KEYS: Record<AiProviderProbeResult["id"], string> = {
  openai: "openai",
  /* Kept as `grok` — the key this map has always published. */
  xai: "grok",
  deepseek: "deepseek",
}

export function aiProbeToApiStatus(result: AiProviderProbeResult): string {
  switch (result.state) {
    case "answering":
      return "active"
    case "billing":
      return "billing-error"
    case "auth":
      return "auth-error"
    case "not_configured":
      return "not-configured"
    case "unreachable":
      return result.detail?.startsWith("timed out") ? "timeout" : "unreachable"
    default:
      return result.httpStatus ? `error-${result.httpStatus}` : "error"
  }
}

async function checkApi(key: string): Promise<{ status: string; latency?: number }> {
  const url = ENDPOINTS[key]
  if (!url) return { status: "unknown" }
  try {
    const start = Date.now()
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 5000)
    const res = await fetch(url, { method: "GET", signal: ctrl.signal, headers: { "User-Agent": "AllFantasy-Admin/1.0" } })
    clearTimeout(t)
    const latency = Date.now() - start
    if (res.ok || res.status === 401 || res.status === 403 || res.status === 404) return { status: "active", latency }
    return { status: `error-${res.status}`, latency }
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError") return { status: "timeout" }
    return { status: "unreachable" }
  }
}

async function checkDatabase(): Promise<{ status: "healthy" | "degraded" | "down"; latencyMs?: number }> {
  const start = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    const latencyMs = Date.now() - start
    return { status: latencyMs > 2000 ? "degraded" : "healthy", latencyMs }
  } catch {
    return { status: "down" }
  }
}

async function checkWorkerQueue(): Promise<{
  status: "healthy" | "degraded" | "down"
  queued: number
  running: number
  failedLast24h: number
}> {
  try {
    const failedWindow = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const [queued, running, failedLast24h] = await Promise.all([
      prisma.legacyImportJob.count({ where: { status: { in: ["queued", "pending"] } } }),
      prisma.legacyImportJob.count({ where: { status: { in: ["running", "processing"] } } }),
      prisma.legacyImportJob.count({
        where: {
          status: { in: ["failed", "error"] },
          updatedAt: { gte: failedWindow },
        },
      }),
    ])

    let status: "healthy" | "degraded" | "down" = "healthy"
    if (failedLast24h >= 25 || queued >= 500) status = "down"
    else if (failedLast24h > 0 || queued >= 100) status = "degraded"

    return { status, queued, running, failedLast24h }
  } catch {
    return { status: "down", queued: 0, running: 0, failedLast24h: 0 }
  }
}

export async function getSystemHealth(): Promise<SystemHealthStatus> {
  const [apiResults, aiResults, db, workerQueue, sportsAlerts] = await Promise.all([
    Promise.all(API_KEYS.map(async (key) => ({ key, ...(await checkApi(key)) }))),
    probeAiProviders().catch(() => null),
    checkDatabase(),
    checkWorkerQueue(),
    getSportsAlertLatency(24),
  ])
  const now = new Date().toISOString()
  const api: SystemHealthStatus["api"] = {}
  for (const r of apiResults) {
    api[r.key] = { status: r.status, latency: r.latency, lastCheck: now }
  }
  /* A probe that could not run is "unknown", never "active". */
  if (!aiResults) {
    for (const key of Object.values(AI_PROVIDER_KEYS)) api[key] = { status: "unknown", lastCheck: now }
  } else {
    for (const r of aiResults) {
      api[AI_PROVIDER_KEYS[r.id]] = { status: aiProbeToApiStatus(r), lastCheck: r.checkedAt }
    }
  }
  return {
    api,
    database: db.status,
    databaseLatencyMs: db.latencyMs,
    workerQueue: {
      ...workerQueue,
      lastCheck: now,
    },
    sportsAlerts,
  }
}
