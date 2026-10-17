'use client'

import Link from 'next/link'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { StartVsApiResponse } from '@/lib/player-comparison-lab'
import { cn } from '@/lib/utils'

export interface StartVsComparisonModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: StartVsApiResponse | null
}

export function StartVsComparisonModal({ open, onOpenChange, data }: StartVsComparisonModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-lg border-white/12 bg-[#0a1228]/98 text-white backdrop-blur-xl sm:max-w-xl"
        data-testid="start-vs-modal"
      >
        {!data ? (
          <p className="text-sm text-white/55">No comparison loaded.</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-lg text-white">
                {data.playerA.name} vs {data.playerB.name}
              </DialogTitle>
              <p className="text-left text-sm text-white/55">{data.short_verdict}</p>
            </DialogHeader>

            <div className="max-h-[60vh] overflow-y-auto pr-1">
              <section className="mb-4 space-y-2 rounded-xl border border-sky-500/20 bg-sky-500/10 p-3 text-sm">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-sky-200/90">Coach snapshot</h4>
                <p className="leading-relaxed text-white/88">{data.coach_lens.concise_explanation}</p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {data.coach_lens.dimensions_used.map((d) => (
                    <span
                      key={d}
                      className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[11px] text-white/55"
                    >
                      {d.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </section>

              <section className="space-y-3 text-sm">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-white/40">Full reasoning</h4>
                <p className="leading-relaxed text-white/80">{data.full_reasoning}</p>

                <h4 className="pt-2 text-xs font-semibold uppercase tracking-wide text-white/40">
                  Factor breakdown
                </h4>
                <ul className="space-y-2">
                  {data.factor_comparison.slice(0, 14).map((row) => (
                    <li
                      key={`${row.factor}-${row.player_a_score}-${row.player_b_score}`}
                      className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2"
                    >
                      <div className="flex justify-between gap-2 text-xs font-medium text-white/85">
                        <span>{row.factor}</span>
                        <span
                          className={cn(
                            row.winner === 'playerA' && 'text-sky-300',
                            row.winner === 'playerB' && 'text-violet-300',
                            row.winner === 'tie' && 'text-amber-200/90'
                          )}
                        >
                          {row.winner === 'playerA'
                            ? 'A'
                            : row.winner === 'playerB'
                              ? 'B'
                              : row.winner === 'tie'
                                ? 'Tie'
                                : '—'}
                        </span>
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-2 text-[11px] text-white/50">
                        <span>A: {row.player_a_score != null ? row.player_a_score.toFixed(1) : '—'}</span>
                        <span>B: {row.player_b_score != null ? row.player_b_score.toFixed(1) : '—'}</span>
                      </div>
                    </li>
                  ))}
                </ul>

                {data.risk_flags.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-200/80">Risk</h4>
                    <ul className="mt-1 list-disc pl-4 text-xs text-amber-100/80">
                      {data.risk_flags.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {data.news_flags.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-sky-200/80">News</h4>
                    <ul className="mt-1 list-disc pl-4 text-xs text-white/70">
                      {data.news_flags.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            </div>

            <div className="flex flex-col gap-2 border-t border-white/10 pt-4 sm:flex-row">
              <Link
                href={data.actions.set_lineup.href}
                className="inline-flex flex-1 items-center justify-center rounded-lg bg-sky-500/90 px-4 py-2 text-sm font-semibold text-[#040915]"
                data-testid="start-vs-modal-lineup"
              >
                {data.actions.set_lineup.label}
              </Link>
              <Link
                href={data.actions.ask_chimmy.href}
                className="inline-flex flex-1 items-center justify-center rounded-lg border border-white/15 bg-white/[0.05] px-4 py-2 text-sm text-sky-200"
              >
                {data.actions.ask_chimmy.label}
              </Link>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
