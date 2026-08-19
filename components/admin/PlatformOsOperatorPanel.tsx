"use client"
/**
 * Platform OS Operator Panel — admin-only client component (Phase D Increment 12).
 *
 * Lets a site admin paste an EXPLICIT, comma-separated list of league IDs and fetch the authorized
 * `GET /api/decision-os/platform-os` snapshot for exactly those leagues. Deliberately does NOT
 * auto-fetch on mount and has no default/example league IDs pre-filled — there is nothing to show
 * until an operator types something and submits, by design (see
 * `docs/os/PLATFORM_OS_CLIENT_INTELLIGENCE_AUDIT.md` §19/§20 for why a default list would itself be
 * a form of auto-discovery, which this whole workstream forbids).
 *
 * Usage (in app/admin/page.tsx):
 *   import { PlatformOsOperatorPanel } from "@/components/admin/PlatformOsOperatorPanel"
 *   // inside AccordionSection:
 *   <PlatformOsOperatorPanel />
 */
import { useState } from "react"
import { RefreshCw, AlertTriangle } from "lucide-react"
import type { PlatformOsSnapshot } from "@/lib/decision-os/platformOs"

const SEVERITY_TONE: Record<string, string> = {
  critical: "border-rose-500/25 bg-rose-500/[0.08] text-rose-200",
  high: "border-orange-500/25 bg-orange-500/[0.08] text-orange-200",
  medium: "border-amber-500/25 bg-amber-500/[0.08] text-amber-200",
  low: "border-sky-500/25 bg-sky-500/[0.08] text-sky-200",
  informational: "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-200",
}

function StatChip({ label, value, tone }: { label: string; value: number; tone?: "healthy" | "risk" | "muted" }) {
  const toneClass =
    tone === "healthy" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300" :
    tone === "risk"    ? "border-rose-500/25 bg-rose-500/10 text-rose-300" :
    "border-white/10 bg-white/[0.04] text-white/70"
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.14em] opacity-70">{label}</p>
      <p className="mt-1 text-lg font-black">{value}</p>
    </div>
  )
}

export function PlatformOsOperatorPanel() {
  const [rawInput, setRawInput] = useState("")
  const [snapshot, setSnapshot] = useState<PlatformOsSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [queriedFor, setQueriedFor] = useState<string | null>(null)

  const trimmedInput = rawInput.trim()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!trimmedInput) {
      setError("Enter at least one league ID.")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ leagueIds: trimmedInput })
      const res = await fetch(`/api/decision-os/platform-os?${params.toString()}`)
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      setSnapshot(body as PlatformOsSnapshot)
      setQueriedFor(trimmedInput)
    } catch (err) {
      setSnapshot(null)
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Explicit league-id input — no default value, nothing auto-fetched ──────────── */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <textarea
          data-testid="platform-os-league-ids-input"
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
          placeholder="Paste explicit league IDs, comma-separated (e.g. league-1, league-2)"
          rows={2}
          className="min-w-0 flex-1 rounded-xl border border-white/12 bg-black/35 px-3 py-2 text-xs font-mono text-white outline-none focus:border-cyan-300/60"
          aria-label="Explicit league IDs, comma-separated"
        />
        <button
          type="submit"
          disabled={loading || !trimmedInput}
          data-testid="platform-os-fetch-button"
          className="rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-xs font-black uppercase tracking-wide text-cyan-100 transition hover:bg-cyan-300/20 disabled:opacity-40"
        >
          <RefreshCw className={["mr-1.5 inline h-3.5 w-3.5", loading ? "animate-spin" : ""].join(" ")} aria-hidden />
          Fetch
        </button>
      </form>
      <p className="text-[11px] text-white/40">
        Never auto-discovers leagues — only the exact league IDs you enter above are queried.
      </p>

      {/* ── Error ───────────────────────────────────────────────────────────────────────── */}
      {error ? (
        <div
          data-testid="platform-os-error"
          className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {error}
        </div>
      ) : null}

      {/* ── Snapshot ────────────────────────────────────────────────────────────────────── */}
      {snapshot ? (
        <div data-testid="platform-os-snapshot" className="flex flex-col gap-4">
          {queriedFor ? (
            <p className="text-[11px] text-white/40">
              Showing results for: <span className="font-mono text-white/60">{queriedFor}</span>
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatChip label="Monitored leagues" value={snapshot.totalMonitoredLeagues} />
            <StatChip label="Healthy" value={snapshot.healthyLeagueCount} tone="healthy" />
            <StatChip label="At risk" value={snapshot.atRiskLeagueCount} tone="risk" />
            <StatChip label="Unavailable" value={snapshot.unavailableLeagueCount} tone="muted" />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatChip label="Active managers" value={snapshot.totalActiveManagers} />
            <StatChip label="Inactive managers" value={snapshot.totalInactiveManagers} tone="muted" />
            <StatChip label="Retention risk" value={snapshot.totalRetentionRiskManagers} tone="risk" />
            <StatChip label="Roster activity" value={snapshot.totalRosterActivity} />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatChip label="Trades" value={snapshot.totalTrades} />
            <StatChip label="Waiver claims" value={snapshot.totalWaiverClaims} />
            <StatChip label="Draft picks" value={snapshot.totalDraftPicks} />
            <StatChip label="Trend covered" value={snapshot.trendCoverage.available} />
          </div>

          {/* ── Trend coverage detail ───────────────────────────────────────────────────── */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/60">
            <p className="mb-1 text-[10px] font-black uppercase tracking-[0.14em] text-white/40">Trend coverage</p>
            <p data-testid="platform-os-trend-coverage">
              {snapshot.trendCoverage.available} available · {snapshot.trendCoverage.insufficientHistory} insufficient history ·{" "}
              {snapshot.trendCoverage.noSnapshots} no snapshots · {snapshot.trendCoverage.unavailable} unavailable
            </p>
          </div>

          {/* ── Attention queue ─────────────────────────────────────────────────────────── */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-white/40">
              Attention queue ({snapshot.attentionQueue.length})
            </p>
            {snapshot.attentionQueue.length === 0 ? (
              <p data-testid="platform-os-attention-empty" className="text-xs text-white/40">
                Nothing needs attention across these leagues.
              </p>
            ) : (
              <ul className="space-y-1.5" data-testid="platform-os-attention-list">
                {snapshot.attentionQueue.map((signal) => (
                  <li
                    key={signal.id}
                    data-testid={`platform-os-attention-item-${signal.id}`}
                    className={`rounded-lg border px-3 py-1.5 text-xs ${SEVERITY_TONE[signal.severity]}`}
                  >
                    <span className="font-mono">{signal.leagueId}</span>{" "}
                    <span className="text-white/50">— {signal.title}</span>
                    <span className="block text-white/40">{signal.explanation}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Provenance + warnings ───────────────────────────────────────────────────── */}
          <div className="flex flex-wrap gap-3 text-[11px] text-white/40">
            <span data-testid="platform-os-provenance">
              source={snapshot.provenance.source} · requested={snapshot.provenance.requestedLeagueCount} ·{" "}
              resolved={snapshot.provenance.resolvedLeagueCount} · unavailable={snapshot.provenance.unavailableLeagueCount}
            </span>
          </div>
          {snapshot.warnings.length > 0 ? (
            <p data-testid="platform-os-warnings" className="text-xs text-amber-300">
              {snapshot.warnings.join(", ")}
            </p>
          ) : null}
        </div>
      ) : !error ? (
        <div
          data-testid="platform-os-empty"
          className="rounded-xl border border-dashed border-white/12 py-8 text-center text-xs text-white/35"
        >
          Enter league IDs above and click Fetch to view the Platform OS snapshot.
        </div>
      ) : null}
    </div>
  )
}
