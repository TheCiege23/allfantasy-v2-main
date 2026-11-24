'use client'

import { c2cScoreModeDescription, type C2CConfigClient } from '@/lib/c2c/c2cUiLabels'

export function C2CScoreSummaryBar({
  campus,
  canton,
  total,
  config,
  compact,
}: {
  campus: number | null
  canton: number | null
  total: number | null
  config: C2CConfigClient
  compact?: boolean
}) {
  const sum = Math.max((campus ?? 0) + (canton ?? 0), 0.0001)
  const campusPct = (campus ?? 0) / sum
  const cantonPct = (canton ?? 0) / sum
  const desc = c2cScoreModeDescription(config)

  return (
    <div
      className={`rounded-xl border border-white/[0.08] bg-[var(--surface)] p-3 ${compact ? 'max-w-full' : ''}`}
      data-testid="c2c-score-summary-bar"
    >
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--campus)]">🎓 Campus</p>
          {campus != null ? (
            <>
              <p className="text-lg font-bold text-[var(--campus)]">
                {campus.toFixed(1)}
              </p>
              <p className="text-[11px] text-[var(--muted)]">pts</p>
            </>
          ) : (
            <p className="mt-1 text-[11px] leading-tight text-[var(--muted)]" data-testid="c2c-campus-no-scoring">
              No college scoring yet
            </p>
          )}
        </div>
        <div className="flex flex-col justify-center">
          <p className="text-[11px] font-bold uppercase text-[var(--muted)]">Total</p>
          {total != null ? (
            <p className="text-xl font-extrabold text-[var(--text)]">{total.toFixed(1)}</p>
          ) : (
            <p className="mt-1 text-[11px] leading-tight text-[var(--muted)]">Not scored yet</p>
          )}
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--canton)]">🏙 Canton</p>
          {canton != null ? (
            <>
              <p className="text-lg font-bold text-[var(--canton)]">
                {canton.toFixed(1)}
              </p>
              <p className="text-[11px] text-[var(--muted)]">pts</p>
            </>
          ) : (
            <p className="mt-1 text-[11px] leading-tight text-[var(--muted)]">Not scored yet</p>
          )}
        </div>
      </div>
      <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full bg-violet-600/80 transition-[width] duration-300"
          style={{ width: `${Math.round(campusPct * 100)}%` }}
          aria-hidden
        />
        <div
          className="h-full bg-blue-600/80 transition-[width] duration-300"
          style={{ width: `${Math.round(cantonPct * 100)}%` }}
          aria-hidden
        />
      </div>
      <p className="mt-2 text-center text-[11px] text-[var(--muted)]">{desc}</p>
    </div>
  )
}
