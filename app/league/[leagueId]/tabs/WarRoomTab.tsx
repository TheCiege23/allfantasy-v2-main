'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useLeagueWarRoomCompanion } from '@/hooks/useLeagueWarRoomCompanion'
import {
  ArrowRight,
  BookOpen,
  Coins,
  LineChart,
  Scale,
  Sparkles,
  Telescope,
  Wrench,
} from 'lucide-react'
import type { UserLeague } from '@/app/dashboard/types'
import { AFWarRoomPlanSpotlight } from '@/components/monetization/AFWarRoomPlanSpotlight'
import WarRoomMetaWidget from '@/components/meta-insights/WarRoomMetaWidget'
import { WarRoomPanel } from '@/components/war-room'
import { FeatureGate } from '@/components/subscription/FeatureGate'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'

export type WarRoomTabProps = {
  league: UserLeague
  sport?: string
  dashboardEmbed?: boolean
}

type QuickLink = { title: string; description: string; href: string; icon: typeof Telescope }

type GatedTool = {
  featureId: SubscriptionFeatureId
  title: string
  description: string
  href: string
  cta: string
}

function ToolLinkCard({
  title,
  description,
  href,
  icon: Icon,
}: QuickLink) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-xl border border-white/[0.08] bg-[#07071a] p-3 transition hover:border-cyan-500/20 hover:bg-white/[0.03]"
      data-testid={`war-room-quick-${title.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400/80" strokeWidth={2} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-white">{title}</p>
          <p className="mt-1 text-[11px] leading-snug text-white/45">{description}</p>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-white/25 transition group-hover:text-cyan-400/70" />
      </div>
    </Link>
  )
}

function GatedToolCard({ tool }: { tool: GatedTool }) {
  return (
    <FeatureGate featureId={tool.featureId} featureNameOverride={tool.title}>
      <div className="rounded-xl border border-white/[0.08] bg-[#07071a] p-3">
        <p className="text-xs font-semibold text-white">{tool.title}</p>
        <p className="mt-1 text-[11px] text-white/45">{tool.description}</p>
        <Link
          href={tool.href}
          className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-400/90 hover:text-cyan-300"
        >
          {tool.cta}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </FeatureGate>
  )
}

export function WarRoomTab({ league, sport, dashboardEmbed = false }: WarRoomTabProps) {
  const resolved = normalizeToSupportedSport(sport ?? league.sport) ?? 'NFL'
  const sportU = resolved.toUpperCase()
  const [metaFrame, setMetaFrame] = useState<'24h' | '7d' | '30d'>('7d')
  const liveDraftCompanion = league.status === 'drafting'
  const leagueDraftCompanion = useLeagueWarRoomCompanion({
    leagueId: league.id,
    sport: resolved,
    leagueName: league.name,
    isDynasty: Boolean(league.isDynasty),
    enabled: liveDraftCompanion,
  })

  const sportQs = useMemo(() => encodeURIComponent(resolved), [resolved])

  const quickLinks: QuickLink[] = useMemo(
    () => [
      {
        title: 'Meta insights',
        description: 'Global meta dashboard — trends, strategies, and signals.',
        href: '/app/meta-insights',
        icon: LineChart,
      },
      {
        title: 'Strategy meta',
        description: 'Position and strategy usage across the platform.',
        href: `/app/strategy-meta?sport=${sportQs}&timeframe=7d`,
        icon: Sparkles,
      },
      {
        title: 'Player trend feed',
        description: 'Hottest players and movement for your sport.',
        href: `/app/trend-feed?sport=${sportQs}&timeframe=7d`,
        icon: Telescope,
      },
      {
        title: 'Mock draft simulator',
        description: 'Practice drafts with AI helpers and War Room context.',
        href: '/mock-draft-simulator',
        icon: Wrench,
      },
      {
        title: 'Trade finder',
        description: 'Find partners and structure dynasty / redraft trades.',
        href: '/trade-finder',
        icon: Coins,
      },
      {
        title: 'Dynasty insights',
        description: 'Long-horizon roster and asset context.',
        href: `/app/dynasty-insights?sport=${sportQs}`,
        icon: BookOpen,
      },
      {
        title: 'Dynasty trade analyzer',
        description: 'Value-based trade breakdowns for dynasty leagues.',
        href: '/dynasty-trade-analyzer',
        icon: Scale,
      },
      {
        title: 'Power rankings',
        description: 'League and player power views with AI commentary.',
        href: '/power-rankings',
        icon: Sparkles,
      },
    ],
    [sportQs],
  )

  const gatedTools: GatedTool[] = useMemo(
    () => [
      {
        featureId: 'draft_strategy_build',
        title: 'Draft strategy builder',
        description: 'Session-based draft strategy builds (War Room).',
        href: '/mock-draft-simulator',
        cta: 'Open mock draft',
      },
      {
        featureId: 'draft_prep',
        title: 'Draft planning',
        description: 'Pick explanations and prep flows tied to your draft.',
        href: '/mock-draft-simulator',
        cta: 'Start planning',
      },
      {
        featureId: 'future_planning',
        title: 'Future-year planning',
        description: 'Multi-season roster and pick planning.',
        href: '/war-room',
        cta: 'View War Room hub',
      },
      {
        featureId: 'multi_year_strategy',
        title: 'Long-range strategy',
        description: '3–5 year team construction and moves.',
        href: '/war-room',
        cta: 'Open planning',
      },
      {
        featureId: 'war_room_dynasty_projections',
        title: 'Dynasty projections',
        description: 'Premium dynasty projection surfaces.',
        href: `/app/dynasty-insights?sport=${sportQs}`,
        cta: 'Open projections',
      },
      {
        featureId: 'war_room_devy_rankings',
        title: 'Devy rankings',
        description: 'Collegiate and devy asset rankings (War Room).',
        href: '/app/dynasty-insights',
        cta: 'View devy context',
      },
      {
        featureId: 'war_room_draft_strategy',
        title: 'Draft strategy (catalog)',
        description: 'Advanced draft strategy tooling.',
        href: '/mock-draft-simulator',
        cta: 'Open tools',
      },
      {
        featureId: 'war_room_pipeline_analysis',
        title: 'Pipeline analysis',
        description: 'Prospect and pipeline evaluation (War Room).',
        href: '/trade-finder',
        cta: 'Analyze pipeline',
      },
    ],
    [sportQs],
  )

  return (
    <div
      className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 md:px-5 md:py-5"
      data-testid="league-war-room-tab"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-400/25 bg-violet-500/15">
              <Telescope className="h-4 w-4 text-violet-200" strokeWidth={2} />
            </span>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white md:text-xl">AF War Room</h1>
              <p className="text-[12px] text-white/45">
                Strategy, draft prep, and meta — scoped for{' '}
                <span className="text-white/65">{league.name}</span> · {sportU}
              </p>
            </div>
          </div>
        </div>
        <Link
          href="/war-room"
          className="shrink-0 rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1.5 text-[11px] font-semibold text-violet-100 transition hover:bg-violet-500/20"
        >
          Plans & pricing
        </Link>
      </header>

      <AFWarRoomPlanSpotlight className="border-white/[0.06]" />

      {liveDraftCompanion && leagueDraftCompanion.error ? (
        <p
          className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100/90"
          data-testid="war-room-companion-error"
        >
          {leagueDraftCompanion.error}
        </p>
      ) : null}

      <WarRoomPanel
        leagueId={league.id}
        sport={resolved}
        companionDraft={
          liveDraftCompanion
            ? { active: true, draftRoomHref: `/league/${league.id}/draft` }
            : { active: false }
        }
        draftCompanionCopilot={liveDraftCompanion ? leagueDraftCompanion.copilot : null}
        draftCompanionIntelligence={liveDraftCompanion ? leagueDraftCompanion.intelligence : null}
        draftCopilotEmptyMessage={liveDraftCompanion ? leagueDraftCompanion.copilotEmptyMessage : null}
        draftCompanionDataLoading={liveDraftCompanion ? leagueDraftCompanion.loading : false}
        onDraftCompanionRefresh={liveDraftCompanion ? () => void leagueDraftCompanion.refresh() : undefined}
        dashboardEmbed={dashboardEmbed}
      />

      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/40">Live meta snapshot</h2>
          <div className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-[#07071a] p-0.5">
            {(['24h', '7d', '30d'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setMetaFrame(f)}
                className={`rounded-md px-2 py-1 text-[10px] font-semibold ${
                  metaFrame === f ? 'bg-cyan-500/20 text-cyan-100' : 'text-white/45 hover:text-white/70'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <WarRoomMetaWidget sport={resolved} timeframe={metaFrame} variant="embed" />
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/40">Always-on tools</h2>
        <p className="text-[11px] text-white/35">
          Open meta, strategy, mock draft, and trade tools. Some flows may prompt for AF War Room or tokens where
          policy requires.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {quickLinks.map((q) => (
            <ToolLinkCard key={q.href + q.title} {...q} />
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/40">AF War Room premium</h2>
        <p className="text-[11px] text-white/35">
          Gated capabilities — unlock with AF War Room or eligible token spend. Upgrade from the spotlight above.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {gatedTools.map((t) => (
            <GatedToolCard key={t.featureId} tool={t} />
          ))}
        </div>
      </section>
    </div>
  )
}
