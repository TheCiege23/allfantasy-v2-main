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
import { RedraftWarRoomPanel } from './redraft/RedraftWarRoomPanel'
import { DynastyWarRoomPanel } from './dynasty/DynastyWarRoomPanel'
import { KeeperWarRoomPanel } from './keeper/KeeperWarRoomPanel'
import { BestBallWarRoomPanel } from './best-ball/BestBallWarRoomPanel'
import { GuillotineWarRoomPanel } from './guillotine/GuillotineWarRoomPanel'
import { FeatureGate } from '@/components/subscription/FeatureGate'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { isDynastyLeague } from '@/lib/league/isDynastyLeague'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'
import { resolveRedraftIdentity } from '@/lib/league-media/redraftIdentity'
import './redraft-tailwind-tabs.css'
import { usesDynastyBackground } from '@/lib/league-media/dynastyBackground'
import '@/components/dynasty/dynasty-details.css'

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
      className="rdt-tile group p-3"
      data-testid={`war-room-quick-${title.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 rdt-accent" strokeWidth={2} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold rdt-text">{title}</p>
          <p className="mt-1 text-[11px] leading-snug rdt-faint">{description}</p>
        </div>
        <ArrowRight className="rdt-tile-arrow h-4 w-4 shrink-0 transition" />
      </div>
    </Link>
  )
}

function GatedToolCard({ tool }: { tool: GatedTool }) {
  return (
    <FeatureGate featureId={tool.featureId} featureNameOverride={tool.title}>
      <div className="rdt-tile p-3">
        <p className="text-xs font-semibold rdt-text">{tool.title}</p>
        <p className="mt-1 text-[11px] rdt-faint">{tool.description}</p>
        <Link
          href={tool.href}
          className="rdt-link mt-2 inline-flex items-center gap-1 text-[11px]"
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
  // Redraft (non-dynasty) leagues mount the data-grounded Redraft AF War Room panel.
  // `format` is the canonical UserLeague discriminator ('redraft' for non-dynasty,
  // non-variant leagues; specialty variants carry their own format). Fall back to
  // `leagueType` when present. Dynasty/specialty formats keep the strategy/meta view.
  // One shared predicate (lib/league/isDynastyLeague.ts); this used to read `isDynasty` only.
  const isDynasty = isDynastyLeague(league)
  const isGuillotineLeague =
    Boolean(league.guillotineMode) || String(league.leagueVariant ?? '').toLowerCase() === 'guillotine'
  const isBestBallLeague = !isGuillotineLeague && Boolean(league.bestBallMode)
  const isKeeperLeague =
    !isDynasty &&
    !isGuillotineLeague &&
    !isBestBallLeague &&
    (String(league.format ?? '').toLowerCase() === 'keeper' ||
      String(league.leagueType ?? '').toLowerCase() === 'keeper')
  const isRedraftLeague =
    !isDynasty &&
    !isGuillotineLeague &&
    !isKeeperLeague &&
    !isBestBallLeague &&
    (String(league.format ?? '').toLowerCase() === 'redraft' ||
      String(league.leagueType ?? '').toLowerCase() === 'redraft')
  const identity = resolveRedraftIdentity(league)
  const [metaFrame, setMetaFrame] = useState<'24h' | '7d' | '30d'>('7d')
  // Dynasty only: the header's violet becomes the Dynasty Era gold.
  const dynastyEra = usesDynastyBackground(league)
  const liveDraftCompanion = league.status === 'drafting'
  const leagueDraftCompanion = useLeagueWarRoomCompanion({
    leagueId: league.id,
    sport: resolved,
    leagueName: league.name,
    isDynasty,
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
        description: 'Practice drafts with AI helpers and AF Legacy context.',
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
        description: 'Session-based draft strategy builds (AF Legacy).',
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
        cta: 'View AF Legacy hub',
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
        description: 'Collegiate and devy asset rankings (AF Legacy).',
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
        description: 'Prospect and pipeline evaluation (AF Legacy).',
        href: '/trade-finder',
        cta: 'Analyze pipeline',
      },
    ],
    [sportQs],
  )

  return (
    <div
      className="rdt min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 md:px-5 md:py-5"
      data-redraft={identity ? 'true' : undefined}
      data-testid="league-war-room-tab"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={dynastyEra ? 'dyd-accent-box flex h-9 w-9 items-center justify-center rounded-xl' : 'flex h-9 w-9 items-center justify-center rounded-xl border rdt-accent-line rdt-accent-soft'}>
              <Telescope className={dynastyEra ? 'dyd-accent-icon h-4 w-4' : 'h-4 w-4 rdt-accent'} strokeWidth={2} />
            </span>
            <div>
              <p className={`rdt-eyebrow ${identity ? 'rdt-eyebrow-accent' : ''}`}>
                {identity
                  ? `Redraft war room · ${identity.sportLabel}${typeof league.currentWeek === 'number' ? ` · Week ${league.currentWeek}` : ''}`
                  : 'War room'}
              </p>
              <h1 className="text-lg font-bold tracking-tight rdt-text md:text-xl">AF Legacy</h1>
              <p className="text-[12px] rdt-faint">
                Strategy, draft prep, and meta — scoped for{' '}
                <span className="rdt-muted">{league.name}</span> · {sportU}
              </p>
            </div>
          </div>
        </div>
        <Link
          href="/war-room"
          className={
            dynastyEra
              ? 'dyd-accent-box shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition'
              : 'rdt-season-chip shrink-0 transition hover:brightness-110'
          }
        >
          Plans & pricing
        </Link>
      </header>

      <div className="rdt-bridge">
        <AFWarRoomPlanSpotlight className="border-white/[0.06]" />
      </div>

      {/* Redraft leagues get a data-grounded War Room scoped to THIS league. */}
      {isRedraftLeague ? <RedraftWarRoomPanel leagueId={league.id} /> : null}

      {/* Dynasty leagues get the dynasty-horizon War Room (value/age/direction). */}
      {isDynasty ? <DynastyWarRoomPanel leagueId={league.id} /> : null}

      {/* Keeper leagues get the keeper War Room (value surplus / keep-cut / draft plan). */}
      {isKeeperLeague ? <KeeperWarRoomPanel leagueId={league.id} /> : null}

      {/* Best-ball leagues get the best-ball War Room (construction / depth / upside / stacks). */}
      {isBestBallLeague ? <BestBallWarRoomPanel leagueId={league.id} /> : null}

      {/* Guillotine leagues get the survival-first War Room (elimination risk / FAAB / weekly plan). */}
      {isGuillotineLeague ? <GuillotineWarRoomPanel leagueId={league.id} /> : null}

      {liveDraftCompanion && leagueDraftCompanion.error ? (
        <p
          className="rounded-lg border rdt-warn-line rdt-warn-soft px-3 py-2 text-[11px] rdt-warn"
          data-testid="war-room-companion-error"
        >
          {leagueDraftCompanion.error}
        </p>
      ) : null}

      <div className="rdt-bridge">
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
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="rdt-eyebrow">Live meta snapshot</h2>
          <div className="rdt-seg" role="group" aria-label="Meta timeframe">
            {(['24h', '7d', '30d'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setMetaFrame(f)}
                aria-pressed={metaFrame === f}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="rdt-bridge">
          <WarRoomMetaWidget sport={resolved} timeframe={metaFrame} variant="embed" />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="rdt-eyebrow">Always-on tools</h2>
        <p className="text-[11px] rdt-faint">
          Open meta, strategy, mock draft, and trade tools. Some flows may prompt for AF Legacy or tokens where
          policy requires.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {quickLinks.map((q) => (
            <ToolLinkCard key={q.href + q.title} {...q} />
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="rdt-eyebrow">AF Legacy premium</h2>
        <p className="text-[11px] rdt-faint">
          Gated capabilities — unlock with AF Legacy or eligible token spend. Upgrade from the spotlight above.
        </p>
        <div className="rdt-bridge grid gap-3 sm:grid-cols-2">
          {gatedTools.map((t) => (
            <GatedToolCard key={t.featureId} tool={t} />
          ))}
        </div>
      </section>
    </div>
  )
}
