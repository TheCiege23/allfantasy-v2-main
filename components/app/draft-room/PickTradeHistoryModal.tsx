'use client'

/**
 * Pick trade history modal — openable from any board cell or the board toolbar.
 *
 * Lists every TradedPickRecord for the active draft session grouped by round,
 * with a "from → to" chain so a commissioner can audit ownership at a glance.
 * When opened via a specific pick (round + ownerSlot), that row is highlighted
 * and scrolled into view so trade provenance for that cell is obvious.
 *
 * Source of truth is session.tradedPicks (already resolved server-side) — this
 * modal is read-only; write surfaces live in DraftPickTradePanel.
 */

import React, { useEffect, useMemo, useRef } from 'react'
import { ArrowRight, X, History } from 'lucide-react'
import type { TradedPickRecord } from '@/lib/live-draft-engine/types'

export interface PickTradeHistoryModalProps {
  open: boolean
  onClose: () => void
  tradedPicks: TradedPickRecord[]
  /** Optional focus target — highlights the matching row and scrolls into view. */
  focusRound?: number | null
  focusOriginalRosterId?: string | null
}

export function PickTradeHistoryModal({
  open,
  onClose,
  tradedPicks,
  focusRound = null,
  focusOriginalRosterId = null,
}: PickTradeHistoryModalProps) {
  const focusRef = useRef<HTMLLIElement | null>(null)

  const byRound = useMemo(() => {
    const groups = new Map<number, TradedPickRecord[]>()
    for (const tp of tradedPicks) {
      const list = groups.get(tp.round) ?? []
      list.push(tp)
      groups.set(tp.round, list)
    }
    return Array.from(groups.entries()).sort((a, b) => a[0] - b[0])
  }, [tradedPicks])

  useEffect(() => {
    if (!open) return
    focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [open, focusRound, focusOriginalRosterId])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Pick trade history"
      data-testid="pick-trade-history-modal"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-white/10 bg-[#060d1e] shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-white/8 px-4 py-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-cyan-300/80" aria-hidden />
            <div>
              <h2 className="text-sm font-semibold text-white">Pick trade history</h2>
              <p className="text-[11px] text-white/50">
                {tradedPicks.length} {tradedPicks.length === 1 ? 'traded pick' : 'traded picks'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
            aria-label="Close"
            data-testid="pick-trade-history-modal-close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {byRound.length === 0 ? (
            <p className="py-8 text-center text-xs text-white/45">No picks have been traded yet.</p>
          ) : (
            <div className="space-y-4">
              {byRound.map(([round, entries]) => (
                <section key={round}>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-cyan-200/80">
                    Round {round}
                  </p>
                  <ul className="space-y-1">
                    {entries.map((entry, idx) => {
                      const isFocus =
                        focusRound === round &&
                        focusOriginalRosterId != null &&
                        entry.originalRosterId === focusOriginalRosterId
                      return (
                        <li
                          key={`${round}-${entry.originalRosterId}-${idx}`}
                          ref={isFocus ? focusRef : undefined}
                          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] transition ${
                            isFocus
                              ? 'border-amber-400/50 bg-amber-500/10 ring-1 ring-amber-300/40'
                              : 'border-white/10 bg-white/[0.03]'
                          }`}
                          data-testid={`pick-trade-history-row-${round}-${entry.originalRosterId}`}
                        >
                          <span className="min-w-0 flex-1 truncate font-medium text-white/90">
                            {entry.previousOwnerName || 'Unknown'}
                          </span>
                          <ArrowRight className="h-3 w-3 shrink-0 text-white/45" aria-hidden />
                          <span className="min-w-0 flex-1 truncate text-right font-medium text-cyan-200">
                            {entry.newOwnerName || 'Unknown'}
                          </span>
                          {entry.season ? (
                            <span className="ml-2 shrink-0 rounded border border-white/10 bg-black/25 px-1.5 py-0.5 text-[11px] text-white/55">
                              {entry.season}
                            </span>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>

        <footer className="border-t border-white/8 bg-[#050c1d] px-4 py-2 text-[11px] text-white/40">
          Read-only · open a pick's menu to propose new trades
        </footer>
      </div>
    </div>
  )
}
