'use client'

import Link from 'next/link'
import { CheckCircle2, Crown, Landmark, Shield, WandSparkles } from 'lucide-react'
import { trackUpgradeEntryClicked } from '@/lib/monetization-analytics'
import { getMonetizationCatalogItemBySku } from '@/lib/monetization/catalog'

/*
 * 🛑 AF SUPREME IS AF PRO + AF COMMISSIONER + AF LEGACY (owner's decision 2026-11-27;
 * SUPREME_INCLUDED_PLAN_IDS in lib/subscription/feature-access.ts). From 2026-10-25 to 2026-11-27 it was
 * Pro + Commissioner only, and this spotlight said so; it lists all three again, and offers the
 * "From AF Legacy" switch, which no longer takes anything away.
 *
 * ⚠ AND ITS YEARLY PRICE WAS TYPED IN: "$199.99 yearly" while checkout charges the catalog's
 * figure. Both prices are now read from the catalog, the same source the charge uses.
 */
function supremePrice(sku: 'af_supreme_monthly' | 'af_supreme_yearly'): string | null {
  const amount = getMonetizationCatalogItemBySku(sku)?.amountUsd
  return amount == null ? null : `$${amount.toFixed(2)}`
}
const SUPREME_MONTHLY = supremePrice('af_supreme_monthly')
const SUPREME_YEARLY = supremePrice('af_supreme_yearly')

const INCLUDED_PLANS = [
  {
    title: 'AF Pro',
    icon: Crown,
    copy: 'Player-specific tools for trades, waivers, matchups, and lineup moves.',
    tone: 'border-cyan-400/35 bg-cyan-500/10 text-cyan-100',
  },
  {
    title: 'AF Commissioner',
    icon: Shield,
    copy: 'League governance, automation, and commissioner intelligence controls.',
    tone: 'border-amber-400/35 bg-amber-500/10 text-amber-100',
  },
  {
    title: 'AF Legacy',
    icon: Landmark,
    copy: 'Dynasty and long-horizon tools: the War Room, draft-room strategy and your league history.',
    tone: 'border-violet-400/35 bg-violet-500/10 text-violet-100',
  },
]

const SIMPLE_VALUE_POINTS = [
  'One subscription unlocks AF Pro, AF Commissioner and AF Legacy.',
  'Costs less than buying the three separately.',
]

export function AFSupremeBundleSpotlight({ className = '' }: { className?: string }) {
  return (
    <section
      className={`rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.06] p-4 ${className}`}
      data-testid="af-supreme-spotlight"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">AF Supreme bundle</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/upgrade?plan=supreme"
            onClick={() =>
              trackUpgradeEntryClicked({
                targetPlan: 'supreme',
                surface: 'af_supreme_spotlight',
                pagePath: window.location.pathname,
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/35 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-500/25"
            data-testid="af-supreme-upgrade-link"
          >
            <WandSparkles className="h-3.5 w-3.5" />
            Upgrade to AF Supreme
          </Link>
          <Link
            href="/pricing"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/85 hover:bg-white/10"
            data-testid="af-supreme-compare-link"
          >
            Compare plans
          </Link>
        </div>
      </div>

      <p className="mt-1 text-xs text-white/70">
        AF Pro, AF Commissioner and AF Legacy in one subscription.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {SUPREME_MONTHLY ? (
          <span
            className="rounded-full border border-emerald-300/40 bg-emerald-500/15 px-2.5 py-1 font-semibold text-emerald-100"
            data-testid="af-supreme-price-monthly"
          >
            {SUPREME_MONTHLY} monthly
          </span>
        ) : null}
        {SUPREME_YEARLY ? (
          <span
            className="rounded-full border border-emerald-300/40 bg-emerald-500/15 px-2.5 py-1 font-semibold text-emerald-100"
            data-testid="af-supreme-price-yearly"
          >
            {SUPREME_YEARLY} yearly
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <article className="rounded-lg border border-white/10 bg-black/25 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-emerald-200/90">Why it is simpler</p>
          <ul className="mt-2 space-y-1.5 text-xs text-white/85">
            {SIMPLE_VALUE_POINTS.map((item) => (
              <li key={item} className="flex items-start gap-1.5" data-testid="af-supreme-value-item">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-white/65" data-testid="af-supreme-token-clarity-copy">
            {/*
              Used to promise a monthly and a yearly token grant — a grant that stopped on the day
              subscriptions stopped carrying tokens (catalog.ts tokenAmount: null; subscription-policy
              grants 0). Fixed 2026-10-03 when the honesty test caught it.
            */}
            Every AF Supreme feature is unlocked outright, so you never spend tokens on them. Tokens are only for pay-as-you-go use without a plan.
          </p>
        </article>

        <article className="rounded-lg border border-white/10 bg-black/25 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/75">Bundle inheritance</p>
          <div className="mt-2 space-y-2">
            {INCLUDED_PLANS.map(({ title, icon: Icon, copy, tone }) => (
              <div
                key={title}
                className={`rounded-lg border px-2.5 py-2 text-xs ${tone}`}
                data-testid={`af-supreme-includes-${title.toLowerCase().replace(/\s+/g, '-')}`}
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

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/75">
        <span>Switch from an individual plan:</span>
        <Link
          href="/upgrade?plan=supreme&from=pro"
          onClick={() =>
            trackUpgradeEntryClicked({
              targetPlan: 'supreme',
              sourcePlan: 'pro',
              surface: 'af_supreme_spotlight',
              pagePath: window.location.pathname,
            })
          }
          className="rounded-full border border-cyan-400/35 bg-cyan-500/10 px-2 py-0.5 text-cyan-100 hover:bg-cyan-500/20"
          data-testid="af-supreme-switch-from-pro"
        >
          From AF Pro
        </Link>
        <Link
          href="/upgrade?plan=supreme&from=commissioner"
          onClick={() =>
            trackUpgradeEntryClicked({
              targetPlan: 'supreme',
              sourcePlan: 'commissioner',
              surface: 'af_supreme_spotlight',
              pagePath: window.location.pathname,
            })
          }
          className="rounded-full border border-amber-400/35 bg-amber-500/10 px-2 py-0.5 text-amber-100 hover:bg-amber-500/20"
          data-testid="af-supreme-switch-from-commissioner"
        >
          From AF Commissioner
        </Link>
        {/* "From AF Legacy" since 2026-11-27: Supreme includes Legacy, so the switch takes nothing away. */}
        <Link
          href="/upgrade?plan=supreme&from=war_room"
          onClick={() =>
            trackUpgradeEntryClicked({
              targetPlan: 'supreme',
              sourcePlan: 'war_room',
              surface: 'af_supreme_spotlight',
              pagePath: window.location.pathname,
            })
          }
          className="rounded-full border border-violet-400/35 bg-violet-500/10 px-2 py-0.5 text-violet-100 hover:bg-violet-500/20"
          data-testid="af-supreme-switch-from-war-room"
        >
          From AF Legacy
        </Link>
      </div>
    </section>
  )
}
