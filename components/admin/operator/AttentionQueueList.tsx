/**
 * Renders the operator Attention Queue.
 *
 * Every row is an auto-derived signal from real metrics — not a human-triaged
 * incident and never a fabricated root cause. That distinction is stated up
 * front so operators treat these as leads to investigate, not verdicts.
 */
import Link from "next/link"
import { OPERATOR_BASE_PATH } from "@/lib/admin-dashboard/operatorNav"
import { SEVERITY_TONE, type OperatorAttentionItem } from "@/lib/admin-dashboard/operatorAttention"
import { StatusPill, EmptyState } from "@/components/admin/operator/primitives"

export function AttentionQueueList({
  items,
  limit,
  showDisclaimer = true,
}: {
  items: OperatorAttentionItem[]
  limit?: number
  showDisclaimer?: boolean
}) {
  const shown = limit ? items.slice(0, limit) : items
  const remaining = limit ? Math.max(0, items.length - limit) : 0

  if (items.length === 0) {
    return (
      <EmptyState>
        No attention signals derived from current metrics. This reflects the checks we run — not a claim that nothing
        can be wrong.
      </EmptyState>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      {showDisclaimer ? (
        <p className="text-[11px] leading-4 text-slate-500">
          Auto-derived from live metrics. These are leads to investigate, not triaged incidents, and no root cause is
          asserted.
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {shown.map((item) => (
          <li
            key={item.id}
            className="rounded-xl border border-white/10 bg-white/[0.02] p-3 transition hover:border-white/20"
          >
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={SEVERITY_TONE[item.severity]}>{item.severity}</StatusPill>
              <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{item.category}</span>
              <Link
                href={`${OPERATOR_BASE_PATH}/${item.section}`}
                className="ml-auto text-[11px] font-bold text-violet-300 hover:text-violet-200"
              >
                Investigate →
              </Link>
            </div>
            <p className="mt-1.5 text-sm font-bold text-white">{item.title}</p>
            <p className="mt-0.5 text-xs text-slate-400">
              <span className="font-semibold text-slate-300">Affected:</span> {item.affected}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              <span className="font-semibold text-slate-300">Evidence:</span> {item.evidence}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              <span className="font-semibold text-slate-400">Suggested:</span> {item.suggestedResponse}
            </p>
          </li>
        ))}
      </ul>

      {remaining > 0 ? (
        <Link
          href={`${OPERATOR_BASE_PATH}/attention`}
          className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-center text-xs font-bold text-violet-300 hover:bg-white/[0.04]"
        >
          View all {items.length} attention items ({remaining} more) →
        </Link>
      ) : null}
    </div>
  )
}
