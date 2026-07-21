/**
 * Operator Command Center — derived views over the real admin metrics.
 *
 * Everything here is computed from AdminCommandCenterMetrics (already fetched by
 * the overview) plus a couple of cheap extras. There are NO fabricated values:
 *  - the Attention Queue is assembled from signals we actually measure
 *    (provider gaps, missing critical env, cron gaps, failed sync jobs,
 *    identity/reconciliation problems, DB health) — never invented incidents;
 *  - metrics we do not measure (open incidents, MRR, uptime %) are returned as
 *    Unknown/Not-configured, never as a healthy 0 or a made-up percentage;
 *  - auto-derived attention items are explicitly labelled as such, and never
 *    assert a root cause.
 */
import type { AdminCommandCenterMetrics, AdminMetric } from "@/lib/admin-dashboard/AdminCommandCenterService"
import type { OperatorTone } from "@/components/admin/operator/primitives"

// ── Severity ─────────────────────────────────────────────────────────────────────
export type OperatorSeverity = "critical" | "high" | "medium" | "low" | "informational"

const SEVERITY_RANK: Record<OperatorSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  informational: 4,
}

export const SEVERITY_TONE: Record<OperatorSeverity, OperatorTone> = {
  critical: "critical",
  high: "critical",
  medium: "warn",
  low: "info",
  informational: "unknown",
}

export type OperatorAttentionItem = {
  id: string
  severity: OperatorSeverity
  category: string
  title: string
  /** Affected service / scope, in plain terms. */
  affected: string
  /** Real evidence — counts and statuses, never a fabricated cause. */
  evidence: string
  suggestedResponse: string
  /** Deep-link slug into the operator console. */
  section: string
}

function readMetric(items: AdminMetric[], label: string): AdminMetric | undefined {
  return items.find((m) => m.label === label)
}

function dbStatus(data: AdminCommandCenterMetrics): string {
  const m = readMetric(data.health, "Database")
  return typeof m?.value === "string" ? m.value : "unknown"
}

// ── Attention Queue ──────────────────────────────────────────────────────────────
export function buildOperatorAttentionQueue(data: AdminCommandCenterMetrics): OperatorAttentionItem[] {
  const items: OperatorAttentionItem[] = []

  // Database health.
  const db = dbStatus(data)
  if (db !== "healthy") {
    items.push({
      id: "db-health",
      severity: "critical",
      category: "Database",
      title: "Database health check is not passing",
      affected: "Platform database",
      evidence: `SELECT 1 probe returned "${db}".`,
      suggestedResponse: "Check the database connection/env and Neon compute state before other triage.",
      section: "system-settings",
    })
  }

  // Provider gaps.
  for (const p of data.providerHealth) {
    if (p.status === "configured" || p.status === "public_fallback" || p.status === "disabled") continue
    const severity: OperatorSeverity =
      p.status === "configured_failing" || p.status === "missing_env" ? "high" : "medium"
    const suggested =
      p.status === "missing_env"
        ? "Set this provider's environment variables."
        : p.status === "configured_failing"
          ? "Verify credentials and provider status; inspect the last error."
          : "Complete this provider integration before relying on its data."
    items.push({
      id: `provider-${p.id}`,
      severity,
      category: "Data provider",
      title: `${p.name} — ${p.status.replace(/_/g, " ")}`,
      affected: `${p.name}${p.category ? ` · ${p.category}` : ""}`,
      evidence: p.lastError ? `Last error: ${p.lastError}` : p.note || `Status: ${p.status.replace(/_/g, " ")}`,
      suggestedResponse: suggested,
      section: "data-providers",
    })
  }

  // Critical / warning missing env.
  for (const row of data.productionReadiness.env) {
    if (row.status !== "missing") continue
    if (row.severity === "optional") continue
    items.push({
      id: `env-${row.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      severity: row.severity === "critical" ? "critical" : "medium",
      category: "Configuration",
      title: `Missing ${row.severity} env: ${row.label}`,
      affected: "Production configuration",
      evidence: `Required environment configuration "${row.label}" is not set.`,
      suggestedResponse: "Set the environment variable in the target environment, then re-check readiness.",
      section: "system-settings",
    })
  }

  // Cron gaps.
  for (const cron of data.productionReadiness.crons) {
    if (cron.status === "configured") continue
    items.push({
      id: `cron-${cron.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      severity: cron.status === "missing" ? "high" : "medium",
      category: "Automation",
      title: `Cron ${cron.status}: ${cron.label}`,
      affected: `Scheduled job (${cron.schedule || "schedule unknown"})`,
      evidence: `Cron readiness status is "${cron.status}".`,
      suggestedResponse: "Confirm the schedule is registered and the endpoint auth/secret is correct.",
      section: "automation",
    })
  }

  // Failed sync jobs (24h).
  const failedSyncMetric = readMetric(data.integrity, "Failed sync jobs 24h")
  const failedSyncTracked = typeof failedSyncMetric?.value === "number"
  const failedSyncCount = failedSyncTracked ? (failedSyncMetric!.value as number) : 0
  if (!failedSyncTracked) {
    items.push({
      id: "sync-failures-unknown",
      severity: "medium",
      category: "Automation",
      title: "Sync-failure status unknown — query failed",
      affected: "Sports / data sync jobs",
      evidence: "The syncJobRun failure-count query did not return a value; this is not evidence of zero failures.",
      suggestedResponse: "Re-check the syncJobRun query and database connectivity.",
      section: "automation",
    })
  } else if (failedSyncCount > 0) {
    items.push({
      id: "sync-failures",
      severity: failedSyncCount >= 5 ? "high" : "medium",
      category: "Automation",
      title: `${failedSyncCount} sync job${failedSyncCount === 1 ? "" : "s"} failed in the last 24h`,
      affected: "Sports / data sync jobs",
      evidence: `syncJobRun rows with status failed/error in the last 24h: ${failedSyncCount}.`,
      suggestedResponse: "Inspect the failing sync jobs and their provider dependencies.",
      section: "automation",
    })
  }

  // Provider/team reconciliation query failure — surfaced distinctly from "0 problems".
  if (data.providerTeamReconciliation.unavailable) {
    items.push({
      id: "provider-reconciliation-unknown",
      severity: "medium",
      category: "Sports data",
      title: "Provider/team reconciliation status unknown — query failed",
      affected: "Provider ↔ canonical team mapping",
      evidence: "The reconciliation summary query threw; the real problem count is unknown, not zero.",
      suggestedResponse: "Re-check the reconciliation query and its data dependencies.",
      section: "sports-data",
    })
  }

  // Sports identity / image / mapping problems.
  const idProblems =
    data.sportsIdentityHealth.summary.identityProblems +
    data.sportsIdentityHealth.summary.imageProblems +
    data.sportsIdentityHealth.summary.providerMappingProblems
  if (idProblems > 0) {
    items.push({
      id: "sports-identity",
      severity: "medium",
      category: "Sports data",
      title: `${idProblems} sports identity / image / mapping problem${idProblems === 1 ? "" : "s"}`,
      affected: "Cached player/team identity + images",
      evidence:
        `identity: ${data.sportsIdentityHealth.summary.identityProblems} · ` +
        `image: ${data.sportsIdentityHealth.summary.imageProblems} · ` +
        `mapping: ${data.sportsIdentityHealth.summary.providerMappingProblems}`,
      suggestedResponse: "Review the Sports Data identity map for collisions and missing IDs.",
      section: "sports-data",
    })
  }

  // Provider team reconciliation problems.
  if (data.providerTeamReconciliation.totalProblems > 0) {
    items.push({
      id: "provider-reconciliation",
      severity: "low",
      category: "Sports data",
      title: `${data.providerTeamReconciliation.totalProblems} provider/team reconciliation problem${
        data.providerTeamReconciliation.totalProblems === 1 ? "" : "s"
      }`,
      affected: "Provider ↔ canonical team mapping",
      evidence: `Cached provider rows disagree with canonical team metadata in ${data.providerTeamReconciliation.totalProblems} case(s).`,
      suggestedResponse: "Reconcile the flagged teams in the Sports Data reconciliation view.",
      section: "sports-data",
    })
  }

  return items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
}

export function summarizeAttention(items: OperatorAttentionItem[]) {
  const bySeverity: Record<OperatorSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    informational: 0,
  }
  for (const item of items) bySeverity[item.severity] += 1
  return { total: items.length, bySeverity }
}

// ── Health row ───────────────────────────────────────────────────────────────────
export type OperatorHealthMetric = {
  label: string
  value: string
  tone: OperatorTone
  note?: string
  tracked: boolean
}

function numFromMetric(items: AdminMetric[], label: string): number | null {
  const m = readMetric(items, label)
  return typeof m?.value === "number" ? m.value : null
}

function strFromMetric(items: AdminMetric[], label: string): string | null {
  const m = readMetric(items, label)
  if (!m) return null
  return typeof m.value === "string" ? m.value : String(m.value)
}

export function buildOperatorHealthRow(
  data: AdminCommandCenterMetrics,
  opts: { activeLeagues: number | null; attentionCritical: number; attentionHigh: number; attentionTotal: number },
): OperatorHealthMetric[] {
  const db = dbStatus(data)
  const providerGaps = data.providerHealth.filter(
    (p) => p.status !== "configured" && p.status !== "public_fallback" && p.status !== "disabled",
  ).length
  const providerConfigured = data.providerHealth.filter((p) => p.configured).length
  const providerTotal = data.providerHealth.length
  const criticalEnvMissing = data.productionReadiness.env.filter(
    (r) => r.status === "missing" && r.severity === "critical",
  ).length
  const cronGaps = data.productionReadiness.crons.filter((c) => c.status !== "configured").length
  const failedSyncRaw = numFromMetric(data.integrity, "Failed sync jobs 24h")
  const failedSync = failedSyncRaw ?? 0

  // Composite platform health as an honest word, not a fabricated percentage.
  let platformValue = "Operational"
  let platformTone: OperatorTone = "healthy"
  if (db !== "healthy") {
    platformValue = "Down"
    platformTone = "critical"
  } else if (criticalEnvMissing > 0 || opts.attentionCritical > 0) {
    platformValue = "Degraded"
    platformTone = "critical"
  } else if (providerGaps > 0 || cronGaps > 0 || failedSyncRaw === null || failedSync > 0 || opts.attentionHigh > 0) {
    platformValue = "Degraded"
    platformTone = "warn"
  }

  const totalAccounts = numFromMetric(data.users, "Total accounts")
  const activeSessions = numFromMetric(data.users, "Active sessions now")
  const chimmyReplies = numFromMetric(data.ai, "Chimmy replies")
  const revenueToday = strFromMetric(data.subscriptions, "Revenue today")
  const revenue7d = strFromMetric(data.subscriptions, "Revenue 7 days")

  return [
    {
      label: "Platform health",
      value: platformValue,
      tone: platformTone,
      note: db === "healthy" ? "DB healthy · derived from live signals" : `DB probe: ${db}`,
      tracked: true,
    },
    {
      label: "Active users",
      value: totalAccounts != null ? totalAccounts.toLocaleString() : "Unknown",
      tone: "info",
      note: activeSessions != null ? `${activeSessions.toLocaleString()} active sessions now` : undefined,
      tracked: totalAccounts != null,
    },
    {
      label: "Active leagues",
      value: opts.activeLeagues != null ? opts.activeLeagues.toLocaleString() : "Unknown",
      tone: "info",
      note: opts.activeLeagues != null ? "Native + imported · split in Leagues" : "League count unavailable",
      tracked: opts.activeLeagues != null,
    },
    {
      label: "Attention items",
      value: opts.attentionTotal.toLocaleString(),
      tone: opts.attentionCritical > 0 ? "critical" : opts.attentionHigh > 0 ? "warn" : "healthy",
      note: `${opts.attentionCritical} critical · ${opts.attentionHigh} high`,
      tracked: true,
    },
    {
      label: "Sync failures 24h",
      value: failedSyncRaw === null ? "Unknown" : failedSync.toLocaleString(),
      tone: failedSyncRaw === null ? "unknown" : failedSync >= 5 ? "critical" : failedSync > 0 ? "warn" : "healthy",
      note: failedSyncRaw === null ? "Query failed — not a confirmed zero" : "syncJobRun failed/error rows",
      tracked: failedSyncRaw !== null,
    },
    {
      label: "Cron readiness",
      value: `${data.productionReadiness.crons.length - cronGaps}/${data.productionReadiness.crons.length}`,
      tone: cronGaps > 0 ? "warn" : "healthy",
      note: `${cronGaps} gap${cronGaps === 1 ? "" : "s"}`,
      tracked: true,
    },
    {
      label: "Provider health",
      value: `${providerConfigured}/${providerTotal}`,
      tone: providerGaps > 0 ? "warn" : "healthy",
      note: `${providerGaps} gap${providerGaps === 1 ? "" : "s"}`,
      tracked: true,
    },
    {
      label: "Open incidents",
      value: "Not configured",
      tone: "unknown",
      note: "No incident tracker wired — see Incidents",
      tracked: false,
    },
    {
      label: "Chimmy replies",
      value: chimmyReplies != null ? chimmyReplies.toLocaleString() : "Unknown",
      tone: "info",
      note: "Usage total · uptime not probed",
      tracked: chimmyReplies != null,
    },
    {
      label: "Revenue today",
      value: revenueToday ?? "Unknown",
      tone: "info",
      note: revenue7d ? `${revenue7d} last 7d · MRR not tracked` : "MRR not tracked",
      tracked: revenueToday != null,
    },
  ]
}

// ── Per-service health ("Health by Service") ─────────────────────────────────────
export type OperatorServiceHealth = {
  name: string
  status: string
  tone: OperatorTone
  detail: string
}

export function buildOperatorServiceHealth(data: AdminCommandCenterMetrics): OperatorServiceHealth[] {
  const db = dbStatus(data)
  const providerGaps = data.providerHealth.filter(
    (p) => p.status !== "configured" && p.status !== "public_fallback" && p.status !== "disabled",
  ).length
  const providerTotal = data.providerHealth.length
  const cronGaps = data.productionReadiness.crons.filter((c) => c.status !== "configured").length
  const idProblems =
    data.sportsIdentityHealth.summary.identityProblems +
    data.sportsIdentityHealth.summary.imageProblems +
    data.sportsIdentityHealth.summary.providerMappingProblems
  const failedSyncRaw = numFromMetric(data.integrity, "Failed sync jobs 24h")
  const failedSync = failedSyncRaw ?? 0

  return [
    {
      name: "Database",
      status: db === "healthy" ? "Operational" : db === "down" ? "Down" : "Unknown",
      tone: db === "healthy" ? "healthy" : db === "down" ? "critical" : "unknown",
      detail: "SELECT 1 liveness probe",
    },
    {
      name: "Data providers",
      status: providerGaps === 0 ? "Operational" : "Degraded",
      tone: providerGaps === 0 ? "healthy" : "warn",
      detail: `${providerTotal - providerGaps}/${providerTotal} configured`,
    },
    {
      name: "Automation / cron",
      status: failedSyncRaw === null ? "Unknown" : cronGaps === 0 && failedSync === 0 ? "Operational" : "Degraded",
      tone: failedSyncRaw === null ? "unknown" : cronGaps === 0 && failedSync === 0 ? "healthy" : "warn",
      detail: failedSyncRaw === null ? `${cronGaps} cron gap(s) · sync status unknown` : `${cronGaps} cron gap(s) · ${failedSync} failed sync 24h`,
    },
    {
      name: "Sports data quality",
      status: idProblems === 0 ? "Operational" : "Attention",
      tone: idProblems === 0 ? "healthy" : "warn",
      detail: `${idProblems} identity/image/mapping problem(s)`,
    },
    {
      name: "Incidents",
      status: "Unknown",
      tone: "unknown",
      detail: "No incident monitor configured",
    },
  ]
}
