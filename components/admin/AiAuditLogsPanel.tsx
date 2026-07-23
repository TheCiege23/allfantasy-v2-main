"use client"
/**
 * AI Audit Logs Panel — admin-only client component.
 *
 * Fetches from GET /api/admin/ai/audit-logs with optional filters.
 * Renders a table of AiInteractionLog rows with colour-coded validator results.
 *
 * Usage (in app/admin/page.tsx):
 *   import { AiAuditLogsPanel } from "@/components/admin/AiAuditLogsPanel"
 *   // inside AccordionSection:
 *   <AiAuditLogsPanel />
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { RefreshCw, ShieldAlert, ShieldCheck, ShieldOff } from "lucide-react"

type AuditRow = {
  id: string
  createdAt: string
  sport: string
  feature: string
  route: string | null
  plan: string | null
  providerSource: string | null
  freshnessTier: string | null
  validatorResult: string | null
  blockedReason: string | null
  modelUsed: string | null
  tokenCost: number | null
  wasDeterministic: boolean
}

type AuditResponse = {
  since: string
  totalCount: number
  blockedCount: number
  returnedCount: number
  rows: AuditRow[]
}

type Filter = {
  sport: string
  result: string
  llmOnly: boolean
  providerUnavailable: boolean
  since: "1h" | "24h" | "7d"
}

const SINCE_MAP = {
  "1h":  () => new Date(Date.now() - 1  * 60 * 60 * 1000).toISOString(),
  "24h": () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  "7d":  () => new Date(Date.now() - 7  * 24 * 60 * 60 * 1000).toISOString(),
}

const RESULT_COLORS: Record<string, string> = {
  clean:         "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  warned:        "bg-amber-500/15 text-amber-300 border-amber-500/25",
  blocked:       "bg-rose-500/20 text-rose-300 border-rose-500/30",
  deterministic: "bg-sky-500/12 text-sky-400 border-sky-500/20",
  unavailable:   "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
}

function ResultBadge({ result }: { result: string | null }) {
  if (!result) return <span className="text-white/35 text-xs">—</span>
  const colors = RESULT_COLORS[result] ?? "bg-white/10 text-white/50 border-white/15"
  const Icon =
    result === "blocked" ? ShieldOff :
    result === "warned"  ? ShieldAlert :
    result === "clean"   ? ShieldCheck : null
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-black uppercase tracking-wide ${colors}`}>
      {Icon ? <Icon className="h-2.5 w-2.5" aria-hidden /> : null}
      {result}
    </span>
  )
}

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return <span className="text-white/35 text-xs">—</span>
  const colors =
    tier === "live"   ? "text-emerald-300" :
    tier === "cached" ? "text-sky-300" :
    tier === "pool_only" || tier === "schedule_only" ? "text-cyan-400/75" :
    "text-white/35"
  return <span className={`text-xs font-semibold ${colors}`}>{tier.replace(/_/g, " ")}</span>
}

export function AiAuditLogsPanel() {
  const [filter, setFilter] = useState<Filter>({
    sport: "",
    result: "",
    llmOnly: false,
    providerUnavailable: false,
    since: "24h",
  })
  const [data, setData] = useState<AuditResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async (f: Filter) => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        since: SINCE_MAP[f.since](),
        limit: "200",
      })
      if (f.sport) params.set("sport", f.sport)
      if (f.result) params.set("result", f.result)
      if (f.llmOnly) params.set("llmOnly", "1")
      if (f.providerUnavailable) params.set("providerUnavailable", "1")

      const res = await fetch(`/api/admin/ai/audit-logs?${params.toString()}`, {
        signal: abortRef.current.signal,
        cache: "no-store",
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as AuditResponse
      setData(json)
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(filter) }, [filter, load])

  return (
    <div className="flex flex-col gap-4">
      {/* ── Filters ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {/* Sport filter */}
        <select
          value={filter.sport}
          onChange={(e) => setFilter((f) => ({ ...f, sport: e.target.value }))}
          className="rounded-xl border border-white/12 bg-black/35 px-3 py-1.5 text-xs font-semibold text-white outline-none focus:border-cyan-300/60"
          aria-label="Filter by sport"
        >
          <option value="">All sports</option>
          <option value="world_cup">World Cup</option>
          <option value="nfl">NFL</option>
          <option value="nba">NBA</option>
          <option value="mlb">MLB</option>
          <option value="nhl">NHL</option>
          <option value="epl">EPL</option>
        </select>

        {/* Result filter */}
        <select
          value={filter.result}
          onChange={(e) => setFilter((f) => ({ ...f, result: e.target.value }))}
          className="rounded-xl border border-white/12 bg-black/35 px-3 py-1.5 text-xs font-semibold text-white outline-none focus:border-cyan-300/60"
          aria-label="Filter by validator result"
        >
          <option value="">All results</option>
          <option value="blocked">Blocked only</option>
          <option value="warned">Warnings only</option>
          <option value="clean">Clean only</option>
          <option value="deterministic">Deterministic only</option>
          <option value="unavailable">Unavailable only</option>
        </select>

        {/* Time range */}
        <select
          value={filter.since}
          onChange={(e) => setFilter((f) => ({ ...f, since: e.target.value as Filter["since"] }))}
          className="rounded-xl border border-white/12 bg-black/35 px-3 py-1.5 text-xs font-semibold text-white outline-none focus:border-cyan-300/60"
          aria-label="Filter by time range"
        >
          <option value="1h">Last 1 hour</option>
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
        </select>

        {/* Toggle chips */}
        <button
          type="button"
          onClick={() => setFilter((f) => ({ ...f, llmOnly: !f.llmOnly }))}
          className={[
            "rounded-xl border px-3 py-1.5 text-xs font-semibold transition",
            filter.llmOnly
              ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-300"
              : "border-white/12 bg-black/35 text-white/55 hover:text-white/80",
          ].join(" ")}
          aria-pressed={filter.llmOnly}
        >
          LLM only
        </button>
        <button
          type="button"
          onClick={() => setFilter((f) => ({ ...f, providerUnavailable: !f.providerUnavailable }))}
          className={[
            "rounded-xl border px-3 py-1.5 text-xs font-semibold transition",
            filter.providerUnavailable
              ? "border-rose-400/40 bg-rose-400/15 text-rose-300"
              : "border-white/12 bg-black/35 text-white/55 hover:text-white/80",
          ].join(" ")}
          aria-pressed={filter.providerUnavailable}
        >
          Provider unavailable
        </button>

        {/* Refresh */}
        <button
          type="button"
          onClick={() => void load(filter)}
          disabled={loading}
          className="ml-auto rounded-xl border border-white/12 bg-black/35 px-3 py-1.5 text-xs font-semibold text-white/55 transition hover:text-white/80 disabled:opacity-50"
          aria-label="Refresh AI audit logs"
        >
          <RefreshCw className={["h-3.5 w-3.5", loading ? "animate-spin" : ""].join(" ")} aria-hidden />
        </button>
      </div>

      {/* ── Summary row ─────────────────────────────────────────── */}
      {data ? (
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 font-semibold text-white/65">
            {data.totalCount.toLocaleString()} total in window
          </span>
          <span className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-1.5 font-semibold text-rose-300">
            {data.blockedCount} blocked
          </span>
          <span className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 font-semibold text-white/50">
            showing {data.returnedCount}
          </span>
        </div>
      ) : null}

      {/* ── Error ───────────────────────────────────────────────── */}
      {error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      ) : null}

      {/* ── Table ───────────────────────────────────────────────── */}
      {loading && !data ? (
        <div className="py-6 text-center text-xs text-white/35">Loading audit logs…</div>
      ) : data?.rows.length === 0 ? (
        <div
          data-testid="ai-audit-empty"
          className="rounded-xl border border-dashed border-white/12 py-8 text-center text-xs text-white/35"
        >
          No AI interactions in this window.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="min-w-full text-xs" data-testid="ai-audit-table">
            <thead>
              <tr className="border-b border-white/8 text-[10px] font-black uppercase tracking-[0.14em] text-white/40">
                <th className="px-3 py-2 text-left whitespace-nowrap">Time</th>
                <th className="px-3 py-2 text-left whitespace-nowrap">Sport</th>
                <th className="px-3 py-2 text-left whitespace-nowrap">Feature</th>
                <th className="px-3 py-2 text-left whitespace-nowrap">Plan</th>
                <th className="px-3 py-2 text-left whitespace-nowrap">Provider</th>
                <th className="px-3 py-2 text-left whitespace-nowrap">Freshness</th>
                <th className="px-3 py-2 text-left whitespace-nowrap">Result</th>
                <th className="px-3 py-2 text-left whitespace-nowrap">Block reason</th>
                <th className="px-3 py-2 text-left whitespace-nowrap">Model</th>
                <th className="px-3 py-2 text-right whitespace-nowrap">Tokens</th>
                <th className="px-3 py-2 text-left whitespace-nowrap">Det?</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((row) => (
                <tr
                  key={row.id}
                  className={[
                    "border-b border-white/[0.04] transition-colors hover:bg-white/[0.025]",
                    row.validatorResult === "blocked" ? "bg-rose-500/[0.06]" : "",
                    row.validatorResult === "warned"  ? "bg-amber-500/[0.04]" : "",
                  ].join(" ")}
                  data-testid={row.validatorResult === "blocked" ? "ai-audit-blocked-row" : undefined}
                >
                  <td className="px-3 py-2 text-white/50 whitespace-nowrap">
                    {new Date(row.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}
                  </td>
                  <td className="px-3 py-2 font-semibold text-cyan-100/80">{row.sport}</td>
                  <td className="px-3 py-2 text-white/65">{row.feature}</td>
                  <td className="px-3 py-2 text-white/55">{row.plan ?? "—"}</td>
                  <td className="px-3 py-2 text-white/55">{row.providerSource ?? "—"}</td>
                  <td className="px-3 py-2"><TierBadge tier={row.freshnessTier} /></td>
                  <td className="px-3 py-2"><ResultBadge result={row.validatorResult} /></td>
                  <td className="px-3 py-2 text-rose-300/80 max-w-[160px] truncate">{row.blockedReason ?? "—"}</td>
                  <td className="px-3 py-2 text-white/45 whitespace-nowrap">{row.modelUsed ?? "—"}</td>
                  <td className="px-3 py-2 text-right text-white/45">{row.tokenCost ?? "—"}</td>
                  <td className="px-3 py-2 text-center text-white/40">{row.wasDeterministic ? "✓" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
