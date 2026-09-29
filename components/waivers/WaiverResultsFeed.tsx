"use client"

import { CheckCircle } from "lucide-react"

export type ResultTransaction = {
  id: string
  addPlayerId: string
  dropPlayerId: string | null
  faabSpent: number | null
  processedAt: string
  addPlayerPosition?: string
  dropPlayerPosition?: string
  isDefensiveAdd?: boolean
  isDefensiveDrop?: boolean
  /** Shown next to successful adds (default: Awarded). */
  outcomeLabel?: string
}

type Props = {
  transactions: ResultTransaction[]
  formatTime: (iso: string) => string
  emptyLabel?: string
  className?: string
}

/**
 * Processed waiver transactions (add/drop + FAAB) for history tab or side panel.
 */
export default function WaiverResultsFeed({
  transactions,
  formatTime,
  emptyLabel = "No waiver transactions yet.",
  className = "",
}: Props) {
  if (transactions.length === 0) {
    return (
      <p className={`py-4 text-center text-sm text-white/50 ${className}`} data-testid="waiver-results-feed-empty">
        {emptyLabel}
      </p>
    )
  }
  return (
    <ul className={`space-y-1.5 text-sm ${className}`} data-testid="waiver-results-feed">
      {transactions.map((t) => (
        <li
          key={t.id}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-white/90"
        >
          <CheckCircle className="h-4 w-4 shrink-0 text-emerald-400/90" />
          <span>
            <span className="mr-1.5 rounded bg-emerald-500/15 px-1 text-[11px] font-medium uppercase tracking-wide text-emerald-200/90">
              {t.outcomeLabel ?? "Awarded"}
            </span>
            {t.isDefensiveAdd && (
              <span className="mr-1 rounded bg-amber-500/20 px-1 text-[11px] text-amber-300">Defensive add</span>
            )}
            Add <span className="font-medium text-white">{t.addPlayerId}</span>
            {t.addPlayerPosition ? (
              <span className="ml-1 text-[11px] uppercase text-white/45">{t.addPlayerPosition}</span>
            ) : null}
          </span>
          {t.dropPlayerId && (
            <span className="text-white/60">
              {" · "}
              {t.isDefensiveDrop && (
                <span className="mr-1 rounded bg-amber-500/20 px-1 text-[11px] text-amber-300">Defensive drop</span>
              )}
              Drop <span className="text-white/80">{t.dropPlayerId}</span>
              {t.dropPlayerPosition ? (
                <span className="ml-1 text-[11px] uppercase text-white/45">{t.dropPlayerPosition}</span>
              ) : null}
            </span>
          )}
          {t.faabSpent != null && <span className="text-cyan-300">${t.faabSpent}</span>}
          <span className="ml-auto text-xs text-white/50">{formatTime(t.processedAt)}</span>
        </li>
      ))}
    </ul>
  )
}
