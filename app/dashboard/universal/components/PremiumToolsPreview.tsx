'use client'

/**
 * Premium tools preview — the "show the breadth, sell the depth" strip (AF_GATE0 §2.6/§3.3).
 *
 * Renders the real gated deep tools (Trade Finder, Waiver Assistant, Projections, AF Legacy
 * draft strategy) as honest locked previews: the value proposition is ALWAYS visible (never a
 * blank/dead card), and the lock state + CTA come from the single `canAccess` seam via
 * `useCanAccess`. A guest/trial visitor sees "Sign up free"; a signed-in free user sees the
 * upgrade path; an entitled user gets a real "Open →" link. No fabricated numbers — copy only.
 *
 * Every href points at a real, existing route (`/trade-finder`, `/waiver-ai`, `/projections`,
 * `/war-room`). Feature ids match what each tool actually gates on, so lock state is truthful.
 */

import Link from 'next/link'
import { Lock, Sparkles } from 'lucide-react'
import { useCanAccess } from '@/hooks/useCanAccess'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'

type PremiumTool = {
  featureId: SubscriptionFeatureId
  icon: string
  title: string
  blurb: string
  href: string
  openLabel: string
}

const RETURN_TO = '/dashboard/universal'

const PREMIUM_TOOLS: PremiumTool[] = [
  {
    featureId: 'legacy_trade_finder',
    icon: '🔄',
    title: 'Trade Finder',
    blurb: "Find and evaluate trades built on your league's real scoring and roster settings — not generic rankings.",
    href: '/trade-finder',
    openLabel: 'Open Trade Finder',
  },
  {
    featureId: 'ai_waivers',
    icon: '📈',
    title: 'Waiver Assistant',
    blurb: 'Ranked add targets with FAAB guidance, grounded in your real roster needs and the latest news.',
    href: '/waiver-ai',
    openLabel: 'Open Waiver Assistant',
  },
  {
    featureId: 'pro_af_projections',
    icon: '📊',
    title: 'Projections',
    blurb: 'AllFantasy projections tuned to your league format, so you know what to expect before you set a lineup.',
    href: '/projections',
    openLabel: 'Open Projections',
  },
  {
    featureId: 'future_planning',
    icon: '🎯',
    title: 'Draft strategy',
    blurb: 'Pick recommendations, tier-cliff alerts, and roster-build strategy for your next draft.',
    href: '/war-room',
    openLabel: 'Open draft strategy',
  },
]

function PremiumToolCard({ tool }: { tool: PremiumTool }) {
  const gate = useCanAccess(tool.featureId, RETURN_TO)
  const planLabel = gate.requiredPlanLabel?.split(' — ')[0] ?? 'Premium'

  return (
    <div className="flex flex-col rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="mb-2 flex items-center gap-2">
        <span aria-hidden className="text-[18px] leading-none">
          {tool.icon}
        </span>
        <h3 className="text-[14px] font-bold text-white">{tool.title}</h3>
        {!gate.loading && gate.locked && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/45">
            <Lock className="h-3 w-3" aria-hidden />
            {planLabel}
          </span>
        )}
      </div>

      <p className="mb-3 flex-1 text-[12.5px] leading-5 text-white/55">{tool.blurb}</p>

      {gate.loading ? (
        <span className="text-[12px] text-white/35">Checking access…</span>
      ) : gate.allowed ? (
        <Link
          href={tool.href}
          className="inline-flex w-fit items-center gap-1 rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-1.5 text-[12px] font-bold text-cyan-200 transition hover:bg-cyan-500/20"
        >
          {tool.openLabel} →
        </Link>
      ) : (
        <Link
          href={gate.ctaHref}
          className="inline-flex w-fit items-center gap-1 rounded-lg bg-cyan-500/90 px-3 py-1.5 text-[12px] font-bold text-[#04121a] transition hover:bg-cyan-400"
        >
          {gate.ctaLabel}
        </Link>
      )}
    </div>
  )
}

export function PremiumToolsPreview() {
  return (
    <section className="mt-10">
      <div className="mb-1 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-cyan-300" aria-hidden />
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-white/70">Go deeper on every league</h2>
      </div>
      <p className="mb-4 text-[12px] text-white/45">
        Your leagues are in one place — now put them to work. Every tool runs on your real league data.
        Free to preview; sign up to use.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PREMIUM_TOOLS.map((tool) => (
          <PremiumToolCard key={tool.featureId} tool={tool} />
        ))}
      </div>
    </section>
  )
}
