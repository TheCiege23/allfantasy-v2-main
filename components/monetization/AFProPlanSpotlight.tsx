'use client'

import Link from 'next/link'
import { CheckCircle2, Coins, Crown, Gem, Shield } from 'lucide-react'
import {
  trackTokenPurchaseClicked,
  trackUpgradeEntryClicked,
} from '@/lib/monetization-analytics'
import { PLAN_FAMILY_INCLUDES, PLAN_FAMILY_SHORT_TAGLINE } from '@/lib/monetization/planIncludes'

/*
 * ⚠ READ FROM THE PLAN CARDS' OWN SOURCE, NOT TYPED HERE. This list was a hand-written copy —
 * "Trade analyzer, Chat, Waivers, Player-specific planning…" — that described no gate the app
 * enforces, sitting directly above the plan card that lists the real ones. It now shows the same
 * bullets as that card (lib/monetization/planIncludes.ts), so the two cannot disagree again.
 */
const AF_PRO_FEATURES = PLAN_FAMILY_INCLUDES.af_pro

/* The three plans on sale. AF Legacy is not offered on the launch pricing, so it is not here. */
const DIFFERENTIATION = [
  {
    title: 'AF Pro',
    icon: Crown,
    copy: PLAN_FAMILY_SHORT_TAGLINE.af_pro,
    tone: 'border-cyan-400/35 bg-cyan-500/10 text-cyan-100',
  },
  {
    title: 'AF Commissioner',
    icon: Shield,
    copy: PLAN_FAMILY_SHORT_TAGLINE.af_commissioner,
    tone: 'border-amber-400/35 bg-amber-500/10 text-amber-100',
  },
  {
    title: 'AF Supreme',
    icon: Gem,
    copy: PLAN_FAMILY_SHORT_TAGLINE.af_supreme,
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
        Deep player and trade analysis, Competitive Edge, and Chimmy answers every day. Tokens pay
        for single AI actions without a plan.
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

