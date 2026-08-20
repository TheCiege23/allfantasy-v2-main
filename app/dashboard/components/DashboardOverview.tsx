'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AiTimeContextPayload } from '@/lib/time-engine/types'
import type { TradesDashboardResponse, WaiverDashboardResponse } from '@/app/dashboard/dashboardStripApiTypes'
import type { TodayActionsEngineResponse } from '@/lib/today-actions-engine'
import { useEntitlements } from '@/hooks/useEntitlements'
import type { ChecklistStep, UserLeague } from '../types'
import type { LineupCheckPayload } from './LineupIssuesModal'
import { LineupIssuesModal } from './LineupIssuesModal'
import { PendingTradesModal } from './PendingTradesModal'
import { RankingsCard } from './RankingsCard'
import { WaiverRecommendationsModal } from './WaiverRecommendationsModal'
import { FavoriteSportsOnboardingModal } from './FavoriteSportsOnboardingModal'
import { QuickCreateModal } from '@/components/league-creation/QuickCreateModal'
import { ConnectPlatformsModal } from './ConnectPlatformsModal'
import type { FavoriteSportsSelection } from '@/lib/dashboard/favorite-sports-storage'
import {
  hasAnyFavoriteSport,
  readFavoriteSportsSelection,
  writeFavoriteSportsSelection,
} from '@/lib/dashboard/favorite-sports-storage'
import { buildLandingInviteUrl } from '@/lib/dashboard/invite-link-storage'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { emptyLineupActionSummary } from '@/lib/lineup-actions/emptySummary'
import { useFantasyContext, type PrimaryContext } from '@/hooks/useFantasyContext'
import { consumeDashboardRankRefreshPending } from '@/lib/import/dashboardRankRefresh'
import { LegacySnapshotCard } from './LegacySnapshotCard'
import { LegacyToolsetGrid } from './LegacyToolsetGrid'
import { CareerProgressionStrip } from './CareerProgressionStrip'
import { Crown, Plus } from 'lucide-react'
import { ActionCenter, countActionItems } from './warroom/ActionCenter'
import { CommandCenterDeck } from './CommandCenterDeck'
import { CareerCardDeck } from './CareerCardDeck'
import { DecisionInbox } from './DecisionInbox'
import { CommissionerLeaderboard } from './CommissionerLeaderboard'
import { DraftSeasonHQ } from './DraftSeasonHQ'
import { TodayTimeline } from './warroom/TodayTimeline'
import { MyLeagueCard, rawStage } from './warroom/MyLeagueCard'
import { LeagueActivityFeed } from './warroom/LeagueActivityFeed'
import { CommissionerHub } from './warroom/CommissionerHub'
import { CommissionerHQ } from './warroom/CommissionerHQ'
import { CoachNotes } from './warroom/CoachNotes'
import { DashboardHero } from './warroom/DashboardHero'
import { TeamThisWeek } from './warroom/TeamThisWeek'
import { SeasonOutlook } from './warroom/SeasonOutlook'
import { SeasonJourney } from './warroom/SeasonJourney'
import { WaiverWirePreview } from './warroom/WaiverWirePreview'
import { RecommendationTimeline } from './warroom/RecommendationTimeline'
import { InjuryImpactPanel } from './warroom/InjuryImpactPanel'
import { PlatformPulseCard } from './warroom/PlatformPulseCard'
import { SectionHeading, CONTEXT_ACCENT } from './warroom/SectionHeading'
import { buildPlatformPulse } from '@/lib/platform-pulse'
import { scopeBySelectedLeague } from '@/lib/dashboard/scope-by-selected-league'
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'

const ONBOARDING_KEY = 'af-onboarding-v1'
const STRIP_FETCH_STALE_MS = 5 * 60_000

type OnboardingState = {
  step1: boolean
  step2: boolean
  step3: boolean
  step4: boolean
  step5: boolean
}

type DashboardOverviewProps = {
  userId: string
  userName: string
  leagues: UserLeague[]
  /** True until the first `/api/league/list` response (SSR or client) resolves — lets My Leagues
   *  show a loading skeleton instead of looking indistinguishable from "zero leagues." */
  leaguesLoading?: boolean
  onTriggerImport: () => void
  onOpenChimmy: () => void
  /** SSR snapshot of `/api/user/rank` — rankings card renders without a client fetch round-trip. */
  initialUserRankPayload?: Record<string, unknown> | null
  /** SSR snapshot of `getCommissionerHubHealthForUser` (Phase 2.3 Commissioner HQ) — one entry
   *  per commissioned league, same engine as the real `/commissioner-hub` page. */
  initialCommissionerHealthSnapshots?: CommissionerLeagueHealthSnapshot[] | null
}

function getDefaultOnboardingState(): OnboardingState {
  return {
    step1: false,
    step2: false,
    step3: false,
    step4: false,
    step5: false,
  }
}

function readOnboardingState() {
  if (typeof window === 'undefined') return getDefaultOnboardingState()

  try {
    const raw = window.localStorage.getItem(ONBOARDING_KEY)
    if (!raw) return getDefaultOnboardingState()

    const parsed = JSON.parse(raw) as Partial<OnboardingState>
    return {
      step1: parsed.step1 === true,
      step2: parsed.step2 === true,
      step3: parsed.step3 === true,
      step4: parsed.step4 === true,
      step5: parsed.step5 === true,
    }
  } catch {
    return getDefaultOnboardingState()
  }
}

function writeOnboardingState(value: OnboardingState) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(ONBOARDING_KEY, JSON.stringify(value))
  } catch {}
}

export function DashboardOverview({
  userId,
  userName,
  leagues,
  leaguesLoading = false,
  onTriggerImport,
  onOpenChimmy: _onOpenChimmy,
  initialUserRankPayload = null,
  initialCommissionerHealthSnapshots = null,
}: DashboardOverviewProps) {
  const router = useRouter()
  const { t, tInterpolate } = useLanguage()
  const { hasPro } = useEntitlements()
  const { context, selectedLeagueId, selectedLeague, setSelectedLeagueId } = useFantasyContext(leagues)
  const [onboarding, setOnboarding] = useState<OnboardingState>(getDefaultOnboardingState())
  /** UI-only per session — not persisted */
  const [checklistExpanded, setChecklistExpanded] = useState(false)
  const [sportsModalOpen, setSportsModalOpen] = useState(false)
  const [platformModalOpen, setPlatformModalOpen] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [lineupModalOpen, setLineupModalOpen] = useState(false)
  const [quickCreateOpen, setQuickCreateOpen] = useState(false)
  const [lineupData, setLineupData] = useState<LineupCheckPayload | null>(null)
  /** Decision OS Slice 1 (manager.lineup.set) Stage 1 LIVE enrichment, when active — null otherwise. */
  const [lineupDecisionOs, setLineupDecisionOs] = useState<TodayActionsEngineResponse['decisionOs']>(null)
  /** First `/api/lineup-check` bootstrap finished (avoids misleading preview counts). */
  const [lineupReady, setLineupReady] = useState(false)
  const [lineupLoading, setLineupLoading] = useState(false)

  const [waiverModalOpen, setWaiverModalOpen] = useState(false)
  const [waiverData, setWaiverData] = useState<WaiverDashboardResponse | null>(null)
  const [waiverLoading, setWaiverLoading] = useState(false)

  const [tradeModalOpen, setTradeModalOpen] = useState(false)
  const [tradeData, setTradeData] = useState<TradesDashboardResponse | null>(null)
  const [tradeLoading, setTradeLoading] = useState(false)

  /** Aggregated counts for Today strip (matchup DB rows, injury splits, war room). */
  const [todayCounts, setTodayCounts] = useState<TodayActionsEngineResponse['counts'] | null>(null)
  /** Primary league id from `/api/dashboard/today-actions` (War Room snapshot + waiver timing). */
  const [todayPrimaryLeagueId, setTodayPrimaryLeagueId] = useState<string | null>(null)
  /** Waiver process timing from DB league fields when resolved. */
  const [todayWaiverTiming, setTodayWaiverTiming] = useState<TodayActionsEngineResponse['waiverTiming'] | null>(null)
  /** Native (non-Sleeper) trades expiring within 48h, from `/api/dashboard/today-actions`. */
  const [expiringNativeTrades, setExpiringNativeTrades] = useState<TodayActionsEngineResponse['expiringNativeTrades']>(
    [],
  )
  /** AI Auto Start/Sit Protection snapshot (swap counts + global toggle). */
  const [todayAutoProtection, setTodayAutoProtection] = useState<
    TodayActionsEngineResponse['autoStartSitProtection'] | null
  >(null)
  /** Time engine envelope from `/api/dashboard/today-actions` (server UTC + account TZ). */
  const [stripTimeContext, setStripTimeContext] = useState<AiTimeContextPayload | null>(null)
  const deepLinkLeagueApplied = useRef(false)

  /** Increment after legacy rankings import so rank widgets refetch `/api/user/rank`. */
  const [rankRefreshKey, setRankRefreshKey] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const u = new URL(window.location.href)
      if (u.searchParams.get('rankSync') === '1') {
        setRankRefreshKey((k) => k + 1)
        u.searchParams.delete('rankSync')
        window.history.replaceState({}, '', `${u.pathname}${u.search}${u.hash}`)
        router.refresh()
      }
    } catch {
      /* ignore */
    }
  }, [router])

  useEffect(() => {
    if (consumeDashboardRankRefreshPending()) {
      setRankRefreshKey((k) => k + 1)
      router.refresh()
    }
  }, [router])

  /** Last successful `/api/dashboard/today-actions` refresh (lineup + waivers + trades + counts). */
  const stripFetchedAt = useRef<number | null>(null)

  useEffect(() => {
    if (leagues.length === 0) return
    let cancelled = false
    void fetch('/api/dashboard/today-actions', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: TodayActionsEngineResponse | null) => {
        if (cancelled) return
        if (data) {
          setLineupData(data.lineup)
          setLineupDecisionOs(data.decisionOs ?? null)
          setWaiverData(data.waivers)
          setTradeData(data.trades)
          setTodayCounts(data.counts)
          setTodayPrimaryLeagueId(data.primaryLeagueId ?? null)
          setTodayWaiverTiming(data.waiverTiming ?? null)
          setExpiringNativeTrades(data.expiringNativeTrades ?? [])
          setTodayAutoProtection(data.autoStartSitProtection ?? null)
          setStripTimeContext(data.aiTimeContext ?? null)
          stripFetchedAt.current = Date.now()
        } else {
          setLineupData(emptyLineupActionSummary())
          setLineupDecisionOs(null)
          setWaiverData({ totalLeagues: 0, recommendations: [] })
          setTradeData({ totalPending: 0, trades: [] })
          setTodayCounts(null)
          setTodayPrimaryLeagueId(null)
          setTodayWaiverTiming(null)
          setExpiringNativeTrades([])
          setTodayAutoProtection(null)
          setStripTimeContext(null)
          stripFetchedAt.current = Date.now()
        }
        setLineupReady(true)
      })
      .catch(() => {
        if (cancelled) return
        setLineupData(emptyLineupActionSummary())
        setLineupDecisionOs(null)
        setWaiverData({ totalLeagues: 0, recommendations: [] })
        setTradeData({ totalPending: 0, trades: [] })
        setTodayCounts(null)
        setTodayPrimaryLeagueId(null)
        setTodayWaiverTiming(null)
        setExpiringNativeTrades([])
        setTodayAutoProtection(null)
        setStripTimeContext(null)
        stripFetchedAt.current = Date.now()
        setLineupReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [leagues.length])

  useEffect(() => {
    setOnboarding(readOnboardingState())
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetch('/api/user/dashboard-onboarding', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          data: {
            checklist?: Partial<OnboardingState>
            favoriteSports?: FavoriteSportsSelection
          } | null
        ) => {
          if (!data || cancelled) return
          if (data.checklist) {
            const s = data.checklist
            setOnboarding((prev) => {
              const next: OnboardingState = {
                step1: prev.step1 || s.step1 === true,
                step2: prev.step2 || s.step2 === true,
                step3: prev.step3 || s.step3 === true,
                step4: prev.step4 || s.step4 === true,
                step5: prev.step5 || s.step5 === true,
              }
              writeOnboardingState(next)
              return next
            })
          }
          if (data.favoriteSports && (data.favoriteSports.supported?.length || data.favoriteSports.custom?.length)) {
            writeFavoriteSportsSelection(data.favoriteSports)
          }
        }
      )
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const fav = readFavoriteSportsSelection()
    if (!hasAnyFavoriteSport(fav)) return
    setOnboarding((prev) => {
      if (prev.step1) return prev
      const next = { ...prev, step1: true }
      writeOnboardingState(next)
      return next
    })
  }, [])

  const patchChecklistOnServer = useCallback(async (partial: Partial<OnboardingState>) => {
    try {
      await fetch('/api/user/dashboard-onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checklist: partial }),
      })
    } catch {}
  }, [])

  useEffect(() => {
    if (leagues.length === 0) return
    setOnboarding((prev) => {
      if (prev.step2 && prev.step3) return prev
      const next = {
        ...prev,
        step2: true,
        step3: true,
      }
      writeOnboardingState(next)
      void patchChecklistOnServer({ step2: true, step3: true })
      return next
    })
  }, [leagues.length, patchChecklistOnServer])

  const updateOnboardingStep = useCallback(
    (step: keyof OnboardingState, value = true) => {
      setOnboarding((current) => {
        const next = { ...current, [step]: value }
        writeOnboardingState(next)
        return next
      })
      void patchChecklistOnServer({ [step]: value })
    },
    [patchChecklistOnServer]
  )

  const checklistSteps = useMemo<ChecklistStep[]>(
    () => [
      {
        id: 'step1',
        label: t('dashboard.onboarding.step1.label'),
        description: t('dashboard.onboarding.step1.desc'),
        done: onboarding.step1,
        ctaLabel: t('dashboard.onboarding.step1.cta'),
      },
      {
        id: 'step2',
        label: t('dashboard.onboarding.step2.label'),
        description: t('dashboard.onboarding.step2.desc'),
        done: onboarding.step2,
        ctaLabel: t('dashboard.onboarding.step2.cta'),
      },
      {
        id: 'step3',
        label: t('dashboard.onboarding.step3.label'),
        description: t('dashboard.onboarding.step3.desc'),
        done: onboarding.step3,
        ctaHref: '/af-rankings',
        ctaLabel: t('dashboard.onboarding.step3.cta'),
      },
      {
        id: 'step4',
        label: t('dashboard.onboarding.step4.label'),
        description: t('dashboard.onboarding.step4.desc'),
        done: onboarding.step4,
        ctaHref: '/ai/tools',
        ctaLabel: t('dashboard.onboarding.step4.cta'),
      },
      {
        id: 'step5',
        label: t('dashboard.onboarding.step5.label'),
        description: t('dashboard.onboarding.step5.desc'),
        done: onboarding.step5,
        ctaLabel: inviteCopied ? t('dashboard.onboarding.step5.ctaCopied') : t('dashboard.onboarding.step5.ctaCopy'),
      },
    ],
    [onboarding, inviteCopied, t]
  )

  const completedCount = checklistSteps.filter((step) => step.done).length
  const allDone = completedCount === checklistSteps.length

  const handleImport = () => {
    updateOnboardingStep('step2')
    onTriggerImport()
  }

  const handleCopyReferral = async () => {
    let inviteUrl = ''
    try {
      const res = await fetch('/api/user/landing-invite', { cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()) as { landingUrl?: string }
        if (typeof data.landingUrl === 'string' && data.landingUrl.startsWith('http')) {
          inviteUrl = data.landingUrl
        }
      }
    } catch {}
    if (!inviteUrl) inviteUrl = buildLandingInviteUrl()
    if (!inviteUrl) return

    try {
      await navigator.clipboard.writeText(inviteUrl)
      updateOnboardingStep('step5')
      setInviteCopied(true)
      window.setTimeout(() => setInviteCopied(false), 2500)
    } catch {}
  }

  const refreshTodayActionsBundle = useCallback(() => {
    return fetch('/api/dashboard/today-actions', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('today-actions'))))
      .then((data: TodayActionsEngineResponse) => {
        setLineupData(data.lineup)
        setLineupDecisionOs(data.decisionOs ?? null)
        setWaiverData(data.waivers)
        setTradeData(data.trades)
        setTodayCounts(data.counts)
        setTodayPrimaryLeagueId(data.primaryLeagueId ?? null)
        setTodayWaiverTiming(data.waiverTiming ?? null)
        setExpiringNativeTrades(data.expiringNativeTrades ?? [])
        setTodayAutoProtection(data.autoStartSitProtection ?? null)
        setStripTimeContext(data.aiTimeContext ?? null)
        stripFetchedAt.current = Date.now()
      })
  }, [])

  /** Prefer dashboard league selector; fall back to primary league from today-actions for tool context. */
  const aiToolFocusLeagueId = useMemo(
    () => selectedLeagueId ?? todayPrimaryLeagueId ?? undefined,
    [selectedLeagueId, todayPrimaryLeagueId],
  )

  const handleLineupIssuesClick = useCallback(() => {
    setLineupModalOpen(true)
    const now = Date.now()
    const fresh =
      lineupData !== null &&
      stripFetchedAt.current !== null &&
      now - stripFetchedAt.current < STRIP_FETCH_STALE_MS
    if (fresh) return
    setLineupLoading(true)
    void refreshTodayActionsBundle()
      .catch(() => {
        setLineupData(emptyLineupActionSummary())
        stripFetchedAt.current = Date.now()
      })
      .finally(() => setLineupLoading(false))
  }, [lineupData, refreshTodayActionsBundle])

  const handleWaiverClick = useCallback(() => {
    setWaiverModalOpen(true)
    const now = Date.now()
    const fresh =
      waiverData !== null &&
      stripFetchedAt.current !== null &&
      now - stripFetchedAt.current < STRIP_FETCH_STALE_MS
    if (fresh) return
    setWaiverLoading(true)
    void refreshTodayActionsBundle()
      .catch(() => {
        setWaiverData({ totalLeagues: 0, recommendations: [] })
        stripFetchedAt.current = Date.now()
      })
      .finally(() => setWaiverLoading(false))
  }, [waiverData, refreshTodayActionsBundle])

  const handleTradeClick = useCallback(() => {
    setTradeModalOpen(true)
    const now = Date.now()
    const fresh =
      tradeData !== null &&
      stripFetchedAt.current !== null &&
      now - stripFetchedAt.current < STRIP_FETCH_STALE_MS
    if (fresh) return
    setTradeLoading(true)
    void refreshTodayActionsBundle()
      .catch(() => {
        setTradeData({ totalPending: 0, trades: [] })
        stripFetchedAt.current = Date.now()
      })
      .finally(() => setTradeLoading(false))
  }, [tradeData, refreshTodayActionsBundle])

  const handleWarRoomToolClick = useCallback(() => {
    if (typeof window === 'undefined') return
    document.querySelector('[data-testid="ai-tools-grid"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.dispatchEvent(
      new CustomEvent('af-open-ai-tool', {
        detail: { tool: 'warRoom', ...(aiToolFocusLeagueId ? { focusLeagueId: aiToolFocusLeagueId } : {}) },
      }),
    )
  }, [aiToolFocusLeagueId])

  useEffect(() => {
    if (!lineupModalOpen && !waiverModalOpen && !tradeModalOpen) return
    const interval = window.setInterval(() => {
      void fetch('/api/dashboard/today-actions', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: TodayActionsEngineResponse | null) => {
          if (!d) return
          setLineupData(d.lineup)
          setWaiverData(d.waivers)
          setTradeData(d.trades)
          setTodayCounts(d.counts)
          setTodayPrimaryLeagueId(d.primaryLeagueId ?? null)
          setTodayWaiverTiming(d.waiverTiming ?? null)
          setExpiringNativeTrades(d.expiringNativeTrades ?? [])
          setTodayAutoProtection(d.autoStartSitProtection ?? null)
          setStripTimeContext(d.aiTimeContext ?? null)
          stripFetchedAt.current = Date.now()
        })
        .catch(() => {})
    }, 30_000)
    return () => window.clearInterval(interval)
  }, [lineupModalOpen, waiverModalOpen, tradeModalOpen])

  useEffect(() => {
    if (deepLinkLeagueApplied.current || leagues.length === 0) return
    const q = new URLSearchParams(window.location.search).get('league')?.trim()
    if (q && leagues.some((l) => l.id === q)) {
      setSelectedLeagueId(q)
      deepLinkLeagueApplied.current = true
    }
  }, [leagues, setSelectedLeagueId])

  const waiverChipCount = useMemo(() => {
    if (todayCounts) return todayCounts.waiverPickupSuggestions
    if (!waiverData?.recommendations?.length) return 0
    return waiverData.recommendations.reduce((n, r) => n + (r.pickups?.length ?? 0), 0)
  }, [todayCounts, waiverData])

  const warRoomDecisionsToReview = useMemo(() => {
    if (todayCounts) return todayCounts.warRoomDecisionsToReview
    const actions = lineupData?.actions ?? []
    return actions.filter((a) => a.reasonType === 'war_room' || a.sourceModule === 'AFWarRoom').length
  }, [todayCounts, lineupData])

  const pendingTradeChipCount = tradeData?.totalPending ?? 0

  /** D7 fix — `lineupData.actions` and `tradeData.trades` each span every league; Team/Commissioner
   *  Focus must scope them to the selected league before feeding them to any per-league surface
   *  (Recommendations, Today's Agenda, Weekly Game Plan, the hero urgent count). Global Command
   *  Center passes selectedLeague=null, so it still sees every league's items unchanged. */
  const leagueScopedLineupActions = useMemo(
    () => scopeBySelectedLeague(lineupData?.actions ?? [], selectedLeague?.id ?? null),
    [lineupData, selectedLeague],
  )
  const leagueScopedPendingTrades = useMemo(
    () => scopeBySelectedLeague(tradeData?.trades ?? [], selectedLeague?.id ?? null),
    [tradeData, selectedLeague],
  )

  /** Leagues in pre_draft with a real, future draftDate — purely client-side, no new fetch. */
  const upcomingDrafts = useMemo(() => {
    const now = Date.now()
    return leagues
      .filter((l) => rawStage(l) === 'pre_draft' && l.draftDate && new Date(l.draftDate).getTime() > now)
      .map((l) => ({ leagueId: l.id, leagueName: l.name, draftDate: l.draftDate as string }))
  }, [leagues])

  const urgentTodayCount = useMemo(
    () => countActionItems(leagueScopedLineupActions, waiverChipCount, pendingTradeChipCount, warRoomDecisionsToReview),
    [leagueScopedLineupActions, waiverChipCount, pendingTradeChipCount, warRoomDecisionsToReview],
  )

  /** Dashboard V2 Phase 3.6 — Platform Pulse. A pure aggregation over intelligence already in
   *  memory (actions, cross-league counts, SSR commissioner health, upcoming drafts) — no new
   *  fetch, no duplicate engine. Context-aware; self-gates to an empty list when nothing matters. */
  const pulseItems = useMemo(
    () =>
      buildPlatformPulse({
        context,
        selectedLeagueId,
        actions: lineupData?.actions ?? [],
        waiverCount: waiverChipCount,
        pendingTradeCount: pendingTradeChipCount,
        commissionerHealth: initialCommissionerHealthSnapshots,
        upcomingDrafts,
      }),
    [
      context,
      selectedLeagueId,
      lineupData,
      waiverChipCount,
      pendingTradeChipCount,
      initialCommissionerHealthSnapshots,
      upcomingDrafts,
    ],
  )

  const handleAiShortcut = useCallback((_prompt: string) => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('af-dashboard-focus-left-chimmy'))
    window.dispatchEvent(new CustomEvent('af-dashboard-open-mobile-left'))
  }, [])

  /** My Leagues narrows to commissioned-only in Commissioner Focus (secondary billing per the
   *  locked Dashboard V2 architecture, Section 1); Global and Team Focus show every league. */
  const myLeaguesList = context === 'commissioner' ? leagues.filter((l) => l.isCommissioner) : leagues

  /** Phase 3.7 — per-context accent for section headings (cyan Global / amber Commissioner /
   *  emerald Team), the single source of Dashboard V2's context identity. */
  const contextAccent = CONTEXT_ACCENT[context]

  const todaysAgendaSection = (
    <section key="agenda" className="space-y-3">
      <SectionHeading accent={contextAccent}>{t('dashboard.warroom.today.title')}</SectionHeading>
      <ActionCenter
        lineupActions={leagueScopedLineupActions}
        waiverPickupSuggestions={waiverChipCount}
        pendingTradeCount={pendingTradeChipCount}
        warRoomDecisionsToReview={warRoomDecisionsToReview}
        onLineupIssuesClick={handleLineupIssuesClick}
        onWaiverClick={handleWaiverClick}
        onTradesClick={handleTradeClick}
        onWarRoomClick={handleWarRoomToolClick}
        decisionOsLineup={lineupDecisionOs}
      />
      <TodayTimeline
        lineupActions={leagueScopedLineupActions}
        waiverTiming={todayWaiverTiming}
        autoSwapsLast24h={todayAutoProtection?.autoSwapsLast24h ?? 0}
        pendingTradeCount={pendingTradeChipCount}
        upcomingDrafts={upcomingDrafts}
        expiringNativeTrades={expiringNativeTrades}
      />
    </section>
  )

  // Dashboard visual bug-fix pass (My Leagues width follow-up) — this grid is keyed to viewport
  // breakpoints (sm/lg/xl), same as LegacyToolsetGrid.tsx, so it needs to render full-width rather
  // than confined to the secondary column (~1/3 of viewport) the way AF Legacy Toolset did before
  // its own fix. Rendered as its own full-width block below; column count widened to match.
  const myLeaguesSection = leaguesLoading ? (
    <section key="myLeagues" className="space-y-2.5">
      <SectionHeading accent={contextAccent} icon={Crown}>{t('dashboard.warroom.myLeagues.title')}</SectionHeading>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="warroom-card h-[168px] animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />
        ))}
      </div>
    </section>
  ) : myLeaguesList.length > 0 ? (
    <section key="myLeagues" className="space-y-2.5">
      <SectionHeading
        accent={contextAccent}
        icon={Crown}
        trailing={
          // The only other openers of ConnectPlatformsModal live inside the Get Started checklist,
          // which is replaced by a one-line "all set" once onboarding completes — so the platform
          // picker became permanently unreachable for exactly the established multi-league manager
          // most likely to want it. This entry point sits beside the league list and never expires.
          <button
            type="button"
            onClick={() => setPlatformModalOpen(true)}
            data-testid="my-leagues-import-platform"
            className="warroom-pressable inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white/55 hover:border-white/20 hover:bg-white/[0.06] hover:text-white/80"
          >
            <Plus className="h-3 w-3" aria-hidden />
            {t('dashboard.warroom.myLeagues.importPlatform')}
          </button>
        }
      >
        {t('dashboard.warroom.myLeagues.title')}
      </SectionHeading>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {myLeaguesList.map((l) => (
          <MyLeagueCard
            key={l.id}
            league={l}
            userId={userId}
            waiverTiming={l.id === todayPrimaryLeagueId ? todayWaiverTiming : null}
          />
        ))}
      </div>
    </section>
  ) : null

  const commissionerHubSection = (
    // Global's condensed cross-league list — unchanged from Phase 2.1/2.2. Commissioner Focus
    // uses the richer, single-league commissionerHQSection below instead (Phase 2.3).
    <CommissionerHub key="commissionerHub" leagues={leagues} />
  )

  /** Dashboard V2 Phase 2.3 — Commissioner HQ. Only rendered in Commissioner Focus, for the one
   *  selected (commissioned) league. Falls back to a snapshot-less card (still real deep links,
   *  just no health/recommendations) if the SSR snapshot doesn't include this league yet. */
  const commissionerHQSection =
    context === 'commissioner' && selectedLeague ? (
      <CommissionerHQ
        key="commissionerHQ"
        league={selectedLeague}
        snapshot={initialCommissionerHealthSnapshots?.find((s) => s.leagueId === selectedLeague.id) ?? null}
      />
    ) : null

  const weeklyGamePlanSection = (
    <CoachNotes key="weeklyGamePlan" lineupActions={leagueScopedLineupActions} pendingTrades={leagueScopedPendingTrades} />
  )

  const rankingsLegacySection = (
    <section key="rankingsLegacy" className="space-y-2.5">
      <SectionHeading accent={contextAccent}>{t('dashboard.warroom.rankingsLegacy.title')}</SectionHeading>
      <div className="grid gap-3 sm:grid-cols-2">
        <RankingsCard
          initialRankPayload={initialUserRankPayload}
          onImportNow={handleImport}
          rankRefreshKey={rankRefreshKey}
          onAskChimmy={() => {
            const prompt =
              'Explain my AllFantasy AF rank, tier, and XP — what should I focus on to climb the ladder?'
            handleAiShortcut(prompt)
            window.dispatchEvent(
              new CustomEvent('af-chimmy-shortcut', {
                detail: { prompt },
              })
            )
          }}
        />
        <LegacySnapshotCard rankPayload={initialUserRankPayload} />
      </div>
      {/* Phase 4.3 Rankings UI — visualizes REAL career fields from the rank
          payload (championships, playoffs, seasons, leagues). Self-gates to
          nothing when the profile is unimported, so it never adds empty noise. */}
      <CareerProgressionStrip rankPayload={initialUserRankPayload as Parameters<typeof CareerProgressionStrip>[0]['rankPayload']} />
    </section>
  )

  const leagueBuzzSection = <LeagueActivityFeed key="leagueBuzz" />

  const legacyToolsetSection = <LegacyToolsetGrid key="legacyToolset" />

  /** Phase 3.1 — Recommendation Timeline (Decision OS "Recommend + Explain" centerpiece). Surfaces
   *  the real AI lineup/start-sit/waiver/matchup signals with their confidence, expected gain, and
   *  inline reasoning. Self-gates when there are no recommendations. */
  const recommendationsSection = (
    <RecommendationTimeline key="recommendations" actions={leagueScopedLineupActions} />
  )

  /** Phase 3.6 — Platform Pulse: the cross-context intelligence briefing, placed first in every
   *  context as the "front page." Self-gates (renders null) when the engine finds nothing. */
  const platformPulseSection = <PlatformPulseCard key="platformPulse" items={pulseItems} />

  /** Dashboard V2 Phase 2.4 — Team Focus sections, scoped to the one selected league (only
   *  rendered in team context, where selectedLeague is guaranteed non-null). Each reuses an
   *  existing component; nothing here is a new data source. */
  const teamMatchupSection =
    context === 'team' && selectedLeague ? (
      <section key="teamMatchup" className="space-y-2.5">
        <SectionHeading accent={contextAccent}>{t('dashboard.warroom.teamThisWeek.title')}</SectionHeading>
        <TeamThisWeek league={selectedLeague} userId={userId} />
      </section>
    ) : null

  // Phase 3 — season-long trajectory (playoff/championship odds + expected wins/seed/elimination
  // risk) from the real season-forecast engine. Pairs with the this-week matchup card above.
  const teamSeasonOutlookSection =
    context === 'team' && selectedLeague ? (
      <SeasonOutlook key="teamSeasonOutlook" league={selectedLeague} userId={userId} />
    ) : null

  // Phase 3.2 — Injury Impact (Monitor + Explain): which of my starters are hurt, how much it
  // matters, and why — from the real injury-impact engine. Scoped to the selected league.
  const teamInjuryImpactSection =
    context === 'team' && selectedLeague ? (
      <InjuryImpactPanel key="teamInjuryImpact" league={selectedLeague} />
    ) : null

  // Waiver pickups for just the selected league (real chimmyAdvice-backed recs); self-gates to
  // nothing when there are no pending pickups for it, so no empty card in the quiet case.
  const teamWaiverData =
    context === 'team' && selectedLeague && waiverData
      ? {
          ...waiverData,
          recommendations: waiverData.recommendations.filter((r) => r.leagueId === selectedLeague.id),
        }
      : null
  const teamWaiverSection = teamWaiverData ? (
    <WaiverWirePreview key="teamWaiver" data={teamWaiverData} onOpenAll={handleWaiverClick} />
  ) : null

  const teamSeasonJourneySection =
    context === 'team' && selectedLeague ? (
      <SeasonJourney
        key="teamSeasonJourney"
        lifecycleState={rawStage(selectedLeague)}
        currentWeek={selectedLeague.currentWeek ?? null}
        tradeDeadlineWeek={selectedLeague.tradeDeadlineWeek ?? null}
        playoffStartWeek={selectedLeague.playoffStartWeek ?? null}
      />
    ) : null

  /** Dashboard V2 Phase 2.2/2.4 — FantasyContextEngine section priority. Same components in every
   *  context (per the "reuse, don't duplicate" rule); only their order changes. Global matches
   *  the Phase 2.1 shell unchanged. Commissioner Focus promotes the Commissioner HQ to primary
   *  billing. Team Focus (Phase 2.4) answers "what gives my team the best chance to win this week":
   *  Weekly Game Plan → This Week's Matchup (primary decision card) → today's start/sit + lineup +
   *  waiver actions → this league's waiver pickups → Season Journey → Rankings & Legacy → Buzz. */
  /** Dashboard V2 Phase 3.8A — command-center layout. Same components/engines as before, but
   *  arranged into a two-column grid (primary decision/intelligence column + secondary
   *  context/portfolio column) so wide screens fill densely instead of a narrow centered column.
   *  Collapses to a single stack below the `xl` breakpoint. `primary` gets the ~2/3 width. */
  const layoutByContext: Record<PrimaryContext, { primary: ReactNode[]; secondary: ReactNode[] }> = {
    global: {
      primary: [platformPulseSection, recommendationsSection, todaysAgendaSection, weeklyGamePlanSection],
      secondary: [commissionerHubSection],
    },
    commissioner: {
      primary: [platformPulseSection, commissionerHQSection, todaysAgendaSection, weeklyGamePlanSection],
      secondary: [],
    },
    team: {
      primary: [
        platformPulseSection,
        teamMatchupSection,
        teamSeasonOutlookSection,
        teamInjuryImpactSection,
        recommendationsSection,
        weeklyGamePlanSection,
        todaysAgendaSection,
        teamWaiverSection,
      ],
      secondary: [teamSeasonJourneySection],
    },
  }
  const layout = layoutByContext[context]

  return (
    <div className="h-full min-h-0 w-full overflow-y-auto [scrollbar-gutter:stable]">
      <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
        {/* 1. DASHBOARD HERO — Dashboard V2 Phase 2.2, context-aware (Global / Commissioner / Team).
            World Cup promo moved out of the primary dashboard experience in Phase 2.1 (still
            reachable at /brackets/world-cup, not deleted). */}
        <DashboardHero
          context={context}
          userName={userName}
          leagues={leagues}
          selectedLeagueId={selectedLeagueId}
          selectedLeague={selectedLeague}
          onSelectLeagueId={setSelectedLeagueId}
          urgentTodayCount={urgentTodayCount}
          leaguesNeedingAttention={(initialCommissionerHealthSnapshots ?? []).filter((s) => s.healthScore < 55).length}
          upcomingDraftCount={upcomingDrafts.length}
          commissionerHealth={
            selectedLeague ? initialCommissionerHealthSnapshots?.find((s) => s.leagueId === selectedLeague.id) ?? null : null
          }
          teamLineupDecisions={selectedLeague ? leagueScopedLineupActions.length : 0}
          waiverPriority={
            selectedLeague && waiverData
              ? waiverData.recommendations
                  .filter((r) => r.leagueId === selectedLeague.id)
                  .reduce((n, r) => n + (r.pickups?.length ?? 0), 0)
              : 0
          }
        />

        {/* 1b. COMMAND CENTER DECK — cross-league brain: urgency-ranked feed,
            week-at-a-glance win probabilities, portfolio value. One payload
            aggregated from every OS engine (Decision OS, LeagueContext, trade
            engine, draft intel, matchup model, market values, Legacy H2H) —
            the same payload that grounds Chimmy's dashboard-level chat. */}
        <CommandCenterDeck userId={userId} />

        {/* 1b-ii. DRAFT SEASON HQ — seasonal: cross-league draft countdowns,
            live cockpit links, post-draft report cards. Auto-hides off-season. */}
        <DraftSeasonHQ leagues={leagues} />

        {/* 1b-iii. DECISION INBOX — one-tap accept/reject for AF-native trades
            awaiting the viewer, via the existing per-trade engine endpoints. */}
        <DecisionInbox />

        {/* 1b-iv. LEAGUE HEALTH LEADERBOARD — commissioner-only: all owned
            leagues pulse-scanned, with friendly deduped chat nudges. */}
        <CommissionerLeaderboard />

        {/* 1c. MANAGER CAREER CARD — aggregated Legacy identity (history chains,
            graded trades, graded drafts, records book) with one-tap sharing. */}
        <CareerCardDeck />

        {/* 2-7. Command-center grid — Dashboard V2 Phase 3.8A. Same components/engines; a
            primary decision column (~2/3) beside a secondary context/portfolio column (~1/3) on
            wide screens, collapsing to a single stack below `xl`. Phase 3.8D moves this directly
            under the hero (ahead of the setup checklist) so the hero flows straight into Platform
            Pulse; the onboarding checklist now sits below the intelligence.

            Commissioner Focus's secondary column is empty (Rankings & Legacy moved to its own
            full-width block below, and nothing else fills it here) — rendering the 2/3+1/3 split
            in that case would just leave a dead empty column. Collapse to a single full-width
            primary column instead whenever secondary has nothing in it. */}
        {layout.secondary.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3 xl:items-start">
            <div className="space-y-5 xl:col-span-2">{layout.primary}</div>
            <div className="space-y-5">{layout.secondary}</div>
          </div>
        ) : (
          <div className="space-y-5">{layout.primary}</div>
        )}

        {/* My Leagues — same fix as AF Legacy Toolset below: this grid's own internal columns
            (sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4) are keyed to viewport breakpoints, so
            confining it to the 1/3-width secondary column left ~170px per card, not enough room
            for icon + name + status badge together. Full-width, and only shown in the contexts
            that showed it in the secondary column before (not "team", which is already scoped to
            one league). */}
        {context !== 'team' ? <div className="space-y-5">{myLeaguesSection}</div> : null}

        {/* Rankings & Legacy — full-width for a different reason than the grids above: this isn't
            about needing more columns (it's exactly 2 cards, sm:grid-cols-2 is already right), it's
            that RankingsCard's own internal sm:flex-row (level info beside the AIGradeRing) needs
            real width to lay out side-by-side without clipping. Confined to the 1/3-width secondary
            column, the ring and the 4-up stat row beneath it were being squeezed by a breakpoint
            keyed to viewport width, not to the column's actual width. */}
        <div className="space-y-5">{rankingsLegacySection}</div>

        {/* AF Legacy Toolset + League Buzz — full-width, below the primary/secondary grid rather
            than inside the 1/3-width secondary column. LegacyToolsetGrid's own internal grid
            (sm:grid-cols-2 lg:grid-cols-3) is keyed to viewport breakpoints, so confining it to a
            narrow column left it squeezed while xl:items-start (columns don't stretch to match
            height) opened dead space to its left whenever the primary column ran shorter. */}
        <div className="space-y-5">
          {legacyToolsetSection}
          {leagueBuzzSection}
        </div>

        {allDone ? (
          <p className="text-xs text-cyan-400/95">{t('dashboard.overview.allSet')}</p>
        ) : checklistExpanded ? (
          <section className="overflow-hidden rounded-2xl border border-white/8 bg-[#0c0c1e]">
            <button
              type="button"
              onClick={() => setChecklistExpanded(false)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <div>
                <p className="text-sm font-bold text-white">{t('dashboard.overview.getStarted')}</p>
                <p className="mt-1 text-xs text-white/40">
                  {tInterpolate('dashboard.overview.checklistProgress', { done: completedCount })}
                </p>
              </div>
              <span
                className="inline-block text-lg leading-none text-white/40 transition-transform duration-200"
                style={{ transform: 'rotate(90deg)' }}
                aria-hidden
              >
                ›
              </span>
            </button>

            <div className="border-t border-white/8">
                {checklistSteps.map((step) => (
                  <div key={step.id} className="flex items-center gap-3 border-b border-white/6 px-4 py-3 last:border-b-0">
                    <div
                      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
                        step.done
                          ? 'border-emerald-400 bg-emerald-400 text-slate-950'
                          : 'border-white/20 text-white/20'
                      }`}
                    >
                      {step.done ? '✓' : ''}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white/85">{step.label}</p>
                      <p className="mt-0.5 text-xs text-white/45">{step.description}</p>
                    </div>

                    {!step.done ? (
                      step.id === 'step1' ? (
                        <button
                          type="button"
                          data-testid="get-started-sports-cta"
                          onClick={() => setSportsModalOpen(true)}
                          className="text-xs font-semibold text-cyan-400 hover:underline"
                        >
                          {step.ctaLabel}
                        </button>
                      ) : step.id === 'step2' ? (
                        <button
                          type="button"
                          data-testid="get-started-connect-cta"
                          onClick={() => setPlatformModalOpen(true)}
                          className="text-xs font-semibold text-cyan-400 hover:underline"
                        >
                          {step.ctaLabel}
                        </button>
                      ) : step.id === 'step4' && step.ctaHref ? (
                        <Link
                          href={step.ctaHref}
                          data-testid="get-started-af-ai-tools-cta"
                          onClick={() => updateOnboardingStep('step4')}
                          className="text-xs font-semibold text-cyan-400 hover:underline"
                        >
                          {step.ctaLabel}
                        </Link>
                      ) : step.id === 'step5' ? (
                        <button
                          type="button"
                          data-testid="get-started-invite-copy"
                          onClick={() => void handleCopyReferral()}
                          className="text-xs font-semibold text-cyan-400 hover:underline"
                        >
                          {step.ctaLabel}
                        </button>
                      ) : step.ctaHref ? (
                        <Link
                          href={step.ctaHref}
                          onClick={() => {
                            if (step.id === 'step3') updateOnboardingStep('step3')
                          }}
                          className="text-xs font-semibold text-cyan-400 hover:underline"
                        >
                          {step.ctaLabel}
                        </Link>
                      ) : null
                    ) : step.id === 'step1' ? (
                      <button
                        type="button"
                        onClick={() => setSportsModalOpen(true)}
                        className="text-xs font-semibold text-white/40 hover:text-cyan-400 hover:underline"
                      >
                        {t('dashboard.onboarding.edit')}
                      </button>
                    ) : step.id === 'step2' ? (
                      <button
                        type="button"
                        onClick={() => setPlatformModalOpen(true)}
                        className="text-xs font-semibold text-white/40 hover:text-cyan-400 hover:underline"
                      >
                        {t('dashboard.onboarding.add')}
                      </button>
                    ) : null}
                  </div>
                ))}
            </div>
          </section>
        ) : (
          <button
            type="button"
            onClick={() => setChecklistExpanded(true)}
            className="group relative flex h-10 w-full cursor-pointer items-center gap-3 overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.04] px-4 text-[12px] text-white/60 transition hover:border-white/12 hover:bg-white/[0.06]"
            data-testid="dashboard-setup-collapsed"
          >
            <span className="z-10 whitespace-nowrap text-white/70">
              {tInterpolate('dashboard.overview.setupCollapsed', { done: completedCount })}
            </span>
            <span
              className="z-10 ml-auto inline-flex items-center gap-1.5 text-white/40 transition-transform group-hover:text-white/70"
              aria-hidden
            >
              <span className="text-[11px] font-medium tabular-nums">
                {completedCount}/{checklistSteps.length}
              </span>
              ›
            </span>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-white/[0.04]"
            />
            <span
              aria-hidden
              data-testid="dashboard-setup-progress-fill"
              style={{
                width: `${Math.round((completedCount / Math.max(1, checklistSteps.length)) * 100)}%`,
              }}
              className="pointer-events-none absolute bottom-0 left-0 h-1 bg-gradient-to-r from-cyan-400 via-cyan-300 to-violet-400 shadow-[0_0_8px_rgba(34,211,238,0.45)] transition-[width] duration-300"
            />
          </button>
        )}

        {/* 8. FOOTER */}
        <footer className="border-t border-white/[0.06] pt-4 text-center text-[11px] text-white/25">
          {t('dashboard.warroom.footer.tagline')}
        </footer>
      </div>

      <LineupIssuesModal
        isOpen={lineupModalOpen}
        onClose={() => setLineupModalOpen(false)}
        data={lineupData}
        loading={lineupLoading}
        hasProAccess={hasPro}
      />

      <WaiverRecommendationsModal
        isOpen={waiverModalOpen}
        onClose={() => setWaiverModalOpen(false)}
        data={waiverData}
        loading={waiverLoading}
        hasProAccess={hasPro}
      />

      <PendingTradesModal
        isOpen={tradeModalOpen}
        onClose={() => setTradeModalOpen(false)}
        data={tradeData}
        loading={tradeLoading}
        hasProAccess={hasPro}
      />

      <QuickCreateModal open={quickCreateOpen} onClose={() => setQuickCreateOpen(false)} />

      <FavoriteSportsOnboardingModal
        open={sportsModalOpen}
        onClose={() => setSportsModalOpen(false)}
        onSaved={(selection) => {
          setOnboarding((c) => {
            const next = { ...c, step1: true }
            writeOnboardingState(next)
            return next
          })
          void fetch('/api/user/dashboard-onboarding', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              checklist: { step1: true },
              favoriteSports: selection,
            }),
          }).catch(() => {})
        }}
      />
      <ConnectPlatformsModal
        open={platformModalOpen}
        onClose={() => setPlatformModalOpen(false)}
        onMarkConnectIntent={() => updateOnboardingStep('step2')}
      />
    </div>
  )
}
