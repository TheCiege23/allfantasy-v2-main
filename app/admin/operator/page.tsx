import Link from "next/link"
import { getOperatorOverviewData } from "@/lib/admin-dashboard/operatorData"
import {
  buildOperatorAttentionQueue,
  buildOperatorHealthRow,
  buildOperatorServiceHealth,
  summarizeAttention,
} from "@/lib/admin-dashboard/operatorAttention"
import type { AdminProviderHealthStatus } from "@/lib/admin-dashboard/AdminProviderHealthService"
import { getDeploymentIdentity } from "@/lib/admin-dashboard/deploymentIdentity"
import { OPERATOR_BASE_PATH } from "@/lib/admin-dashboard/operatorNav"
import {
  Panel,
  MetricCard,
  StatusDot,
  StatusPill,
  DataFreshnessBadge,
  SectionHeader,
  type OperatorTone,
} from "@/components/admin/operator/primitives"
import { AttentionQueueList } from "@/components/admin/operator/AttentionQueueList"
import { RefreshButton } from "@/components/admin/operator/RefreshButton"

export const dynamic = "force-dynamic"

const PROVIDER_TONE: Record<AdminProviderHealthStatus, OperatorTone> = {
  configured: "healthy",
  public_fallback: "info",
  scaffold_only: "warn",
  not_production_ready: "warn",
  missing_env: "critical",
  configured_failing: "critical",
  disabled: "unknown",
  unknown: "unknown",
}

function providerLabel(status: AdminProviderHealthStatus): string {
  return status.replace(/_/g, " ")
}

function metricValue(items: { label: string; value: number | string }[], label: string): string {
  const m = items.find((i) => i.label === label)
  return m ? String(m.value) : "—"
}

function OverviewDegraded({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="Platform Command Center"
        description="The shell is online, but the metrics pipeline failed. Recovery paths below stay available."
      />
      <Panel className="border-rose-500/25">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-rose-300">Metrics unavailable</p>
        <p className="mt-2 break-words font-mono text-xs leading-6 text-rose-200/90">{message}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/admin/production-health"
            className="rounded-lg border border-white/12 bg-white/[0.05] px-3 py-2 text-xs font-bold text-white hover:bg-white/[0.08]"
          >
            Production health
          </Link>
          <Link
            href="/admin/bootstrap"
            className="rounded-lg border border-white/12 bg-white/[0.05] px-3 py-2 text-xs font-bold text-white hover:bg-white/[0.08]"
          >
            Admin recovery
          </Link>
          <Link
            href={OPERATOR_BASE_PATH}
            className="rounded-lg border border-white/12 bg-white/[0.05] px-3 py-2 text-xs font-bold text-white hover:bg-white/[0.08]"
          >
            Retry
          </Link>
        </div>
      </Panel>
    </div>
  )
}

export default async function OperatorOverviewPage() {
  let data
  try {
    data = await getOperatorOverviewData()
  } catch (error) {
    return <OverviewDegraded message={error instanceof Error ? error.message : "Unknown metrics failure"} />
  }

  const { metrics, activeLeagues } = data
  const deployment = getDeploymentIdentity()
  const attention = buildOperatorAttentionQueue(metrics)
  const { total, bySeverity } = summarizeAttention(attention)
  const health = buildOperatorHealthRow(metrics, {
    activeLeagues,
    attentionCritical: bySeverity.critical,
    attentionHigh: bySeverity.high,
    attentionTotal: total,
  })
  const services = buildOperatorServiceHealth(metrics)

  const providerGaps = [...metrics.providerHealth]
    .filter((p) => p.status !== "configured" && p.status !== "public_fallback" && p.status !== "disabled")
    .slice(0, 6)
  const topProviders = providerGaps.length > 0 ? providerGaps : metrics.providerHealth.slice(0, 6)

  const cronGaps = metrics.productionReadiness.crons.filter((c) => c.status !== "configured")

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="Platform Command Center"
        description="Monitor the health, safety, intelligence, and operations of AllFantasy."
        action={
          <div className="flex items-center gap-2">
            <DataFreshnessBadge generatedAt={metrics.generatedAt} />
            <RefreshButton />
          </div>
        }
      />

      {/* Deployment identity — makes it unmistakable which build/environment/DB this is. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-xs">
        <StatusPill tone={deployment.environment === "production" ? "critical" : deployment.environment === "staging" ? "warn" : "unknown"}>
          {deployment.environmentLabel}
        </StatusPill>
        <span className="text-slate-500">v{deployment.version}</span>
        <span className="text-slate-600">·</span>
        <span title={deployment.commitSha ?? "No commit SHA in this environment"} className="font-mono text-slate-400">
          {deployment.commitShaShort ?? "no-sha"}
        </span>
        {deployment.branch ? (
          <>
            <span className="text-slate-600">·</span>
            <span className="text-slate-400">{deployment.branch}</span>
          </>
        ) : null}
        {deployment.deploymentUrl ? (
          <>
            <span className="text-slate-600">·</span>
            <span className="truncate text-slate-500">{deployment.deploymentUrl}</span>
          </>
        ) : null}
        <span className="text-slate-600">·</span>
        <span title="One-way fingerprint of the DB connection host — not the host itself" className="font-mono text-slate-500">
          db:{deployment.databaseHostFingerprint ?? "unknown"}
        </span>
        <span className="ml-auto text-slate-600">
          process started {new Date(deployment.processStartedAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET
        </span>
      </div>

      {/* Health row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {health.map((m) => (
          <MetricCard key={m.label} label={m.label} value={m.value} tone={m.tone} note={m.note} tracked={m.tracked} />
        ))}
      </div>

      {/* Attention + platform health */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel
          eyebrow="Operator attention"
          title={`Attention Queue (${total})`}
          action={
            <div className="flex items-center gap-1.5">
              {bySeverity.critical > 0 ? <StatusPill tone="critical">{bySeverity.critical} critical</StatusPill> : null}
              {bySeverity.high > 0 ? <StatusPill tone="warn">{bySeverity.high} high</StatusPill> : null}
            </div>
          }
        >
          <AttentionQueueList items={attention} limit={6} />
        </Panel>

        <Panel eyebrow="Platform health" title="Health by service">
          <ul className="flex flex-col divide-y divide-white/[0.06]">
            {services.map((s) => (
              <li key={s.name} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div>
                  <p className="text-sm font-semibold text-white">{s.name}</p>
                  <p className="text-[11px] text-slate-500">{s.detail}</p>
                </div>
                <StatusDot tone={s.tone} label={s.status} />
              </li>
            ))}
          </ul>
          <p className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] leading-4 text-slate-500">
            Status is derived from live checks, not an uptime probe. No historical health time-series is recorded yet,
            so no trend chart is shown rather than a fabricated one.
          </p>
        </Panel>
      </div>

      {/* Summary row */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          eyebrow="Providers"
          title={providerGaps.length > 0 ? "Provider gaps" : "Top data providers"}
          action={
            <Link href={`${OPERATOR_BASE_PATH}/data-providers`} className="text-[11px] font-bold text-violet-300 hover:text-violet-200">
              View all →
            </Link>
          }
        >
          <ul className="flex flex-col gap-2">
            {topProviders.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm text-slate-200">{p.name}</span>
                <StatusPill tone={PROVIDER_TONE[p.status]}>{providerLabel(p.status)}</StatusPill>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          eyebrow="Automation"
          title="Cron readiness"
          action={
            <Link href={`${OPERATOR_BASE_PATH}/automation`} className="text-[11px] font-bold text-violet-300 hover:text-violet-200">
              View all →
            </Link>
          }
        >
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-white">
              {metrics.productionReadiness.crons.length - cronGaps.length}/{metrics.productionReadiness.crons.length}
            </span>
            <span className="text-xs text-slate-400">configured</span>
          </div>
          <div className="mt-3 flex flex-col gap-1.5">
            {cronGaps.length === 0 ? (
              <p className="text-xs text-slate-400">All registered cron jobs are configured.</p>
            ) : (
              cronGaps.slice(0, 5).map((c) => (
                <div key={c.label} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate text-slate-300">{c.label}</span>
                  <StatusPill tone={c.status === "missing" ? "critical" : "warn"}>{c.status}</StatusPill>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel
          eyebrow="Business"
          title="Revenue & subscribers"
          action={
            <Link href={`${OPERATOR_BASE_PATH}/subscriptions`} className="text-[11px] font-bold text-violet-300 hover:text-violet-200">
              View all →
            </Link>
          }
        >
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Revenue today</dt>
              <dd className="mt-1 text-lg font-black text-white">{metricValue(metrics.subscriptions, "Revenue today")}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Active subscribers</dt>
              <dd className="mt-1 text-lg font-black text-white">{metricValue(metrics.morning, "Active subscribers")}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">New subs today</dt>
              <dd className="mt-1 text-lg font-black text-white">
                {metricValue(metrics.subscriptions, "New subscriptions today")}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Failed / canceled</dt>
              <dd className="mt-1 text-lg font-black text-white">
                {metricValue(metrics.subscriptions, "Failed/canceled subscriptions")}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-[11px] text-slate-500">MRR is not tracked (subscription prices aren’t stored on rows).</p>
        </Panel>
      </div>

      {/* Operator sub-tools */}
      <Panel eyebrow="Operator tools" title="Consoles & recovery">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { href: "/admin/production-health", label: "Production health console" },
            { href: "/admin/bootstrap", label: "Admin recovery / bootstrap" },
            { href: "/admin/duplicate-manager-verify", label: "Duplicate-manager verify" },
            { href: "/api/admin/status", label: "Raw status payload (JSON)" },
          ].map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-sm font-semibold text-slate-200 hover:border-violet-400/30 hover:bg-white/[0.04]"
            >
              <span className="min-w-0 truncate">{tool.label}</span>
              <span className="text-slate-500">→</span>
            </Link>
          ))}
        </div>
      </Panel>
    </div>
  )
}
