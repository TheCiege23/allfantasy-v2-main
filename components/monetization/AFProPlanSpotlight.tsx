'use client'

import Link from 'next/link'
import { CheckCircle2, Coins, Crown, Shield, Telescope } from 'lucide-react'
import {
  trackTokenPurchaseClicked,
  trackUpgradeEntryClicked,
} from '@/lib/monetization-analytics'

const AF_PRO_FEATURES = [
  'Trade analyzer',
  'Chat',
  'Waivers',
  'Player-specific planning',
  'Matchup and player-specific recommendations',
  'Player-focused insights',
]

const DIFFERENTIATION = [
  {
    title: 'AF Pro',
    icon: Crown,
    copy: 'Player-specific tier for lineup and roster decisions.',
    tone: 'border-cyan-400/35 bg-cyan-500/10 text-cyan-100',
  },
  {
    title: 'AF Commissioner',
    icon: Shield,
    copy: 'League governance and commissioner automation tools.',
    tone: 'border-amber-400/35 bg-amber-500/10 text-amber-100',
  },
  {
    title: 'AF Legacy',
    icon: Telescope,
    copy: 'Draft room and long-horizon build workflows.',
    tone: 'border-violet-400/35 bg-violet-500/10 text-violet-100',
  },
]

export function AFProPlanSpotlight({ className = '' }: { className?: string }) {
  return (
    <section
      className={`rounded-2xl border border-cyan-400/20 bg-cyan-500/[0.06] p-4 ${className}`}
      data-testid="af-pro-spotlight"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">Why AF Pro</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/upgrade?plan=pro"
            onClick={() =>
              trackUpgradeEntryClicked({
                targetPlan: 'pro',
                surface: 'af_pro_spotlight',
                pagePath: window.location.pathname,
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/35 bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-500/25"
            data-testid="af-pro-upgrade-link"
          >
            <Crown className="h-3.5 w-3.5" />
            Upgrade to AF Pro
          </Link>
          <Link
            href="/tokens"
            onClick={() =>
              trackTokenPurchaseClicked({
                surface: 'af_pro_spotlight',
                pagePath: window.location.pathname,
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/35 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-500/25"
            data-testid="af-pro-token-link"
          >
            <Coins className="h-3.5 w-3.5" />
            Buy tokens
          </Link>
        </div>
      </div>

      <p className="mt-1 text-xs text-white/65">
        AF Pro is the player-specific tier. Use subscription access or tokens where policy allows.
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <article className="rounded-lg border border-white/10 bg-black/25 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-cyan-200/90">AF Pro includes</p>
          <ul className="mt-2 space-y-1.5 text-xs text-white/85">
            {AF_PRO_FEATURES.map((item) => (
              <li key={item} className="flex items-start gap-1.5" data-testid="af-pro-feature-item">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-lg border border-white/10 bg-black/25 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/75">How tiers differ</p>
          <div className="mt-2 space-y-2">
            {DIFFERENTIATION.map(({ title, icon: Icon, copy, tone }) => (
              <div
                key={title}
                className={`rounded-lg border px-2.5 py-2 text-xs ${tone}`}
                data-testid={`af-plan-diff-${title.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <p className="inline-flex items-center gap-1.5 font-semibold">
                  <Icon className="h-3.5 w-3.5" />
                  {title}
                </p>
                <p className="mt-1">{copy}</p>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  )
}

