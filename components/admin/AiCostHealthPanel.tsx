/**
 * AiCostHealthPanel — admin-only Server Component.
 *
 * Shows AI cost, cache health, token usage, and per-feature stats for a
 * configurable look-back window.
 *
 * Usage (from an admin Server Component page):
 *
 *   import { getAdminAiCostHealth } from '@/lib/ai/aiCostHealth'
 *   import { AiCostHealthPanel } from '@/components/admin/AiCostHealthPanel'
 *
 *   const health = await getAdminAiCostHealth(24)
 *   return <AiCostHealthPanel health={health} />
 *
 * Auth: handled by the parent page/layout.
 */
import type { AiCostHealth, AiCostFeatureStat } from "@/lib/ai/aiCostHealth"

// ─── Utilities ────────────────────────────────────────────────────────────────

function pctBar(pct: number, color: string) {
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div
        className={`absolute inset-y-0 left-0 rounded-full ${color}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  )
}

function fmt(n: number) {
  return n.toLocaleString("en-US")
}

function fmtPct(n: number) {
  return `${n}%`
}

function feedbackColor(pct: number | null) {
  if (pct === null) return "text-zinc-500"
  if (pct >= 75) return "text-emerald-400"
  if (pct >= 50) return "text-amber-400"
  return "text-rose-400"
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-white/10 bg-white/[0.03] p-4 ${className}`}>
      {children}
    </div>
  )
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">{title}</h3>
  )
}

function StatCell({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: "emerald" | "amber" | "rose" | "cyan"
}) {
  const valueColor =
    accent === "emerald"
      ? "text-emerald-400"
      : accent === "amber"
        ? "text-amber-400"
        : accent === "rose"
          ? "text-rose-400"
          : accent === "cyan"
            ? "text-cyan-400"
            : "text-white"
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <span className={`text-xl font-black ${valueColor}`}>{value}</span>
      {sub ? <span className="text-[11px] text-zinc-600">{sub}</span> : null}
    </div>
  )
}

function FeatureRow({ row }: { row: AiCostFeatureStat }) {
  const llmPct = row.count > 0 ? Math.round((row.llmCount / row.count) * 100) : 0
  const cachePct = row.count > 0 ? Math.round((row.cacheHitCount / row.count) * 100) : 0
  const detPct = row.count > 0 ? Math.round((row.deterministicCount / row.count) * 100) : 0

  return (
    <tr className="border-t border-white/[0.05] text-xs">
      <td className="py-2 pr-3 font-mono text-zinc-300">{row.feature}</td>
      <td className="py-2 pr-3 text-right text-zinc-400">{fmt(row.count)}</td>
      <td className="py-2 pr-3 text-right">
        <span className="text-emerald-400">{fmtPct(detPct)}</span>
      </td>
      <td className="py-2 pr-3 text-right">
        <span className="text-cyan-400">{fmtPct(cachePct)}</span>
      </td>
      <td className="py-2 pr-3 text-right">
        <span className={llmPct > 50 ? "text-amber-400" : "text-zinc-400"}>{fmtPct(llmPct)}</span>
      </td>
      <td className="py-2 pr-3 text-right text-zinc-500">
        {row.avgTokenCost != null ? Math.round(row.avgTokenCost) : "—"}
      </td>
      <td className="py-2 pr-3 text-right text-emerald-600 text-[11px]">
        {row.estimatedTokensSaved > 0 ? `~${fmt(row.estimatedTokensSaved)}` : "—"}
      </td>
      <td className={`py-2 text-right font-bold ${feedbackColor(row.feedbackPositivePct)}`}>
        {row.feedbackPositivePct !== null ? `${row.feedbackPositivePct}%` : "—"}
      </td>
    </tr>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function AiCostHealthPanel({ health }: { health: AiCostHealth }) {
  const { windowHours, totalInteractions } = health

  const windowLabel =
    windowHours === 1
      ? "Last 1 hour"
      : windowHours === 24
        ? "Last 24 hours"
        : windowHours === 168
          ? "Last 7 days"
          : `Last ${windowHours} hours`

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-black text-white">AI Cost & Cache Health</h2>
          <p className="text-xs text-zinc-500">{windowLabel} · {fmt(totalInteractions)} total interactions</p>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Window links are handled by the parent page */}
          <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-[11px] font-bold text-zinc-400">
            {windowLabel}
          </span>
        </div>
      </div>

      {/* Key metrics row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <StatCell
            label="Deterministic"
            value={fmtPct(health.deterministicPct)}
            sub={`${fmt(health.deterministicCount)} calls · no LLM`}
            accent="emerald"
          />
          <div className="mt-2">{pctBar(health.deterministicPct, "bg-emerald-400")}</div>
        </Card>
        <Card>
          <StatCell
            label="Cache Hits"
            value={fmtPct(health.cacheHitPct)}
            sub={`${fmt(health.cacheHitCount)} calls · LLM skipped`}
            accent="cyan"
          />
          <div className="mt-2">{pctBar(health.cacheHitPct, "bg-cyan-400")}</div>
        </Card>
        <Card>
          <StatCell
            label="LLM Calls"
            value={fmtPct(health.llmPct)}
            sub={`${fmt(health.llmCount)} calls · costs money`}
            accent={health.llmPct > 50 ? "amber" : undefined}
          />
          <div className="mt-2">{pctBar(health.llmPct, health.llmPct > 50 ? "bg-amber-400" : "bg-zinc-500")}</div>
        </Card>
        <Card>
          <StatCell
            label="Free AI Calls"
            value={fmtPct(health.deterministicPct + health.cacheHitPct)}
            sub="det + cache"
            accent="emerald"
          />
          <div className="mt-2">{pctBar(health.deterministicPct + health.cacheHitPct, "bg-emerald-400/60")}</div>
        </Card>
      </div>

      {/* Token cost row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card>
          <StatCell
            label="Tokens Spent"
            value={fmt(health.estimatedTokensSpent)}
            sub="output tokens (LLM calls only)"
          />
        </Card>
        <Card>
          <StatCell
            label="Tokens Saved"
            value={`~${fmt(health.estimatedTokensSaved)}`}
            sub="estimated via cache hits"
            accent="emerald"
          />
        </Card>
        <Card>
          <StatCell
            label="Save Ratio"
            value={
              health.estimatedTokensSpent + health.estimatedTokensSaved > 0
                ? fmtPct(
                    Math.round(
                      (health.estimatedTokensSaved /
                        (health.estimatedTokensSpent + health.estimatedTokensSaved)) *
                        100
                    )
                  )
                : "—"
            }
            sub="tokens saved / total"
            accent="emerald"
          />
        </Card>
      </div>

      {/* Validator stats + top intents row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Validator */}
        <Card>
          <SectionHeader title="Validator Results" />
          <div className="space-y-2">
            {[
              { label: "Clean", count: health.validatorStats.clean, color: "bg-emerald-400" },
              { label: "Warned", count: health.validatorStats.warned, color: "bg-amber-400" },
              { label: "Blocked", count: health.validatorStats.blocked, color: "bg-rose-500" },
            ].map(({ label, count, color }) => {
              const pct = totalInteractions > 0 ? Math.round((count / totalInteractions) * 100) : 0
              return (
                <div key={label} className="flex items-center gap-2">
                  <span className="w-12 text-xs text-zinc-400">{label}</span>
                  <div className="flex-1">{pctBar(pct, color)}</div>
                  <span className="w-10 text-right text-xs text-zinc-500">{fmt(count)}</span>
                </div>
              )
            })}
          </div>
        </Card>

        {/* Top intents */}
        <Card>
          <SectionHeader title="Top Intents (LLM path)" />
          {health.topIntents.length === 0 ? (
            <p className="text-xs text-zinc-600 italic">No data yet</p>
          ) : (
            <div className="space-y-1.5">
              {health.topIntents.slice(0, 8).map(({ intent, count }) => (
                <div key={intent} className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs text-zinc-400">{intent}</span>
                  <span className="shrink-0 text-xs font-bold text-zinc-300">{fmt(count)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Billing enforcement audit */}
      <Card className={health.chargeGap > 0 ? "border-rose-500/40 bg-rose-500/[0.04]" : ""}>
        <SectionHeader title="Billing Enforcement Audit" />
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Should Charge</span>
            <span className={`text-xl font-black ${health.shouldChargeCount > 0 ? "text-amber-400" : "text-zinc-400"}`}>
              {fmt(health.shouldChargeCount)}
            </span>
            <span className="text-[11px] text-zinc-600">policy says charge token</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Actually Charged</span>
            <span className="text-xl font-black text-emerald-400">{fmt(health.actualChargedCount)}</span>
            <span className="text-[11px] text-zinc-600">token deducted in DB</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Gap</span>
            <span className={`text-xl font-black ${health.chargeGap > 0 ? "text-rose-400" : "text-emerald-400"}`}>
              {health.chargeGap > 0 ? `−${fmt(health.chargeGap)}` : "0"}
            </span>
            <span className="text-[11px] text-zinc-600">
              {health.chargeGap > 0 ? "enforcement gap — charges missed" : "clean"}
            </span>
          </div>
        </div>
      </Card>

      {/* Token fairness breakdown */}
      <Card>
        <SectionHeader title="Token Fairness (LLM Calls)" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            {
              label: "Plan Covered",
              count: health.planCoveredCount,
              sub: "subscription absorbed cost",
              color: "text-emerald-400",
            },
            {
              label: "Token Required",
              count: health.chargeableCount,
              sub: "no plan — token should charge",
              color: health.chargeableCount > 0 ? "text-amber-400" : "text-zinc-400",
            },
            {
              label: "Validator Blocked",
              count: health.validatorStats.blocked,
              sub: "LLM ran but output filtered",
              color: health.validatorStats.blocked > 0 ? "text-rose-400" : "text-zinc-400",
            },
            {
              label: "Free Calls",
              count: health.deterministicCount + health.cacheHitCount,
              sub: "det + cache — no LLM",
              color: "text-cyan-400",
            },
          ].map(({ label, count, sub, color }) => (
            <div key={label} className="flex flex-col gap-0.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</span>
              <span className={`text-xl font-black ${color}`}>{fmt(count)}</span>
              <span className="text-[11px] text-zinc-600">{sub}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Per-feature breakdown table */}
      <Card className="overflow-x-auto">
        <SectionHeader title="Per-Feature Breakdown" />
        {health.byFeature.length === 0 ? (
          <p className="text-xs text-zinc-600 italic">No data yet</p>
        ) : (
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="text-[11px] font-bold uppercase tracking-wide text-zinc-600">
                <th className="pb-2 pr-3 text-left">Feature</th>
                <th className="pb-2 pr-3 text-right">Total</th>
                <th className="pb-2 pr-3 text-right">Det%</th>
                <th className="pb-2 pr-3 text-right">Cache%</th>
                <th className="pb-2 pr-3 text-right">LLM%</th>
                <th className="pb-2 pr-3 text-right">Avg Tok</th>
                <th className="pb-2 pr-3 text-right">Saved Tok</th>
                <th className="pb-2 text-right">👍 %</th>
              </tr>
            </thead>
            <tbody>
              {health.byFeature.map((row) => (
                <FeatureRow key={row.feature} row={row} />
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Data staleness note */}
      <p className="text-[11px] text-zinc-700">
        Data from <code className="text-zinc-500">/ai_interaction_logs</code> ·{" "}
        Token savings are estimated using average cost per LLM call per feature ·{" "}
        Feedback % from <code className="text-zinc-500">/ai_feedback</code>
      </p>
    </div>
  )
}
