'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import {
  ChevronRight,
  Coins,
  Crown,
  LayoutList,
  Swords,
  ClipboardList,
  Sparkles,
  Loader2,
  Trophy,
  Bot,
  Radio,
  Zap,
  RefreshCw,
} from 'lucide-react'
import { groupLeaguesBySport } from '@/lib/dashboard'
import { getLeagueListDestinationHref } from '@/lib/dashboard/league-list-destination'
import { useTokenBalance } from '@/hooks/useTokenBalance'
import { useEntitlement } from '@/hooks/useEntitlement'
import { useLeagueList } from '@/hooks/useLeagueList'
import { resolvesToLeagueRecord, type LeagueRecordPolicyInput } from '@/lib/dashboard/league-card-fetch-policy'
import { useAIAssistantAvailability } from '@/hooks/useAIAssistantAvailability'
import { useDashboardHomeSignals } from '@/hooks/useDashboardHomeSignals'
import { ErrorBoundary } from '@/components/error-handling'
import { AIProductLayer } from '@/lib/ai-product-layer'

const QUICK_ACTIONS_BASE = [
  { id: 'start-sit', label: 'Start / Sit', basePath: '/app/coach', icon: LayoutList, iconBg: 'bg-cyan-500/15', iconColor: 'text-cyan-400' },
  { id: 'trade', label: 'Trade', basePath: '/trade-evaluator', icon: Swords, iconBg: 'bg-emerald-500/15', iconColor: 'text-emerald-400' },
  { id: 'draft', label: 'Draft', basePath: '/mock-draft', icon: ClipboardList, iconBg: 'bg-violet-500/15', iconColor: 'text-violet-400' },
  { id: 'waivers', label: 'Waivers', basePath: '/waiver-ai', icon: Zap, iconBg: 'bg-amber-500/15', iconColor: 'text-amber-400' },
] as const

const MAX_LEAGUES_PER_GROUP = 3

function formatDraftStatus(status: string): string {
  const normalized = String(status || '').toLowerCase()
  if (normalized === 'in_progress') return 'Live draft'
  if (normalized === 'paused') return 'Paused'
  if (normalized === 'pre_draft') return 'Upcoming'
  return 'Draft'
}

function formatPlanLabel(plans: string[] | undefined, isActiveOrGrace: boolean): string {
  if (!isActiveOrGrace) return 'Free'
  const first = plans?.[0]
  if (!first) return 'Pro'
  return String(first)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export default function FinalDashboardClient() {
  const { status } = useSession()
  const { balance, loading: tokensLoading, error: tokensError, refetch: refetchTokens } = useTokenBalance()
  const {
    entitlement,
    isActiveOrGrace,
    loading: entitlementLoading,
    refetch: refetchEntitlement,
  } = useEntitlement()
  const {
    leagues,
    loading: leaguesLoading,
    error: leaguesError,
    refetch: refetchLeagues,
  } = useLeagueList(status === 'authenticated')
  const { enabled: aiAssistantEnabled, loading: aiAssistantLoading } = useAIAssistantAvailability()

  const groups = useMemo(() => groupLeaguesBySport(leagues), [leagues])
  const leaguesFlat = useMemo(() => groups.flatMap((group) => group.leagues), [groups])
  /*
   * ⚠ `groups` STILL RENDERS EVERY ROW — this is a narrower list for the things that resolve an
   * id, not a display filter. `firstLeague` seeds `?leagueId=`, `/league/<id>/draft` and Chimmy's
   * chat href, and `useDashboardHomeSignals` queries drafts/matchups by id; all of those key on the
   * `leagues` table. Tournament-hub rows carry a `LegacyTournament` id while setting
   * `hasUnifiedRecord: true`, so they are prepended to the list and could seed every one of those
   * links with an id that resolves to nothing.
   */
  const resolvableLeagues = useMemo(
    () => leaguesFlat.filter((league) => resolvesToLeagueRecord(league as LeagueRecordPolicyInput)),
    [leaguesFlat]
  )
  const leagueById = useMemo(
    () => new Map(resolvableLeagues.map((league) => [league.id, league])),
    [resolvableLeagues]
  )
  const firstLeague = resolvableLeagues[0]
  const isAuthed = status === 'authenticated'
  const {
    loading: signalsLoading,
    error: signalsError,
    upcomingDrafts,
    liveMatchups,
    refetch: refetchSignals,
  } = useDashboardHomeSignals(resolvableLeagues, isAuthed)

  const buildLeagueContextHref = useMemo(
    () =>
      (basePath: string): string => {
        if (!firstLeague?.id) return basePath
        const params = new URLSearchParams()
        params.set('leagueId', firstLeague.id)
        if (firstLeague.sport) params.set('sport', String(firstLeague.sport).toUpperCase())
        const variant = firstLeague.leagueVariant ?? firstLeague.league_variant
        if (variant) params.set('leagueVariant', String(variant))
        const query = params.toString()
        return query ? `${basePath}${basePath.includes('?') ? '&' : '?'}${query}` : basePath
      },
    [firstLeague]
  )

  const quickActions = useMemo(
    () =>
      QUICK_ACTIONS_BASE.map((action) => ({
        ...action,
        href:
          action.id === 'draft' && firstLeague?.id
            ? `/league/${firstLeague.id}/draft`
            : buildLeagueContextHref(action.basePath),
      })),
    [buildLeagueContextHref, firstLeague?.id]
  )

  const aiSuggestionsHref = firstLeague?.id
    ? `${getLeagueListDestinationHref(firstLeague)}?tab=Advisor`
    : '/app/coach'
  const tradeSuggestionHref = buildLeagueContextHref('/trade-evaluator')
  const waiverSuggestionHref = buildLeagueContextHref('/waiver-ai')

  const chimmyHref = AIProductLayer.chimmy.getChatHref({
    leagueId: firstLeague?.id,
    sport: firstLeague?.sport ? AIProductLayer.resolveSupportedSport(String(firstLeague.sport)) : undefined,
    source: 'dashboard',
  })
  const chimmyCtaHref = aiAssistantEnabled ? chimmyHref : aiSuggestionsHref
  const chimmyCtaTitle = aiAssistantEnabled ? 'Chimmy AI' : 'AI temporarily unavailable'
  const chimmyCtaSubtitle = aiAssistantEnabled
    ? 'Ask about your leagues'
    : aiAssistantLoading
      ? 'Checking AI availability...'
      : 'Open deterministic suggestions instead'
  const subscriptionLabel = formatPlanLabel(entitlement?.plans, isActiveOrGrace)
  const hasSignalData = upcomingDrafts.length > 0 || liveMatchups.length > 0
  const hasLeagues = leaguesFlat.length > 0

  const refreshDashboard = async () => {
    await Promise.all([refetchLeagues(), refetchTokens(), refetchEntitlement(), refetchSignals()])
  }

  if (status === 'loading') {
    return (
      <main className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-white/40" aria-hidden />
          <span className="text-sm text-white/50">Loading...</span>
        </div>
      </main>
    )
  }

  if (!isAuthed) {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-10 sm:py-14">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center">
          <h1 className="text-xl font-semibold text-white">Your dashboard</h1>
          <p className="mt-2 text-sm text-white/50">Sign in to see leagues, drafts, matchups, and AI suggestions.</p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/login?callbackUrl=/dashboard"
              className="min-h-[44px] inline-flex items-center justify-center rounded-xl border border-white/20 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/10 transition-premium focus-ring touch-manipulation"
            >
              Sign in
            </Link>
            <Link
              href="/signup?callbackUrl=/dashboard"
              className="min-h-[44px] inline-flex items-center justify-center rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-black hover:bg-cyan-400 active:scale-[0.98] transition-premium focus-ring touch-manipulation"
            >
              Sign up
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <ErrorBoundary>
      <main className="mx-auto w-full max-w-lg px-4 pb-10 pt-4 sm:pt-6">
        <section className="mb-5 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.16em] text-white/45">AllFantasy Dashboard</p>
              <h1 className="mt-1 text-xl font-bold text-white">Game Day Control Center</h1>
              <p className="mt-1 text-xs text-white/55">Leagues, drafts, matchups, and AI in one clean view.</p>
            </div>
            <button
              type="button"
              onClick={() => void refreshDashboard()}
              className="inline-flex min-h-[40px] items-center gap-1 rounded-xl border border-white/15 bg-white/[0.04] px-3 text-xs font-semibold text-white/85 hover:bg-white/[0.08] focus-ring touch-manipulation"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
        </section>

        <section className="mb-6 grid grid-cols-2 gap-2" aria-label="Account status">
          <Link
            href="/tokens"
            className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 hover:bg-white/[0.06] transition-premium focus-ring"
          >
            <div className="flex items-center gap-2 text-white/70">
              <Coins className="h-4 w-4 text-amber-400" />
              <span className="text-[11px] uppercase tracking-[0.14em]">Tokens</span>
            </div>
            <p className="mt-2 text-lg font-bold text-white tabular-nums">
              {tokensLoading ? '...' : tokensError ? 'Error' : balance}
            </p>
          </Link>
          <Link
            href="/pricing"
            className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 hover:bg-white/[0.06] transition-premium focus-ring"
          >
            <div className="flex items-center gap-2 text-white/70">
              <Crown className="h-4 w-4 text-amber-400" />
              <span className="text-[11px] uppercase tracking-[0.14em]">Subscription</span>
            </div>
            <p className="mt-2 text-sm font-semibold text-white">{entitlementLoading ? 'Syncing...' : subscriptionLabel}</p>
          </Link>
        </section>

        <section className="mb-7" aria-label="Quick actions">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/45">Quick actions</h2>
          <div className="grid grid-cols-2 gap-2">
            {quickActions.map((action) => {
              const Icon = action.icon
              return (
                <Link
                  key={action.id}
                  href={action.href}
                  className="flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 hover:bg-white/[0.06] transition-premium focus-ring touch-manipulation"
                >
                  <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${action.iconBg}`}>
                    <Icon className={`h-4 w-4 ${action.iconColor}`} />
                  </span>
                  <span className="text-xs font-semibold text-white">{action.label}</span>
                </Link>
              )
            })}
          </div>
        </section>

        <section className="mb-7" aria-label="Active leagues by sport">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">Active leagues by sport</h2>
            <div className="flex items-center gap-2 text-xs">
              <Link href="/create-league" className="text-cyan-300 hover:text-cyan-200">Create</Link>
              <Link href="/leagues" className="text-white/55 hover:text-white/80">All</Link>
            </div>
          </div>
          {leaguesError ? (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
              <p className="text-sm text-amber-100">{leaguesError}</p>
              <button
                type="button"
                onClick={() => void refetchLeagues()}
                className="mt-3 rounded-lg border border-amber-500/35 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-500/20"
              >
                Retry league sync
              </button>
            </div>
          ) : leaguesLoading ? (
            <div className="flex min-h-[96px] items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03]">
              <Loader2 className="h-5 w-5 animate-spin text-white/40" />
            </div>
          ) : !hasLeagues ? (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-center">
              <p className="text-sm text-white/60">No active leagues yet.</p>
              <Link href="/create-league" className="mt-3 inline-block text-xs font-semibold text-cyan-300 hover:text-cyan-200">
                Create or join a league
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map((group) => (
                <div key={group.sport} className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03]">
                  <div className="flex items-center gap-2 border-b border-white/[0.08] px-3 py-2">
                    <span>{group.emoji}</span>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">{group.label}</span>
                    <span className="ml-auto text-[11px] text-white/40">{group.leagues.length}</span>
                  </div>
                  <ul className="divide-y divide-white/[0.08]">
                    {group.leagues.slice(0, MAX_LEAGUES_PER_GROUP).map((league) => (
                      <li key={league.id}>
                        <Link
                          href={getLeagueListDestinationHref(league)}
                          className="flex items-center gap-2 px-3 py-2.5 hover:bg-white/[0.05] transition-premium focus-ring"
                        >
                          <Trophy className="h-3.5 w-3.5 text-white/35 shrink-0" />
                          <span className="min-w-0 flex-1 truncate text-sm text-white">{league.name || 'Unnamed league'}</span>
                          <span className="text-[11px] text-white/45">{league.leagueSize ?? '?'}-team</span>
                          <ChevronRight className="h-3.5 w-3.5 text-white/30 shrink-0" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mb-7 grid grid-cols-1 gap-3" aria-label="Upcoming drafts and live matchups">
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">Upcoming drafts</h2>
              <Link href="/mock-draft" className="text-xs text-white/55 hover:text-white/80">Open draft tools</Link>
            </div>
            {signalsLoading && !hasSignalData ? (
              <div className="flex min-h-[64px] items-center justify-center">
                <Loader2 className="h-4.5 w-4.5 animate-spin text-white/35" />
              </div>
            ) : upcomingDrafts.length > 0 ? (
              <div className="space-y-2">
                {upcomingDrafts.map((draft) => {
                  const league = leagueById.get(draft.leagueId)
                  return (
                    <Link
                      key={`${draft.leagueId}:${draft.updatedAt}`}
                      href={`/league/${draft.leagueId}/draft`}
                      className="flex items-center gap-3 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 hover:bg-white/[0.05] transition-premium focus-ring"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
                        <ClipboardList className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-white">{league?.name || 'League draft'}</span>
                        <span className="block text-xs text-white/45">{formatDraftStatus(draft.status)}</span>
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-white/30 shrink-0" />
                    </Link>
                  )
                })}
              </div>
            ) : (
              <Link
                href={firstLeague ? `/league/${firstLeague.id}/draft` : '/mock-draft'}
                className="flex items-center gap-3 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 hover:bg-white/[0.05] transition-premium focus-ring"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
                  <ClipboardList className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">
                    {firstLeague ? `${firstLeague.name || 'League'} draft` : 'Open mock draft'}
                  </span>
                  <span className="block text-xs text-white/45">No scheduled live drafts detected yet.</span>
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-white/30 shrink-0" />
              </Link>
            )}
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">Live matchups</h2>
              <Link
                href={firstLeague ? `${getLeagueListDestinationHref(firstLeague)}?tab=Matchups` : '/app/matchup-simulation'}
                className="text-xs text-white/55 hover:text-white/80"
              >
                Open matchups
              </Link>
            </div>
            {signalsLoading && !hasSignalData ? (
              <div className="flex min-h-[64px] items-center justify-center">
                <Loader2 className="h-4.5 w-4.5 animate-spin text-white/35" />
              </div>
            ) : liveMatchups.length > 0 ? (
              <div className="space-y-2">
                {liveMatchups.map((item) => {
                  const league = leagueById.get(item.leagueId)
                  return (
                    <Link
                      key={`${item.leagueId}:${item.seasonYear}:${item.week}`}
                      href={`/league/${item.leagueId}?tab=Matchups`}
                      className="flex items-center gap-3 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 hover:bg-white/[0.05] transition-premium focus-ring"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300">
                        <Radio className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-white">{league?.name || 'Live matchup'}</span>
                        <span className="block text-xs text-white/45">Week {item.week} · {item.matchupCount} matchup{item.matchupCount === 1 ? '' : 's'}</span>
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-white/30 shrink-0" />
                    </Link>
                  )
                })}
              </div>
            ) : (
              <Link
                href={firstLeague ? `${getLeagueListDestinationHref(firstLeague)}?tab=Matchups` : '/app/matchup-simulation'}
                className="flex items-center gap-3 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 hover:bg-white/[0.05] transition-premium focus-ring"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300">
                  <Radio className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">Matchup center</span>
                  <span className="block text-xs text-white/45">Scores and projections by league.</span>
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-white/30 shrink-0" />
              </Link>
            )}
            {signalsError ? <p className="mt-2 text-[11px] text-amber-300/85">{signalsError}</p> : null}
          </div>
        </section>

        <section className="space-y-3" aria-label="AI suggestions">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">AI suggestions</h2>
          <Link
            href={aiSuggestionsHref}
            className="flex items-center gap-3 rounded-xl border border-cyan-500/25 bg-cyan-500/10 p-4 hover:bg-cyan-500/15 transition-premium focus-ring"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-300">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-white">League AI advisor</span>
              <span className="block text-xs text-cyan-100/75">Start/sit, trade posture, waiver priorities.</span>
            </span>
            <ChevronRight className="h-4 w-4 text-cyan-300/70 shrink-0" />
          </Link>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Link href={tradeSuggestionHref} className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 hover:bg-white/[0.06] transition-premium focus-ring">
              <span className="text-xs font-semibold text-white">Trade suggestions</span>
              <span className="mt-0.5 block text-[11px] text-white/45">Evaluate deals with league context.</span>
            </Link>
            <Link href={waiverSuggestionHref} className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 hover:bg-white/[0.06] transition-premium focus-ring">
              <span className="text-xs font-semibold text-white">Waiver suggestions</span>
              <span className="mt-0.5 block text-[11px] text-white/45">Find adds and FAAB targets fast.</span>
            </Link>
          </div>
          <Link
            href={chimmyCtaHref}
            data-testid="dashboard-chimmy-entry"
            className="flex items-center gap-3 rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 hover:bg-white/[0.06] transition-premium focus-ring"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white/85">
              <Bot className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-white">{chimmyCtaTitle}</span>
              <span className="block text-xs text-white/45">{chimmyCtaSubtitle}</span>
            </span>
            <ChevronRight className="h-3.5 w-3.5 text-white/30 shrink-0" />
          </Link>
        </section>
      </main>
    </ErrorBoundary>
  )
}

