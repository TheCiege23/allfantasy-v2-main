'use client'

/**
 * Fantasy OS Phase 4 — executive intelligence workspace (Parts 6–7).
 *
 * Renders the seven portfolio surfaces from provider-neutral contracts (computed server-side from the
 * certified non-production portfolio). Each surface answers distinct executive questions — not seven
 * identical pages. Truth labels + source window + limitations are always visible; recommendations render
 * only when the full explanation contract is satisfied.
 */
import { useState } from 'react'
import type {
  PlatformIntelligence,
  LeagueIntelligence,
  CommissionerIntelligence,
  TradeIntelligence,
  WaiverIntelligence,
  DraftIntelligence,
  ManagerIntelligence,
  RankedLeague,
} from '@/lib/fantasy-os/exec-intelligence/contracts'
import { isRenderableInsight, type Explanation } from '@/lib/fantasy-os/exec-intelligence/explanation'
import { EXEC_OFFSEASON_LIMITATION, sourceWindowLabel } from '@/lib/fantasy-os/exec-intelligence/truth'
import type { FreshnessContract } from '@/lib/fantasy-os/sync/freshness'
import {
  ExecutiveKpiCard,
  ExecutiveKpiRow,
  ExecutiveInsightPanel,
  InsufficientEvidenceState,
  WorkspaceSectionHeader,
  SourceWindowNotice,
  DataFreshness,
  SyncFreshnessBadge,
  fmt,
} from './primitives'
import { ExecutiveChartCard, YearBarChart, GroupedYearChart, DistributionBars, ChartLegend } from './charts'

export type ExecutiveWorkspaceData = {
  platform: PlatformIntelligence
  league: LeagueIntelligence
  commissioner: CommissionerIntelligence
  trade: TradeIntelligence
  waiver: WaiverIntelligence
  draft: DraftIntelligence
  manager: ManagerIntelligence
}

const TABS = [
  { id: 'platform', label: 'Platform', question: 'How large and active is the whole portfolio?' },
  { id: 'league', label: 'League', question: 'Which leagues are thriving vs stalled?' },
  { id: 'commissioner', label: 'Commissioner', question: 'Where is commissioner attention demanded?' },
  { id: 'trade', label: 'Trade', question: 'Is the trade market heating up or cooling?' },
  { id: 'waiver', label: 'Waiver', question: 'How competitive is the acquisition market?' },
  { id: 'draft', label: 'Draft', question: 'Is draft setup complete across the portfolio?' },
  { id: 'manager', label: 'Manager', question: 'Who forms the connected manager network?' },
] as const
type TabId = (typeof TABS)[number]['id']

function Insights({ insights }: { insights: Explanation[] }) {
  const renderable = insights.filter(isRenderableInsight)
  if (renderable.length === 0) return null
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {renderable.map((ins, i) => (
        <ExecutiveInsightPanel key={i} insight={ins} />
      ))}
    </div>
  )
}

function RankedTable({ title, rows, metricLabel }: { title: string; rows: RankedLeague[]; metricLabel: string }) {
  if (!rows.length) return null
  return (
    <div className="card-premium overflow-hidden p-0">
      <p className="border-b border-subtle px-4 py-2.5 text-[12px] font-bold uppercase tracking-[0.1em] text-secondary">{title}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-muted">
              <th className="px-4 py-2 font-semibold">League</th>
              <th className="px-4 py-2 font-semibold">Season</th>
              <th className="px-4 py-2 font-semibold">Format</th>
              <th className="px-4 py-2 text-right font-semibold">{metricLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.ref}-${r.season}`} className="border-t border-subtle/60">
                <td className="px-4 py-2 font-mono text-secondary">{r.ref}</td>
                <td className="px-4 py-2 tabular-nums text-secondary">{r.season}</td>
                <td className="px-4 py-2 text-muted">{r.detail}</td>
                <td className="px-4 py-2 text-right font-bold tabular-nums text-primary">{fmt(r.metric)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function ExecutiveWorkspace({ data, productName, freshness }: { data: ExecutiveWorkspaceData; productName: string; freshness?: FreshnessContract | null }) {
  const [tab, setTab] = useState<TabId>('platform')
  const window = sourceWindowLabel(data.platform)

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 md:px-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">{productName} · Executive Intelligence</p>
            <h1 className="text-2xl font-black tracking-tight text-primary">Portfolio Intelligence</h1>
          </div>
          {freshness ? <SyncFreshnessBadge freshness={freshness} /> : <DataFreshness importedAt={data.platform.freshness.importedAt} window={window} />}
        </div>
        <SourceWindowNotice window={window} limitation={EXEC_OFFSEASON_LIMITATION} />
      </header>

      <nav className="flex flex-wrap gap-1.5 border-b border-subtle pb-2" aria-label="Executive workspaces">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition ${
              tab === t.id ? 'bg-brand-primary/[0.10] text-brand-primary' : 'text-secondary hover:bg-surface-hover'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <p className="text-[13px] italic text-muted">{TABS.find((t) => t.id === tab)?.question}</p>

      {tab === 'platform' && <PlatformSurface d={data.platform} window={window} />}
      {tab === 'league' && <LeagueSurface d={data.league} window={window} />}
      {tab === 'commissioner' && <CommissionerSurface d={data.commissioner} window={window} />}
      {tab === 'trade' && <TradeSurface d={data.trade} window={window} />}
      {tab === 'waiver' && <WaiverSurface d={data.waiver} window={window} />}
      {tab === 'draft' && <DraftSurface d={data.draft} window={window} />}
      {tab === 'manager' && <ManagerSurface d={data.manager} window={window} />}
    </div>
  )
}

function PlatformSurface({ d, window }: { d: PlatformIntelligence; window: string }) {
  const t = d.totals
  return (
    <section className="flex flex-col gap-4">
      <WorkspaceSectionHeader eyebrow="Platform" title="Portfolio at a glance" subtitle="Direct record counts across every league season in the certified portfolio." />
      <ExecutiveKpiRow>
        <ExecutiveKpiCard label="League seasons" value={fmt(t.leagueSeasons)} truthLabel="Live League Data" />
        <ExecutiveKpiCard label="Managers" value={fmt(t.uniqueManagers)} sub={`${fmt(t.commissioners)} commissioners`} truthLabel="Live League Data" />
        <ExecutiveKpiCard label="Transactions" value={fmt(t.transactions)} truthLabel="Live League Data" definition="Completed transactions in the sampled weeks 1–18." />
        <ExecutiveKpiCard label="Trades" value={fmt(t.trades)} truthLabel="Live League Data" />
        <ExecutiveKpiCard label="Waivers" value={fmt(t.waivers)} sub={`${fmt(t.faab)} FAAB moves`} truthLabel="Live League Data" />
        <ExecutiveKpiCard label="Drafts" value={fmt(t.drafts)} sub={`${fmt(t.draftPicks)} picks`} truthLabel="Live League Data" />
        <ExecutiveKpiCard label="Matchups" value={fmt(t.matchups)} truthLabel="Live League Data" />
        <ExecutiveKpiCard label="Continuity chains" value={fmt(t.continuityChains)} truthLabel="Live League Data" definition="Multi-season league lineages reconstructed from prior-league links." />
      </ExecutiveKpiRow>
      <div className="grid gap-3 lg:grid-cols-2">
        <ExecutiveChartCard title="League seasons by year" subtitle="Portfolio footprint per season." unit="leagues" truthLabel="Live League Data" sourceWindow={window}>
          <YearBarChart series={d.leaguesByYear} />
        </ExecutiveChartCard>
        <ExecutiveChartCard title="Transactions by year" subtitle="Total roster moves per season." unit="transactions" truthLabel="Live League Data" sourceWindow={window}>
          <YearBarChart series={d.transactionsByYear} colorClass="text-status-success" />
        </ExecutiveChartCard>
        <ExecutiveChartCard title="Activity composition by year" subtitle="Trades vs waivers vs free-agent moves." unit="events" truthLabel="Derived League Intelligence" sourceWindow={window}>
          <GroupedYearChart
            points={d.activityCompositionByYear}
            keys={[
              { key: 'trades', label: 'Trades', colorClass: 'text-brand-primary' },
              { key: 'waivers', label: 'Waivers', colorClass: 'text-status-warning' },
              { key: 'freeAgents', label: 'Free agents', colorClass: 'text-status-success' },
            ]}
          />
          <div className="mt-2">
            <ChartLegend items={[{ label: 'Trades', colorClass: 'text-brand-primary' }, { label: 'Waivers', colorClass: 'text-status-warning' }, { label: 'Free agents', colorClass: 'text-status-success' }]} />
          </div>
        </ExecutiveChartCard>
        <ExecutiveChartCard title="Drafts by year" subtitle="Completed drafts per season." unit="drafts" truthLabel="Live League Data" sourceWindow={window}>
          <YearBarChart series={d.draftsByYear} colorClass="text-status-warning" />
        </ExecutiveChartCard>
      </div>
      <Insights insights={d.insights} />
    </section>
  )
}

function LeagueSurface({ d, window }: { d: LeagueIntelligence; window: string }) {
  const health = Object.fromEntries(d.operationalHealth.map((h) => [h.status, h.count]))
  return (
    <section className="flex flex-col gap-4">
      <WorkspaceSectionHeader eyebrow="League" title="League operational health" subtitle="Activity-based operational status per league season (explicit transaction thresholds, disclosed)." />
      <ExecutiveKpiRow>
        <ExecutiveKpiCard label="League seasons" value={fmt(d.leagueSeasons)} truthLabel="Live League Data" />
        <ExecutiveKpiCard label="Continuity chains" value={fmt(d.distinctLeagueChains)} truthLabel="Live League Data" />
        <ExecutiveKpiCard label="Active" value={fmt(health.active ?? 0)} sub="≥ 50 transactions" truthLabel="Derived League Intelligence" />
        <ExecutiveKpiCard label="Needs attention" value={fmt((health.quiet ?? 0) + (health.dormant ?? 0))} sub={`${fmt(health.dormant ?? 0)} dormant`} truthLabel="Derived League Intelligence" />
      </ExecutiveKpiRow>
      <div className="grid gap-3 lg:grid-cols-2">
        <ExecutiveChartCard title="Leagues by format" subtitle="Dynasty, redraft, keeper mix." unit="leagues" truthLabel="Derived League Intelligence" sourceWindow={window}>
          <DistributionBars data={d.byFormat} />
        </ExecutiveChartCard>
        <ExecutiveChartCard title="Operational status" subtitle="Active vs quiet vs dormant league seasons." unit="leagues" truthLabel="Derived League Intelligence" sourceWindow={window}>
          <DistributionBars data={d.operationalHealth.map((h) => ({ bucket: h.status, count: h.count }))} colorClass="text-status-warning" />
        </ExecutiveChartCard>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <RankedTable title="Most active league seasons" rows={d.mostActive} metricLabel="Transactions" />
        <RankedTable title="Quiet / dormant — needs attention" rows={d.needsAttention} metricLabel="Transactions" />
      </div>
      <Insights insights={d.insights} />
    </section>
  )
}

function CommissionerSurface({ d, window }: { d: CommissionerIntelligence; window: string }) {
  return (
    <section className="flex flex-col gap-4">
      <WorkspaceSectionHeader eyebrow="Commissioner" title="Commissioner workload" subtitle="Where operational ownership is concentrated and where attention is flagged." />
      <ExecutiveKpiRow>
        <ExecutiveKpiCard label="Commissioned seasons" value={fmt(d.commissionedLeagueSeasons)} truthLabel="Live League Data" />
        <ExecutiveKpiCard label="Portfolio commissioners" value={fmt(d.commissionersInPortfolio)} truthLabel="Live League Data" />
        <ExecutiveKpiCard label="Transactions handled" value={fmt(d.activityUnderCommissioner.transactions)} truthLabel="Live League Data" />
        <ExecutiveKpiCard label="Trades handled" value={fmt(d.activityUnderCommissioner.trades)} truthLabel="Live League Data" />
      </ExecutiveKpiRow>
      <div className="grid gap-3 lg:grid-cols-2">
        <ExecutiveChartCard title="Commissioned league seasons by year" subtitle="Ownership footprint over time." unit="leagues" truthLabel="Derived League Intelligence" sourceWindow={window}>
          <YearBarChart series={d.commissionedByYear} />
        </ExecutiveChartCard>
        <div className="card-premium flex flex-col gap-2 p-4">
          <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-secondary">Attention flags</p>
          {d.attentionFlags.map((f) => (
            <div key={f.flag} className="flex items-center justify-between gap-3 border-t border-subtle/60 pt-2 text-[13px] first:border-0 first:pt-0">
              <span className="text-secondary" title={f.rule}>{f.flag}</span>
              <span className="font-black tabular-nums text-primary">{fmt(f.count)}</span>
            </div>
          ))}
        </div>
      </div>
      <Insights insights={d.insights} />
    </section>
  )
}

function TradeSurface({ d, window }: { d: TradeIntelligence; window: string }) {
  return (
    <section className="flex flex-col gap-4">
      <WorkspaceSectionHeader eyebrow="Trade" title="Trade market outlook" subtitle="Completed-trade volume, market breadth, and season-over-season movement." />
      <ExecutiveKpiRow>
        <ExecutiveKpiCard label="Completed trades" value={fmt(d.totalTrades)} truthLabel="Live League Data" />
        <ExecutiveKpiCard label="Active trading leagues" value={fmt(d.activeTradingLeagueSeasons)} sub={`${fmt(d.quietLeagueSeasons)} quiet`} truthLabel="Derived League Intelligence" />
        <ExecutiveKpiCard label="Traded future picks" value={fmt(d.tradedFuturePicks)} truthLabel="Live League Data" />
        <ExecutiveKpiCard label="YoY change" value={d.yoyChangePct == null ? '—' : `${d.yoyChangePct > 0 ? '+' : ''}${d.yoyChangePct}%`} truthLabel="Derived League Intelligence" definition="Latest season vs prior season completed trades." />
      </ExecutiveKpiRow>
      <div className="grid gap-3 lg:grid-cols-2">
        <ExecutiveChartCard title="Trades by year" subtitle="Completed trades per season." unit="trades" truthLabel="Live League Data" sourceWindow={window}>
          <YearBarChart series={d.tradesByYear} />
        </ExecutiveChartCard>
        <RankedTable title="Busiest trade markets" rows={d.concentration} metricLabel="Trades" />
      </div>
      <Insights insights={d.insights} />
    </section>
  )
}

function WaiverSurface({ d, window }: { d: WaiverIntelligence; window: string }) {
  return (
    <section className="flex flex-col gap-4">
      <WorkspaceSectionHeader eyebrow="Waiver" title="Waiver intelligence summary" subtitle="Waivers, free-agent moves, and FAAB adoption — reported as distinct categories." />
      <ExecutiveKpiRow>
        <ExecutiveKpiCard label="Waivers" value={fmt(d.waivers)} truthLabel="Live League Data" />
        <ExecutiveKpiCard label="Free-agent moves" value={fmt(d.freeAgents)} truthLabel="Live League Data" />
        <ExecutiveKpiCard label="FAAB moves" value={fmt(d.faab)} truthLabel="Live League Data" />
        <ExecutiveKpiCard label="FAAB adoption" value={d.faabAdoptionPct == null ? '—' : `${d.faabAdoptionPct}%`} sub="of waiver-active leagues" truthLabel="Derived League Intelligence" />
      </ExecutiveKpiRow>
      <div className="grid gap-3 lg:grid-cols-2">
        <ExecutiveChartCard title="Waivers by year" subtitle="Waiver claims per season." unit="waivers" truthLabel="Live League Data" sourceWindow={window}>
          <YearBarChart series={d.waiversByYear} colorClass="text-status-warning" />
        </ExecutiveChartCard>
        <ExecutiveChartCard title="Free-agent moves by year" subtitle="Free-agent adds per season." unit="moves" truthLabel="Live League Data" sourceWindow={window}>
          <YearBarChart series={d.freeAgentsByYear} colorClass="text-status-success" />
        </ExecutiveChartCard>
      </div>
      <Insights insights={d.insights} />
    </section>
  )
}

function DraftSurface({ d, window }: { d: DraftIntelligence; window: string }) {
  return (
    <section className="flex flex-col gap-4">
      <WorkspaceSectionHeader eyebrow="Draft" title="Draft intelligence" subtitle="Draft completion and pick volume across the portfolio." />
      <ExecutiveKpiRow>
        <ExecutiveKpiCard label="Drafts" value={fmt(d.drafts)} truthLabel="Live League Data" />
        <ExecutiveKpiCard label="Draft picks" value={fmt(d.draftPicks)} truthLabel="Live League Data" />
        <ExecutiveKpiCard label="Avg picks / draft" value={d.avgPicksPerDraft == null ? '—' : fmt(d.avgPicksPerDraft)} truthLabel="Derived League Intelligence" />
        <ExecutiveKpiCard label="Traded future picks" value={fmt(d.tradedFuturePicks)} truthLabel="Live League Data" />
      </ExecutiveKpiRow>
      <div className="grid gap-3 lg:grid-cols-2">
        <ExecutiveChartCard title="Drafts by year" subtitle="Completed drafts per season." unit="drafts" truthLabel="Live League Data" sourceWindow={window}>
          <YearBarChart series={d.draftsByYear} />
        </ExecutiveChartCard>
        <ExecutiveChartCard title="Draft picks by year" subtitle="Total picks made per season." unit="picks" truthLabel="Live League Data" sourceWindow={window}>
          <YearBarChart series={d.draftPicksByYear} colorClass="text-status-success" />
        </ExecutiveChartCard>
      </div>
      <InsufficientEvidenceState
        title="Positional draft distribution"
        reason="Player position metadata was not captured during discovery, so positional breakdowns cannot be computed. This renders as Insufficient Evidence rather than a guess."
      />
      <Insights insights={d.insights} />
    </section>
  )
}

function ManagerSurface({ d, window }: { d: ManagerIntelligence; window: string }) {
  return (
    <section className="flex flex-col gap-4">
      <WorkspaceSectionHeader eyebrow="Manager" title="Manager network" subtitle="Participation and cross-league presence only. No psychology, skill, loyalty, or retention inference." />
      <ExecutiveKpiRow>
        <ExecutiveKpiCard label="Unique managers" value={fmt(d.uniqueManagers)} truthLabel="Live League Data" />
        <ExecutiveKpiCard label="Commissioners" value={fmt(d.commissioners)} truthLabel="Live League Data" />
        <ExecutiveKpiCard label="Multi-league" value={fmt(d.managersInMultipleLeagues)} truthLabel="Derived League Intelligence" />
        <ExecutiveKpiCard label="Multi-season" value={fmt(d.managersAcrossMultipleSeasons)} truthLabel="Derived League Intelligence" />
      </ExecutiveKpiRow>
      <div className="grid gap-3 lg:grid-cols-2">
        <ExecutiveChartCard title="Participation distribution" subtitle="How many leagues each manager appears in." unit="managers" truthLabel="Derived League Intelligence" sourceWindow={window}>
          <DistributionBars data={d.participationDistribution} />
        </ExecutiveChartCard>
        <RankedTable title="Highest cross-league presence" rows={d.topByLeaguePresence} metricLabel="Leagues" />
      </div>
      <InsufficientEvidenceState
        title="Manager psychology, skill & retention"
        reason={`Not produced. These require a separately validated contract and are intentionally excluded: ${d.forbiddenInferences.join(', ')}.`}
      />
      <Insights insights={d.insights} />
    </section>
  )
}
