'use client'

import Link from 'next/link'
import { CheckCircle2, Crown, ShieldAlert } from 'lucide-react'
import { PaidLeagueNotice } from '@/components/legal/PaidLeagueNotice'

const FREE_FEATURES = [
  'Basic league creation',
  'Basic league management',
  'Running free or paid leagues',
  'General commissioner actions outside premium Chimmy/advanced setup',
]

const PREMIUM_FEATURES = [
  'Advanced scoring features',
  'Advanced playoff setup',
  'Chimmy collusion detection',
  'Chimmy tanking detection',
  'Storyline creation',
  'League rankings',
  'Draft rankings',
  'Chimmy team managers',
]

export function CommissionerMonetizationOverview({
  compact = false,
  className = '',
}: {
  compact?: boolean
  className?: string
}) {
  return (
    <section
      className={`rounded-2xl border border-white/10 bg-black/20 p-4 ${className}`}
      data-testid="commissioner-monetization-overview"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">Commissioner Access Breakdown</h2>
        <Link
          href="/commissioner-upgrade"
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-500/25"
          data-testid="commissioner-monetization-upgrade-link"
        >
          <Crown className="h-3.5 w-3.5" />
          Upgrade to AF Commissioner
        </Link>
      </div>

      <p className="mt-1 text-xs text-white/60">
        Core commissioner controls stay free. Premium Chimmy and advanced setup tools are clearly marked below.
      </p>

      <div className={`mt-3 grid gap-3 ${compact ? 'md:grid-cols-1' : 'md:grid-cols-2'}`}>
        <article className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-emerald-100">Free Commissioner Features</p>
          <ul className="mt-2 space-y-1.5 text-xs text-emerald-50/95">
            {FREE_FEATURES.map((item) => (
              <li key={item} className="flex items-start gap-1.5" data-testid="commissioner-free-feature-item">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-amber-100">AF Commissioner Premium Features</p>
          <ul className="mt-2 space-y-1.5 text-xs text-amber-50/95">
            {PREMIUM_FEATURES.map((item) => (
              <li key={item} className="flex items-start gap-1.5" data-testid="commissioner-premium-feature-item">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>

      <PaidLeagueNotice
        compact
        showFanCredCta
        ctaLabel="Open FanCred setup"
        ctaTestId="commissioner-overview-fancred-link"
        dataTestId="commissioner-paid-league-boundary-copy"
        className="mt-3"
      />
    </section>
  )
}

