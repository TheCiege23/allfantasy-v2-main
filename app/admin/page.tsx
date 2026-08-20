import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { getAdminAccessState } from "@/lib/adminAuth"
import {
  getAdminCommandCenterMetrics,
  type AdminCommandCenterMetrics,
  type AdminMetric,
} from "@/lib/admin-dashboard/AdminCommandCenterService"
import { AiAuditLogsPanel } from "@/components/admin/AiAuditLogsPanel"
import { CampaignAttributionPanel } from "@/components/admin/CampaignAttributionPanel"
import { BetaInvitePanel } from "@/components/admin/BetaInvitePanel"
import { AiProviderHealthPanel } from "@/components/admin/AiProviderHealthPanel"
import { PlatformOsOperatorPanel } from "@/components/admin/PlatformOsOperatorPanel"
import type {
  AdminProviderHealthRow,
  AdminProviderHealthStatus,
  AdminSportDataReliabilityRow,
} from "@/lib/admin-dashboard/AdminProviderHealthService"
import type {
  DashboardAiToolAvailability,
  DashboardAiToolStatus,
  SportImportMatrixRow,
  SportImportStatus,
} from "@/lib/admin-dashboard/SportImportMatrixService"
import type {
  AdminProductionReadiness,
  CronReadinessStatus,
  EnvReadinessStatus,
} from "@/lib/admin-dashboard/AdminProductionReadinessService"
import type { AdminEmailStatus } from "@/lib/admin-dashboard/AdminEmailCenterService"
import type {
  SportsOperatingSystemAudit,
  SportsOsStatus,
} from "@/lib/sports-os/SportsOperatingSystemReadinessService"
import type {
  SportsIdentityHealthSnapshot,
  SportsIdentityHealthStatus,
} from "@/lib/sports-os/SportsIdentityHealthService"
import type {
  ProviderTeamReconciliationSummary,
} from "@/lib/sports-os/ProviderTeamReconciliationService"

export const dynamic = "force-dynamic"

// Admin surfaces must never be indexed (defense-in-depth beyond robots.txt Disallow: /admin).
export const metadata = { robots: { index: false, follow: false } }

function MetricCard({ item }: { item: AdminMetric }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 shadow-[0_18px_60px_-46px_rgba(34,211,238,0.75)]">
      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100/55">
        {item.label}
      </div>
      <div className={item.tracked ? "mt-2 text-2xl font-black text-white" : "mt-2 text-sm font-bold text-amber-100"}>
        {item.value}
      </div>
      {item.note ? <div className="mt-1 text-xs text-white/45">{item.note}</div> : null}
    </div>
  )
}

function AccordionSection({
  id,
  title,
  eyebrow,
  children,
  defaultOpen = true,
}: {
  id?: string
  title: string
  eyebrow?: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details
      id={id}
      className="group rounded-3xl border border-cyan-300/15 bg-white/[0.035] p-4 shadow-[0_24px_80px_-58px_rgba(34,211,238,0.75)] backdrop-blur-xl sm:p-5"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left">
        <div>
          {eyebrow ? <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-200/55">{eyebrow}</p> : null}
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan-100/80">{title}</h2>
        </div>
        <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-black text-cyan-100 transition group-open:rotate-180">
          v
        </span>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  )
}

function Section({ id, title, items }: { id?: string; title: string; items: AdminMetric[] }) {
  return (
    <AccordionSection id={id} title={title}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <MetricCard key={`${title}-${item.label}`} item={item} />
        ))}
      </div>
    </AccordionSection>
  )
}

function formatDate(value: string | null) {
  if (!value) return "Not set"
  return new Date(value).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function metricLookup(items: AdminMetric[]) {
  return new Map(items.map((item) => [item.label, item]))
}

function metricDisplay(items: AdminMetric[], label: string, fallback = "Not tracked"): string {
  const match = metricLookup(items).get(label)
  if (!match) return fallback
  return String(match.value)
}

function AdminOverviewDeck({
  data,
  accessSource,
}: {
  data: AdminCommandCenterMetrics
  accessSource: "admin_session" | "app_session"
}) {
  const criticalEnvMissing = data.productionReadiness.env.filter(
    (row) => row.status === "missing" && row.severity === "critical",
  ).length
  const cronGaps = data.productionReadiness.crons.filter(
    (row) => row.status !== "configured",
  ).length
  const providerGaps = data.providerHealth.filter(
    (row) => row.status !== "configured" && row.status !== "public_fallback",
  ).length
  const identityGapCount =
    data.sportsIdentityHealth.summary.identityProblems +
    data.sportsIdentityHealth.summary.imageProblems +
    data.sportsIdentityHealth.summary.providerMappingProblems

  const overviewCards = [
    {
      label: "Platform",
      value: metricDisplay(data.health, "Database", "Unknown"),
      note: `${metricDisplay(data.users, "Total accounts", "0")} accounts • ${metricDisplay(data.morning, "New signups", "0")} new today`,
      tone: "cyan" as const,
    },
    {
      label: "Revenue pulse",
      value: metricDisplay(data.subscriptions, "Revenue today", "Not tracked"),
      note: `${metricDisplay(data.subscriptions, "Active subscribers", "Not tracked")} active subscribers`,
      tone: "amber" as const,
    },
    {
      label: "Data foundation",
      value: `${data.sportsOperatingSystem.summary.ready} ready / ${data.sportsOperatingSystem.summary.partial} partial`,
      note: `${providerGaps} provider gaps • ${identityGapCount} identity/image issues`,
      tone: "emerald" as const,
    },
    {
      label: "Ops queue",
      value: `${criticalEnvMissing + cronGaps} blockers`,
      note: `${criticalEnvMissing} critical env gaps • ${cronGaps} cron gaps`,
      tone: "rose" as const,
    },
  ]

  const quickLinks = [
    { href: "#overview", label: "Overview" },
    { href: "#production-readiness", label: "Launch Readiness" },
    { href: "#user-search", label: "Users" },
    { href: "#sports-os", label: "Sports OS" },
    { href: "#provider-health", label: "Providers" },
    { href: "#ai-panels", label: "AI Ops" },
  ]

  return (
    <section id="overview" className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
      <div className="rounded-3xl border border-cyan-300/15 bg-[linear-gradient(135deg,rgba(8,15,33,0.95),rgba(7,24,39,0.92))] p-5 shadow-[0_24px_90px_-56px_rgba(34,211,238,0.85)] backdrop-blur-xl sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-200/65">
              Live Operations
            </p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">
              Admin command deck
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/58">
              Watch launch health, data coverage, AI safety, and user activity from one surface. This shell is designed
              to stay useful even when one backend module is degraded.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-right">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/42">
              Access Source
            </p>
            <p className="mt-1 text-sm font-black text-white">
              {accessSource === "admin_session" ? "Admin session" : "App session"}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {overviewCards.map((card) => {
            const toneClass =
              card.tone === "amber"
                ? "border-amber-300/20 bg-amber-300/[0.08] text-amber-100"
                : card.tone === "emerald"
                  ? "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-100"
                  : card.tone === "rose"
                    ? "border-rose-300/20 bg-rose-300/[0.08] text-rose-100"
                    : "border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-100"

            return (
              <div
                key={card.label}
                className={`rounded-2xl border p-4 shadow-[0_16px_44px_-32px_rgba(15,23,42,0.9)] ${toneClass}`}
              >
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-current/75">
                  {card.label}
                </p>
                <p className="mt-2 text-2xl font-black text-white">{card.value}</p>
                <p className="mt-2 text-xs leading-5 text-white/58">{card.note}</p>
              </div>
            )
          })}
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-5 shadow-[0_24px_90px_-60px_rgba(251,191,36,0.55)] backdrop-blur-xl sm:p-6">
        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-amber-200/70">
          Fast Paths
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {quickLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="inline-flex min-h-10 items-center rounded-full border border-white/12 bg-black/25 px-4 text-sm font-bold text-white/80 transition hover:border-cyan-300/40 hover:text-white"
            >
              {link.label}
            </a>
          ))}
        </div>
        <div className="mt-5 grid gap-3">
          <a
            href="/admin/production-health"
            className="flex items-center justify-between rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.08] px-4 py-3 text-sm font-bold text-cyan-100 transition hover:border-cyan-300/40"
          >
            <span>Production health console</span>
            <span className="text-cyan-100/65">Open</span>
          </a>
          <a
            href="/admin/bootstrap"
            className="flex items-center justify-between rounded-2xl border border-amber-300/15 bg-amber-300/[0.08] px-4 py-3 text-sm font-bold text-amber-100 transition hover:border-amber-300/35"
          >
            <span>Admin recovery / bootstrap</span>
            <span className="text-amber-100/65">Open</span>
          </a>
          <a
            href="/admin/duplicate-manager-verify"
            className="flex items-center justify-between rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.08] px-4 py-3 text-sm font-bold text-emerald-100 transition hover:border-emerald-300/35"
          >
            <span>Duplicate-manager verification</span>
            <span className="text-emerald-100/65">Open</span>
          </a>
          <a
            href="/api/admin/status"
            className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm font-bold text-white/78 transition hover:border-white/25"
          >
            <span>Raw status payload</span>
            <span className="text-white/45">JSON</span>
          </a>
        </div>
      </div>
    </section>
  )
}

/**
 * Non-sensitive build marker: shows the deployment's abbreviated commit SHA + environment
 * (e.g. "build a1b2c3d · preview") so a deployed build is identifiable at a glance — you can
 * tell Preview from Production without guessing from appearance. Reads only Vercel-set system
 * vars; never renders secrets. Falls back gracefully when the vars are absent.
 */
function DeploymentMarker() {
  const env = process.env.VERCEL_ENV || process.env.NODE_ENV || "local"
  const commit = (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || "dev"
  return (
    <span
      data-testid="admin-build-marker"
      className="inline-flex items-center rounded-md border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.16em] text-cyan-100"
    >
      build {commit} · {env}
    </span>
  )
}

function AdminPageLoadFailure({
  message,
}: {
  message: string
}) {
  return (
    <main className="min-h-dvh bg-[#020817] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(34,211,238,0.20),transparent_34%),radial-gradient(circle_at_85%_8%,rgba(251,191,36,0.14),transparent_30%),linear-gradient(180deg,#020817_0%,#06111f_46%,#020817_100%)]" />
      <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-rose-300/20 bg-black/35 p-6 shadow-[0_28px_90px_-54px_rgba(244,63,94,0.65)] backdrop-blur-xl sm:p-8">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-rose-200">
              Admin degraded
            </p>
            <DeploymentMarker />
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-5xl">
            The admin shell loaded, but the data pipeline failed.
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-white/65">
            This page now stays online and gives you recovery options instead of crashing. The most likely next step is
            checking production health, env readiness, or a failing admin data dependency.
          </p>
          <div className="mt-6 rounded-2xl border border-rose-300/20 bg-rose-300/[0.08] p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-rose-100/80">
              Last error
            </p>
            <p className="mt-2 break-words font-mono text-xs leading-6 text-rose-50/90">
              {message}
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="/admin/production-health"
              className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-cyan-300 px-4 py-2 text-sm font-black text-slate-950"
            >
              Open production health
            </a>
            <a
              href="/admin/bootstrap"
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.05] px-4 py-2 text-sm font-black text-white"
            >
              Admin recovery
            </a>
            <a
              href="/dashboard"
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/12 bg-black/25 px-4 py-2 text-sm font-black text-white/80"
            >
              Back to app
            </a>
          </div>
        </section>

        {/*
          P0-1: closed-beta invitations must NOT disappear because an unrelated admin data
          loader failed. BetaInvitePanel is a client component that fetches its own data from
          the admin-gated API, so it renders here in degraded mode exactly as on the healthy
          page — an authenticated admin can always issue/list/revoke invites.
        */}
        <AccordionSection id="beta-invites" title="Closed-Beta Invitations" eyebrow="access">
          <BetaInvitePanel />
        </AccordionSection>
      </div>
    </main>
  )
}

function providerStatusLabel(status: AdminProviderHealthStatus) {
  switch (status) {
    case "configured":
      return "Configured"
    case "missing_env":
      return "Missing env"
    case "configured_failing":
      return "Configured failing"
    case "scaffold_only":
      return "Scaffold only"
    case "not_production_ready":
      return "Not production ready"
    case "disabled":
      return "Disabled"
    case "public_fallback":
      return "Public fallback"
    default:
      return "Unknown"
  }
}

function providerStatusClass(status: AdminProviderHealthStatus) {
  if (status === "configured") return "border-emerald-300/35 bg-emerald-300/10 text-emerald-100"
  if (status === "public_fallback") return "border-cyan-300/35 bg-cyan-300/10 text-cyan-100"
  if (status === "scaffold_only" || status === "not_production_ready") {
    return "border-amber-300/35 bg-amber-300/10 text-amber-100"
  }
  if (status === "missing_env" || status === "configured_failing") {
    return "border-rose-300/35 bg-rose-300/10 text-rose-100"
  }
  return "border-white/15 bg-white/[0.06] text-white/70"
}

function joinList(values: string[], fallback = "Not tracked yet") {
  return values.length > 0 ? values.join(", ") : fallback
}

function subStatusClass(status: string) {
  const s = status.toLowerCase()
  if (s === "active" || s === "trialing") return "border-emerald-300/35 bg-emerald-300/10 text-emerald-100"
  if (s === "past_due") return "border-amber-300/35 bg-amber-300/10 text-amber-100"
  if (s === "canceled" || s === "cancelled" || s === "failed" || s === "incomplete" || s === "unpaid") {
    return "border-rose-300/35 bg-rose-300/10 text-rose-100"
  }
  return "border-white/15 bg-white/[0.06] text-white/55"
}

function paymentStatusClass(status: string) {
  const s = status.toLowerCase()
  if (s === "completed" || s === "paid" || s === "succeeded") return "border-emerald-300/35 bg-emerald-300/10 text-emerald-100"
  if (s === "pending") return "border-amber-300/35 bg-amber-300/10 text-amber-100"
  if (s === "failed" || s === "canceled" || s === "refunded") return "border-rose-300/35 bg-rose-300/10 text-rose-100"
  return "border-white/15 bg-white/[0.06] text-white/55"
}

function statusPillClass(status: string) {
  if (status === "configured" || status === "active_importer" || status === "active") {
    return "border-emerald-300/35 bg-emerald-300/10 text-emerald-100"
  }
  if (status === "partial" || status === "partial_importer" || status === "preview") {
    return "border-amber-300/35 bg-amber-300/10 text-amber-100"
  }
  return "border-rose-300/35 bg-rose-300/10 text-rose-100"
}

function sportsOsStatusClass(status: SportsOsStatus) {
  if (status === "ready") return "border-emerald-300/35 bg-emerald-300/10 text-emerald-100"
  if (status === "partial") return "border-amber-300/35 bg-amber-300/10 text-amber-100"
  return "border-rose-300/35 bg-rose-300/10 text-rose-100"
}

function sportsOsStatusLabel(status: SportsOsStatus) {
  if (status === "ready") return "Ready"
  if (status === "partial") return "Partial"
  return "Missing"
}

function identityStatusClass(status: SportsIdentityHealthStatus) {
  if (status === "ready") return "border-emerald-300/35 bg-emerald-300/10 text-emerald-100"
  if (status === "partial") return "border-amber-300/35 bg-amber-300/10 text-amber-100"
  return "border-rose-300/35 bg-rose-300/10 text-rose-100"
}

function identityStatusLabel(status: SportsIdentityHealthStatus) {
  if (status === "ready") return "Ready"
  if (status === "partial") return "Partial"
  return "Missing"
}

function envStatusLabel(status: EnvReadinessStatus) {
  return status === "configured" ? "Configured" : "Missing"
}

function cronStatusLabel(status: CronReadinessStatus) {
  if (status === "configured") return "Configured"
  if (status === "partial") return "Partial"
  return "Missing"
}

function ProductionReadinessPanel({ data }: { data: AdminProductionReadiness }) {
  const criticalMissing = data.env.filter((row) => row.status === "missing" && row.severity === "critical")
  return (
    <AccordionSection title="Production Env & Cron Readiness" eyebrow="launch trust">
      <div className="mb-4 rounded-2xl border border-amber-300/20 bg-amber-300/[0.08] p-4 text-sm text-amber-100">
        {criticalMissing.length > 0
          ? `${criticalMissing.length} critical production env groups are missing. Add them in Vercel before trusting live sync/AI.`
          : "Critical production env groups are configured in this runtime."}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-[0.16em] text-white/42">
              <tr>
                <th className="py-2 pr-3">Env group</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Required</th>
                <th className="py-2 pr-3">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {data.env.map((row) => (
                <tr key={row.id} className="align-top text-white/70">
                  <td className="py-3 pr-3">
                    <div className="font-black text-white">{row.label}</div>
                    <div className="text-[11px] uppercase tracking-[0.12em] text-cyan-100/45">{row.category} · {row.severity}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <span className={`rounded-full border px-2 py-1 text-[10px] font-black ${statusPillClass(row.status)}`}>
                      {envStatusLabel(row.status)}
                    </span>
                  </td>
                  <td className="max-w-[220px] py-3 pr-3 font-mono text-[11px] text-white/55">{row.required}</td>
                  <td className="max-w-[260px] py-3 pr-3 text-[11px] leading-4 text-white/50">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-3">
          {data.crons.map((row) => (
            <div key={row.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-black text-white">{row.label}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-cyan-100/45">{row.category}</div>
                </div>
                <span className={`rounded-full border px-2 py-1 text-[10px] font-black ${statusPillClass(row.status)}`}>
                  {cronStatusLabel(row.status)}
                </span>
              </div>
              <div className="mt-3 text-[11px] leading-5 text-white/55">{row.note}</div>
              <div className="mt-2 text-[11px] text-amber-100/80">Recommended: {row.recommended}</div>
              <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.04] p-3 font-mono text-[10px] leading-4 text-cyan-100/70">
                {row.configuredPaths.length ? row.configuredPaths.join("\n") : "No matching Vercel cron found"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AccordionSection>
  )
}

function TrafficGeoPanel({ data, metrics }: { data: AdminProductionReadiness; metrics: AdminMetric[] }) {
  return (
    <AccordionSection title="Traffic / Visitors / IP Geo" eyebrow="privacy-safe analytics">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((item) => <MetricCard key={`traffic-${item.label}`} item={item} />)}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_0.8fr]">
        <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
          <h3 className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/75">Approximate location map</h3>
          <div className="mt-4 grid gap-2">
            {data.trafficLocations.length > 0 ? data.trafficLocations.map((row) => (
              <div key={row.label} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">
                <span className="font-bold text-white">{row.label}</span>
                <span className="text-xs text-cyan-100/70">{row.visits} visits · {row.visitors} visitors</span>
              </div>
            )) : (
              <p className="rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/50">
                Geo tracking not configured yet. Use Vercel/Cloudflare geo headers or cached server-side lookup, then store aggregate city/region/country only.
              </p>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
          <h3 className="text-xs font-black uppercase tracking-[0.16em] text-amber-100/75">Privacy notes</h3>
          <ul className="mt-3 space-y-2 text-xs leading-5 text-white/55">
            {data.trafficNotes.map((note) => <li key={note}>- {note}</li>)}
          </ul>
        </div>
      </div>
    </AccordionSection>
  )
}

function EmailCenterPanel({ status }: { status: AdminEmailStatus }) {
  return (
    <AccordionSection title="Email Notifications" eyebrow="admin broadcast safety" defaultOpen={false}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard item={{ label: "Email provider", value: status.configured ? "Configured" : "Missing env", tracked: status.configured, note: status.missingEnv.join(", ") || "Resend ready" }} />
        <MetricCard item={{ label: "Users with email", value: status.totalUsersWithEmail, tracked: true }} />
        <MetricCard item={{ label: "Opt-outs", value: status.productUpdateOptOuts + status.unsubscribed, tracked: true, note: "Product updates false or unsubscribed" }} />
        <MetricCard item={{ label: "Pending email outbox", value: status.pendingEmailOutbox, tracked: true }} />
      </div>
      <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/75">Admin API</h3>
            <p className="mt-1 text-xs text-white/50">Preview, test-send, then confirm broadcast. Opt-outs are excluded and every send is logged.</p>
          </div>
          <a href="/api/admin/email/broadcast" className="rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100">
            Email status JSON
          </a>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {status.audiences.map((audience) => (
            <div key={audience.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
              <div className="font-black text-white">{audience.label}</div>
              <div className="mt-1 text-xs text-white/48">{audience.description}</div>
            </div>
          ))}
        </div>
      </div>
    </AccordionSection>
  )
}

function SportsOperatingSystemPanel({ audit }: { audit: SportsOperatingSystemAudit }) {
  const phaseGroups = [
    { title: "Identity", rows: audit.identityFindings },
    { title: "Historical Data", rows: audit.historicalDataFindings },
    { title: "Images / Logos", rows: audit.imageLogoFindings },
    { title: "Fantasy Value", rows: audit.fantasyValueEngine },
    { title: "Trade Analyzer", rows: audit.tradeAnalyzer },
    { title: "Draft Advisor", rows: audit.draftAdvisor },
    { title: "Commissioner Copilot", rows: audit.commissionerCopilot },
    { title: "Bracket Intelligence", rows: audit.bracketIntelligence },
    { title: "Freshness", rows: audit.dataFreshness },
  ]

  return (
    <AccordionSection title="Sports OS / Chimmy Brain Readiness" eyebrow="master data and commissioner value">
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard item={{ label: "Ready signals", value: audit.summary.ready, tracked: true }} />
        <MetricCard item={{ label: "Partial signals", value: audit.summary.partial, tracked: true }} />
        <MetricCard item={{ label: "Missing signals", value: audit.summary.missing, tracked: true }} />
      </div>

      <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/[0.08] p-4">
        <h3 className="text-xs font-black uppercase tracking-[0.16em] text-amber-100/85">Biggest data holes</h3>
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {audit.biggestDataHoles.map((hole) => (
            <div key={hole} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs font-semibold text-white/65">
              {hole}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        {phaseGroups.map((group) => (
          <div key={group.title} className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <h3 className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/75">{group.title}</h3>
            <div className="mt-3 space-y-3">
              {group.rows.map((row) => (
                <div key={row.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-black text-white">{row.label}</div>
                    <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-black ${sportsOsStatusClass(row.status)}`}>
                      {sportsOsStatusLabel(row.status)}
                    </span>
                  </div>
                  <div className="mt-2 text-[11px] leading-4 text-white/48">{row.recommendation}</div>
                  {row.gaps.length > 0 ? (
                    <div className="mt-2 text-[11px] leading-4 text-amber-100/75">
                      Gaps: {row.gaps.slice(0, 3).join("; ")}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/25 p-4">
        <h3 className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/75">Per-sport grounding</h3>
        <table className="mt-3 w-full min-w-[980px] text-left text-xs">
          <thead className="text-[10px] uppercase tracking-[0.16em] text-white/42">
            <tr>
              <th className="py-2 pr-3">Sport</th>
              <th className="py-2 pr-3">Identity</th>
              <th className="py-2 pr-3">History</th>
              <th className="py-2 pr-3">Current facts</th>
              <th className="py-2 pr-3">Images/logos</th>
              <th className="py-2 pr-3">AI grounding</th>
              <th className="py-2 pr-3">Missing</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {audit.sports.map((row) => (
              <tr key={row.id} className="align-top text-white/70">
                <td className="py-3 pr-3 font-black text-white">{row.label}</td>
                {[row.identityStatus, row.historicalStatus, row.currentFactsStatus, row.imageLogoStatus, row.aiGroundingStatus].map((status, index) => (
                  <td key={`${row.id}-${index}`} className="py-3 pr-3">
                    <span className={`rounded-full border px-2 py-1 text-[10px] font-black ${sportsOsStatusClass(status)}`}>
                      {sportsOsStatusLabel(status)}
                    </span>
                  </td>
                ))}
                <td className="max-w-[280px] py-3 pr-3 text-[11px] leading-4 text-white/48">
                  {row.missingData.length ? row.missingData.slice(0, 6).join(", ") : "No critical gaps"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
          <h3 className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/75">Chimmy intent routes</h3>
          <div className="mt-3 grid gap-2">
            {audit.chimmyIntentRoutes.map((route) => (
              <div key={route.intent} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-black text-white">{route.intent}</div>
                    <div className="text-[11px] text-white/45">{route.targetEngine}</div>
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-[10px] font-black ${sportsOsStatusClass(route.status)}`}>
                    {sportsOsStatusLabel(route.status)}
                  </span>
                </div>
                <div className="mt-2 text-[11px] text-white/50">{route.tokenPolicy}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
          <h3 className="text-xs font-black uppercase tracking-[0.16em] text-amber-100/75">Specialty league support</h3>
          <div className="mt-3 grid gap-2">
            {audit.leagueFormats.map((format) => (
              <div key={format.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-black text-white">{format.label}</div>
                    <div className="text-[11px] text-white/45">{format.supportedSports.join(", ")}</div>
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-[10px] font-black ${sportsOsStatusClass(format.status)}`}>
                    {sportsOsStatusLabel(format.status)}
                  </span>
                </div>
                <div className="mt-2 text-[11px] text-white/50">{format.commissionerValue}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AccordionSection>
  )
}

function SportsIdentityHealthPanel({ snapshot }: { snapshot: SportsIdentityHealthSnapshot }) {
  return (
    <AccordionSection title="Sports OS Identity & Image Health" eyebrow="cached data quality">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard item={{ label: "Sports audited", value: snapshot.summary.sportsAudited, tracked: true }} />
        <MetricCard item={{ label: "Total players", value: snapshot.summary.totalPlayers, tracked: true }} />
        <MetricCard item={{ label: "Identity problems", value: snapshot.summary.identityProblems, tracked: true }} />
        <MetricCard item={{ label: "Image/logo problems", value: snapshot.summary.imageProblems, tracked: true }} />
        <MetricCard item={{ label: "Provider mapping problems", value: snapshot.summary.providerMappingProblems, tracked: true }} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/25 p-4">
          <h3 className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/75">Identity coverage</h3>
          <table className="mt-3 w-full min-w-[1280px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-[0.16em] text-white/42">
              <tr>
                <th className="py-2 pr-3">Sport</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Players</th>
                <th className="py-2 pr-3">Teams</th>
                <th className="py-2 pr-3">Provider ID gaps</th>
                <th className="py-2 pr-3">No team</th>
                <th className="py-2 pr-3">No position</th>
                <th className="py-2 pr-3">Duplicate names</th>
                <th className="py-2 pr-3">Duplicate teams</th>
                <th className="py-2 pr-3">Unmapped players</th>
                <th className="py-2 pr-3">Unmapped teams</th>
                <th className="py-2 pr-3">Inactive/unknown</th>
                <th className="py-2 pr-3">Team mismatch</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {snapshot.rows.map((row) => (
                <tr key={row.id} className="align-top text-white/70">
                  <td className="py-3 pr-3 font-black text-white">{row.label}</td>
                  <td className="py-3 pr-3">
                    <span className={`rounded-full border px-2 py-1 text-[10px] font-black ${identityStatusClass(row.status)}`}>
                      {identityStatusLabel(row.status)}
                    </span>
                  </td>
                  <td className="py-3 pr-3">{row.playerCount}</td>
                  <td className="py-3 pr-3">{row.teamCount}</td>
                  <td className="py-3 pr-3">{row.playersMissingProviderIds}</td>
                  <td className="py-3 pr-3">{row.playersMissingTeam}</td>
                  <td className="py-3 pr-3">{row.playersMissingPosition}</td>
                  <td className="py-3 pr-3">{row.duplicatePlayerNameGroups}</td>
                  <td className="py-3 pr-3">{row.duplicateTeamIdentityGroups}</td>
                  <td className="py-3 pr-3">{row.unmappedProviderPlayers}</td>
                  <td className="py-3 pr-3">{row.unmappedProviderTeams}</td>
                  <td className="py-3 pr-3">{row.inactiveOrUnknownPlayers}</td>
                  <td className="py-3 pr-3">{row.teamMappingMismatches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/25 p-4">
          <h3 className="text-xs font-black uppercase tracking-[0.16em] text-amber-100/75">Image / logo coverage</h3>
          <table className="mt-3 w-full min-w-[760px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-[0.16em] text-white/42">
              <tr>
                <th className="py-2 pr-3">Sport</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Missing headshots</th>
                <th className="py-2 pr-3">Missing logos</th>
                <th className="py-2 pr-3">Duplicate heads</th>
                <th className="py-2 pr-3">Duplicate logos</th>
                <th className="py-2 pr-3">Bad URL pattern</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {snapshot.imageRows.map((row) => (
                <tr key={row.id} className="align-top text-white/70">
                  <td className="py-3 pr-3 font-black text-white">{row.label}</td>
                  <td className="py-3 pr-3">
                    <span className={`rounded-full border px-2 py-1 text-[10px] font-black ${identityStatusClass(row.status)}`}>
                      {identityStatusLabel(row.status)}
                    </span>
                  </td>
                  <td className="py-3 pr-3">{row.playersMissingHeadshots}</td>
                  <td className="py-3 pr-3">{row.teamsMissingLogos}</td>
                  <td className="py-3 pr-3">{row.duplicateHeadshotGroups}</td>
                  <td className="py-3 pr-3">{row.duplicateLogoGroups}</td>
                  <td className="py-3 pr-3">{row.invalidHeadshotUrlPatterns + row.invalidLogoUrlPatterns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.04] p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/75">Provider mapping counts</h3>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-white/48">
              Cached rows only. This panel compares stored provider player/team rows against canonical identity and team metadata without remote image or provider checks.
            </p>
          </div>
          <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-cyan-100">
            {snapshot.providerRows.length} provider sport maps
          </span>
        </div>
        {snapshot.providerRows.length > 0 ? (
          <table className="mt-3 w-full min-w-[1180px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-[0.16em] text-white/42">
              <tr>
                <th className="py-2 pr-3">Sport</th>
                <th className="py-2 pr-3">Provider</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Provider players</th>
                <th className="py-2 pr-3">Mapped IDs</th>
                <th className="py-2 pr-3">Unmapped players</th>
                <th className="py-2 pr-3">Provider teams</th>
                <th className="py-2 pr-3">Mapped teams</th>
                <th className="py-2 pr-3">Unmapped teams</th>
                <th className="py-2 pr-3">Duplicate player IDs</th>
                <th className="py-2 pr-3">Duplicate team IDs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {snapshot.providerRows.map((row) => (
                <tr key={row.id} className="align-top text-white/70">
                  <td className="py-3 pr-3 font-black text-white">{row.label}</td>
                  <td className="py-3 pr-3">{row.provider}</td>
                  <td className="py-3 pr-3">
                    <span className={`rounded-full border px-2 py-1 text-[10px] font-black ${identityStatusClass(row.status)}`}>
                      {identityStatusLabel(row.status)}
                    </span>
                  </td>
                  <td className="py-3 pr-3">{row.providerPlayerRows}</td>
                  <td className="py-3 pr-3">{row.mappedPlayerIds}</td>
                  <td className="py-3 pr-3">{row.unmappedProviderPlayers}</td>
                  <td className="py-3 pr-3">{row.providerTeamRows}</td>
                  <td className="py-3 pr-3">{row.mappedTeamRows}</td>
                  <td className="py-3 pr-3">{row.unmappedProviderTeams}</td>
                  <td className="py-3 pr-3">{row.duplicatePlayerMappingGroups}</td>
                  <td className="py-3 pr-3">{row.duplicateTeamMappingGroups}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-3 rounded-xl border border-white/10 bg-black/25 p-4 text-sm text-white/50">
            Provider mapping counts are not tracked yet for cached identity rows.
          </p>
        )}
      </div>

      <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/[0.08] p-4">
        <h3 className="text-xs font-black uppercase tracking-[0.16em] text-amber-100/85">Top data quality problems</h3>
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {snapshot.topProblems.length > 0 ? snapshot.topProblems.map((problem) => (
            <div key={problem.id} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white/65">
              <div className="flex items-center justify-between gap-3">
                <span className="font-black text-white">{problem.label}</span>
                <span className={`rounded-full border px-2 py-1 text-[10px] font-black ${identityStatusClass(problem.severity === "low" ? "ready" : "partial")}`}>
                  {problem.severity}
                </span>
              </div>
              <div className="mt-2">{problem.message} Count: {problem.count}.</div>
              <div className="mt-1 text-cyan-100/58">{problem.recommendation}</div>
            </div>
          )) : (
            <p className="rounded-xl border border-white/10 bg-black/25 p-4 text-sm text-white/50">
              No identity/image data quality problems detected from cached metadata.
            </p>
          )}
        </div>
      </div>
    </AccordionSection>
  )
}

type ReconStatus = "ready" | "partial" | "critical"

function reconStatusClass(status: ReconStatus) {
  if (status === "ready") return "border-emerald-300/35 bg-emerald-300/10 text-emerald-100"
  if (status === "partial") return "border-amber-300/35 bg-amber-300/10 text-amber-100"
  return "border-rose-300/35 bg-rose-300/10 text-rose-100"
}

function reconStatusLabel(status: ReconStatus): string {
  if (status === "ready") return "Ready"
  if (status === "partial") return "Partial"
  return "Critical"
}

function deriveReconStatus(row: ProviderTeamReconciliationSummary): ReconStatus {
  if (row.coveredPct >= 98 && row.ambiguous === 0 && row.duplicate === 0) return "ready"
  if (row.coveredPct >= 85) return "partial"
  return "critical"
}

function ProviderTeamReconciliationPanel({
  data,
}: {
  data: { summaries: ProviderTeamReconciliationSummary[]; totalProblems: number; generatedAt: string }
}) {
  const { summaries, totalProblems } = data
  const readyCount = summaries.filter((s) => deriveReconStatus(s) === "ready").length
  const partialCount = summaries.filter((s) => deriveReconStatus(s) === "partial").length
  const criticalCount = summaries.filter((s) => deriveReconStatus(s) === "critical").length

  return (
    <AccordionSection
      title="Provider Team Reconciliation"
      eyebrow="cached data quality · fuzzy match"
      defaultOpen={false}
    >
      <div className="mb-4 rounded-2xl border border-white/10 bg-black/25 p-4 text-xs text-white/58 leading-5">
        Fuzzy-match reconciliation of{" "}
        <span className="font-black text-white">SportsTeam</span> provider rows against canonical{" "}
        <span className="font-black text-white">TeamAsset</span> and{" "}
        <span className="font-black text-white">WorldCupTeam</span> tables. Uses 6-tier matching (exact code →
        alias → full name → normalized → city → word overlap). Unlike the raw identity health counts above, this
        view shows{" "}
        <span className="font-bold text-cyan-200">true unmapped teams</span> after alias resolution — a much
        smaller real-blocker count.{" "}
        <a
          href="/api/admin/sports/provider-team-reconciliation"
          className="text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
        >
          Full drilldown JSON ↗
        </a>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard item={{ label: "Sport/provider pairs", value: summaries.length, tracked: true }} />
        <MetricCard item={{ label: "True problems", value: totalProblems, tracked: true, note: "Ambiguous + unmapped + duplicate after fuzzy match" }} />
        <MetricCard item={{ label: "Ready pairs", value: readyCount, tracked: true, note: "≥98% covered, no ambiguous/duplicate" }} />
        <MetricCard item={{ label: "Partial pairs", value: partialCount, tracked: true, note: "≥85% covered" }} />
        <MetricCard item={{ label: "Critical pairs", value: criticalCount, tracked: true, note: "<85% covered" }} />
      </div>

      {summaries.length === 0 ? (
        <p
          data-testid="recon-empty-state"
          className="mt-4 rounded-xl border border-white/10 bg-black/25 p-4 text-sm text-white/50"
        >
          No SportsTeam provider rows found. Provider team sync has not run yet, or all sports use World Cup-specific
          tables.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/25 p-4">
          <h3 className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/75">
            Summary by sport / provider
          </h3>
          <table className="mt-3 w-full min-w-[1100px] text-left text-xs" data-testid="recon-summary-table">
            <thead className="text-[10px] uppercase tracking-[0.16em] text-white/42">
              <tr>
                <th className="py-2 pr-3">Sport</th>
                <th className="py-2 pr-3">Provider</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Total</th>
                <th className="py-2 pr-3">Mapped</th>
                <th className="py-2 pr-3">Probable</th>
                <th className="py-2 pr-3">Ambiguous</th>
                <th className="py-2 pr-3">Unmapped</th>
                <th className="py-2 pr-3">Duplicate</th>
                <th className="py-2 pr-3">Mapped %</th>
                <th className="py-2 pr-3">Covered %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {summaries.map((row) => {
                const status = deriveReconStatus(row)
                return (
                  <tr key={`${row.sport}|${row.provider}`} className="align-top text-white/70">
                    <td className="py-3 pr-3 font-black text-white">{row.sport}</td>
                    <td className="py-3 pr-3">{row.provider}</td>
                    <td className="py-3 pr-3">
                      <span
                        className={`rounded-full border px-2 py-1 text-[10px] font-black ${reconStatusClass(status)}`}
                        data-testid={`recon-status-${row.sport}-${row.provider}`}
                      >
                        {reconStatusLabel(status)}
                      </span>
                    </td>
                    <td className="py-3 pr-3">{row.totalProviderTeams}</td>
                    <td className="py-3 pr-3 text-emerald-300/90">{row.mapped}</td>
                    <td className="py-3 pr-3 text-cyan-300/80">{row.probableMatch}</td>
                    <td className={`py-3 pr-3 ${row.ambiguous > 0 ? "font-bold text-amber-300" : ""}`}>
                      {row.ambiguous}
                    </td>
                    <td className={`py-3 pr-3 ${row.unmapped > 0 ? "font-bold text-rose-300" : ""}`}>
                      {row.unmapped}
                    </td>
                    <td className={`py-3 pr-3 ${row.duplicate > 0 ? "font-bold text-amber-300" : ""}`}>
                      {row.duplicate}
                    </td>
                    <td className="py-3 pr-3">{row.mappedPct}%</td>
                    <td className={`py-3 pr-3 font-black ${row.coveredPct >= 98 ? "text-emerald-300" : row.coveredPct >= 85 ? "text-amber-300" : "text-rose-300"}`}>
                      {row.coveredPct}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 rounded-2xl border border-white/10 bg-black/25 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-xs font-black uppercase tracking-[0.16em] text-amber-100/75">
            Drilldown — unmapped &amp; ambiguous
          </h3>
          <a
            href="/api/admin/sports/provider-team-reconciliation"
            className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1 text-[10px] font-black text-amber-100 hover:bg-amber-300/15"
          >
            topUnmapped + topAmbiguous JSON ↗
          </a>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-white/48">
          The JSON endpoint includes up to 50 topUnmapped rows (the real gaps to fix) and up to 20 topAmbiguous
          rows (need alias or manual mapping). Add aliases to{" "}
          <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-cyan-200/80">lib/team-abbrev.ts</code>{" "}
          or a new TeamAsset row to clear ambiguous and unmapped counts.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-rose-300/80">
              Fix unmapped first
            </div>
            <p className="mt-2 text-[11px] leading-4 text-white/55">
              Each unmapped row has no canonical match even after alias resolution. Usually means the provider
              uses a different abbreviation, name format, or the TeamAsset row is missing entirely.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-300/80">
              Then fix ambiguous
            </div>
            <p className="mt-2 text-[11px] leading-4 text-white/55">
              Ambiguous rows matched 2+ canonical teams. Pick the correct canonical and add an alias or exact
              code to collapse it to a single mapped result.
            </p>
          </div>
        </div>
      </div>
    </AccordionSection>
  )
}

function ProviderHealthPanel({ rows }: { rows: AdminProviderHealthRow[] }) {
  return (
    <section className="rounded-3xl border border-cyan-300/15 bg-white/[0.04] p-4 shadow-[0_24px_80px_-54px_rgba(34,211,238,0.75)] sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan-100/80">
            Provider Health & Cost Guards
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-white/48">
            Env readiness, stored data, request telemetry, sync state, and call-limit protection. This view does not call paid providers.
          </p>
        </div>
        <span className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.08] px-3 py-2 text-xs font-black text-amber-100">
          {rows.length} providers
        </span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[1180px] text-left text-xs">
          <thead className="text-[10px] uppercase tracking-[0.16em] text-white/42">
            <tr>
              <th className="py-2 pr-3">Provider</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Data / Consumers</th>
              <th className="py-2 pr-3">Storage</th>
              <th className="py-2 pr-3">Requests</th>
              <th className="py-2 pr-3">Sync</th>
              <th className="py-2 pr-3">Cost Protection</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {rows.map((row) => (
              <tr key={row.id} className="align-top text-white/70">
                <td className="max-w-[210px] py-4 pr-3">
                  <div className="font-black text-white">{row.name}</div>
                  <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-100/45">
                    {row.category}
                  </div>
                  <div className="mt-2 text-[11px] text-white/38">
                    Env: {joinList(row.envVars, "No env required")}
                  </div>
                </td>
                <td className="py-4 pr-3">
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-black ${providerStatusClass(row.status)}`}>
                    {providerStatusLabel(row.status)}
                  </span>
                  <div className="mt-2 max-w-[210px] text-[11px] leading-4 text-white/45">
                    {row.note}
                  </div>
                </td>
                <td className="max-w-[240px] py-4 pr-3">
                  <div className="font-bold text-white/80">{joinList(row.dataCategories)}</div>
                  <div className="mt-2 text-[11px] text-white/45">Used by: {joinList(row.consumedBy)}</div>
                </td>
                <td className="max-w-[210px] py-4 pr-3">
                  <div className="font-bold text-white/75">{joinList(row.storage)}</div>
                  <div className="mt-2 text-[11px] text-white/45">
                    Imported rows: {row.importedRows ?? "Not tracked yet"}
                  </div>
                </td>
                <td className="py-4 pr-3">
                  <div className="font-black text-white">{row.requestCount24h ?? 0} / 24h</div>
                  <div className="mt-1 text-[11px] text-white/45">
                    Avg latency: {row.avgLatencyMs24h == null ? "Not tracked" : `${row.avgLatencyMs24h}ms`}
                  </div>
                  <div className="mt-1 text-[11px] text-white/45">{row.rateLimit}</div>
                </td>
                <td className="max-w-[180px] py-4 pr-3">
                  <div className="font-bold text-white/75">{formatDate(row.lastSyncAt)}</div>
                  {row.lastError ? (
                    <div className="mt-2 rounded-xl border border-rose-300/25 bg-rose-300/10 p-2 text-[11px] text-rose-100">
                      {row.lastError}
                    </div>
                  ) : (
                    <div className="mt-2 text-[11px] text-white/40">No recent stored error</div>
                  )}
                </td>
                <td className="max-w-[240px] py-4 pr-3">
                  <div className="text-[11px] leading-5 text-white/55">{joinList(row.costProtection)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function formatCount(value: number | null) {
  return value == null ? "Not tracked yet" : value.toLocaleString("en-US")
}

function SportDataReliabilityPanel({ rows }: { rows: AdminSportDataReliabilityRow[] }) {
  return (
    <section className="rounded-3xl border border-cyan-300/15 bg-white/[0.04] p-4 shadow-[0_24px_80px_-54px_rgba(34,211,238,0.75)] sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan-100/80">
            Per-Sport Data Reliability
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-white/48">
            Neon-backed import counts by sport. Missing rows mean Chimmy and user pages must refuse exact facts or show an unavailable state.
          </p>
        </div>
        <span className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.08] px-3 py-2 text-xs font-black text-cyan-100">
          {rows.length} sports
        </span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[1120px] text-left text-xs">
          <thead className="text-[10px] uppercase tracking-[0.16em] text-white/42">
            <tr>
              <th className="py-2 pr-3">Sport</th>
              <th className="py-2 pr-3">Imported</th>
              <th className="py-2 pr-3">AI-Critical</th>
              <th className="py-2 pr-3">Last Sync</th>
              <th className="py-2 pr-3">Providers</th>
              <th className="py-2 pr-3">Warnings</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {rows.map((row) => (
              <tr key={row.id} className="align-top text-white/70">
                <td className="max-w-[180px] py-4 pr-3">
                  <div className="font-black text-white">{row.label}</div>
                  <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-100/45">
                    {row.sport}
                  </div>
                  <div className="mt-2 text-[11px] text-white/40">{row.note}</div>
                </td>
                <td className="py-4 pr-3">
                  <div>Teams: <b>{formatCount(row.counts.teams)}</b></div>
                  <div>Players: <b>{formatCount(row.counts.players)}</b></div>
                  <div>Schedules: <b>{formatCount(row.counts.schedules)}</b></div>
                  <div>Games: <b>{formatCount(row.counts.games)}</b></div>
                  <div>Live scores: <b>{formatCount(row.counts.liveScores)}</b></div>
                </td>
                <td className="py-4 pr-3">
                  <div>Standings: <b>{formatCount(row.counts.standings)}</b></div>
                  <div>Injuries: <b>{formatCount(row.counts.injuries)}</b></div>
                  <div>News: <b>{formatCount(row.counts.news)}</b></div>
                  <div>Player stats: <b>{formatCount(row.counts.playerStats)}</b></div>
                </td>
                <td className="max-w-[210px] py-4 pr-3 text-[11px] leading-5 text-white/50">
                  {Object.entries(row.lastSyncAtByType).map(([key, value]) => (
                    <div key={key}>
                      {key}: <span className="text-white/75">{formatDate(value)}</span>
                    </div>
                  ))}
                </td>
                <td className="max-w-[220px] py-4 pr-3">
                  <div className="font-bold text-emerald-100">
                    Configured: {joinList(row.configuredProviders, "None")}
                  </div>
                  <div className="mt-2 text-[11px] text-amber-100/85">
                    Missing: {joinList(row.missingProviders, "None")}
                  </div>
                </td>
                <td className="max-w-[240px] py-4 pr-3">
                  {row.staleWarnings.length > 0 ? (
                    <div className="space-y-1">
                      {row.staleWarnings.map((warning) => (
                        <div key={warning} className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-2 py-1 text-[11px] text-amber-100">
                          {warning}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2.5 py-1 text-[11px] font-black text-emerald-100">
                      No stored warnings
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function importStatusLabel(status: SportImportStatus) {
  switch (status) {
    case "active_importer":
      return "Active importer"
    case "partial_importer":
      return "Partial importer"
    case "cached_only":
      return "Cached only"
    case "provider_available_no_importer":
      return "Provider, no importer"
    default:
      return "Not tracked yet"
  }
}

function importStatusClass(status: SportImportStatus) {
  if (status === "active_importer") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
  if (status === "cached_only") return "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
  if (status === "partial_importer") return "border-amber-300/30 bg-amber-300/10 text-amber-100"
  if (status === "provider_available_no_importer") return "border-fuchsia-300/25 bg-fuchsia-300/10 text-fuchsia-100"
  return "border-white/10 bg-white/[0.05] text-white/45"
}

function SportImportMatrixPanel({ rows }: { rows: SportImportMatrixRow[] }) {
  const columns = [
    "teams",
    "players",
    "schedules",
    "liveScores",
    "standings",
    "injuries",
    "news",
    "playerStats",
    "projectionsRankings",
    "odds",
  ] as const

  return (
    <section className="rounded-3xl border border-cyan-300/15 bg-white/[0.04] p-4 shadow-[0_24px_80px_-54px_rgba(34,211,238,0.75)] sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan-100/80">
            Sports Import Matrix
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-white/48">
            Exact data-type readiness for sports pages and Chimmy. Provider calls belong to admin/cron sync only.
          </p>
        </div>
        <span className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.08] px-3 py-2 text-xs font-black text-amber-100">
          cache-first
        </span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[1320px] text-left text-xs">
          <thead className="text-[10px] uppercase tracking-[0.16em] text-white/42">
            <tr>
              <th className="py-2 pr-3">Sport</th>
              {columns.map((key) => (
                <th key={key} className="py-2 pr-3">{rows[0]?.cells[key].label ?? key}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {rows.map((row) => (
              <tr key={row.id} className="align-top text-white/70">
                <td className="max-w-[150px] py-4 pr-3">
                  <div className="font-black text-white">{row.label}</div>
                  <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-100/45">{row.sport}</div>
                </td>
                {columns.map((key) => {
                  const cell = row.cells[key]
                  return (
                    <td key={key} className="max-w-[150px] py-4 pr-3">
                      <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-black ${importStatusClass(cell.status)}`}>
                        {importStatusLabel(cell.status)}
                      </span>
                      <div className="mt-2 font-black text-white">{cell.count == null ? "Not tracked" : cell.count.toLocaleString("en-US")}</div>
                      <div className="mt-1 text-[11px] text-white/42">{formatDate(cell.lastSyncedAt)}</div>
                      {cell.stale ? <div className="mt-1 text-[11px] font-bold text-amber-100">Stale</div> : null}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function toolStatusLabel(status: DashboardAiToolStatus) {
  if (status === "active") return "Active"
  if (status === "preview") return "Preview"
  if (status === "coming_soon") return "Coming soon"
  return "Missing data"
}

function toolStatusClass(status: DashboardAiToolStatus) {
  if (status === "active") return "border-emerald-300/35 bg-emerald-300/10 text-emerald-100"
  if (status === "preview") return "border-amber-300/35 bg-amber-300/10 text-amber-100"
  if (status === "coming_soon") return "border-white/15 bg-white/[0.06] text-white/55"
  return "border-rose-300/35 bg-rose-300/10 text-rose-100"
}

function AiToolAvailabilityPanel({ rows }: { rows: DashboardAiToolAvailability[] }) {
  return (
    <section className="rounded-3xl border border-cyan-300/15 bg-white/[0.04] p-4 shadow-[0_24px_80px_-54px_rgba(34,211,238,0.75)] sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan-100/80">
            Dashboard AI Tool Availability
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-white/48">
            Tools should charge tokens only when the supporting cached data exists or the route can provide a safe deterministic answer.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {rows.map((row) => (
          <div key={row.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="font-black text-white">{row.label}</div>
              <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-black ${toolStatusClass(row.status)}`}>
                {toolStatusLabel(row.status)}
              </span>
            </div>
            <div className="mt-2 text-[11px] leading-4 text-white/48">{row.note}</div>
            <div className="mt-3 text-[11px] text-cyan-100/75">Last sync: {formatDate(row.lastSyncedAt)}</div>
            <div className="mt-2 text-[11px] text-white/50">
              Sports: {row.supportedSports.length > 0 ? row.supportedSports.join(", ") : "None ready"}
            </div>
            <div className="mt-2 text-[11px] text-amber-100/80">
              Missing: {row.missingData.length > 0 ? row.missingData.join(", ") : "No critical gaps"}
            </div>
            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-bold text-white/58">
              {row.requiredAccess}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function AdminSportsSyncControlsPanel() {
  return (
    <section className="rounded-3xl border border-amber-300/15 bg-white/[0.04] p-4 shadow-[0_24px_80px_-54px_rgba(251,191,36,0.65)] sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-amber-100/80">
            Admin Sports Sync Controls
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-white/48">
            Admin-only route for controlled imports. Use dry-run before expensive syncs; public pages never trigger these provider calls.
          </p>
        </div>
        <a
          href="/api/admin/sports/sync"
          className="rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100 hover:bg-cyan-300/15"
        >
          Status JSON
        </a>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {[
          { label: "Schedules", body: '{ "type": "schedules", "sports": ["NFL","NBA"], "dryRun": true }' },
          { label: "Injuries", body: '{ "type": "injuries", "sports": ["NFL","NCAAF"], "dryRun": true }' },
          { label: "News / players", body: '{ "type": "all", "sports": ["MLB","NHL"], "dryRun": true }' },
          { label: "Identity health", body: '{ "type": "identity_health", "dryRun": false }' },
          { label: "Image audit", body: '{ "type": "image_audit", "dryRun": false }' },
          { label: "Fantasy value", body: '{ "type": "fantasy_value_snapshots", "dryRun": false }' },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="text-xs font-black uppercase tracking-[0.14em] text-amber-100/80">{item.label}</div>
            <code className="mt-3 block whitespace-pre-wrap rounded-xl border border-white/10 bg-black/35 p-3 text-[11px] leading-5 text-cyan-100/75">
              POST /api/admin/sports/sync{"\n"}{item.body}
            </code>
          </div>
        ))}
      </div>
    </section>
  )
}

function AdminAccessDenied() {
  return (
    <main className="min-h-dvh bg-[#020817] px-4 py-8 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(34,211,238,0.20),transparent_34%),radial-gradient(circle_at_85%_8%,rgba(251,191,36,0.14),transparent_30%),linear-gradient(180deg,#020817_0%,#06111f_48%,#020817_100%)]" />
      <section className="relative mx-auto max-w-xl rounded-3xl border border-amber-300/20 bg-black/45 p-6 shadow-[0_28px_90px_-54px_rgba(251,191,36,0.75)] backdrop-blur-xl sm:p-8">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-amber-200">
          Admin Access
        </p>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-white">
          Access denied
        </h1>
        <p className="mt-3 text-sm leading-6 text-white/62">
          You are signed in, but this account is not on the AllFantasy admin allowlist.
          Ask an existing admin to add your email to `ADMIN_EMAILS`, or use the bootstrap recovery path if you are the founder.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href="/dashboard"
            className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-black text-white hover:border-cyan-300/45"
          >
            Back to dashboard
          </a>
          <a
            href="/admin/bootstrap"
            className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 hover:bg-cyan-200"
          >
            Admin recovery
          </a>
        </div>
      </section>
    </main>
  )
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: { q?: string | string[] }
}) {
  const gate = await getAdminAccessState()
  if (gate.status === "unauthenticated") {
    redirect("/admin-login?next=/admin")
  }
  if (gate.status === "forbidden") {
    return <AdminAccessDenied />
  }

  const q = Array.isArray(searchParams?.q) ? searchParams?.q[0] ?? "" : searchParams?.q ?? ""
  let data: AdminCommandCenterMetrics
  try {
    data = await getAdminCommandCenterMetrics(q)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown admin data failure"
    return <AdminPageLoadFailure message={message} />
  }

  return (
    <main className="min-h-dvh bg-[#020817] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(34,211,238,0.20),transparent_34%),radial-gradient(circle_at_85%_8%,rgba(251,191,36,0.14),transparent_30%),linear-gradient(180deg,#020817_0%,#06111f_46%,#020817_100%)]" />
      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-cyan-300/15 bg-black/35 p-5 shadow-[0_28px_90px_-54px_rgba(34,211,238,0.85)] backdrop-blur-xl sm:p-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-200">AllFantasy Admin</p>
                <DeploymentMarker />
              </div>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-5xl">
                Command Center
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-white/62">
                Production metrics from existing AllFantasy tables. Unavailable metrics are labeled instead of estimated.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:flex-col lg:items-end">
              <a
                href="/dashboard"
                data-testid="admin-exit-button"
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-cyan-200/35 bg-gradient-to-r from-cyan-300 to-sky-300 px-4 py-2 text-sm font-black text-slate-950 shadow-[0_12px_34px_-18px_rgba(34,211,238,0.95)] transition hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
              >
                Exit Admin / Back to App
              </a>
              <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.08] px-4 py-3 text-sm font-bold text-amber-100">
                Generated {new Date(data.generatedAt).toLocaleString("en-US", { timeZone: "America/New_York" })}
              </div>
            </div>
          </div>
        </header>

        <AdminOverviewDeck data={data} accessSource={gate.source} />

        <Section id="morning-dashboard" title="Morning Dashboard" items={data.morning} />
        <Section title="Users" items={data.users} />
        <Section title="Payments & Subscriptions" items={data.subscriptions} />
        <Section title="Tokens & AI" items={[...data.tokens, ...data.ai]} />
        <Section title="World Cup" items={data.worldCup} />
        <Section title="System Health" items={data.health} />
        <div id="production-readiness">
          <ProductionReadinessPanel data={data.productionReadiness} />
        </div>
        <TrafficGeoPanel data={data.productionReadiness} metrics={data.traffic} />
        <div id="social-campaigns">
          <AccordionSection title="Social & Campaigns" eyebrow="attribution">
            <CampaignAttributionPanel />
          </AccordionSection>
        </div>
        <div id="beta-invites">
          <AccordionSection title="Closed-Beta Invitations" eyebrow="access">
            <BetaInvitePanel />
          </AccordionSection>
        </div>
        <EmailCenterPanel status={data.emailStatus} />
        <div id="sports-os">
          <SportsOperatingSystemPanel audit={data.sportsOperatingSystem} />
        </div>
        <SportsIdentityHealthPanel snapshot={data.sportsIdentityHealth} />
        <ProviderTeamReconciliationPanel data={data.providerTeamReconciliation} />
        <Section title="Integrity / Fraud Signals" items={data.integrity} />
        <Section title="Admin Data Quality" items={data.dataQuality} />
        <AccordionSection id="provider-health" title="Sports API Health" eyebrow="providers" defaultOpen={false}>
          <ProviderHealthPanel rows={data.providerHealth ?? []} />
        </AccordionSection>
        <AccordionSection title="Sports Data Freshness" eyebrow="per-sport cache" defaultOpen={false}>
          <SportDataReliabilityPanel rows={data.sportDataReliability ?? []} />
        </AccordionSection>
        <AccordionSection title="Provider Sync / Import Matrix" eyebrow="cache-first imports" defaultOpen={false}>
          <SportImportMatrixPanel rows={data.sportImportMatrix ?? []} />
        </AccordionSection>
        <AccordionSection title="AI Tool Availability" eyebrow="paid tool safety" defaultOpen={false}>
          <AiToolAvailabilityPanel rows={data.aiToolAvailability ?? []} />
        </AccordionSection>
        <AccordionSection title="Provider Sync Controls" eyebrow="admin manual imports" defaultOpen={false}>
          <AdminSportsSyncControlsPanel />
        </AccordionSection>
        <div id="ai-panels" className="grid gap-4 xl:grid-cols-2">
          <AccordionSection title="AI Provider Health" eyebrow="interaction stats + WC provider" defaultOpen={false}>
            <AiProviderHealthPanel />
          </AccordionSection>
          <AccordionSection title="AI Audit Logs" eyebrow="validator + cost monitoring" defaultOpen={false}>
            <AiAuditLogsPanel />
          </AccordionSection>
        </div>
        <AccordionSection
          id="platform-os"
          title="Platform OS"
          eyebrow="Decision OS — explicit league aggregation"
          defaultOpen={false}
        >
          <PlatformOsOperatorPanel />
        </AccordionSection>

        <section id="user-search" className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.75fr)]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 shadow-[0_20px_70px_-52px_rgba(34,211,238,0.7)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan-100/80">User Search</h2>
                <p className="mt-1 text-xs text-white/45">Masked email, subscription, token balance, and World Cup activity.</p>
              </div>
              <form action="/admin" className="flex min-w-0 gap-2">
                <input
                  name="q"
                  defaultValue={q}
                  placeholder="Search username or email"
                  className="min-h-11 min-w-0 rounded-2xl border border-white/10 bg-black/35 px-4 text-sm font-semibold text-white outline-none placeholder:text-white/35 focus:border-cyan-300/60"
                />
                <button className="min-h-11 rounded-2xl bg-cyan-300 px-4 text-sm font-black text-black">
                  Search
                </button>
              </form>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="text-[11px] uppercase tracking-[0.16em] text-white/45">
                  <tr>
                    <th className="py-2 pr-3">User</th>
                    <th className="py-2 pr-3">Email</th>
                    <th className="py-2 pr-3">Sub</th>
                    <th className="py-2 pr-3">Tokens</th>
                    <th className="py-2 pr-3">WC</th>
                    <th className="py-2 pr-3">Signed up</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {data.usersSearch.length > 0 ? (
                    data.usersSearch.map((user) => (
                      <tr key={user.id} className="text-white/76">
                        <td className="py-3 pr-3">
                          <div className="font-black text-white">@{user.username}</div>
                          {user.displayName && user.displayName !== user.username ? (
                            <div className="text-xs text-white/40">{user.displayName}</div>
                          ) : null}
                        </td>
                        <td className="py-3 pr-3">{user.emailMasked}</td>
                        <td className="py-3 pr-3">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${subStatusClass(user.subscriptionStatus)}`}>
                            {user.subscriptionStatus}
                          </span>
                        </td>
                        <td className="py-3 pr-3">{user.tokenBalance ?? "—"}</td>
                        <td className="py-3 pr-3">
                          <div className="text-xs">{user.worldCupEntries} entries</div>
                          <div className="text-xs text-white/45">{user.worldCupPoolsCreated} pools</div>
                        </td>
                        <td className="py-3 text-xs text-white/55">{formatDate(user.createdAt)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="py-5 text-white/45" colSpan={6}>
                        Enter at least two characters to search users.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 shadow-[0_20px_70px_-52px_rgba(251,191,36,0.55)]">
            <h2 className="text-sm font-black uppercase tracking-[0.18em] text-amber-100/80">Most Active World Cup Pools</h2>
            <div className="mt-4 space-y-3">
              {data.activeWorldCupPools.length > 0 ? (
                data.activeWorldCupPools.map((pool) => (
                  <div key={pool.id} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                    <div className="font-black text-white">{pool.name}</div>
                    <div className="mt-1 text-xs text-white/45">Owner @{pool.ownerUsername ?? "unknown"}</div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs font-bold text-white/70">
                      <span className="rounded-xl bg-white/[0.06] px-2 py-2">{pool.entries} entries</span>
                      <span className="rounded-xl bg-white/[0.06] px-2 py-2">{pool.participants} players</span>
                      <span className="rounded-xl bg-white/[0.06] px-2 py-2">{pool.chatEvents} chat</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-white/50">
                  No World Cup pool activity recorded yet.
                </p>
              )}
            </div>
          </div>
        </section>

        {/*
          ── Early-access waitlist ──────────────────────────────────────────
          The list was never lost, only never shown: EarlyAccessSignup has been
          collecting since April and nothing in this panel read it, so the only
          way to know it existed was to query the database directly.

          ⚠ CONFIRMED AND UNCONFIRMED ARE REPORTED SEPARATELY, ON PURPOSE. A
          signup that never confirmed is a weaker consent signal than one that
          did. Showing a single total invites reading "N signups" as "N people
          who opted in", which is the number that matters if this list is ever
          emailed — and emailing people who never confirmed is how a sending
          domain gets burned.

          ⚠ READ ONLY. There is no send button here by design. Bulk email to a
          months-old list is one-way and belongs behind an explicit decision
          about recipients and copy, not a click on a dashboard.
        */}
        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 shadow-[0_20px_70px_-52px_rgba(34,211,238,0.7)]">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan-100/80">
              Early-access waitlist
            </h2>
            <span className="text-[11px] text-white/45">
              {data.waitlist.firstAt ? (
                <>
                  {formatDate(data.waitlist.firstAt)} &rarr; {formatDate(data.waitlist.lastAt ?? data.waitlist.firstAt)}
                </>
              ) : (
                "no signups yet"
              )}
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <div className="text-2xl font-black text-white">{data.waitlist.total}</div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-white/45">Total signups</div>
            </div>
            <div className="rounded-2xl border border-emerald-300/20 bg-black/25 p-3">
              <div className="text-2xl font-black text-emerald-300">{data.waitlist.confirmed}</div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-white/45">Confirmed</div>
            </div>
            <div className="rounded-2xl border border-amber-300/20 bg-black/25 p-3">
              <div className="text-2xl font-black text-amber-300">{data.waitlist.unconfirmed}</div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-white/45">Never confirmed</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <div className="text-2xl font-black text-white">{data.waitlist.last30Days}</div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-white/45">Last 30 days</div>
            </div>
          </div>

          {/* How old the list is, at a glance — a dormant list and a growing one
              call for completely different decisions. */}
          {data.waitlist.byMonth.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {data.waitlist.byMonth.map((m) => (
                <span
                  key={m.month}
                  className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[11px] text-white/70"
                >
                  {m.month} &middot; <span className="font-black text-white">{m.count}</span>
                </span>
              ))}
            </div>
          ) : null}

          {(data.waitlist.bySource.length > 0 || data.waitlist.byUtmSource.length > 0) ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <div className="text-[10px] uppercase tracking-[0.16em] text-white/45">By source</div>
                <ul className="mt-2 space-y-1 text-sm text-white/70">
                  {data.waitlist.bySource.map((r) => (
                    <li key={r.source} className="flex justify-between gap-3">
                      <span className="truncate">{r.source}</span>
                      <span className="font-black text-white">{r.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.16em] text-white/45">By UTM source</div>
                <ul className="mt-2 space-y-1 text-sm text-white/70">
                  {data.waitlist.byUtmSource.map((r) => (
                    <li key={r.source} className="flex justify-between gap-3">
                      <span className="truncate">{r.source}</span>
                      <span className="font-black text-white">{r.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-[0.16em] text-white/45">
                <tr>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Confirmed</th>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3">Campaign</th>
                  <th className="py-2 pr-3">Signed up</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {data.waitlist.recent.length > 0 ? (
                  data.waitlist.recent.map((row) => (
                    <tr key={row.email} className="text-white/76">
                      {/* Full address, not masked: the operator deciding whether
                          to email this list needs to see who is on it. This page
                          is already behind the admin allowlist. */}
                      <td className="py-3 font-mono text-xs text-white">{row.email}</td>
                      <td className="py-3">{row.name ?? "—"}</td>
                      <td className="py-3">
                        <span
                          className={
                            row.confirmed
                              ? "rounded-full border border-emerald-300/30 px-2 py-0.5 text-[10px] font-black text-emerald-300"
                              : "rounded-full border border-amber-300/30 px-2 py-0.5 text-[10px] font-black text-amber-300"
                          }
                        >
                          {row.confirmed ? "YES" : "NO"}
                        </span>
                      </td>
                      <td className="py-3 text-xs text-white/55">{row.source ?? "—"}</td>
                      <td className="py-3 text-xs text-white/55">{row.utmCampaign ?? row.utmSource ?? "—"}</td>
                      <td className="py-3 text-xs text-white/55">{formatDate(row.createdAt)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="py-4 text-white/45">
                      No waitlist signups recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {data.waitlist.total > data.waitlist.recent.length ? (
            <p className="mt-3 text-[11px] text-white/45">
              Showing the {data.waitlist.recent.length} most recent of {data.waitlist.total}.
            </p>
          ) : null}
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 shadow-[0_20px_70px_-52px_rgba(34,211,238,0.7)]">
            <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan-100/80">Recent Users</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-[11px] uppercase tracking-[0.16em] text-white/45">
                  <tr>
                    <th className="py-2">User</th>
                    <th className="py-2">Email</th>
                    <th className="py-2">Sub</th>
                    <th className="py-2">Tokens</th>
                    <th className="py-2">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {data.recentUsers.map((user) => (
                    <tr key={user.id} className="text-white/76">
                      <td className="py-3 font-black text-white">@{user.username}</td>
                      <td className="py-3">{user.emailMasked}</td>
                      <td className="py-3">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${subStatusClass(user.subscriptionStatus)}`}>
                          {user.subscriptionStatus}
                        </span>
                      </td>
                      <td className="py-3">{user.tokenBalance ?? "—"}</td>
                      <td className="py-3 text-xs text-white/55">{formatDate(user.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 shadow-[0_20px_70px_-52px_rgba(251,191,36,0.55)]">
            <h2 className="text-sm font-black uppercase tracking-[0.18em] text-amber-100/80">Recent Subscriptions</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="text-[11px] uppercase tracking-[0.16em] text-white/45">
                  <tr>
                    <th className="py-2 pr-3">User</th>
                    <th className="py-2 pr-3">Plan / SKU</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Since</th>
                    <th className="py-2 pr-3">Renews / Ends</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {data.recentSubscriptions.length > 0 ? (
                    data.recentSubscriptions.map((sub) => (
                      <tr key={sub.id} className="text-white/76">
                        <td className="py-3 pr-3">
                          <div className="font-black text-white">@{sub.username}</div>
                          <div className="text-xs text-white/40">{sub.emailMasked}</div>
                        </td>
                        <td className="py-3 pr-3">
                          <div className="font-semibold text-white/85">{sub.plan}</div>
                          {sub.sku ? <div className="mt-0.5 font-mono text-[10px] text-white/38">{sub.sku}</div> : null}
                        </td>
                        <td className="py-3 pr-3">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${subStatusClass(sub.status)}`}>
                            {sub.status}
                          </span>
                        </td>
                        <td className="py-3 pr-3 text-xs text-white/55">{formatDate(sub.createdAt)}</td>
                        <td className="py-3 pr-3 text-xs text-white/55">{formatDate(sub.currentPeriodEnd)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="py-5 text-white/45" colSpan={5}>
                        No subscription rows recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 shadow-[0_20px_70px_-52px_rgba(34,211,238,0.7)]">
            <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan-100/80">Recent Payments</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-[11px] uppercase tracking-[0.16em] text-white/45">
                  <tr>
                    <th className="py-2">User</th>
                    <th className="py-2">Type</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Amount</th>
                    <th className="py-2">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {data.recentPayments.length > 0 ? (
                    data.recentPayments.map((payment) => (
                      <tr key={payment.id} className="text-white/76">
                        <td className="py-3 pr-3">
                          <div className="font-black text-white">@{payment.username}</div>
                          <div className="text-xs text-white/40">{payment.emailMasked}</div>
                        </td>
                        <td className="py-3 pr-3 text-xs">{payment.paymentType}</td>
                        <td className="py-3 pr-3">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${paymentStatusClass(payment.status)}`}>
                            {payment.status}
                          </span>
                        </td>
                        <td className="py-3 pr-3 font-black text-amber-100">{payment.amount}</td>
                        <td className="py-3 text-xs text-white/55">{formatDate(payment.createdAt)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="py-5 text-white/45" colSpan={5}>
                        No payment rows recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 shadow-[0_20px_70px_-52px_rgba(34,211,238,0.7)]">
            <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan-100/80">Recent Token Activity</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-[11px] uppercase tracking-[0.16em] text-white/45">
                  <tr>
                    <th className="py-2 pr-3">User</th>
                    <th className="py-2 pr-3">Type / Description</th>
                    <th className="py-2 pr-3">Delta</th>
                    <th className="py-2 pr-3">Balance</th>
                    <th className="py-2">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {data.recentTokenActivity.length > 0 ? (
                    data.recentTokenActivity.map((entry) => (
                      <tr key={entry.id} className="text-white/76">
                        <td className="py-3 pr-3">
                          <div className="font-black text-white">@{entry.username}</div>
                          <div className="text-xs text-white/40">{entry.emailMasked}</div>
                        </td>
                        <td className="py-3 pr-3">
                          <div className="font-semibold text-white/85">{entry.entryType}</div>
                          {entry.description ? <div className="mt-0.5 text-[11px] text-white/40">{entry.description}</div> : null}
                        </td>
                        <td className={entry.tokenDelta >= 0 ? "py-3 pr-3 font-black text-emerald-200" : "py-3 pr-3 font-black text-amber-100"}>
                          {entry.tokenDelta >= 0 ? `+${entry.tokenDelta}` : entry.tokenDelta}
                        </td>
                        <td className="py-3 pr-3">{entry.balanceAfter}</td>
                        <td className="py-3 text-xs text-white/55">{formatDate(entry.createdAt)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="py-5 text-white/45" colSpan={5}>
                        No token ledger rows recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
