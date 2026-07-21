/**
 * Operator sections: Moderation, Security, Audit Logs, Feature Flags,
 * Support Tools, System Settings. Server components on real data where it
 * exists, with honest partial/planned framing where it does not.
 */
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { getOperatorOverviewData } from "@/lib/admin-dashboard/operatorData"
import { getOperatorEnvironment } from "@/lib/admin-dashboard/operatorEnvironment"
import { getReportedContent, getReportedUserRecords, getBlockedUsers } from "@/lib/admin-dashboard/AdminModerationBridge"
import {
  isAIAssistantEnabled,
  isMockDraftsEnabled,
  isLegacyModeEnabled,
  areBracketChallengesEnabled,
  isAnthropicChimmyEnabled,
  isExperimentalLegacyImportEnabled,
  isExperimentalDynastyEnabled,
  getEnabledSports,
} from "@/lib/feature-toggle/PlatformConfigResolver"
import type { EnvReadinessRow } from "@/lib/admin-dashboard/AdminProductionReadinessService"
import { getDeploymentIdentity } from "@/lib/admin-dashboard/deploymentIdentity"
import {
  Panel,
  Stat,
  StatusPill,
  TableScroll,
  Th,
  Td,
  EmptyState,
  PartialDataWarning,
  type OperatorTone,
} from "@/components/admin/operator/primitives"
import { AiAuditLogsPanel } from "@/components/admin/AiAuditLogsPanel"

function fmtDate(iso: string | Date | null): string {
  if (!iso) return "—"
  const d = typeof iso === "string" ? new Date(iso) : iso
  return d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

// ── Moderation ───────────────────────────────────────────────────────────────────
export async function ModerationSection() {
  const [reportedContent, reportedUsers, blocked] = await Promise.all([
    getReportedContent(50).catch(() => []),
    getReportedUserRecords(50).catch(() => []),
    getBlockedUsers(50).catch(() => []),
  ])
  return (
    <div className="flex flex-col gap-4">
      <PartialDataWarning>
        Report detail, evidence preservation, and moderation actions (warn / remove / restrict / suspend / escalate) are
        planned and will be reason-required and audited. Volume from real moderation records is shown below.
      </PartialDataWarning>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Reported content" value={reportedContent.length} tone={reportedContent.length > 0 ? "warn" : "healthy"} />
        <Stat label="Reported users" value={reportedUsers.length} tone={reportedUsers.length > 0 ? "warn" : "healthy"} />
        <Stat label="Blocked users" value={blocked.length} />
      </div>
    </div>
  )
}

// ── Security ─────────────────────────────────────────────────────────────────────
export async function SecuritySection() {
  const { metrics } = await getOperatorOverviewData()
  const adminUsers = metrics.users.find((m) => m.label === "Admin users")
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {metrics.integrity.map((m) => (
          <div key={m.label} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{m.label}</p>
            <p className={`mt-1 text-lg font-black ${m.tracked ? "text-white" : "text-slate-500"}`}>{String(m.value)}</p>
          </div>
        ))}
        <Stat label="Admin users (allowlist)" value={adminUsers ? String(adminUsers.value) : "—"} />
      </div>

      <Panel eyebrow="Elevated review" title="Shared-secret actions">
        <p className="text-sm leading-6 text-slate-300">
          Some automation/admin mutations authenticate with a shared bearer secret. Those events can only be recorded as{" "}
          <code className="rounded bg-white/[0.06] px-1 py-0.5 text-xs text-slate-200">shared-secret</code> — the
          individual caller cannot be attributed, so they require elevated review. Migrating toward unique service
          identities is recommended.
        </p>
      </Panel>

      <PartialDataWarning>
        Failed-admin-login tracking, session revocation, unusual-API-usage detection, and security evidence export are
        planned. Integrity signals above are from real data.
      </PartialDataWarning>
    </div>
  )
}

// ── Audit Logs ───────────────────────────────────────────────────────────────────
type AuditEvent = {
  id: string
  adminUserId: string
  action: string
  targetType: string | null
  targetId: string | null
  createdAt: Date
}

export async function AuditLogsSection() {
  let events: AuditEvent[] = []
  try {
    events = await prisma.adminAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: 40 })
  } catch {
    events = []
  }

  return (
    <div className="flex flex-col gap-4">
      <PartialDataWarning>
        Read-only recent admin-audit events from <code>admin_audit_log</code>. Full filters, actor-type/environment
        columns, before/after diffs, and export are planned. Audit records are append-only — there is no delete control.
      </PartialDataWarning>

      <Panel title={`Recent admin audit events (${events.length})`}>
        {events.length === 0 ? (
          <EmptyState>No admin audit events recorded yet.</EmptyState>
        ) : (
          <TableScroll minWidth={820}>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Target</Th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id}>
                  <Td className="whitespace-nowrap text-slate-400">{fmtDate(ev.createdAt)}</Td>
                  <Td className="font-mono text-xs text-slate-400">{ev.adminUserId.slice(0, 12)}…</Td>
                  <Td className="font-semibold text-white">{ev.action}</Td>
                  <Td className="text-slate-400">
                    {ev.targetType ? `${ev.targetType}${ev.targetId ? `:${ev.targetId.slice(0, 16)}` : ""}` : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
        )}
      </Panel>

      <Panel eyebrow="AI safety" title="AI audit logs">
        <AiAuditLogsPanel />
      </Panel>
    </div>
  )
}

// ── Feature Flags ────────────────────────────────────────────────────────────────
export async function FeatureFlagsSection() {
  const [aiAssistant, mockDrafts, legacyMode, brackets, anthropic, expLegacyImport, expDynasty, sports] = await Promise.all(
    [
      isAIAssistantEnabled(),
      isMockDraftsEnabled(),
      isLegacyModeEnabled(),
      areBracketChallengesEnabled(),
      isAnthropicChimmyEnabled(),
      isExperimentalLegacyImportEnabled(),
      isExperimentalDynastyEnabled(),
      getEnabledSports(),
    ],
  )

  const flags: { key: string; enabled: boolean }[] = [
    { key: "AI assistant", enabled: aiAssistant },
    { key: "Mock drafts", enabled: mockDrafts },
    { key: "Legacy mode", enabled: legacyMode },
    { key: "Bracket challenges", enabled: brackets },
    { key: "Anthropic Chimmy", enabled: anthropic },
    { key: "Experimental legacy import", enabled: expLegacyImport },
    { key: "Experimental dynasty", enabled: expDynasty },
  ]

  return (
    <div className="flex flex-col gap-4">
      <PartialDataWarning>
        Read-only view of resolved platform flags. Editing (with impact preview, reason, confirmation, audit, and
        rollback) plus per-cohort/percentage rollout are planned. Changes made elsewhere are cache-invalidated within 30s.
      </PartialDataWarning>

      <Panel title="Platform feature flags">
        <TableScroll minWidth={480}>
          <thead>
            <tr>
              <Th>Flag</Th>
              <Th>State</Th>
            </tr>
          </thead>
          <tbody>
            {flags.map((f) => (
              <tr key={f.key}>
                <Td className="font-semibold text-white">{f.key}</Td>
                <Td>
                  <StatusPill tone={f.enabled ? "healthy" : "unknown"}>{f.enabled ? "Enabled" : "Disabled"}</StatusPill>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      </Panel>

      <Panel title={`Enabled sports (${sports.length})`}>
        {sports.length === 0 ? (
          <EmptyState>No sports are currently enabled.</EmptyState>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sports.map((s) => (
              <span key={s} className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-xs font-bold text-emerald-200">
                {s}
              </span>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

// ── Support Tools ────────────────────────────────────────────────────────────────
export function SupportToolsSection() {
  return (
    <div className="flex flex-col gap-4">
      <PartialDataWarning>
        Support tools prioritize diagnosis before mutation. Deep import diagnostics, entitlement checks, and safe narrow
        actions are planned. Available diagnostics are linked below.
      </PartialDataWarning>
      <Panel title="Diagnostics">
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { href: "/admin/operator/users", label: "User search & recent accounts" },
            { href: "/admin/operator/subscriptions", label: "Subscription & entitlement state" },
            { href: "/admin/operator/tokens", label: "Token ledger" },
            { href: "/admin/production-health", label: "Production health console" },
            { href: "/admin/duplicate-manager-verify", label: "Duplicate-manager verification" },
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

// ── System Settings ──────────────────────────────────────────────────────────────
function envRowTone(row: EnvReadinessRow): OperatorTone {
  if (row.status === "configured") return "healthy"
  if (row.severity === "critical") return "critical"
  if (row.severity === "warning") return "warn"
  return "unknown"
}

export async function SystemSettingsSection() {
  const { metrics } = await getOperatorOverviewData()
  const env = getOperatorEnvironment()
  const deployment = getDeploymentIdentity()
  const readiness = metrics.productionReadiness

  return (
    <div className="flex flex-col gap-4">
      <PartialDataWarning>
        Read-only configuration state. Editable, validated, versioned, audited settings are planned. Values below are
        real environment/readiness signals.
      </PartialDataWarning>

      <Panel eyebrow="Deployment" title="What the browser is talking to">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Version" value={deployment.version} />
          <Stat label="Commit" value={deployment.commitShaShort ?? "no-sha"} />
          <Stat label="Branch" value={deployment.branch ?? "unknown"} />
          <Stat label="Deployment URL" value={deployment.deploymentUrl ?? "unknown"} />
          <Stat
            label="DB fingerprint"
            value={deployment.databaseHostFingerprint ?? "unknown"}
            tone="unknown"
          />
          <Stat
            label="Process started"
            value={new Date(deployment.processStartedAt).toLocaleString("en-US", {
              timeZone: "America/New_York",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          />
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          Full commit SHA: <span className="font-mono text-slate-400">{deployment.commitSha ?? "not set in this environment"}</span>.
          DB fingerprint is a one-way hash of the connection host — never the host, credentials, or database name.
        </p>
      </Panel>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Environment" value={env.label} tone={env.isProduction ? "critical" : "info"} />
        <Stat label="NODE_ENV" value={env.raw.nodeEnv ?? "unset"} />
        <Stat label="VERCEL_ENV" value={env.raw.vercelEnv ?? "unset"} />
        <Stat label="Override" value={env.raw.override ?? "none"} />
      </div>

      <Panel title="Environment readiness">
        <TableScroll minWidth={560}>
          <thead>
            <tr>
              <Th>Setting</Th>
              <Th>Severity</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {readiness.env.map((row) => (
              <tr key={row.label}>
                <Td className="font-semibold text-white">{row.label}</Td>
                <Td className="text-slate-400">{row.severity}</Td>
                <Td>
                  <StatusPill tone={envRowTone(row)}>{row.status}</StatusPill>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      </Panel>
    </div>
  )
}
