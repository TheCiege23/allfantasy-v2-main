/**
 * Operator sections: Users, Leagues, Imports, Data Providers, Sports Data, Automation.
 * Server components rendered from the existing real admin services.
 */
import Link from "next/link"
import { getAdminCommandCenterMetrics } from "@/lib/admin-dashboard/AdminCommandCenterService"
import { getOperatorOverviewData } from "@/lib/admin-dashboard/operatorData"
import {
  getActiveLeaguesBySport,
  getLargestLeagues,
  getRecentlyCreatedLeagues,
  getFlaggedLeagues,
} from "@/lib/admin-dashboard/AdminLeagueManagementService"
import type { AdminProviderHealthStatus } from "@/lib/admin-dashboard/AdminProviderHealthService"
import { getFantasyImportActivity } from "@/lib/admin-dashboard/AdminImportActivityService"
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
import { AiProviderHealthPanel } from "@/components/admin/AiProviderHealthPanel"
import { ApiHealthPanel } from "@/components/admin/ApiHealthPanel"

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

function subTone(status: string): OperatorTone {
  const s = status.toLowerCase()
  if (s === "active" || s === "trialing") return "healthy"
  if (s === "past_due") return "warn"
  if (["canceled", "cancelled", "failed", "incomplete", "unpaid"].includes(s)) return "critical"
  return "unknown"
}

function fmtDate(iso: string | Date | null): string {
  if (!iso) return "—"
  const d = typeof iso === "string" ? new Date(iso) : iso
  return d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

// ── Users ────────────────────────────────────────────────────────────────────────
export async function UsersSection({ q }: { q: string }) {
  const query = (q || "").trim()
  const metrics = await getAdminCommandCenterMetrics(query)
  const results = query.length >= 2 ? metrics.usersSearch : []

  return (
    <div className="flex flex-col gap-4">
      <form method="get" className="flex gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Search by username, email, or display name…"
          className="h-10 flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-white placeholder:text-slate-500 outline-none focus:border-violet-400/50"
        />
        <button type="submit" className="rounded-lg border border-violet-400/30 bg-violet-500/15 px-4 text-sm font-bold text-violet-200 hover:bg-violet-500/25">
          Search
        </button>
      </form>

      {query.length >= 2 ? (
        <Panel title={`Search results (${results.length})`}>
          {results.length === 0 ? (
            <EmptyState>No users match “{query}”.</EmptyState>
          ) : (
            <TableScroll minWidth={760}>
              <thead>
                <tr>
                  <Th>User</Th>
                  <Th>Email</Th>
                  <Th>Subscription</Th>
                  <Th>Tokens</Th>
                  <Th>Created</Th>
                </tr>
              </thead>
              <tbody>
                {results.map((u) => (
                  <tr key={u.id}>
                    <Td>
                      <span className="font-semibold text-white">@{u.username}</span>
                      {u.displayName ? <span className="ml-1 text-slate-500">({u.displayName})</span> : null}
                    </Td>
                    <Td className="font-mono text-xs text-slate-400">{u.emailMasked}</Td>
                    <Td>
                      <StatusPill tone={subTone(u.subscriptionStatus)}>{u.subscriptionStatus}</StatusPill>
                    </Td>
                    <Td>{u.tokenBalance ?? "—"}</Td>
                    <Td className="text-slate-400">{fmtDate(u.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableScroll>
          )}
        </Panel>
      ) : (
        <PartialDataWarning>
          Full user profiles, impersonation (read-only, audited), session revocation, and entitlement correction are
          planned. This view provides search + recent accounts today. Emails are masked.
        </PartialDataWarning>
      )}

      <Panel title="Recently created accounts">
        <TableScroll minWidth={680}>
          <thead>
            <tr>
              <Th>User</Th>
              <Th>Email</Th>
              <Th>Subscription</Th>
              <Th>Tokens</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody>
            {metrics.recentUsers.map((u) => (
              <tr key={u.id}>
                <Td className="font-semibold text-white">@{u.username}</Td>
                <Td className="font-mono text-xs text-slate-400">{u.emailMasked}</Td>
                <Td>
                  <StatusPill tone={subTone(u.subscriptionStatus)}>{u.subscriptionStatus}</StatusPill>
                </Td>
                <Td>{u.tokenBalance ?? "—"}</Td>
                <Td className="text-slate-400">{fmtDate(u.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      </Panel>
    </div>
  )
}

// ── Leagues ──────────────────────────────────────────────────────────────────────
export async function LeaguesSection() {
  const [bySport, largest, recent, flagged] = await Promise.all([
    getActiveLeaguesBySport(),
    getLargestLeagues(10),
    getRecentlyCreatedLeagues(10),
    getFlaggedLeagues(10),
  ])
  const total = bySport.reduce((s, r) => s + r.count, 0)

  return (
    <div className="flex flex-col gap-4">
      <PartialDataWarning>
        Counts reflect the canonical League table across supported sports. Native vs. imported split, full league
        detail, and filters are planned. Imported third-party leagues remain read-only — operators repair AllFantasy’s
        local copy, never the source platform.
      </PartialDataWarning>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <Stat label="Total" value={total} />
        {bySport.map((s) => (
          <Stat key={s.sport} label={s.sport} value={s.count} />
        ))}
      </div>

      {flagged.length > 0 ? (
        <Panel title={`Leagues with sync errors (${flagged.length})`}>
          <TableScroll minWidth={720}>
            <thead>
              <tr>
                <Th>League</Th>
                <Th>Sport</Th>
                <Th>Status</Th>
                <Th>Sync error</Th>
              </tr>
            </thead>
            <tbody>
              {flagged.map((l) => (
                <tr key={l.id}>
                  <Td className="font-semibold text-white">{l.name}</Td>
                  <Td className="text-slate-400">{l.sport}</Td>
                  <Td>
                    <StatusPill tone="warn">{l.status ?? "unknown"}</StatusPill>
                  </Td>
                  <Td className="max-w-[280px] truncate text-rose-300/80">{l.syncError ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
        </Panel>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Largest leagues">
          <ul className="flex flex-col gap-1.5">
            {largest.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-slate-200">{l.name}</span>
                <span className="shrink-0 text-slate-500">
                  {l.sport} · {l.leagueSize ?? "?"} teams
                </span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Recently created leagues">
          <ul className="flex flex-col gap-1.5">
            {recent.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-slate-200">{l.name}</span>
                <span className="shrink-0 text-slate-500">{fmtDate(l.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  )
}

// ── Data Providers ───────────────────────────────────────────────────────────────
export async function DataProvidersSection() {
  const { metrics } = await getOperatorOverviewData()
  return (
    <div className="flex flex-col gap-4">
      <Panel title={`Configured providers (${metrics.providerHealth.length})`}>
        <TableScroll minWidth={900}>
          <thead>
            <tr>
              <Th>Provider</Th>
              <Th>Category</Th>
              <Th>Status</Th>
              <Th>Req 24h</Th>
              <Th>Latency p95</Th>
              <Th>Last sync</Th>
              <Th>Last error</Th>
            </tr>
          </thead>
          <tbody>
            {metrics.providerHealth.map((p) => (
              <tr key={p.id}>
                <Td className="font-semibold text-white">{p.name}</Td>
                <Td className="text-slate-400">{p.category}</Td>
                <Td>
                  <StatusPill tone={PROVIDER_TONE[p.status]}>{p.status.replace(/_/g, " ")}</StatusPill>
                </Td>
                <Td>{p.requestCount24h ?? "—"}</Td>
                <Td>{p.avgLatencyMs24h != null ? `${p.avgLatencyMs24h}ms` : "—"}</Td>
                <Td className="text-slate-400">{fmtDate(p.lastSyncAt)}</Td>
                <Td className="max-w-[220px] truncate text-rose-300/80">{p.lastError ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel eyebrow="Providers" title="AI provider health">
          <AiProviderHealthPanel />
        </Panel>
        <Panel eyebrow="Providers" title="API health">
          <ApiHealthPanel />
        </Panel>
      </div>
    </div>
  )
}

// ── Sports Data ──────────────────────────────────────────────────────────────────
export async function SportsDataSection() {
  const { metrics } = await getOperatorOverviewData()
  const identity = metrics.sportsIdentityHealth.summary
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Identity problems" value={identity.identityProblems} tone={identity.identityProblems > 0 ? "warn" : "healthy"} />
        <Stat label="Image problems" value={identity.imageProblems} tone={identity.imageProblems > 0 ? "warn" : "healthy"} />
        <Stat label="Mapping problems" value={identity.providerMappingProblems} tone={identity.providerMappingProblems > 0 ? "warn" : "healthy"} />
        <Stat
          label="Reconciliation"
          value={metrics.providerTeamReconciliation.unavailable ? "Unavailable" : metrics.providerTeamReconciliation.totalProblems}
          tone={
            metrics.providerTeamReconciliation.unavailable
              ? "unknown"
              : metrics.providerTeamReconciliation.totalProblems > 0
                ? "warn"
                : "healthy"
          }
        />
      </div>

      <Panel title="Per-sport data reliability">
        <TableScroll minWidth={820}>
          <thead>
            <tr>
              <Th>Sport</Th>
              <Th>Teams</Th>
              <Th>Players</Th>
              <Th>Games</Th>
              <Th>Injuries</Th>
              <Th>Stale warnings</Th>
              <Th>Providers</Th>
            </tr>
          </thead>
          <tbody>
            {metrics.sportDataReliability.map((row) => (
              <tr key={row.id}>
                <Td className="font-semibold text-white">{row.label}</Td>
                <Td>{row.counts.teams ?? "—"}</Td>
                <Td>{row.counts.players ?? "—"}</Td>
                <Td>{row.counts.games ?? "—"}</Td>
                <Td>{row.counts.injuries ?? "—"}</Td>
                <Td>
                  {row.staleWarnings.length > 0 ? (
                    <StatusPill tone="warn">{row.staleWarnings.length}</StatusPill>
                  ) : (
                    <span className="text-slate-500">0</span>
                  )}
                </Td>
                <Td className="max-w-[220px] truncate text-slate-400">
                  {row.configuredProviders.length > 0 ? row.configuredProviders.join(", ") : "—"}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      </Panel>
    </div>
  )
}

// ── Imports ──────────────────────────────────────────────────────────────────────
export async function ImportsSection() {
  const { metrics } = await getOperatorOverviewData()
  const failedSync = metrics.integrity.find((m) => m.label === "Failed sync jobs 24h")
  const dataProviders = metrics.providerHealth.filter((p) => p.importedRows != null || p.lastSyncAt != null)
  const fantasyImports = await getFantasyImportActivity(30)

  return (
    <div className="flex flex-col gap-4">
      <PartialDataWarning>
        Per-run import inspector (queue → authenticating → fetching → normalizing → mapping identities → writing →
        validating), safe idempotent retry, and checkpoint resume are planned. Fantasy league import counts below
        are real (ImportRun), scoped to the last {fantasyImports.windowDays} days.
      </PartialDataWarning>

      <Panel eyebrow="Fantasy league imports" title="Sleeper / ESPN / Yahoo / Fantrax / MFL / Fleaflicker">
        {fantasyImports.unavailable ? (
          <p className="text-sm text-rose-300/80">{fantasyImports.unavailableReason}</p>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Attempts" value={fantasyImports.totals.attempts} />
              <Stat label="Successes" value={fantasyImports.totals.successes} tone="healthy" />
              <Stat
                label="Failures"
                value={fantasyImports.totals.failures}
                tone={fantasyImports.totals.failures > 0 ? "warn" : "healthy"}
              />
              <Stat label="Unique importing users" value={fantasyImports.totals.uniqueImportingUsers} />
            </div>
            <TableScroll minWidth={880}>
              <thead>
                <tr>
                  <Th>Provider</Th>
                  <Th>Attempts</Th>
                  <Th>Success rate</Th>
                  <Th>Avg completion</Th>
                  <Th>Imported leagues</Th>
                  <Th>Recent failure</Th>
                </tr>
              </thead>
              <tbody>
                {fantasyImports.byProvider.map((p) => (
                  <tr key={p.provider}>
                    <Td className="font-semibold text-white">
                      {p.label}
                      {!p.availableToUsers ? (
                        <span className="ml-2 text-[10px] font-normal uppercase tracking-wide text-slate-500">
                          not available to users yet
                        </span>
                      ) : null}
                    </Td>
                    <Td>{p.attempts}</Td>
                    <Td>{p.successRatePct == null ? "—" : `${p.successRatePct}%`}</Td>
                    <Td>{p.avgCompletionMs == null ? "—" : `${Math.round(p.avgCompletionMs / 1000)}s`}</Td>
                    <Td>{p.importedLeagues}</Td>
                    <Td className="max-w-[240px] truncate text-rose-300/80">{p.recentFailureReason ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </TableScroll>
          </>
        )}
      </Panel>

      <Panel eyebrow="Sports-data ingestion — not league imports" title="Provider sync health">
        <p className="mb-3 text-xs text-slate-500">
          Rolling Insights, API-Sports, TheSportsDB, and Sleeper/ESPN&rsquo;s public data feeds — schedules,
          projections, injuries, scores, and player data. This is data-ingestion health, not whether a
          user&rsquo;s Sleeper/ESPN/Yahoo league import succeeded (see Fantasy league imports above).
        </p>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat
            label="Failed sync jobs 24h"
            value={failedSync ? String(failedSync.value) : "—"}
            tone={failedSync && Number(failedSync.value) > 0 ? "warn" : "healthy"}
          />
          <Stat label="Data providers tracked" value={dataProviders.length} />
          <Stat label="Sports covered" value={metrics.sportDataReliability.length} />
        </div>
        <TableScroll minWidth={760}>
          <thead>
            <tr>
              <Th>Provider</Th>
              <Th>Cached rows</Th>
              <Th>Last sync</Th>
              <Th>Last error</Th>
            </tr>
          </thead>
          <tbody>
            {dataProviders.map((p) => (
              <tr key={p.id}>
                <Td className="font-semibold text-white">{p.name}</Td>
                <Td>{p.importedRows ?? "—"}</Td>
                <Td className="text-slate-400">{fmtDate(p.lastSyncAt)}</Td>
                <Td className="max-w-[240px] truncate text-rose-300/80">{p.lastError ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      </Panel>
    </div>
  )
}

// ── Automation ───────────────────────────────────────────────────────────────────
export async function AutomationSection() {
  const { metrics } = await getOperatorOverviewData()
  const crons = metrics.productionReadiness.crons
  const cronGaps = crons.filter((c) => c.status !== "configured").length
  const failedSync = metrics.integrity.find((m) => m.label === "Failed sync jobs 24h")

  return (
    <div className="flex flex-col gap-4">
      <PartialDataWarning>
        Per-job run history, enable/disable, dry-run, kill switches, and idempotency/concurrency controls are planned.
        Cron readiness and recent sync-job failures are shown from real data. Keep <code>DRAFT_TICK_CRON_ENABLED</code>{" "}
        guarded until runtime certification is complete.
      </PartialDataWarning>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Cron jobs registered" value={crons.length} />
        <Stat label="Cron gaps" value={cronGaps} tone={cronGaps > 0 ? "warn" : "healthy"} />
        <Stat
          label="Failed sync 24h"
          value={failedSync ? String(failedSync.value) : "—"}
          tone={failedSync && Number(failedSync.value) > 0 ? "warn" : "healthy"}
        />
      </div>

      <Panel title="Cron readiness">
        <TableScroll minWidth={640}>
          <thead>
            <tr>
              <Th>Job</Th>
              <Th>Schedule</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {crons.map((c) => (
              <tr key={c.label}>
                <Td className="font-semibold text-white">{c.label}</Td>
                <Td className="font-mono text-xs text-slate-400">{c.schedule || "—"}</Td>
                <Td>
                  <StatusPill tone={c.status === "configured" ? "healthy" : c.status === "missing" ? "critical" : "warn"}>
                    {c.status}
                  </StatusPill>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      </Panel>

      <Link href="/api/admin/automation/health" className="text-xs font-bold text-violet-300 hover:text-violet-200">
        Automation health API →
      </Link>
    </div>
  )
}
