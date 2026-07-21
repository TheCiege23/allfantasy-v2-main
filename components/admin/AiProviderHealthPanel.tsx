"use client"

/**
 * AiProviderHealthPanel
 *
 * Admin-only panel that shows:
 *   1. AI Interaction Health — stats from AiInteractionLog for a rolling window
 *   2. World Cup Provider Health — API-Football config, live chain, data counts, data status
 *
 * Data is fetched from GET /api/admin/ai/provider-health
 */

import { useEffect, useState, useCallback } from "react"
import { RefreshCw, ShieldCheck, ShieldAlert, ShieldOff, Database, Globe, Zap, Play, CheckCircle2, XCircle } from "lucide-react"
import type { AdminWorldCupAction, AdminWorldCupActionResult } from "@/app/api/admin/world-cup/actions/route"

// ─── API response types (mirror the route's JSON shape) ──────────────────────

type ModelRow = { model: string; count: number }
type BlockedReasonRow = { reason: string; count: number }

type AiHealth = {
  windowHours: number
  since: string
  total: number
  deterministic: number
  deterministicPct: number
  llmCalls: number
  clean: number
  warned: number
  blocked: number
  blockedPct: number
  unavailable: number
  avgTokenCost: number | null
  modelBreakdown: ModelRow[]
  topBlockedReasons: BlockedReasonRow[]
  lastCallAt: string | null
  worldCupTotal: number
  worldCupBlocked: number
}

type WcProvider = {
  name: string
  configured: boolean
  apiKeyPresent: boolean
  leagueId: string | null
  leagueIdConfigured: boolean
  cronSecretPresent: boolean
  missingEnvVars: string[]
}

type WcData = {
  productionStatus: "ready" | "partial_ready" | "not_ready"
  groupStageReady: boolean
  knockoutsReady: boolean
  standingsSynced: boolean
  standingsState: string
  fixtureCount: number
  groupStageFixtureCount: number
  knockoutFixtureCount: number
  standingsRowCount: number
  warnings: string[]
}

type ProviderHealthResponse = {
  generatedAt: string
  windowHours: number
  ai: AiHealth
  worldCup: {
    provider: WcProvider
    data: WcData
    liveChain: string[]
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%"
  return `${Math.round((n / total) * 100)}%`
}

type StatCardProps = {
  label: string
  value: string | number
  sub?: string
  accent?: "emerald" | "rose" | "amber" | "sky" | "white"
  testId?: string
}

function StatCard({ label, value, sub, accent = "white", testId }: StatCardProps) {
  const colorMap: Record<typeof accent, string> = {
    emerald: "text-emerald-300",
    rose:    "text-rose-400",
    amber:   "text-amber-300",
    sky:     "text-sky-300",
    white:   "text-white",
  }
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4" data-testid={testId ?? "ai-health-stat"}>
      <p className="text-[11px] font-medium uppercase tracking-wider text-white/50">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${colorMap[accent]}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-white/40">{sub}</p> : null}
    </div>
  )
}

type PillProps = {
  label: string
  color?: "emerald" | "rose" | "amber" | "sky" | "white" | "cyan"
}

function Pill({ label, color = "white" }: PillProps) {
  const colorMap: Record<typeof color, string> = {
    emerald: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
    rose:    "border-rose-400/40 bg-rose-400/10 text-rose-300",
    amber:   "border-amber-400/40 bg-amber-400/10 text-amber-300",
    sky:     "border-sky-400/40 bg-sky-400/10 text-sky-300",
    cyan:    "border-cyan-400/40 bg-cyan-400/10 text-cyan-300",
    white:   "border-white/20 bg-white/[0.06] text-white/60",
  }
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${colorMap[color]}`}>
      {label}
    </span>
  )
}

function WcStatusPill({ status }: { status: WcData["productionStatus"] }) {
  if (status === "ready") return <Pill label="Ready" color="emerald" />
  if (status === "partial_ready") return <Pill label="Partial" color="amber" />
  return <Pill label="Not Ready" color="rose" />
}

// ─── Admin actions ────────────────────────────────────────────────────────────

type ActionState = {
  loading: boolean
  result: AdminWorldCupActionResult | null
  error: string | null
}

const INITIAL_ACTION_STATE: ActionState = { loading: false, result: null, error: null }

const ACTION_LABELS: Record<AdminWorldCupAction, string> = {
  "sync-fixtures":    "Sync Fixtures Now",
  "sync-live-scores": "Sync Live Scores Now",
  "sync-standings":   "Refresh Standings Now",
  "recompute-scores": "Recompute Pool Scores",
  "rebuild-grounding":"Check AI Grounding",
}

const ACTION_DESCRIPTIONS: Record<AdminWorldCupAction, string> = {
  "sync-fixtures":    "Pull latest fixture data from the provider into WC bracket matches.",
  "sync-live-scores": "Apply live score updates for all active challenges.",
  "sync-standings":   "Refresh group standings from the data provider.",
  "recompute-scores": "Re-evaluate all bracket picks against final match results.",
  "rebuild-grounding":"Diagnostic check of AI grounding readiness (read-only).",
}

const ALL_ACTIONS: AdminWorldCupAction[] = [
  "sync-fixtures",
  "sync-live-scores",
  "sync-standings",
  "recompute-scores",
  "rebuild-grounding",
]

function ActionButton({
  action,
  state,
  onRun,
}: {
  action: AdminWorldCupAction
  state: ActionState
  onRun: (action: AdminWorldCupAction) => void
}) {
  return (
    <div
      className="rounded-xl border border-white/10 bg-white/[0.04] p-4 space-y-2"
      data-testid={`wc-action-${action}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white/80">{ACTION_LABELS[action]}</p>
          <p className="mt-0.5 text-[11px] text-white/40">{ACTION_DESCRIPTIONS[action]}</p>
        </div>
        <button
          aria-label={ACTION_LABELS[action]}
          disabled={state.loading}
          onClick={() => onRun(action)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/70 transition hover:bg-white/[0.12] disabled:opacity-40"
        >
          {state.loading ? (
            <RefreshCw className="h-3 w-3 animate-spin" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          {state.loading ? "Running…" : "Run"}
        </button>
      </div>

      {/* Result */}
      {state.result ? (
        <div
          className={`rounded-lg border px-3 py-2 text-[11px] space-y-1 ${
            state.result.ok
              ? "border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-300"
              : "border-rose-500/30 bg-rose-500/[0.07] text-rose-300"
          }`}
          data-testid={`wc-action-result-${action}`}
        >
          <div className="flex items-center gap-1.5 font-semibold">
            {state.result.ok ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : (
              <XCircle className="h-3 w-3" />
            )}
            {state.result.ok ? "Success" : "Failed"}
            <span className="font-normal text-white/30 ml-auto">
              {new Date(state.result.timestamp).toLocaleTimeString()}
            </span>
          </div>
          {Object.entries(state.result.counts).length > 0 ? (
            <p className="text-white/60">
              {Object.entries(state.result.counts)
                .map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()}: ${v}`)
                .join(" · ")}
            </p>
          ) : null}
          {state.result.challengesProcessed > 0 ? (
            <p className="text-white/50">
              {state.result.challengesProcessed} challenge{state.result.challengesProcessed !== 1 ? "s" : ""} processed
            </p>
          ) : null}
          {state.result.error ? (
            <p className="text-rose-300/80">{state.result.error}</p>
          ) : null}
          {state.result.warnings.length > 0 ? (
            <p className="text-amber-300/70">
              ⚠ {state.result.warnings.slice(0, 2).join(" · ")}
              {state.result.warnings.length > 2 ? ` (+${state.result.warnings.length - 2} more)` : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Error (network/auth) */}
      {state.error && !state.result ? (
        <p
          className="rounded-lg border border-rose-500/30 bg-rose-500/[0.07] px-3 py-2 text-[11px] text-rose-300"
          data-testid={`wc-action-error-${action}`}
        >
          {state.error}
        </p>
      ) : null}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AiProviderHealthPanel() {
  const [data, setData] = useState<ProviderHealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [windowHours, setWindowHours] = useState(24)
  const [actionStates, setActionStates] = useState<Record<AdminWorldCupAction, ActionState>>(
    () => Object.fromEntries(ALL_ACTIONS.map((a) => [a, INITIAL_ACTION_STATE])) as Record<AdminWorldCupAction, ActionState>
  )

  const runAction = useCallback(async (action: AdminWorldCupAction) => {
    setActionStates((prev) => ({ ...prev, [action]: { loading: true, result: null, error: null } }))
    try {
      const res = await fetch("/api/admin/world-cup/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const json = await res.json() as AdminWorldCupActionResult
      setActionStates((prev) => ({ ...prev, [action]: { loading: false, result: json, error: null } }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Request failed"
      setActionStates((prev) => ({ ...prev, [action]: { loading: false, result: null, error: msg } }))
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/ai/provider-health?hours=${windowHours}`, { cache: "no-store" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json() as ProviderHealthResponse
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load provider health")
    } finally {
      setLoading(false)
    }
  }, [windowHours])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-6" data-testid="ai-provider-health-panel">
      {/* Header + controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-white/80">AI Provider Health</span>
          {data ? (
            <span className="text-[11px] text-white/35">
              generated {fmtTime(data.generatedAt)}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Window in hours"
            value={windowHours}
            onChange={(e) => setWindowHours(Number(e.target.value))}
            className="rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-xs text-white/70 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
          >
            <option value={1}>Last 1h</option>
            <option value={6}>Last 6h</option>
            <option value={24}>Last 24h</option>
            <option value={72}>Last 72h</option>
            <option value={168}>Last 7d</option>
          </select>
          <button
            aria-label="Refresh AI provider health"
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/[0.10] disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error */}
      {error ? (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300" data-testid="ai-health-error">
          {error}
        </p>
      ) : null}

      {/* Loading skeleton */}
      {loading && !data ? (
        <div className="animate-pulse space-y-3">
          <div className="h-24 rounded-xl bg-white/[0.04]" />
          <div className="h-24 rounded-xl bg-white/[0.04]" />
        </div>
      ) : null}

      {/* AI Interaction stats */}
      {data ? (
        <>
          <section aria-label="AI interaction stats">
            <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/40">
              <ShieldCheck className="h-3.5 w-3.5" />
              AI Interaction ({data.windowHours}h window)
            </h3>
            <div
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
              data-testid="ai-health-stats-grid"
            >
              <StatCard label="Total calls" value={data.ai.total} sub={`since ${fmtTime(data.ai.since)}`} />
              <StatCard
                label="Deterministic"
                value={`${data.ai.deterministicPct}%`}
                sub={`${data.ai.deterministic} of ${data.ai.total}`}
                accent="emerald"
                testId="ai-health-deterministic"
              />
              <StatCard
                label="LLM calls"
                value={data.ai.llmCalls}
                sub={data.ai.avgTokenCost != null ? `avg ${data.ai.avgTokenCost} tokens` : "avg tokens unknown"}
                accent="sky"
              />
              <StatCard
                label="Blocked"
                value={data.ai.blocked}
                sub={`${data.ai.blockedPct}% of LLM calls`}
                accent={data.ai.blocked > 0 ? "rose" : "white"}
                testId="ai-health-blocked"
              />
              <StatCard label="Clean" value={data.ai.clean} accent="emerald" />
              <StatCard label="Warned" value={data.ai.warned} accent="amber" />
              <StatCard label="Unavailable" value={data.ai.unavailable} />
              <StatCard
                label="WC calls"
                value={data.ai.worldCupTotal}
                sub={data.ai.worldCupBlocked > 0 ? `${data.ai.worldCupBlocked} blocked` : "none blocked"}
                accent="sky"
              />
            </div>

            {/* Last call */}
            {data.ai.lastCallAt ? (
              <p className="mt-2 text-[11px] text-white/35">
                Last call: {fmtTime(data.ai.lastCallAt)}
              </p>
            ) : (
              <p className="mt-2 text-[11px] text-white/35" data-testid="ai-health-no-calls">
                No AI calls recorded in this window.
              </p>
            )}
          </section>

          {/* Model breakdown */}
          {data.ai.modelBreakdown.length > 0 ? (
            <section aria-label="Model breakdown">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">Model Distribution</h3>
              <div className="flex flex-wrap gap-2" data-testid="ai-health-models">
                {data.ai.modelBreakdown.map((row) => (
                  <div
                    key={row.model}
                    className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs"
                  >
                    <span className="font-medium text-sky-300">{row.model}</span>
                    <span className="ml-2 text-white/50">
                      {row.count} call{row.count !== 1 ? "s" : ""}{" "}
                      ({pct(row.count, data.ai.llmCalls)})
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* Blocked reasons */}
          {data.ai.topBlockedReasons.length > 0 ? (
            <section aria-label="Top blocked reasons">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/40">
                <ShieldOff className="h-3.5 w-3.5 text-rose-400" />
                Top Blocked Reasons
              </h3>
              <div className="flex flex-wrap gap-2" data-testid="ai-health-blocked-reasons">
                {data.ai.topBlockedReasons.map((row) => (
                  <div
                    key={row.reason}
                    className="rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-3 py-2 text-xs"
                  >
                    <span className="font-medium text-rose-300">{row.reason.replace(/_/g, " ")}</span>
                    <span className="ml-2 text-white/50">×{row.count}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* World Cup provider */}
          <section aria-label="World Cup provider health">
            <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/40">
              <Globe className="h-3.5 w-3.5" />
              World Cup Provider
            </h3>
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 space-y-4" data-testid="ai-health-wc-provider">
              {/* Provider config row */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-white/80">API-Football</span>
                {data.worldCup.provider.configured ? (
                  <Pill label="Configured" color="emerald" />
                ) : (
                  <Pill label="Missing env" color="rose" />
                )}
                <WcStatusPill status={data.worldCup.data.productionStatus} />
                {data.worldCup.provider.apiKeyPresent ? (
                  <Pill label="API key ✓" color="sky" />
                ) : (
                  <Pill label="No API key" color="rose" />
                )}
                {data.worldCup.provider.leagueIdConfigured ? (
                  <Pill label={`League ${data.worldCup.provider.leagueId ?? "?"}`} color="cyan" />
                ) : (
                  <Pill label="No league ID" color="amber" />
                )}
                {data.worldCup.provider.cronSecretPresent ? (
                  <Pill label="Cron secret ✓" color="sky" />
                ) : (
                  <Pill label="No cron secret" color="amber" />
                )}
              </div>

              {/* Missing env vars */}
              {data.worldCup.provider.missingEnvVars.length > 0 ? (
                <div>
                  <p className="text-[11px] font-medium text-rose-400 mb-1">Missing env vars:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.worldCup.provider.missingEnvVars.map((v) => (
                      <code key={v} className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-300">{v}</code>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Data counts */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="ai-health-wc-counts">
                <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
                  <p className="text-[10px] text-white/40 uppercase tracking-wide">Fixtures</p>
                  <p className="text-lg font-bold text-white tabular-nums">{data.worldCup.data.fixtureCount}</p>
                  <p className="text-[10px] text-white/30">
                    {data.worldCup.data.groupStageFixtureCount} group · {data.worldCup.data.knockoutFixtureCount} KO
                  </p>
                </div>
                <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
                  <p className="text-[10px] text-white/40 uppercase tracking-wide">Standings rows</p>
                  <p className="text-lg font-bold text-white tabular-nums">{data.worldCup.data.standingsRowCount}</p>
                  <p className="text-[10px] text-white/30">{data.worldCup.data.standingsState}</p>
                </div>
                <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
                  <p className="text-[10px] text-white/40 uppercase tracking-wide">Group stage</p>
                  <p className={`text-lg font-bold tabular-nums ${data.worldCup.data.groupStageReady ? "text-emerald-300" : "text-amber-300"}`}>
                    {data.worldCup.data.groupStageReady ? "Ready" : "Partial"}
                  </p>
                </div>
                <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
                  <p className="text-[10px] text-white/40 uppercase tracking-wide">Knockouts</p>
                  <p className={`text-lg font-bold tabular-nums ${data.worldCup.data.knockoutsReady ? "text-emerald-300" : "text-amber-300"}`}>
                    {data.worldCup.data.knockoutsReady ? "Ready" : "Partial"}
                  </p>
                </div>
              </div>

              {/* Live chain */}
              <div>
                <p className="text-[11px] font-medium text-white/40 uppercase tracking-wide mb-1.5">Live Score Chain</p>
                <div className="flex flex-wrap items-center gap-1.5" data-testid="ai-health-live-chain">
                  {data.worldCup.liveChain.map((id, i) => (
                    <span key={id} className="flex items-center gap-1.5">
                      {i > 0 ? <span className="text-white/20 text-xs">→</span> : null}
                      <code className="rounded border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-white/60">
                        {id}
                      </code>
                    </span>
                  ))}
                </div>
              </div>

              {/* Warnings */}
              {data.worldCup.data.warnings.length > 0 ? (
                <div>
                  <p className="text-[11px] font-medium text-amber-400 mb-1.5 flex items-center gap-1.5">
                    <ShieldAlert className="h-3 w-3" />
                    Warnings
                  </p>
                  <ul className="space-y-1" data-testid="ai-health-wc-warnings">
                    {data.worldCup.data.warnings.map((w, i) => (
                      <li key={i} className="text-xs text-amber-300/80">• {w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </section>

          {/* World Cup Admin Actions */}
          <section aria-label="World Cup admin actions" data-testid="wc-admin-actions">
            <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/40">
              <Play className="h-3.5 w-3.5 text-amber-400" />
              World Cup Admin Actions
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {ALL_ACTIONS.map((action) => (
                <ActionButton
                  key={action}
                  action={action}
                  state={actionStates[action]}
                  onRun={runAction}
                />
              ))}
            </div>
          </section>

          {/* DB health */}
          <section aria-label="Database health">
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/40">
              <Database className="h-3.5 w-3.5" />
              Audit Log Storage
            </h3>
            <p className="text-xs text-white/50">
              AiInteractionLog is append-only. Records are kept indefinitely. Query with filters in the
              AI Audit Logs panel below to investigate specific events.
            </p>
          </section>
        </>
      ) : null}
    </div>
  )
}
