'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Crown,
  Plus,
  ArrowDownToLine,
  Mail,
  Target,
  Sparkles,
  FileText,
  Shield,
  ChevronRight,
  Trophy,
  ArrowRight,
  Users,
  AlertCircle,
  Zap,
  MessageSquare,
  Activity,
  Settings,
  Flag,
  BookOpen,
  TrendingUp,
} from 'lucide-react'
import type { UserLeague } from '@/app/dashboard/types'
import CommissionerShowcasePanel from '@/components/redraft/CommissionerShowcasePanel'
import LeaguePulseCard from '@/components/decision-os/LeaguePulseCard'
import ManagerDnaCard from '@/components/decision-os/ManagerDnaCard'
import DecisionRecommendationsCard from '@/components/decision-os/DecisionRecommendationsCard'
import MissionControlCard from '@/components/decision-os/MissionControlCard'
import LeagueAnalyticsCard from '@/components/decision-os/LeagueAnalyticsCard'
import LeagueContextCard from '@/components/decision-os/LeagueContextCard'
import CommissionerCommandCenterSection from '@/components/decision-os/CommissionerCommandCenterSection'
import {
  decisionOsToneClasses,
  decisionOsHealthStatusToneClasses,
} from '@/components/decision-os/DecisionOsCardPrimitives'
import type {
  CommissionerHealthAction,
  CommissionerLeagueHealthSnapshot,
} from '@/lib/commissioner-hub/commissionerHubHealth'
import LeagueHealthMap from '@/components/executive-viz/LeagueHealthMap'
import {
  ManagerAttentionCard,
  LeagueHealthBreakdownCard,
  CommissionerWorkloadCard,
  LeagueReadinessCard,
} from '@/components/executive-viz/SupportingExecutiveViz'
import LeagueMomentum from '@/components/executive-viz/LeagueMomentum'
import {
  TransactionDistributionCard,
  LeagueEngagementCard,
  CompetitiveBalanceCard,
} from '@/components/executive-viz/LeagueSupportingViz'
import TradeOpportunityMatrix from '@/components/executive-viz/TradeOpportunityMatrix'
import {
  MarketActivityCard,
  TradePipelineCard,
} from '@/components/executive-viz/TradeSupportingViz'
import {
  buildCommissionerLeagueHealthViewModel,
  selectFlagshipSnapshot,
} from '@/lib/executive-viz/commissionerLeagueHealthViewModel'
import { buildCommissionerLeaguePulse } from '@/lib/decision-os/league-pulse'
import { buildManagerDnaViewModel } from '@/lib/decision-os/manager-dna'
import { buildDecisionRecommendationsViewModel } from '@/lib/decision-os/recommendations'
import type { ManagerIntelligencePayload } from '@/lib/decision-os/dashboard-intelligence'
import type { MissionControlSnapshot } from '@/lib/decision-os/missionControl'
import type { LeagueAnalyticsSnapshot } from '@/lib/decision-os/leagueAnalytics'
import { resolveTenantBrand, tenantThemeStyle, isFeatureVisible } from '@/lib/white-label'

// The active licensee brand (Phase V5.0 white-label). Env-selected, resolved once — the tenant is
// fixed per deployment, so brand strings/theme/feature gates below read from this single source.
const BRAND = resolveTenantBrand()

// ─── Copy constants (future i18n wiring) ───────────────────────────────────
const COPY = {
  hero: {
    badge: BRAND.copy.commissionerHubLabel,
    trustBadge: 'No gambling. Pure fantasy.',
    headline1: 'Run better leagues.',
    headline2: 'Build your legacy.',
    sub: 'Built for commissioners. Loved by managers. Every tool you need to create, grow, and manage your fantasy empire - all in one place.',
    sub2: `Draft smarter. Keep members engaged. Move entire leagues onto ${BRAND.copy.productName}.`,
    ctaCreate: 'Create a League',
    ctaImport: 'Import League',
  },
  ops: {
    sectionLabel: 'League Operations',
    totalManaged: 'Leagues Managed',
    needsSetup: 'Needs Setup',
    missingDraft: 'Missing Draft Date',
    active: 'Active Now',
  },
  health: {
    sectionLabel: 'League Setup Health',
    membersLabel: 'members',
    draftLabel: 'Draft',
    noDraftDate: 'No draft date set',
    viewLeague: 'View League',
  },
  queue: {
    sectionLabel: 'Commissioner Mission Queue',
    sectionHint: 'Highest-priority actions for your leagues',
  },
  ai: {
    sectionLabel: 'Commissioner AI Prompts',
    sectionHint: 'Ask Chimmy to do the heavy lifting',
  },
  migration: {
    sectionLabel: 'Migration Center',
    sectionHint: `Bring your leagues to ${BRAND.copy.productName}`,
    activeLabel: 'Active',
    legacyLabel: 'Legacy',
    comingSoonLabel: 'Coming Soon',
    importCta: 'Import ->',
  },
  memberLeagues: {
    sectionLabel: 'Leagues I Play In',
  },
  trust: {
    heading: 'Transparent. Strategy-first. No gambling.',
    body1:
      `${BRAND.copy.productName} is built for fantasy sports strategy - not sportsbook predictions or gambling. Every recommendation from our AI tools is grounded in public data and fantasy scoring logic.`,
    body2:
      'Chimmy gives recommendations, not guarantees. Fantasy sports involve real uncertainty. Use our tools to make smarter decisions, not to replace your own judgment.',
  },
  empty: {
    heading: 'No leagues yet.',
    sub: 'Create or import a league to get started as a commissioner.',
    ctaCreate: 'Create League',
    ctaImport: 'Import',
  },
}

// ─── Types ──────────────────────────────────────────────────────────────────
type QueueCard = {
  key: string
  icon: React.ComponentType<{ className?: string }>
  title: string
  desc: string
  href: string
  priority: number
  cardClass: string
  iconClass: string
  badge?: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────
// Phase V1.0: removed the color table (and the `resolveSetupStatus`/`resolveNextAction` functions that
// used it) that only backed the "Leagues I Manage" grid, deleted this phase for being a 3rd, visually
// distinct rendering of the same league list already shown by the League Switcher and League Health
// Dashboard — see docs/os/VISUAL_OS_V1_AUDIT.md Finding 5.

function buildLoginHref(path: string): string {
  return `/login?callbackUrl=${encodeURIComponent(path)}`
}

function disablePrefetchForAuthSensitiveHref(href: string): boolean {
  const pathname = href.split('?')[0] ?? href
  if (pathname === '/create-league' || pathname === '/import') return true
  if (pathname !== '/login') return false
  try {
    const params = new URLSearchParams(href.split('?')[1] ?? '')
    const callbackUrl = params.get('callbackUrl') ?? ''
    return callbackUrl === '/create-league' || callbackUrl === '/import'
  } catch {
    return false
  }
}

function buildMissionQueue(commLeagues: UserLeague[]): QueueCard[] {
  const needsDraft = commLeagues.some(
    (l) =>
      (l.lifecycleState ?? l.status ?? '').toLowerCase() === 'pre_draft' && !l.draftDate,
  )
  const needsSetup = commLeagues.some(
    (l) => (l.lifecycleState ?? l.status ?? '').toLowerCase() === 'setup' || (l.lifecycleState ?? l.status ?? '') === '',
  )

  const cards: QueueCard[] = [
    {
      key: 'create',
      icon: Plus,
      title: 'Create League',
      desc: 'Launch a new NFL, NBA, MLB, or multi-sport league in minutes.',
      href: '/create-league',
      priority: needsSetup ? 0 : 1,
      cardClass:
        'border-cyan-500/30 bg-gradient-to-br from-cyan-500/[0.10] to-transparent hover:border-cyan-500/45',
      iconClass: 'border-cyan-500/40 bg-cyan-500/20 text-cyan-600',
      badge: commLeagues.length === 0 ? 'Start Here' : undefined,
    },
    {
      key: 'import',
      icon: ArrowDownToLine,
      title: 'Import League',
      desc: `Bring your Sleeper, ESPN, Yahoo, or MFL league to ${BRAND.copy.productName} in under 2 minutes.`,
      href: '/import',
      priority: 2,
      cardClass:
        'border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.07] to-transparent hover:border-emerald-500/40',
      iconClass: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-600',
    },
    {
      key: 'draft',
      icon: Target,
      title: 'Draft Readiness',
      desc: 'Check lineup health, set draft order, and confirm settings before draft day.',
      href: '/war-room',
      priority: needsDraft ? 0 : 3,
      cardClass:
        'border-amber-500/25 bg-gradient-to-br from-amber-500/[0.07] to-transparent hover:border-amber-500/40',
      iconClass: 'border-amber-500/35 bg-amber-500/10 text-amber-600',
      badge: needsDraft ? 'Action Needed' : undefined,
    },
    {
      key: 'invites',
      icon: Mail,
      title: 'Send Invites',
      desc: 'Recruit managers and fill your league roster with one shareable link.',
      /*
       * ⚠ THIS POINTED AT /import, WHICH IS THE LEAGUE-IMPORT PAGE. A card
       * promising "one shareable link" sent commissioners to a screen for
       * importing a league from Sleeper or ESPN — a different job entirely.
       * Portfolio now carries the invite link per commissioned league, so this
       * goes somewhere that can actually produce one.
       */
      href: '/core/portfolio',
      priority: 4,
      cardClass:
        'border-violet-500/20 bg-gradient-to-br from-violet-500/[0.06] to-transparent hover:border-violet-500/35',
      iconClass: 'border-violet-500/35 bg-violet-500/10 text-violet-600',
    },
    {
      key: 'ai',
      icon: Sparkles,
      title: 'Ask Commissioner AI',
      desc: 'Get AI-powered advice on rules, disputes, waiver settings, and league health.',
      href: '/ai/tools',
      priority: 5,
      cardClass:
        'border-violet-500/25 bg-gradient-to-br from-violet-500/[0.08] to-transparent hover:border-violet-500/40',
      iconClass: 'border-violet-500/40 bg-violet-500/15 text-violet-600',
      badge: 'AI',
    },
    {
      key: 'recap',
      icon: FileText,
      title: 'Generate Weekly Recap',
      desc: 'Auto-generate a shareable league recap to keep your managers engaged all season.',
      href: '/ai/tools',
      priority: 6,
      cardClass:
        'border-cyan-500/20 bg-gradient-to-br from-cyan-500/[0.06] to-transparent hover:border-cyan-500/35',
      iconClass: 'border-cyan-500/30 bg-cyan-500/[0.08] text-cyan-400',
      badge: 'Beta',
    },
    {
      key: 'settings',
      icon: Settings,
      title: 'League Settings',
      desc: 'Review scoring rules, waiver priority, roster limits, and trade deadlines.',
      href: commLeagues[0] ? `/league/${commLeagues[0].id}` : '/dashboard',
      priority: 7,
      cardClass:
        'border-subtle bg-surface-muted hover:bg-surface-hover',
      iconClass: 'border-subtle bg-surface-hover text-muted',
    },
  ]

  return cards.sort((a, b) => a.priority - b.priority)
}

// ─── AI Prompt Cards ─────────────────────────────────────────────────────────
const AI_PROMPT_CARDS = [
  {
    key: 'announce',
    icon: Flag,
    title: 'Write Draft Announcement',
    desc: 'Generate a league-wide message to hype up your draft day.',
    href: '/ai/tools',
  },
  {
    key: 'explain',
    icon: BookOpen,
    title: 'Explain League Settings',
    desc: 'Get a plain-English breakdown of scoring rules, waivers, and trades for your managers.',
    href: '/ai/tools',
  },
  {
    key: 'recap',
    icon: FileText,
    title: 'Weekly Recap Generator',
    desc: 'Auto-write a shareable recap covering top performers, trades, and standings.',
    href: '/ai/tools',
    badge: 'Beta',
  },
  {
    key: 'engage',
    icon: Zap,
    title: 'Engagement Ideas',
    desc: 'Get ideas to keep your managers active and chatting throughout the season.',
    href: '/ai/tools',
  },
  {
    key: 'dispute',
    icon: MessageSquare,
    title: 'Resolve Dispute',
    desc: 'Describe a trade dispute or rule question - Chimmy gives a fair, evidence-based ruling.',
    href: '/ai-chat',
  },
  {
    key: 'power',
    icon: TrendingUp,
    title: 'Power Rankings',
    desc: 'Generate weekly power rankings with short commentary for each team.',
    href: '/ai/tools',
    badge: 'Beta',
  },
]

// ─── Migration platforms ──────────────────────────────────────────────────────
const MIGRATION_PLATFORMS: {
  key: string
  name: string
  status: 'active' | 'legacy' | 'coming_soon'
  href: string | null
  desc: string
}[] = [
  {
    key: 'sleeper',
    name: 'Sleeper',
    status: 'active',
    href: '/import?provider=sleeper',
    desc: 'Full import - rosters, history, and settings.',
  },
  {
    key: 'espn',
    name: 'ESPN',
    status: 'active',
    href: '/import?provider=espn',
    desc: 'Full import - rosters, history, and settings.',
  },
  {
    key: 'yahoo',
    name: 'Yahoo',
    status: 'active',
    href: '/import?provider=yahoo',
    desc: 'Full import - rosters, history, and settings.',
  },
  {
    key: 'mfl',
    name: 'MFL',
    status: 'active',
    href: '/import?provider=mfl',
    desc: 'Full import - rosters, history, and settings.',
  },
  {
    key: 'fantrax',
    name: 'Fantrax',
    status: 'legacy',
    href: '/import?provider=fantrax',
    desc: 'Legacy import - basic roster data only.',
  },
  {
    key: 'csv',
    name: 'CSV / Custom',
    status: 'coming_soon',
    href: null,
    desc: 'Upload a spreadsheet export from any platform.',
  },
]

// Phase V1.1: badge text was `text-emerald-300`/`text-amber-300` — the same light-pastel contrast
// pattern fixed elsewhere this phase (docs/os/VISUAL_OS_V1_AUDIT.md Finding 3/4). Routed through
// `decisionOsToneClasses` for the badge; only the small status dot keeps its own solid color, since a
// filled dot has no text-contrast concern.
const MIGRATION_STATUS_CLASSES: Record<string, { badge: string; dot: string }> = {
  active: {
    badge: decisionOsToneClasses('good'),
    dot: 'bg-emerald-400',
  },
  legacy: {
    badge: decisionOsToneClasses('warning'),
    dot: 'bg-amber-400',
  },
  coming_soon: {
    badge: decisionOsToneClasses('neutral'),
    dot: 'bg-surface-hover',
  },
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function SectionHeader({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline gap-2">
      <p className="text-[11px] font-bold uppercase tracking-widest text-muted">{label}</p>
      {hint && <p className="text-[11px] text-muted">{hint}</p>}
    </div>
  )
}

// Phase V1.2: removed the private `HEALTH_STATUS_CLASSES` and `ACTION_TONE_CLASSES` tables that lived
// here — consolidated onto the shared `decisionOsHealthStatusToneClasses`/`decisionOsToneClasses`
// primitives (see `DecisionOsCardPrimitives.tsx`). `ACTION_TONE_CLASSES`'s tone domain
// (`standard`/`warning`/`danger`) maps 1:1 onto `decisionOsToneClasses`'s `neutral`/`warning`/`danger`.
function actionToneClasses(tone: CommissionerHealthAction['tone']): string {
  return `${decisionOsToneClasses(tone === 'standard' ? 'neutral' : tone)} transition hover:brightness-95 motion-reduce:transition-none`
}

function sumMetric(
  snapshots: CommissionerLeagueHealthSnapshot[],
  key: keyof CommissionerLeagueHealthSnapshot['metrics'],
): number {
  return snapshots.reduce((sum, snapshot) => sum + Number(snapshot.metrics[key] ?? 0), 0)
}

function averageMetric(
  snapshots: CommissionerLeagueHealthSnapshot[],
  key: keyof CommissionerLeagueHealthSnapshot['metrics'],
): number {
  if (snapshots.length === 0) return 0
  return Math.round(sumMetric(snapshots, key) / snapshots.length)
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function MetricTile({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
  tone?: 'neutral' | 'good' | 'warn'
}) {
  const toneClass = decisionOsToneClasses(tone === 'good' ? 'good' : tone === 'warn' ? 'warning' : 'neutral')
  return (
    <div className={`flex min-h-[78px] flex-col justify-between rounded-2xl border p-3 ${toneClass}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
        <Icon className="h-3.5 w-3.5 text-current opacity-70" aria-hidden />
      </div>
      <p className="mt-2 text-[24px] font-black leading-none text-current">{value}</p>
    </div>
  )
}

function CommissionerActionLink({ action }: { action: CommissionerHealthAction }) {
  const className = action.enabled
    ? actionToneClasses(action.tone)
    : 'cursor-not-allowed border-subtle bg-surface-muted text-muted'

  if (!action.enabled) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${className}`}
        title={action.disabledReason}
      >
        <Settings className="h-3 w-3" aria-hidden />
        {action.label}
      </span>
    )
  }

  return (
    <Link
      href={action.href}
      prefetch={disablePrefetchForAuthSensitiveHref(action.href) ? false : undefined}
      className={`focus-ring inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${className}`}
      title={action.requiresConfirmation ? 'Requires commissioner confirmation' : undefined}
    >
      <Settings className="h-3 w-3" aria-hidden />
      {action.label}
    </Link>
  )
}

// ─── Phase V2.0 — Commissioner OS flagship (60/30/10) ──────────────────────────
// The signature League Health Map (~60%) with three supporting KPIs and the top commissioner actions
// (~30% / ~10%) drawn from the same real snapshot. Provider-agnostic: consumes the health view model,
// never a raw provider payload or player-level record.
function FlagshipKpiTile({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
  tone?: 'neutral' | 'good' | 'warn' | 'danger'
}) {
  const toneClass = decisionOsToneClasses(
    tone === 'good' ? 'good' : tone === 'warn' ? 'warning' : tone === 'danger' ? 'danger' : 'neutral',
  )
  return (
    <div className={`flex min-h-[92px] flex-col justify-between rounded-2xl border p-3.5 ${toneClass}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</p>
        <Icon className="h-4 w-4 text-current opacity-70" aria-hidden />
      </div>
      <p className="mt-2 text-[28px] font-black leading-none text-current">{value}</p>
    </div>
  )
}

function CommissionerOsFlagship({ snapshots }: { snapshots: CommissionerLeagueHealthSnapshot[] }) {
  const flagshipSnapshot = selectFlagshipSnapshot(snapshots)
  const viewModel = buildCommissionerLeagueHealthViewModel(flagshipSnapshot)
  if (!viewModel || !flagshipSnapshot) return null

  const needsAttention = viewModel.attention.needsAttentionCount + viewModel.attention.monitorCount
  const openActions =
    flagshipSnapshot.metrics.pendingWaiverClaims +
    flagshipSnapshot.metrics.pendingTrades +
    flagshipSnapshot.metrics.openAiAlerts +
    flagshipSnapshot.metrics.commissionerActions
  const topActions = flagshipSnapshot.actions.filter((action) => action.enabled).slice(0, 4)

  return (
    <section className="mb-6" data-testid="commissioner-os-flagship" aria-label="Commissioner OS flagship">
      <div className="grid gap-4 lg:grid-cols-5">
        {/* ~60% — the dominant signature visualization */}
        <div className="lg:col-span-3">
          <LeagueHealthMap viewModel={viewModel} />
        </div>

        {/* ~30% KPIs + ~10% actions rail */}
        <div className="flex flex-col gap-3 lg:col-span-2">
          <div className="grid grid-cols-3 gap-3">
            <FlagshipKpiTile
              icon={Activity}
              label="Health"
              value={`${viewModel.overallScore}`}
              tone={viewModel.overallStatus === 'excellent' || viewModel.overallStatus === 'healthy' ? 'good' : viewModel.overallStatus === 'critical' ? 'danger' : 'warn'}
            />
            <FlagshipKpiTile
              icon={AlertCircle}
              label="Needs attention"
              value={needsAttention}
              tone={viewModel.attention.needsAttentionCount > 0 ? 'danger' : needsAttention > 0 ? 'warn' : 'good'}
            />
            <FlagshipKpiTile
              icon={Zap}
              label="Open actions"
              value={openActions}
              tone={openActions > 5 ? 'danger' : openActions > 0 ? 'warn' : 'good'}
            />
          </div>
          <div className="rounded-2xl border border-subtle bg-surface p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Commissioner actions</p>
            {topActions.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {topActions.map((action) => (
                  <CommissionerActionLink key={action.key} action={action} />
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[12px] text-muted">No actions require your attention right now.</p>
            )}
          </div>
        </div>
      </div>

      {/* Phase V2.1 — supporting executive graphs that explain the flagship map's operational state.
          Lighter weight than the map (non-dominant shells) so the League Health Map stays the anchor. */}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <ManagerAttentionCard snapshot={flagshipSnapshot} />
        <LeagueHealthBreakdownCard snapshot={flagshipSnapshot} />
        <CommissionerWorkloadCard snapshot={flagshipSnapshot} />
        <LeagueReadinessCard snapshot={flagshipSnapshot} />
      </div>
    </section>
  )
}

function LeagueHealthDashboard({
  snapshots,
  demoMode = false,
}: {
  snapshots: CommissionerLeagueHealthSnapshot[]
  demoMode?: boolean
}) {
  const [showAll, setShowAll] = useState(false)
  if (snapshots.length === 0) return null
  const averageEngagement = averageMetric(snapshots, 'leagueEngagement')
  const averageProjectionCoverage = averageMetric(snapshots, 'projectionCoveragePct')
  const averageLineupRate =
    snapshots.reduce((sum, snapshot) => sum + snapshot.metrics.lineupSubmissionRate, 0) / snapshots.length
  const visibleSnapshots = showAll ? snapshots : snapshots.slice(0, 3)

  return (
    <section data-testid="commissioner-health-dashboard">
      {/* Phase V2.0 — the dominant signature visualization for the most attention-needing league. */}
      <CommissionerOsFlagship snapshots={snapshots} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SectionHeader
          label="All managed leagues"
          hint={
            demoMode
              ? 'Preview-safe commissioner risk, activity, and engagement signals'
              : 'Live commissioner risk, activity, and engagement signals'
          }
        />
        {snapshots.length > 3 ? (
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            className="inline-flex items-center gap-1.5 rounded-full border border-subtle bg-surface-muted px-3 py-1.5 text-[11px] font-semibold text-secondary transition hover:bg-surface-hover"
          >
            {showAll ? 'Show fewer leagues' : `View all ${snapshots.length} leagues`}
          </button>
        ) : null}
      </div>
      {/* Phase V2.1 — this cross-league aggregate strip is only shown for multi-league commissioners.
          For a single league it fully duplicates the flagship workspace above (League Health Map + its
          KPIs + the supporting graphs), so it's suppressed there to keep the map dominant. */}
      {snapshots.length > 1 ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-7">
          <MetricTile
            icon={Users}
            label="Inactive Teams"
            value={sumMetric(snapshots, 'inactiveTeams')}
            tone={sumMetric(snapshots, 'inactiveTeams') > 0 ? 'warn' : 'good'}
          />
          <MetricTile
            icon={AlertCircle}
            label="Missed Lineups"
            value={sumMetric(snapshots, 'missedLineups')}
            tone={sumMetric(snapshots, 'missedLineups') > 0 ? 'warn' : 'good'}
          />
          <MetricTile icon={TrendingUp} label="Trade Activity" value={sumMetric(snapshots, 'tradeActivity')} />
          <MetricTile icon={Zap} label="Waiver Activity" value={sumMetric(snapshots, 'waiverActivity')} />
          <MetricTile
            icon={Activity}
            label="League Engagement"
            value={`${averageEngagement}/100`}
            tone={averageEngagement >= 65 ? 'good' : 'warn'}
          />
          <MetricTile icon={Shield} label="Commissioner Actions" value={sumMetric(snapshots, 'commissionerActions')} />
          <MetricTile
            icon={Target}
            label="Projection Coverage"
            value={`${averageProjectionCoverage}%`}
            tone={averageProjectionCoverage >= 70 ? 'good' : 'warn'}
          />
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {visibleSnapshots.map((snapshot) => {
          const statusClass = decisionOsHealthStatusToneClasses(snapshot.overallStatus)
          return (
            <article
              key={snapshot.leagueId}
              className="rounded-2xl border border-subtle bg-surface p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-bold text-primary">{snapshot.leagueName}</p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {snapshot.sport} {snapshot.leagueType} / Week {snapshot.currentWeek} / {snapshot.teamCount} teams
                  </p>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${statusClass}`}>
                  {snapshot.healthScore}/100
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                <div className="rounded-xl border border-subtle bg-surface-muted p-2">
                  <p className="text-[10px] text-muted">Lineups</p>
                  <p className="text-[13px] font-bold text-secondary">{formatPercent(snapshot.metrics.lineupSubmissionRate)}</p>
                </div>
                <div className="rounded-xl border border-subtle bg-surface-muted p-2">
                  <p className="text-[10px] text-muted">Pending Waivers</p>
                  <p className="text-[13px] font-bold text-secondary">{snapshot.metrics.pendingWaiverClaims}</p>
                </div>
                <div className="rounded-xl border border-subtle bg-surface-muted p-2">
                  <p className="text-[10px] text-muted">Pending Trades</p>
                  <p className="text-[13px] font-bold text-secondary">{snapshot.metrics.pendingTrades}</p>
                </div>
                <div className="rounded-xl border border-subtle bg-surface-muted p-2">
                  <p className="text-[10px] text-muted">Open AI Alerts</p>
                  <p className="text-[13px] font-bold text-secondary">{snapshot.metrics.openAiAlerts}</p>
                </div>
                <div className="rounded-xl border border-subtle bg-surface-muted p-2">
                  <p className="text-[10px] text-muted">Projection Coverage</p>
                  <p className="text-[13px] font-bold text-secondary">{snapshot.metrics.projectionCoveragePct}%</p>
                </div>
              </div>

              <p className="mt-3 text-[12px] leading-relaxed text-muted">{snapshot.summary}</p>

              {snapshot.alerts.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {snapshot.alerts.slice(0, 2).map((alert) => (
                    <p key={alert} className="rounded-lg border border-amber-500/15 bg-amber-500/[0.05] px-2.5 py-1.5 text-[11px] text-amber-700">
                      {alert}
                    </p>
                  ))}
                </div>
              )}

              <div className="mt-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Commissioner Actions</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {snapshot.actions.map((action) => (
                    <CommissionerActionLink key={action.key} action={action} />
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-violet-600">AI Commissioner Assistant</p>
                <div className="mt-2 grid gap-2">
                  {snapshot.assistantQuestions.slice(0, 5).map((question) => (
                    <Link
                      key={question.key}
                      href={`/ai-chat?leagueId=${encodeURIComponent(snapshot.leagueId)}&prompt=${encodeURIComponent(question.prompt)}`}
                      className="group rounded-xl border border-violet-500/[0.12] bg-violet-500/[0.035] px-3 py-2 transition hover:border-violet-500/25 hover:bg-violet-500/[0.06]"
                    >
                      <div className="flex items-start gap-2">
                        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600" aria-hidden />
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-secondary group-hover:text-primary">{question.label}</p>
                          <p className="mt-0.5 text-[11px] leading-snug text-muted">{question.answer}</p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-muted">
                <span>Source: {snapshot.source === 'database' ? 'Database' : 'Dashboard fallback'}</span>
                <span>Confidence: {snapshot.dataConfidence}</span>
              </div>
            </article>
          )
        })}
      </div>

      {!showAll && snapshots.length > visibleSnapshots.length ? (
        <p className="mt-3 text-[11px] text-muted">
          Showing {visibleSnapshots.length} of {snapshots.length} managed leagues for presentation flow.
        </p>
      ) : null}

      <p className="mt-3 text-[11px] text-muted">
        Average lineup submission across managed leagues: {formatPercent(averageLineupRate)}.
      </p>
    </section>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
type CommissionerHubPageClientProps = {
  leagues: UserLeague[]
  healthSnapshots: CommissionerLeagueHealthSnapshot[]
  demoMode?: boolean
  isAuthenticated?: boolean
}

export default function CommissionerHubPageClient({
  leagues,
  healthSnapshots,
  demoMode = false,
  isAuthenticated = false,
}: CommissionerHubPageClientProps) {
  const commissionerLeagues = leagues.filter((l) => l.isCommissioner)
  const memberLeagues = leagues.filter((l) => !l.isCommissioner)
  const missionQueue = buildMissionQueue(commissionerLeagues)
  const healthByLeagueId = new Map(healthSnapshots.map((snapshot) => [snapshot.leagueId, snapshot]))
  const managedHealthSnapshots = commissionerLeagues
    .map((league) => healthByLeagueId.get(league.id))
    .filter((snapshot): snapshot is CommissionerLeagueHealthSnapshot => Boolean(snapshot))
  // Phase OS-B1: the Multi-League Overview (`CommissionerCommandCenterSection`) is now the default
  // landing view — no league is auto-selected. `representativeLeagueId` (the anchor every League
  // Focus fetch below already keys off) now comes from explicit user selection, not an automatic
  // "first commissioner league" pick. Selecting a league from the overview's switcher, or from the
  // "Leagues I Manage" grid further down the page, sets this and reveals League Focus; clearing it
  // returns to the overview. This is a pure rename of the SOURCE of `representativeLeagueId` — every
  // existing fetch/render below that already depends on it is unchanged.
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null)
  const representativeLeagueId = selectedLeagueId
  const [managerIntelligence, setManagerIntelligence] = useState<ManagerIntelligencePayload | null>(null)
  useEffect(() => {
    if (!representativeLeagueId) {
      setManagerIntelligence(null)
      return
    }
    let cancelled = false
    void fetch(`/api/decision-os/manager-intelligence?leagueId=${encodeURIComponent(representativeLeagueId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => (res.ok ? (res.json() as Promise<ManagerIntelligencePayload>) : null))
      .then((data) => {
        if (!cancelled) setManagerIntelligence(data)
      })
      .catch(() => {
        if (!cancelled) setManagerIntelligence(null)
      })
    return () => {
      cancelled = true
    }
  }, [representativeLeagueId])
  const leaguePulse = useMemo(
    () =>
      buildCommissionerLeaguePulse({
        snapshots: managedHealthSnapshots,
        managerDna: managerIntelligence?.managerDna ?? null,
      }),
    [managedHealthSnapshots, managerIntelligence]
  )
  const managerDna = useMemo(
    () => buildManagerDnaViewModel({ source: managerIntelligence?.managerDna ?? null }),
    [managerIntelligence],
  )
  const recommendations = useMemo(
    () => buildDecisionRecommendationsViewModel({ source: managerIntelligence?.recommendations ?? null }),
    [managerIntelligence],
  )
  const [missionControl, setMissionControl] = useState<MissionControlSnapshot | null>(null)
  useEffect(() => {
    if (!representativeLeagueId) {
      setMissionControl(null)
      return
    }
    let cancelled = false
    void fetch(`/api/decision-os/mission-control?leagueId=${encodeURIComponent(representativeLeagueId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => (res.ok ? (res.json() as Promise<MissionControlSnapshot>) : null))
      .then((data) => {
        if (!cancelled) setMissionControl(data)
      })
      .catch(() => {
        if (!cancelled) setMissionControl(null)
      })
    return () => {
      cancelled = true
    }
  }, [representativeLeagueId])
  const [leagueAnalytics, setLeagueAnalytics] = useState<LeagueAnalyticsSnapshot | null>(null)
  useEffect(() => {
    if (!representativeLeagueId) {
      setLeagueAnalytics(null)
      return
    }
    let cancelled = false
    void fetch(`/api/decision-os/league-analytics?leagueId=${encodeURIComponent(representativeLeagueId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => (res.ok ? (res.json() as Promise<LeagueAnalyticsSnapshot>) : null))
      .then((data) => {
        if (!cancelled) setLeagueAnalytics(data)
      })
      .catch(() => {
        if (!cancelled) setLeagueAnalytics(null)
      })
    return () => {
      cancelled = true
    }
  }, [representativeLeagueId])
  const showDemoMode = demoMode || leagues.length === 0
  const primaryHeroHref = isAuthenticated ? '/create-league' : buildLoginHref('/create-league')
  const primaryHeroLabel = isAuthenticated ? COPY.hero.ctaCreate : 'Sign In'
  const secondaryHeroHref = isAuthenticated ? '/import' : buildLoginHref('/import')
  const secondaryHeroLabel = isAuthenticated ? COPY.hero.ctaImport : 'Sign In to Import'
  const emptyPrimaryHref = isAuthenticated ? '/create-league' : buildLoginHref('/create-league')
  const emptyPrimaryLabel = isAuthenticated ? COPY.empty.ctaCreate : 'Sign In'
  const emptySecondaryHref = isAuthenticated ? '/import' : buildLoginHref('/import')
  const emptySecondaryLabel = isAuthenticated ? COPY.empty.ctaImport : 'Sign In to Import'
  const emptyHeading = isAuthenticated ? COPY.empty.heading : 'Commissioner demo is ready.'
  const emptySub = isAuthenticated
    ? 'Create or import a league to replace the preview state with your real commissioner data.'
    : 'You can tour the commissioner workflow now, then sign in when you are ready to load leagues and personalize the hub.'

  return (
    <div className="min-h-screen bg-app text-primary" style={tenantThemeStyle(BRAND)}>
      <div className="mx-auto max-w-5xl space-y-10 px-4 py-8 sm:px-6 sm:py-12">

        {/* ── Hero ── */}
        <section className="relative overflow-hidden rounded-3xl border border-amber-500/[0.15] bg-gradient-to-br from-amber-500/[0.07] via-[color:var(--surface)] to-cyan-500/[0.04] p-6 sm:p-8">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-48 opacity-60"
            style={{
              background:
                'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(245,158,11,0.18) 0%, transparent 70%)',
            }}
          />
          <div className="relative z-10">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-700">
                <Crown className="h-3 w-3" aria-hidden />
                {COPY.hero.badge}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
                <Shield className="h-3 w-3" aria-hidden />
                {COPY.hero.trustBadge}
              </span>
            </div>

            <h1 className="text-[28px] font-black leading-tight tracking-tight text-primary sm:text-[36px]">
              {COPY.hero.headline1}{' '}
              <span className="bg-gradient-to-r from-amber-300 to-cyan-300 bg-clip-text text-transparent">
                {COPY.hero.headline2}
              </span>
            </h1>
            <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-secondary">
              {COPY.hero.sub}
            </p>
            <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-muted">
              {COPY.hero.sub2}
            </p>
            {showDemoMode && (
              // Phase V1.0: was `text-cyan-200/75`/`text-cyan-50/80` — a light-cyan palette tuned for a
              // dark background. Verified live in light mode (the app default): near-unreadable against
              // this card's light background. Swapped to theme-aware semantic tokens (see
              // docs/os/VISUAL_OS_V1_AUDIT.md Finding 4).
              <div className="mt-5 max-w-2xl rounded-2xl border border-status-info/25 bg-status-info/10 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-status-info">
                  Presentation-safe preview
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-secondary">
                  The hub now falls back to stable commissioner preview data when leagues, draft state, waiver state,
                  roster data, or NFL foundation reads are still empty.
                </p>
              </div>
            )}

            <div className="mt-6 flex flex-wrap gap-2.5">
              <Link
                href={primaryHeroHref}
                prefetch={disablePrefetchForAuthSensitiveHref(primaryHeroHref) ? false : undefined}
                className="focus-ring inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-5 py-2.5 text-[14px] font-bold text-content-inverse shadow-[0_0_20px_rgba(245,158,11,0.25)] transition hover:from-amber-300 hover:to-amber-400 active:opacity-90"
              >
                <Plus className="h-4 w-4" aria-hidden />
                {primaryHeroLabel}
              </Link>
              <Link
                href={secondaryHeroHref}
                prefetch={disablePrefetchForAuthSensitiveHref(secondaryHeroHref) ? false : undefined}
                className="focus-ring inline-flex items-center gap-2 rounded-xl border border-subtle bg-surface-muted px-5 py-2.5 text-[14px] font-semibold text-primary transition hover:bg-surface-hover"
              >
                <ArrowDownToLine className="h-4 w-4" aria-hidden />
                {secondaryHeroLabel}
              </Link>
            </div>
          </div>
        </section>

        {/* ── Multi-League Overview (Phase OS-B1) — the default landing view; selecting a league
             below reveals League Focus further down the page, unchanged from before this phase. ── */}
        <CommissionerCommandCenterSection
          commissionerLeagues={commissionerLeagues}
          demoMode={showDemoMode}
          onSelectLeague={setSelectedLeagueId}
        />

        {/* Phase V1.0: the "League Operations Summary" stat row (Leagues Managed / Needs Setup /
             Missing Draft Date / Active Now) was removed — it fully duplicated
             CommissionerCommandCenterOverview's own stat chips directly above, a redundancy flagged
             but left unfixed since OS-B6/OS-B7. See docs/os/VISUAL_OS_V1_AUDIT.md Finding 6. */}

        <CommissionerShowcasePanel
          leagues={leagues}
          healthSnapshots={managedHealthSnapshots}
          demoMode={showDemoMode}
        />

        <LeaguePulseCard pulse={leaguePulse} variant="commissioner" />

        {/* ── League Focus (Phase OS-B1: now gated behind an explicit league selection instead of
             an automatic "first commissioner league" default — every card/fetch below is byte-for-
             byte unchanged from before this phase, only the trigger for showing them changed). ── */}
        {representativeLeagueId && (
          <section aria-label="League Focus">
            <button
              type="button"
              onClick={() => setSelectedLeagueId(null)}
              data-testid="league-focus-back-to-overview"
              className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-subtle bg-surface-muted px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-secondary transition hover:text-primary"
            >
              ← All leagues
            </button>

            {/* Phase V2.3 — League OS Executive Analytics Workspace. Speaks about the league itself:
                the League Momentum flagship (dominant) over supporting graphs, all from the existing
                `leagueAnalytics` snapshot (+ the already-loaded fairnessScore for Competitive Balance).
                Sits above the commissioner-specific guidance below. */}
            <section className="mb-5 space-y-4" data-testid="league-os-workspace" aria-label="League overview">
              <LeagueMomentum snapshot={leagueAnalytics} />
              <div className="grid gap-4 md:grid-cols-2">
                <TransactionDistributionCard snapshot={leagueAnalytics} />
                <LeagueEngagementCard snapshot={leagueAnalytics} />
                <CompetitiveBalanceCard healthSnapshot={healthByLeagueId.get(representativeLeagueId) ?? null} />
              </div>
            </section>

            {/* Phase V2.4 — Trade OS Executive Analytics Workspace. Represents the trade MARKET (not a
                player calculator): the Trade Opportunity Matrix (dominant) over Market Activity + Trade
                Pipeline, all from the already-fetched `leagueAnalytics` (trade count/trend) + the
                trade-category recommendations in `managerIntelligence`. */}
            <section className="mb-5 space-y-4" data-testid="trade-os-workspace" aria-label="Trade market overview">
              <TradeOpportunityMatrix
                recommendations={managerIntelligence?.recommendations?.recommendations ?? null}
                analytics={leagueAnalytics}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <MarketActivityCard analytics={leagueAnalytics} />
                <TradePipelineCard recommendations={managerIntelligence?.recommendations?.recommendations ?? null} />
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-2" aria-label="Commissioner guidance">
              <ManagerDnaCard profile={managerDna} variant="commissioner" compact />
              <DecisionRecommendationsCard model={recommendations} variant="commissioner" compact />
            </section>

            <div className="mt-4 space-y-4">
              <MissionControlCard snapshot={missionControl} variant="commissioner" compact />

              <LeagueAnalyticsCard snapshot={leagueAnalytics} variant="commissioner" />

              <LeagueContextCard leagueId={representativeLeagueId} canManage variant="commissioner" />
            </div>
          </section>
        )}

        <LeagueHealthDashboard snapshots={managedHealthSnapshots} demoMode={showDemoMode} />

        {/* Phase V1.0: the "Leagues I Manage" grid (its own 3rd, visually distinct rendering of the
             same league list already shown by the League Switcher inside the Multi-League Overview and
             by League Health Dashboard below) was removed — see docs/os/VISUAL_OS_V1_AUDIT.md Finding 5.
             `resolveSetupStatus`/`resolveNextAction` (its only callers) were removed with it. */}

        {/* ── Empty state ── */}
        {leagues.length === 0 && (
          <section className="rounded-2xl border border-subtle bg-surface-muted p-8 text-center">
            <Crown className="mx-auto mb-3 h-8 w-8 text-amber-400/40" aria-hidden />
            <p className="text-[14px] font-semibold text-secondary">{emptyHeading}</p>
            <p className="mt-1 text-[12px] text-muted">{emptySub}</p>
            <div className="mt-4 flex justify-center gap-3">
              <Link
                href={emptyPrimaryHref}
                prefetch={disablePrefetchForAuthSensitiveHref(emptyPrimaryHref) ? false : undefined}
                className="focus-ring inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[13px] font-semibold text-amber-700 transition hover:bg-amber-500/20"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {emptyPrimaryLabel}
              </Link>
              <Link
                href={emptySecondaryHref}
                prefetch={disablePrefetchForAuthSensitiveHref(emptySecondaryHref) ? false : undefined}
                className="focus-ring inline-flex items-center gap-1.5 rounded-xl border border-subtle bg-surface-muted px-4 py-2 text-[13px] font-semibold text-secondary transition hover:bg-surface-hover"
              >
                <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden />
                {emptySecondaryLabel}
              </Link>
            </div>
          </section>
        )}

        {/* ── Commissioner Mission Queue ── */}
        <section>
          <SectionHeader label={COPY.queue.sectionLabel} hint={COPY.queue.sectionHint} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {missionQueue.map((card) => {
              const Icon = card.icon
              return (
                <Link
                  key={card.key}
                  href={isAuthenticated ? card.href : buildLoginHref(card.href)}
                  prefetch={disablePrefetchForAuthSensitiveHref(isAuthenticated ? card.href : buildLoginHref(card.href)) ? false : undefined}
                  className={`group relative flex flex-col gap-3 rounded-2xl border px-4 py-4 transition-all ${card.cardClass}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${card.iconClass}`}
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    {card.badge && (
                      <span className="rounded-full border border-subtle bg-surface-hover px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted">
                        {card.badge}
                      </span>
                    )}
                  </div>
                  <div>
                    <p className="text-[14px] font-bold text-primary group-hover:text-primary">
                      {card.title}
                    </p>
                    <p className="mt-1 text-[12px] leading-snug text-muted">{card.desc}</p>
                  </div>
                  <ArrowRight
                    className="h-4 w-4 text-muted transition group-hover:text-secondary"
                    aria-hidden
                  />
                </Link>
              )
            })}
          </div>
        </section>

        {/* ── Commissioner AI Prompt Cards (white-label optional section) ── */}
        {isFeatureVisible(BRAND, 'aiPrompts') && (
        <section>
          <SectionHeader label={COPY.ai.sectionLabel} hint={COPY.ai.sectionHint} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {AI_PROMPT_CARDS.map((card) => {
              const Icon = card.icon
              return (
                <Link
                  key={card.key}
                  href={isAuthenticated ? card.href : buildLoginHref(card.href)}
                  prefetch={disablePrefetchForAuthSensitiveHref(isAuthenticated ? card.href : buildLoginHref(card.href)) ? false : undefined}
                  className="group flex flex-col gap-2.5 rounded-2xl border border-violet-500/[0.14] bg-gradient-to-br from-violet-500/[0.06] to-transparent px-4 py-4 transition-all hover:border-violet-500/25 hover:from-violet-500/[0.09]"
                >
                  <div className="flex items-start justify-between gap-2">
                    {/* Phase V1.1: icon chip text was `text-violet-300` — a light pastel meant for a
                        dark background, the same contrast bug class fixed on Commissioner Hub's hero
                        and Platform Readiness Snapshot in Phase V1.0 (docs/os/VISUAL_OS_V1_AUDIT.md
                        Finding 3/4). Swapped to a saturated, readable `-600` shade. */}
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-violet-500/30 bg-violet-500/10 text-violet-600">
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    {card.badge && (
                      <span className="rounded-full border border-subtle bg-surface-muted px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted">
                        {card.badge}
                      </span>
                    )}
                  </div>
                  <div>
                    <p className="text-[13px] font-bold text-primary group-hover:text-primary">
                      {card.title}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted">{card.desc}</p>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-violet-600 group-hover:text-violet-700">
                    <Sparkles className="h-3 w-3" aria-hidden />
                    Ask Chimmy
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
        )}

        {/* ── Migration Center (white-label optional section) ── */}
        {isFeatureVisible(BRAND, 'migrationCenter') && (
        <section>
          <SectionHeader label={COPY.migration.sectionLabel} hint={COPY.migration.sectionHint} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MIGRATION_PLATFORMS.map((platform) => {
              const styles = MIGRATION_STATUS_CLASSES[platform.status]
              const statusLabel =
                platform.status === 'active'
                  ? COPY.migration.activeLabel
                  : platform.status === 'legacy'
                    ? COPY.migration.legacyLabel
                    : COPY.migration.comingSoonLabel

              const inner = (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[14px] font-bold text-primary">{platform.name}</p>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${styles.badge}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} aria-hidden />
                      {statusLabel}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted">{platform.desc}</p>
                  {platform.status !== 'coming_soon' && (
                    <p className="text-[11px] font-semibold text-status-success transition group-hover:text-status-success">
                      {COPY.migration.importCta}
                    </p>
                  )}
                </>
              )

              return platform.href ? (
                <Link
                  key={platform.key}
                  href={isAuthenticated ? platform.href : buildLoginHref(platform.href)}
                  prefetch={disablePrefetchForAuthSensitiveHref(isAuthenticated ? platform.href : buildLoginHref(platform.href)) ? false : undefined}
                  className="group flex flex-col gap-2 rounded-2xl border border-subtle bg-surface-muted px-4 py-4 transition hover:border-emerald-500/20 hover:bg-emerald-500/[0.03]"
                >
                  {inner}
                </Link>
              ) : (
                <div
                  key={platform.key}
                  className="flex flex-col gap-2 rounded-2xl border border-subtle bg-surface-muted px-4 py-4 opacity-60"
                >
                  {inner}
                </div>
              )
            })}
          </div>
        </section>
        )}

        {/* ── Leagues I Play In ── */}
        {memberLeagues.length > 0 && (
          <section>
            <div className="mb-4 flex items-center gap-2">
              <Trophy className="h-4 w-4 text-status-info" aria-hidden />
              <p className="text-[11px] font-bold uppercase tracking-widest text-status-info">
                {COPY.memberLeagues.sectionLabel}
                <span className="ml-2 rounded-full border border-subtle bg-surface-muted px-1.5 py-0.5 text-[9px] font-bold text-muted">
                  {memberLeagues.length}
                </span>
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {memberLeagues.map((league) => (
                <Link
                  key={league.id}
                  href={`/league/${league.id}`}
                  className="group flex items-center gap-3 rounded-2xl border border-subtle bg-surface-muted p-4 transition hover:border-status-info/20 hover:bg-surface-hover"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-subtle bg-surface-muted">
                    <Trophy className="h-4 w-4 text-status-info" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-secondary group-hover:text-primary">
                      {league.name}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {league.sport}
                      {league.teamCount ? ` / ${league.teamCount}-team` : ''}
                    </p>
                  </div>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted group-hover:text-muted"
                    aria-hidden
                  />
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── Trust Block ── */}
        <section className="rounded-2xl border border-status-success/20 bg-status-success/[0.03] p-5">
          <div className="flex items-start gap-3">
            <Shield className="mt-0.5 h-5 w-5 shrink-0 text-status-success" aria-hidden />
            <div>
              <p className="text-[13px] font-bold text-status-success">{COPY.trust.heading}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">{COPY.trust.body1}</p>
              <p className="mt-2 text-[12px] leading-relaxed text-muted">{COPY.trust.body2}</p>
            </div>
          </div>
        </section>

      </div>
    </div>
  )
}
