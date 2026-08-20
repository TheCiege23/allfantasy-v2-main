'use client'

import { CheckCircle2, PartyPopper, X } from 'lucide-react'
import { FIRST_RUN_COPY } from '@/lib/league/first-run-i18n'

export function PostCreateCommissionerHero({
  leagueName,
  sportLabel,
  formatLabel,
  visibilityLabel,
  paidFreeLabel,
  readinessBadge,
  onDismiss,
}: {
  leagueName: string
  sportLabel: string
  formatLabel: string
  visibilityLabel: string | null
  paidFreeLabel: string | null
  readinessBadge: string
  onDismiss: () => void
}) {
  return (
    <div className="border-b border-cyan-500/20 bg-gradient-to-r from-[#061428]/98 via-[#081226]/98 to-[#0a1228]/98 px-4 py-3">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-500/10 text-cyan-200">
            <PartyPopper className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-200/80">{FIRST_RUN_COPY.heroEyebrow}</p>
            <h2 className="mt-0.5 truncate text-base font-semibold text-white/95">{leagueName}</h2>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-white/70">
                {sportLabel}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-white/70">
                {formatLabel}
              </span>
              {visibilityLabel ? (
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-white/70">
                  {visibilityLabel}
                </span>
              ) : null}
              {paidFreeLabel ? (
                <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-100/90">
                  {paidFreeLabel}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-end sm:self-start">
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-100/95">
            <CheckCircle2 className="h-3.5 w-3.5 opacity-90" aria-hidden />
            {readinessBadge}
          </span>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white/50 transition hover:bg-white/[0.06] hover:text-white/85"
            aria-label={FIRST_RUN_COPY.heroDismissAria}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  )
}
