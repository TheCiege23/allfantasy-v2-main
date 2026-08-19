'use client'

import Link from 'next/link'
import { useAccessTier } from '@/hooks/useAccessTier'

/**
 * Surfaces the real, working /af-legacy toolset as clickable dashboard cards. Reuses that
 * page's own tab copy (LegacyTradeTabHeader / LegacyWaiverTabIntro / LegacyCompareIntro /
 * LegacyRankingsIntro / LegacyPulseIntro) for the preview text rather than the 18k-line page
 * itself — every tier sees the same honest description; only the entry CTA changes.
 *
 * The free-preview/deep-paid line is drawn at the dashboard entry point, not by editing
 * heavy-action buttons inside the existing af-legacy tabs (that page has no per-tab gating
 * today, and surgically wiring six separate inline sections inside an 18k-line file would be
 * exactly the invasive, hard-to-verify change this feature is meant to avoid). Guests get
 * "Sign up free"; signed-in free accounts get a labeled "Unlock with AF Legacy" upgrade CTA;
 * AF Legacy subscribers get the real tool.
 */

type ToolDef = {
  id: string
  tab: string
  icon: string
  title: string
  description: string
}

const TOOLS: ToolDef[] = [
  {
    id: 'trade',
    tab: 'trade',
    icon: '📋',
    title: 'Trade Command Center',
    description: 'Know if a trade helps or hurts your team before you accept.',
  },
  {
    id: 'finder',
    tab: 'finder',
    icon: '🔎',
    title: 'Trade Review',
    description: 'Finds and evaluates real trade opportunities against your own roster.',
  },
  {
    id: 'waiver',
    tab: 'waiver',
    icon: '↗',
    title: 'Waiver AI',
    description: 'League-specific, goal-aware waiver analysis with 4 scoring dimensions — not generic advice.',
  },
  {
    id: 'compare',
    tab: 'compare',
    icon: '⚔️',
    title: 'Opponent Behavior',
    description: 'One question. One answer. Compare any two Sleeper managers instantly.',
  },
  {
    id: 'rankings',
    tab: 'rankings',
    icon: '📈',
    title: 'Team Direction',
    description: 'See exactly where your team stands in the league hierarchy.',
  },
  {
    id: 'pulse',
    tab: 'pulse',
    icon: '📡',
    title: 'Market Board',
    description: 'Live search for real-time player and team news and sentiment.',
  },
]

export function LegacyToolsetGrid() {
  const accessTier = useAccessTier()
  const isPaidLegacy = accessTier.paidTiers.includes('war_room') || accessTier.paidTiers.includes('supreme')

  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-white/70">AF Legacy Toolset</h2>
        <Link
          href="/af-legacy"
          className="text-[11px] font-semibold text-cyan-300/80 hover:text-cyan-200"
          data-testid="legacy-toolset-view-all"
        >
          View all →
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLS.map((tool) => (
          <LegacyToolCard key={tool.id} tool={tool} isPaidLegacy={isPaidLegacy} accessTier={accessTier} />
        ))}
      </div>
    </section>
  )
}

function LegacyToolCard({
  tool,
  isPaidLegacy,
  accessTier,
}: {
  tool: ToolDef
  isPaidLegacy: boolean
  accessTier: ReturnType<typeof useAccessTier>
}) {
  const toolHref = `/af-legacy?tab=${tool.tab}`

  let cta: { href: string; label: string; tone: 'open' | 'signup' | 'upgrade' }
  if (isPaidLegacy) {
    cta = { href: toolHref, label: `Open ${tool.title} →`, tone: 'open' }
  } else if (accessTier.isGuest) {
    cta = { href: `/signup?next=${encodeURIComponent(toolHref)}`, label: 'Sign up free to try', tone: 'signup' }
  } else {
    cta = { href: '/pricing', label: 'Unlock with AF Legacy — $29.99/mo', tone: 'upgrade' }
  }

  return (
    <div
      className="flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4"
      data-testid={`legacy-tool-card-${tool.id}`}
    >
      <div>
        <div className="mb-2 flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base"
            style={{ background: 'color-mix(in srgb, var(--accent-purple, #a78bfa) 16%, transparent)' }}
            aria-hidden
          >
            {tool.icon}
          </span>
          <p className="text-[13px] font-bold text-white">{tool.title}</p>
        </div>
        <p className="text-[12px] leading-snug text-white/55">{tool.description}</p>
      </div>
      <Link
        href={cta.href}
        className={`mt-3 inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-semibold transition ${
          cta.tone === 'open'
            ? 'bg-cyan-500/90 text-[#04121a] hover:bg-cyan-400'
            : cta.tone === 'signup'
              ? 'border border-cyan-400/30 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20'
              : 'border border-amber-400/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
        }`}
        data-testid={`legacy-tool-cta-${tool.id}`}
      >
        {cta.label}
      </Link>
    </div>
  )
}
