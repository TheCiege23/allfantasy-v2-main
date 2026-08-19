'use client'

/**
 * AllFantasy Adaptive Dashboard.
 *
 * ONE dashboard rendered three genuinely different ways — not one tree reflowed by CSS:
 *   desktop ≥1280   232px sidebar · 6-col KPI grid · 4-col analytics · 3-col rows
 *   tablet 768–1279 74px icon rail · 3-col KPI grid · 2-col analytics · stacked rows
 *   mobile  <768    no sidebar; bottom tab bar + drawer; KPI becomes a snap-scroll strip
 *
 * Gating model: every card renders in its final position for every plan. Cards the user
 * can't access blur behind a lock overlay rather than disappearing, so upgrading fills the
 * blanks instead of rearranging the page.
 *
 * ── Data honesty ────────────────────────────────────────────────────────────────
 * Everything displayed is real, or explicitly says it isn't. Where the design specified a
 * metric this codebase has no source for, the card keeps its designed position and states
 * the gap. The two such cases are named at their call sites:
 *   - Waiver FAAB efficiency — no points-per-dollar metric exists anywhere in the repo.
 *   - Weekly win probability — real, but only via a rate-limited AI-tools POST, so it is
 *     not auto-fired on dashboard load; the card links to the tool that computes it.
 * This matters because fabricated dashboard data has been a recurring, separately-fixed bug
 * class here (League Buzz, AF Rank, career counts).
 *
 * ── Load discipline ─────────────────────────────────────────────────────────────
 * Analytics are fetched for the SELECTED league only, never per-league. A prior dashboard
 * fanned out one request per league card and took production Postgres to OOM (53200); real
 * accounts here hold 500+ leagues.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { useAccessTier } from '@/hooks/useAccessTier'
import { useTokenBalance } from '@/hooks/useTokenBalance'
import { useEntitlements } from '@/hooks/useEntitlements'
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
import type { UserLeague } from '@/app/dashboard/types'
import { FloatingCommunications } from '@/app/dashboard/components/FloatingCommunications'
import type { LeftChatInitialTab } from '@/app/dashboard/types'

import { useDeviceKind } from './hooks/useDeviceKind'
import { useViewAsRole, stateToRole } from './hooks/useViewAsRole'
import { useWidgetLayout } from './hooks/useWidgetLayout'
import { useLeagueAnalytics } from './hooks/useLeagueAnalytics'
import { AdaptiveTopNav, type DropdownKey } from './shell/AdaptiveTopNav'
import { AdaptiveSidebar } from './shell/AdaptiveSidebar'
import { MobileTabBar, NavDrawer } from './shell/MobileNav'
import { KpiRow, type KpiWidget } from './sections/KpiRow'
import { PerformanceOverview } from './sections/PerformanceOverview'
import { LeagueRow, type DashboardLeague, type LiveScore } from './sections/LeagueRow'
import { BottomRow, LegendStrip, TokenToolsStrip, type RankSummary } from './sections/ToolsAndHealth'
import { UnlockModal, NoMetric, type UnlockRequest } from './ui/Gating'
import { ColumnChart, DonutChart, GaugeChart, SparklineChart } from './charts'
import './adaptive-dashboard.css'

type LeagueListPayload = { leagues?: unknown[]; sleeperUserId?: string | null } | undefined

export type AdaptiveDashboardProps = {
  userId: string
  userName: string
  userImage?: string | null
  initialLeagueList?: LeagueListPayload
  initialUserRankPayload?: Record<string, unknown>
  initialCommissionerHealthSnapshots?: CommissionerLeagueHealthSnapshot[]
  discordConnected?: boolean
}

/** KPI catalogue. The first six are the design's row; the last two are real extras. */
const KPI_KEYS = ['health', 'standing', 'points', 'winprob', 'playoff', 'trade', 'title', 'attention'] as const
const KPI_DEFAULT_HIDDEN = ['title', 'attention'] as const

const PLATFORM_ACCENT: Record<string, string> = {
  sleeper: 'var(--af-cyan)', espn: 'var(--af-red)', yahoo: 'var(--af-violet)',
  mfl: 'var(--af-emerald)', fantrax: 'var(--af-gold)', native: 'var(--af-blue)',
}

export default function AdaptiveDashboard({
  userId, userName, userImage, initialLeagueList, initialUserRankPayload,
  initialCommissionerHealthSnapshots, discordConnected = false,
}: AdaptiveDashboardProps) {
  const pathname = usePathname()
  const selfHref = pathname || '/dashboard/v2'

  const access = useAccessTier()
  const { balance: tokenBalance, loading: tokenBalanceLoading, error: tokenBalanceError } = useTokenBalance()
  const entitlements = useEntitlements()

  // ── Layout state ────────────────────────────────────────────────────────────
  const device = useDeviceKind('auto')
  const isMobile = device === 'mobile'
  const isDesktop = device === 'desktop'

  const [openDropdown, setOpenDropdown] = useState<DropdownKey>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [kpiEditMode, setKpiEditMode] = useState(false)
  const [unlock, setUnlock] = useState<UnlockRequest | null>(null)
  const [searchValue, setSearchValue] = useState('')
  const [searchResults, setSearchResults] = useState<PlayerResult[]>([])
  const [notifications, setNotifications] = useState<NotificationItem[] | null>(null)
  const [unreadMessages, setUnreadMessages] = useState<number | null>(null)
  const [commsOpen, setCommsOpen] = useState(false)
  const [commsTab, setCommsTab] = useState<LeftChatInitialTab | null>(null)

  // ── Leagues ─────────────────────────────────────────────────────────────────
  const rawLeagues = useMemo(
    () => (Array.isArray(initialLeagueList?.leagues) ? initialLeagueList!.leagues! : []),
    [initialLeagueList],
  )
  const leagues = useMemo<DashboardLeague[]>(() => rawLeagues.map(toDashboardLeague), [rawLeagues])
  const userLeagues = useMemo<UserLeague[]>(
    () => rawLeagues.map(toUserLeague).filter((l): l is UserLeague => l !== null),
    [rawLeagues],
  )
  const commissionerLeagues = useMemo(
    () => userLeagues.filter((l) => l.isCommissioner).map((l) => ({ id: l.id, name: l.name, teamCount: l.teamCount ?? 0 })),
    [userLeagues],
  )
  const commissionsAnyLeague = commissionerLeagues.length > 0

  const { role, override, setOverride, enabled: viewAsEnabled } = useViewAsRole({
    access, entitlements, tokenBalance, commissionsAnyLeague,
  })

  // ── Scope selection ─────────────────────────────────────────────────────────
  const sports = useMemo(() => uniqueBy(leagues.map((l) => l.sport).filter(Boolean) as string[]), [leagues])
  const seasons = useMemo(
    () => uniqueBy(leagues.map((l) => l.season).filter((s): s is number => s != null).map(String)).sort().reverse(),
    [leagues],
  )
  const [selectedSport, setSelectedSport] = useState<string | null>(null)
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null)

  // Both scope pills actually filter. A dropdown that changes a label but not the board is
  // worse than no dropdown — it silently misrepresents what's on screen.
  const scopedLeagues = useMemo(() => leagues.filter((l) => (
    (!selectedSport || l.sport === selectedSport)
    && (!selectedSeason || String(l.season) === selectedSeason)
  )), [leagues, selectedSport, selectedSeason])

  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null)
  // Default to the first in-scope league so the analytics cards resolve on first paint —
  // and re-point if the current selection falls outside a newly-narrowed scope, otherwise
  // the cards would keep showing a league the filters say isn't there.
  useEffect(() => {
    if (scopedLeagues.length === 0) return
    if (selectedLeagueId && scopedLeagues.some((l) => l.id === selectedLeagueId)) return
    setSelectedLeagueId(scopedLeagues[0].id)
  }, [scopedLeagues, selectedLeagueId])

  const selectedLeague = useMemo(
    () => leagues.find((l) => l.id === selectedLeagueId) ?? null,
    [leagues, selectedLeagueId],
  )

  // ── Real analytics for the selected league (one league, one request) ────────
  const sleeperUserId = typeof initialLeagueList?.sleeperUserId === 'string' ? initialLeagueList.sleeperUserId : null
  /*
   * ⚠ `/api/rankings/league-v2` is LEGACY id-space, not `League.id`.
   * `computeLeagueRankingsV2` resolves the league via `legacyLeague.sleeperLeagueId` and the
   * Sleeper roster/user helpers, so it must be handed the PROVIDER's league id. Passing the
   * internal id 404s for every league — and gating on `hasUnifiedRecord` is backwards here,
   * since the imported Sleeper leagues (unified=false) are precisely the ones this engine can
   * serve. A native league with no provider id has no rankings source at all.
   */
  const analyticsLeagueId = selectedLeague?.platformLeagueId ?? null
  const analytics = useLeagueAnalytics(analyticsLeagueId, sleeperUserId)

  // ── Today's actions + live scores ───────────────────────────────────────────
  const [today, setToday] = useState<TodayCounts | 'unavailable' | null>(null)
  useEffect(() => {
    if (leagues.length === 0) { setToday(null); return }
    const ac = new AbortController()
    fetch('/api/dashboard/today-actions', { cache: 'no-store', signal: ac.signal })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      // 503/degraded must surface as "unavailable", never as an all-clear zero — the API
      // returns it precisely so the client doesn't tell the user everything is fine.
      .then((d) => setToday(parseToday(d) ?? 'unavailable'))
      .catch((e) => { if (e?.name !== 'AbortError') setToday('unavailable') })
    return () => ac.abort()
  }, [leagues.length])

  const [liveScores, setLiveScores] = useState<LiveScore[] | null>(null)
  useEffect(() => {
    if (leagues.length === 0) return
    const ac = new AbortController()
    fetch('/api/dashboard/live-scores', { cache: 'no-store', signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setLiveScores(Array.isArray(d?.scores) ? d.scores : []))
      .catch((e) => { if (e?.name !== 'AbortError') setLiveScores(null) })
    return () => ac.abort()
  }, [leagues.length])

  const liveScore = useMemo(() => {
    if (!liveScores || liveScores.length === 0) return null
    return liveScores.find((s) => s.leagueId === selectedLeagueId) ?? liveScores[0]
  }, [liveScores, selectedLeagueId])

  // ── Notifications (real platform notifications, not a decorative badge) ──────
  useEffect(() => {
    const ac = new AbortController()
    fetch('/api/user/notifications?unread=true&limit=8', { cache: 'no-store', signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !Array.isArray(d.notifications)) return
        setNotifications(d.notifications.map((n: Record<string, unknown>) => ({
          id: String(n.id),
          text: [n.title, n.body].filter(Boolean).join(' — ') || 'Notification',
        })))
        // `unreadTotal` counts every unread row, not just this page's 8.
        setUnreadMessages(typeof d.unreadTotal === 'number' ? d.unreadTotal : null)
      })
      // Leave both null on failure — the menus then say "not wired up" rather than
      // asserting a confident zero the server never returned.
      .catch(() => {})
    return () => ac.abort()
  }, [])

  // ── Cross-league player search (debounced) ──────────────────────────────────
  useEffect(() => {
    const q = searchValue.trim()
    if (q.length < 2) { setSearchResults([]); return }
    const ac = new AbortController()
    const t = setTimeout(() => {
      fetch(`/api/players/my-exposure?q=${encodeURIComponent(q)}`, { cache: 'no-store', signal: ac.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setSearchResults(Array.isArray(d?.players) ? d.players.slice(0, 6) : []))
        .catch(() => {})
    }, 250)
    return () => { ac.abort(); clearTimeout(t) }
  }, [searchValue])

  const rank = useMemo(() => readRank(initialUserRankPayload), [initialUserRankPayload])

  const health = useMemo(() => {
    const all = initialCommissionerHealthSnapshots ?? []
    return all.find((s) => s.leagueId === selectedLeagueId) ?? all[0] ?? null
  }, [initialCommissionerHealthSnapshots, selectedLeagueId])

  // ── Gating ──────────────────────────────────────────────────────────────────
  // While entitlements load, don't render locks — flashing a paywall at a paying user is
  // worse than a beat of empty space.
  const showLocks = !role.loading && !role.hasPro
  const askUpgrade = useCallback((title: string, body: string, tier = 'Pro') => {
    setUnlock({
      title, body, tier,
      primaryLabel: `Unlock with ${tier}`,
      primaryHref: '/upgrade',
      comparePlansHref: '/pricing',
    })
  }, [])

  const layout = useWidgetLayout('kpi', KPI_KEYS, role.roleKey, device, KPI_DEFAULT_HIDDEN)

  // ── KPI widgets ─────────────────────────────────────────────────────────────
  const a = analytics.data
  const widgets = useMemo<KpiWidget[]>(() => {
    const proLock = (label: string, body: string) => ({
      locked: showLocks, lockLabel: 'Pro Feature', onUnlock: () => askUpgrade(label, body),
    })
    const noLock = { locked: false, lockLabel: '', onUnlock: () => {} }
    const analyticsEmpty = (metric: string) =>
      !selectedLeague ? `Select a league to see ${metric}.`
        // No provider id → the rankings engine has nothing to resolve; say that plainly
        // rather than implying the league is merely early in its season.
        : !selectedLeague.platformLeagueId ? `${selectedLeague.name} isn’t provider-linked, so it has no ${metric}.`
          : analytics.loading ? 'Loading…'
            : analytics.unavailable === 'failed' ? `Couldn’t load ${metric}.`
              : `No ${metric} for this league yet.`

    return [
      {
        key: 'health', label: 'League Health', ...noLock,
        body: health ? (
          <Row>
            <GaugeChart value={health.healthScore} color="var(--af-emerald)" />
            <div>
              <div style={{ fontSize: 11, color: 'var(--af-emerald)', fontWeight: 700 }}>{health.overallStatus}</div>
              <div style={{ fontSize: 10.5, color: 'var(--af-text-faint)', marginTop: 2 }}>{health.healthTrend}</div>
            </div>
          </Row>
        ) : (
          <NoMetric compact reason={
            role.isCommissioner
              ? 'No health snapshot for this league yet.'
              : 'League health is a commissioner metric.'
          } />
        ),
      },
      {
        key: 'standing', label: 'League Standing', ...noLock,
        body: a?.me ? (
          <>
            <Stat>{ordinal(a.me.rank)} of {a.me.totalTeams}</Stat>
            <Sub>{a.me.record.wins}-{a.me.record.losses}{a.me.record.ties ? `-${a.me.record.ties}` : ''}</Sub>
            {a.me.rankSparkline.length > 1 && (
              // Rank inverts: 1st is best, so flip it before plotting or the line reads upside down.
              <SparklineChart values={a.me.rankSparkline.map((r) => -r)} color="var(--af-violet)" />
            )}
          </>
        ) : <NoMetric compact reason={analyticsEmpty('standing')} />,
      },
      {
        key: 'points', label: 'Points For', ...proLock('Scoring history', 'Track your weekly scoring against the league with AllFantasy Pro.'),
        body: a?.scoring ? (
          <>
            <Stat>{a.scoring.mine[a.scoring.mine.length - 1]?.toFixed(1)}</Stat>
            <Sub>latest week · {a.scoring.mine.length} weeks tracked</Sub>
            <SparklineChart values={a.scoring.mine} color="var(--af-cyan)" />
          </>
        ) : <NoMetric compact reason={analyticsEmpty('scoring history')} />,
      },
      {
        key: 'winprob', label: 'Win Probability (Wk)', ...proLock('Win probability', 'See live win-probability modelling with AllFantasy Pro.'),
        // Real, but only from a rate-limited AI-tools POST — not auto-fired on dashboard load.
        body: <NoMetric compact
          reason="Win probability is modelled by Matchup Prep, not on load."
          action={{ label: 'Run Matchup Prep', href: '/war-room' }} />,
      },
      {
        key: 'playoff', label: 'Playoff Odds', ...proLock('Playoff odds', 'See season-long playoff odds modelling with AllFantasy Pro.'),
        body: a?.me ? (
          <Row>
            <DonutChart value={a.me.playoffPct} color="var(--af-blue)" display={`${Math.round(a.me.playoffPct)}%`} />
            <div style={{ fontSize: 10.5, color: 'var(--af-text-faint)' }}>
              from {a.me.simCount.toLocaleString()} sims
            </div>
          </Row>
        ) : <NoMetric compact reason={analyticsEmpty('playoff odds')} />,
      },
      {
        key: 'trade', label: 'Pending Trades', ...proLock('Trade activity', 'Track league-wide trade activity with AllFantasy Pro.'),
        body: today === 'unavailable' ? (
          <NoMetric compact reason="Today’s actions are temporarily unavailable." />
        ) : today ? (
          <>
            <Stat>{today.trades}</Stat>
            <Sub>awaiting your response</Sub>
          </>
        ) : <NoMetric compact reason="No trade data yet." />,
      },
      {
        key: 'title', label: 'Title Odds', ...proLock('Title odds', 'See championship odds modelling with AllFantasy Pro.'),
        body: a?.me ? (
          <Row>
            <DonutChart value={a.me.titlePct} color="var(--af-violet)" display={`${Math.round(a.me.titlePct)}%`} />
            <div style={{ fontSize: 10.5, color: 'var(--af-text-faint)' }}>
              from {a.me.simCount.toLocaleString()} sims
            </div>
          </Row>
        ) : <NoMetric compact reason={analyticsEmpty('title odds')} />,
      },
      {
        key: 'attention', label: 'Needs Attention', ...noLock,
        body: today === 'unavailable' ? (
          <NoMetric compact reason="Today’s actions are temporarily unavailable." />
        ) : today ? (
          <>
            <Stat>{today.lineups + today.waivers + today.trades}</Stat>
            <Sub>across your leagues</Sub>
            <ColumnChart color="var(--af-gold)" points={[
              { label: 'Lineups', value: today.lineups },
              { label: 'Waivers', value: today.waivers },
              { label: 'Trades', value: today.trades },
            ]} />
          </>
        ) : <NoMetric compact reason="Nothing needs attention." />,
      },
    ]
  }, [a, health, today, showLocks, askUpgrade, selectedLeague, analytics.loading, analytics.unavailable, role.isCommissioner])

  const mainPadding = isMobile ? '14px 12px 90px' : isDesktop ? '20px 26px 40px' : '18px 18px 40px'

  return (
    <div className="af-adaptive">
      <AdaptiveTopNav
        device={device}
        userName={userName}
        userInitials={initialsOf(userName)}
        userImage={userImage}
        roleLabel={role.roleLabel}
        sports={sports.map((s) => ({ id: s, label: s.toUpperCase() }))}
        selectedSport={selectedSport}
        // Re-selecting the active option clears the filter — the pill doubles as its own "all".
        onSelectSport={(id) => setSelectedSport(id === selectedSport ? null : id)}
        leagues={scopedLeagues.slice(0, 40).map((l) => ({ id: l.id, label: l.name }))}
        selectedLeagueId={selectedLeagueId}
        onSelectLeague={setSelectedLeagueId}
        seasons={seasons.map((s) => ({ id: s, label: `${s} Season` }))}
        selectedSeason={selectedSeason}
        onSelectSeason={(id) => setSelectedSeason(id === selectedSeason ? null : id)}
        notifications={notifications}
        unreadMessages={unreadMessages}
        openDropdown={openDropdown}
        setOpenDropdown={setOpenDropdown}
        viewAs={viewAsEnabled ? {
          active: override ?? stateToRole(role.planTier, role.isCommissioner),
          onSelect: setOverride,
        } : null}
        onOpenDrawer={() => setDrawerOpen(true)}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        searchResults={
          searchValue.trim().length >= 2 ? (
            <PlayerSearchResults results={searchResults} onDismiss={() => setSearchValue('')} />
          ) : null
        }
        selfHref={selfHref}
      />

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {!isMobile && (
          <AdaptiveSidebar
            variant={isDesktop ? 'full' : 'rail'}
            activeKey="dashboard"
            isCommissioner={role.isCommissioner}
            selectedLeagueId={selectedLeague?.unified ? selectedLeague.id : null}
            badgeCounts={today && today !== 'unavailable'
              ? { waivers: today.waivers, trades: today.trades }
              : {}}
            draftIsLive={false}
          />
        )}

        <main style={{ flex: 1, overflowY: 'auto', minWidth: 0, padding: mainPadding }}>
          {/* ── Welcome ────────────────────────────────────────────────────── */}
          <div className="af-fadein" style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 14, marginBottom: 18,
          }}>
            <div>
              <h1 style={{ fontSize: 26, display: 'flex', alignItems: 'center', gap: 8 }}>
                Welcome back, {firstNameOf(userName)} <span style={{ fontSize: 19 }}>👋</span>
              </h1>
              <div style={{ fontSize: 12.5, color: 'var(--af-text-dim)', marginTop: 3 }}>
                Here&apos;s what&apos;s happening across your fantasy empire.
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--af-text-dim)' }}>
                Plan
                <span style={{
                  background: 'var(--af-grad)', color: '#fff', fontSize: 11, fontWeight: 800,
                  padding: '3px 9px', borderRadius: 6,
                }}>
                  {role.planLabel}
                </span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--af-text-dim)' }}>
                Tokens{' '}
                <span style={{ color: 'var(--af-gold)', fontWeight: 800, fontSize: 13 }}>
                  🪙 {tokenBalanceLoading ? '...' : tokenBalanceError || tokenBalance == null ? '—' : tokenBalance}
                </span>
              </span>
              {!role.hasPro && !role.loading && (
                <Link href="/upgrade" className="af-btn af-btn-primary"
                  style={{ padding: '8px 16px', fontSize: 12.5, borderRadius: 8 }}>
                  Upgrade
                </Link>
              )}
            </div>
          </div>

          <KpiRow
            widgets={widgets}
            layout={layout}
            device={device}
            editMode={kpiEditMode}
            onToggleEdit={() => setKpiEditMode((v) => !v)}
          />

          <PerformanceOverview
            analytics={a}
            unavailable={analytics.unavailable}
            loading={analytics.loading}
            device={device}
            locked={showLocks}
            onUnlock={() => askUpgrade(
              'Performance Analytics',
              'Unlock scoring trends, position strength and roster analysis with AllFantasy Pro.',
            )}
            scope={{
              kind: !selectedLeague ? 'no-league' : !analyticsLeagueId ? 'no-provider' : 'ok',
              leagueName: selectedLeague?.name,
            }}
          />

          <LeagueRow
            device={device}
            leagues={scopedLeagues}
            totalLeagueCount={leagues.length}
            liveScore={liveScore}
            liveScoresEmpty={liveScores !== null && liveScores.length === 0}
            analytics={a}
            selectedLeagueId={selectedLeagueId}
          />

          <TokenToolsStrip
            tokenBalance={tokenBalance}
            onSpend={setUnlock}
            category="ai_feature"
            title="Token Tools"
          />

          <BottomRow
            device={device}
            rank={rank}
            connectedPlatforms={new Set(leagues.map((l) => l.platform))}
            health={health}
            isCommissioner={role.isCommissioner}
            commissionerLocked={showLocks}
            onUnlockCommissioner={() => askUpgrade(
              'Commissioner Analytics',
              'Unlock league health scoring, engagement and sustainability analytics.',
              'Commissioner Pro',
            )}
          />

          {role.isCommissioner && (
            <TokenToolsStrip
              tokenBalance={tokenBalance}
              onSpend={setUnlock}
              category="commissioner_function"
              title="Commissioner Token Tools"
            />
          )}

          <LegendStrip />
        </main>
      </div>

      {isMobile && <MobileTabBar activeKey="dashboard" onOpenDrawer={() => setDrawerOpen(true)} />}
      {/*
        One drawer for every breakpoint. Only mobile has an affordance to open it (hamburger
        + "More"), but rendering it unconditionally means a drawer left open while resizing
        past 768px stays controllable instead of unmounting mid-interaction.
      */}
      <NavDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        isCommissioner={role.isCommissioner}
        selectedLeagueId={selectedLeague?.unified ? selectedLeague.id : null}
        activeKey="dashboard"
      />

      {/*
        Design's FAB, real chat. `FloatingCommunications` is already wired to this app's
        chat/DM/league-chat surfaces and, critically, to the token-spend confirmation the
        Chimmy endpoint requires — so it owns the panel and we supply only the launcher
        (`hideLauncher`). Rebuilding the panel would mean reimplementing a paid flow.
      */}
      {!commsOpen && (
        <button
          type="button"
          onClick={() => { setCommsTab('chimmy'); setCommsOpen(true) }}
          aria-label="Open Chimmy"
          style={{
            position: 'fixed', zIndex: 260,
            ...(isMobile ? { bottom: 80, right: 16 } : { bottom: 24, right: 24 }),
            width: 52, height: 52, borderRadius: '50%', background: 'var(--af-grad-135)',
            border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'center', boxShadow: '0 6px 20px rgba(6,182,212,.4)',
          }}
        >
          <MessageSquare size={22} strokeWidth={2} color="#fff" />
        </button>
      )}
      <FloatingCommunications
        open={commsOpen}
        requestedTab={commsTab}
        hideLauncher
        onOpen={() => setCommsOpen(true)}
        onClose={() => { setCommsOpen(false); setCommsTab(null) }}
        userId={userId}
        userName={userName}
        userImage={userImage ?? null}
        leagues={userLeagues}
        activeLeagueId={selectedLeagueId}
        discordConnected={discordConnected}
        commissionerLeagues={commissionerLeagues}
      />

      <UnlockModal request={unlock} onClose={() => setUnlock(null)} />
    </div>
  )
}

// ── Player search results ──────────────────────────────────────────────────────
/**
 * Cross-league exposure for a searched player — how many of YOUR leagues roster them, and
 * in how many you're starting them. Reuses `/api/players/my-exposure`, the same route the
 * current dashboard uses, so no new backend.
 */
function PlayerSearchResults({
  results, onDismiss,
}: { results: PlayerResult[]; onDismiss: () => void }) {
  return (
    <div className="af-menu" style={{ left: 0, right: 0, width: '100%', maxHeight: 320, overflowY: 'auto', padding: 6 }}>
      {results.length === 0 ? (
        <div style={{ fontSize: 11.5, color: 'var(--af-text-faint)', padding: '8px 10px', lineHeight: 1.5 }}>
          No player by that name on any of your rosters.
        </div>
      ) : results.map((p) => (
        <div key={p.playerId} onClick={onDismiss} style={{
          display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
          borderRadius: 7, cursor: 'default',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.name ?? 'Unknown player'}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--af-text-faint)' }}>
              {[p.position, p.team].filter(Boolean).join(' · ') || '—'}
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--af-cyan)' }}>
              {p.leagueCount} {p.leagueCount === 1 ? 'league' : 'leagues'}
            </div>
            <div style={{ fontSize: 10, color: 'var(--af-text-faint)' }}>
              {p.startingCount} starting
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Small presentational helpers ───────────────────────────────────────────────
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{children}</div>
}
function Stat({ children }: { children: React.ReactNode }) {
  return <div className="af-stat" style={{ fontSize: 24 }}>{children}</div>
}
function Sub({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10.5, color: 'var(--af-text-faint)', margin: '2px 0 6px' }}>{children}</div>
}

// ── Parsers ────────────────────────────────────────────────────────────────────
type TodayCounts = { lineups: number; waivers: number; trades: number }
type NotificationItem = { id: string; text: string }
type PlayerResult = {
  playerId: string; name: string | null; position: string | null; team: string | null
  leagueCount: number; startingCount: number
}

function parseToday(data: unknown): TodayCounts | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (d.degraded === true) return null
  const counts = (d.counts ?? {}) as Record<string, unknown>
  if (Object.keys(counts).length === 0) return null
  return {
    lineups: num(counts.unresolvedLineupSlotActions) ?? 0,
    waivers: num(counts.waiverPickupSuggestions) ?? 0,
    trades: num(counts.pendingTrades) ?? 0,
  }
}

function readRank(p: Record<string, unknown> | undefined): RankSummary {
  return {
    level: num(p?.level),
    levelName: str(p?.levelName) ?? str(p?.tierName),
    progressPct: num(p?.progressPct),
    nextLevelName: str(p?.nextLevelName),
    wins: num(p?.careerWins),
    losses: num(p?.careerLosses),
    titles: num(p?.careerChampionships),
    seasons: num(p?.careerSeasonsPlayed),
  }
}

function toDashboardLeague(raw: unknown): DashboardLeague {
  const r = (raw ?? {}) as Record<string, unknown>
  const platform = (str(r.platform) ?? 'native').toLowerCase()
  const name = str(r.name) ?? 'League'
  return {
    id: str(r.navigationLeagueId) ?? str(r.unifiedLeagueId) ?? str(r.id) ?? `lg-${name}`,
    name,
    platform,
    sport: (str(r.sport) ?? str(r.sport_type))?.toLowerCase() ?? null,
    teamCount: num(r.teamCount) ?? num(r.leagueSize),
    scoring: str(r.scoring) ?? str(r.scoringType),
    format: str(r.format) ?? str(r.leagueType),
    // `SleeperLeague.season` is a String column while League/LegacyLeague are Int — a
    // number-only guard silently nulls every Sleeper league, which is most of a real board.
    season: seasonYear(r.season),
    isCommissioner: r.isCommissioner === true || r.userRole === 'commissioner',
    unified: r.hasUnifiedRecord === true,
    // Sleeper rows expose `platformLeagueId`; AF-Legacy board rows carry `sleeperLeagueId`.
    platformLeagueId: str(r.platformLeagueId) ?? str(r.sleeperLeagueId),
    accent: PLATFORM_ACCENT[platform] ?? 'var(--af-violet)',
  }
}

function toUserLeague(raw: unknown): UserLeague | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const id = str(r.navigationLeagueId) ?? str(r.unifiedLeagueId) ?? str(r.id)
  if (!id) return null
  const platform = (str(r.platform) ?? 'allfantasy').toLowerCase()
  const role = r.userRole === 'commissioner' || r.userRole === 'member' || r.userRole === 'imported'
    ? r.userRole : 'member'
  return {
    id,
    name: str(r.name) ?? 'League',
    platform,
    sport: str(r.sport) ?? str(r.sport_type) ?? 'NFL',
    format: str(r.leagueType) ?? str(r.leagueVariant) ?? (r.isDynasty === true ? 'dynasty' : 'redraft'),
    scoring: str(r.scoring) ?? 'Standard',
    teamCount: num(r.teamCount) ?? num(r.leagueSize) ?? 0,
    season: num(r.season) ?? str(r.season) ?? undefined,
    status: str(r.status) ?? str(r.syncStatus) ?? undefined,
    currentWeek: num(r.currentWeek) ?? null,
    isDynasty: r.isDynasty === true,
    avatarUrl: str(r.avatarUrl),
    logoUrl: str(r.logoUrl),
    leagueType: str(r.leagueType),
    leagueVariant: str(r.leagueVariant),
    hasUnifiedRecord: r.hasUnifiedRecord === true,
    isCommissioner: r.isCommissioner === true || r.userRole === 'commissioner',
    userRole: role,
    lifecycleState: str(r.lifecycleState),
    tradeDeadlineWeek: num(r.tradeDeadlineWeek),
    playoffStartWeek: num(r.playoffStartWeek),
    sleeperLeagueId: platform === 'sleeper' ? str(r.platformLeagueId) ?? undefined : undefined,
  }
}

// ── Primitives ─────────────────────────────────────────────────────────────────
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

function seasonYear(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number.parseInt(v.trim(), 10)
    if (Number.isFinite(n) && n > 1900 && n < 2200) return n
  }
  return null
}

function uniqueBy(values: string[]): string[] {
  return Array.from(new Set(values))
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
