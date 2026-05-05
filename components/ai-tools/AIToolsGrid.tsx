'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeftRight,
  Compass,
  Crosshair,
  Crown,
  Flame,
  Shield,
  ShieldAlert,
  Swords,
  Target,
  Sparkles,
} from 'lucide-react'
import { getChimmyChatHref } from '@/lib/ai-product-layer/UnifiedChimmyEntryResolver'
import type { UserLeague } from '@/app/dashboard/types'
import { formatInjuryAvailabilitySummary } from '@/lib/injury-impact-dashboard/formatAvailabilitySummary'
import type { InjuryImpactDashboardResult } from '@/lib/injury-impact-dashboard/types'
import type { WarRoomCommandCenterResult } from '@/lib/war-room-command-center/types'
import type { MatchupPrepDashboardResult } from '@/lib/matchup-prep-dashboard/types'
import { isSupportedSport } from '@/lib/sport-scope'
import { AIToolCard } from './AIToolCard'
import type { AIToolCardConfig, FreshnessBadge } from './types'
import { StartSitModal } from './modals/StartSitModal'
import { TradeValueModal } from './modals/TradeValueModal'
import { WaiverWireModal } from './modals/WaiverWireModal'
import { TrendingPlayersModal } from './modals/TrendingPlayersModal'
import { PowerRankingsModal } from './modals/PowerRankingsModal'
import { InjuryImpactModal } from './modals/InjuryImpactModal'
import { AFWarRoomModal } from './modals/AFWarRoomModal'
import { MatchupPrepModal } from './modals/MatchupPrepModal'
import { LongTermCoachingModal } from './modals/LongTermCoachingModal'
import type { AIToolGridId } from './ai-tool-ids'
import { isAiToolGridId } from './ai-tool-ids'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { useIntelligenceSnapshot } from '@/hooks/useIntelligenceSnapshot'
import type { IntelligenceChipState } from '@/lib/intelligence/types'
import type { LongTermCoachingAnalysis } from '@/lib/long-term-coaching/types'

type ToolId = AIToolGridId

type OpenAiToolDetail = {
  tool?: string
  waiverJump?: { name: string; position?: string }
  tradePrefillGive?: { name: string; playerId?: string | null; sportHint?: string }
  injuryFocusName?: string
  /** Dashboard Today strip / deep link: open tool scoped to this league when valid. */
  focusLeagueId?: string
}

function chipTone(state: IntelligenceChipState | 'loading'): string {
  if (state === 'connected') return 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.45)]'
  if (state === 'degraded') return 'bg-amber-400/90'
  if (state === 'loading') return 'bg-sky-400/80 animate-pulse'
  return 'bg-white/15'
}

function formatShortAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 'Updated'
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (sec < 45) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

/**
 * Tool card configs. `insight` is a realistic placeholder preview — when
 * real data is available per tool, swap these out for live values. Same
 * for `freshness` — these are currently static "Ready" states; wire to
 * real recency signals per tool as backends come online.
 */
const TOOL_CONFIGS: (AIToolCardConfig & { id: ToolId })[] = [
  {
    id: 'startSit',
    title: 'Start/Sit',
    subtitle: 'Tactical lineup decisions',
    icon: <Crosshair className="h-[18px] w-[18px]" />,
    accent: 'cyan',
    insight: 'Flex swap flagged · 2 lineup issues',
    freshness: { status: 'live', label: 'Live' },
  },
  {
    id: 'trade',
    title: 'Trade Value',
    subtitle: 'Evaluate and rebalance any deal',
    icon: <ArrowLeftRight className="h-[18px] w-[18px]" />,
    accent: 'purple',
    insight: 'Market trending +3 · fairness 52/100',
    freshness: { status: 'recent', label: '6m ago' },
  },
  {
    id: 'waiver',
    title: 'Waiver Wire',
    subtitle: 'Best pickups ranked by urgency',
    icon: <Target className="h-[18px] w-[18px]" />,
    accent: 'emerald',
    insight: '3 high-value adds · $14 FAAB median',
    freshness: { status: 'recent', label: '12m ago' },
  },
  {
    id: 'trending',
    title: 'Trending',
    subtitle: "Who's hot, who's cold",
    icon: <Flame className="h-[18px] w-[18px]" />,
    accent: 'amber',
    insight: '5 risers · 4 fallers this week',
    freshness: { status: 'live', label: 'Live' },
  },
  {
    id: 'power',
    title: 'Power Rankings',
    subtitle: 'League standings and momentum',
    icon: <Crown className="h-[18px] w-[18px]" />,
    accent: 'violet',
    insight: "You're #4 · ↑2 from last week",
    freshness: { status: 'recent', label: '1h ago' },
  },
  {
    id: 'injury',
    title: 'Injury Impact',
    subtitle: 'Roster availability risk',
    icon: <ShieldAlert className="h-[18px] w-[18px]" />,
    accent: 'red',
    insight: '2 questionable · 1 IR candidate',
    freshness: { status: 'live', label: 'Live' },
  },
  {
    id: 'warRoom',
    title: 'AF War Room',
    subtitle: 'Season strategy command center',
    icon: <Shield className="h-[18px] w-[18px]" />,
    accent: 'rose',
    status: 'new',
    insight: 'Contender read · 4 action items',
    freshness: { status: 'recent', label: 'New' },
  },
  {
    id: 'matchupPrep',
    title: 'Matchup Prep',
    subtitle: 'Opponent scouting + game plan',
    icon: <Swords className="h-[18px] w-[18px]" />,
    accent: 'sky',
    insight: 'Synced league data · projected edge & win chance',
    freshness: { status: 'recent', label: 'Ready' },
  },
  {
    id: 'longTermCoach',
    title: 'Long-Term Coach',
    subtitle: '2–5 year dynasty / devy / C2C plan',
    icon: <Compass className="h-[18px] w-[18px]" />,
    accent: 'violet',
    status: 'new',
    insight: 'Contend vs rebuild · title window · pick capital',
    freshness: { status: 'live', label: 'Live' },
  },
]

export function AIToolsGrid({
  leagues,
  selectedLeagueId,
}: {
  leagues: UserLeague[]
  /** Same league as League Intelligence widgets (persisted on dashboard home) */
  selectedLeagueId: string | null
}) {
  const { t, tInterpolate } = useLanguage()
  const { data: intel, loading: intelLoading } = useIntelligenceSnapshot({ leagueId: selectedLeagueId })
  const [activeTool, setActiveTool] = useState<ToolId | null>(null)
  const [pendingWaiverJump, setPendingWaiverJump] = useState<{ name: string; position?: string } | null>(null)
  const [pendingTradePrefill, setPendingTradePrefill] = useState<{
    name: string
    playerId?: string | null
    sportHint?: string
  } | null>(null)
  const [pendingInjuryFocusName, setPendingInjuryFocusName] = useState<string | null>(null)
  const [pendingFocusLeagueId, setPendingFocusLeagueId] = useState<string | null>(null)
  const [injuryPreviewLoading, setInjuryPreviewLoading] = useState(false)
  const [injuryPreview, setInjuryPreview] = useState<{
    insight: string
    freshness: FreshnessBadge
  } | null>(null)
  const [warRoomPreviewLoading, setWarRoomPreviewLoading] = useState(false)
  const [warRoomPreview, setWarRoomPreview] = useState<{
    insight: string
    freshness: FreshnessBadge
  } | null>(null)
  const [matchupPreviewLoading, setMatchupPreviewLoading] = useState(false)
  const [matchupPreview, setMatchupPreview] = useState<{
    insight: string
    freshness: FreshnessBadge
  } | null>(null)
  const [longTermPreviewLoading, setLongTermPreviewLoading] = useState(false)
  const [longTermPreview, setLongTermPreview] = useState<{
    insight: string
    freshness: FreshnessBadge
  } | null>(null)

  const closeActiveTool = useCallback(() => {
    setActiveTool(null)
    setPendingWaiverJump(null)
    setPendingTradePrefill(null)
    setPendingInjuryFocusName(null)
    setPendingFocusLeagueId(null)
  }, [])

  const openToolFromGrid = useCallback((id: ToolId) => {
    setPendingWaiverJump(null)
    setPendingTradePrefill(null)
    setPendingInjuryFocusName(null)
    setPendingFocusLeagueId(null)
    setActiveTool(id)
  }, [])

  useEffect(() => {
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<OpenAiToolDetail>
      const id = ce.detail?.tool
      if (!isAiToolGridId(id)) return
      setPendingWaiverJump(ce.detail?.waiverJump ?? null)
      setPendingTradePrefill(ce.detail?.tradePrefillGive ?? null)
      setPendingInjuryFocusName(ce.detail?.injuryFocusName?.trim() ? ce.detail.injuryFocusName.trim() : null)
      const fl = ce.detail?.focusLeagueId?.trim()
      setPendingFocusLeagueId(fl && leagues.some((l) => l.id === fl) ? fl : null)
      setActiveTool(id)
    }
    window.addEventListener('af-open-ai-tool', handler)
    return () => window.removeEventListener('af-open-ai-tool', handler)
  }, [leagues])

  const activeLeague = useMemo(
    () => (selectedLeagueId ? leagues.find((l) => l.id === selectedLeagueId) ?? null : null),
    [leagues, selectedLeagueId],
  )
  const resolvedLeague = useMemo(() => {
    if (pendingFocusLeagueId) {
      const hit = leagues.find((l) => l.id === pendingFocusLeagueId)
      if (hit) return hit
    }
    return activeLeague
  }, [pendingFocusLeagueId, leagues, activeLeague])
  const leagueId = resolvedLeague?.id ?? ''
  const leagueName = resolvedLeague?.name ?? 'my league'
  const sport = String(resolvedLeague?.sport ?? 'NFL')

  const loadInjuryGridPreview = useCallback(async () => {
    if (!leagueId) {
      setInjuryPreview(null)
      return
    }
    setInjuryPreviewLoading(true)
    try {
      const sportFilter =
        resolvedLeague && isSupportedSport(resolvedLeague.sport) ? String(resolvedLeague.sport).toUpperCase() : 'ALL'
      const res = await fetch('/api/ai-tools/injury-impact/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sportFilter,
          leagueId,
          teamContext: 'my_team',
          specificTeamExternalId: null,
          opponentTeamExternalId: null,
          statusFilter: 'all',
          timeHorizon: 'this_week',
          skipAi: true,
          toggles: {
            includePractice: true,
            includeNews: true,
            includeReturnTimelines: true,
            includeHandcuffs: true,
            includePlayoffImpact: true,
            includeDynastyImpact: true,
          },
        }),
      })
      const json = (await res.json()) as InjuryImpactDashboardResult | { ok: false; error?: string }
      if (!res.ok || !json.ok) {
        return
      }
      const risk = Math.round(Math.min(100, Math.max(0, json.overallRisk)))
      const summary = formatInjuryAvailabilitySummary(json.summaryCounts)
      const insight = `${summary} · Risk ${risk}/100`
      const freshness: FreshnessBadge = json.degraded
        ? { status: 'stale', label: 'Partial data' }
        : { status: 'recent', label: formatShortAgo(json.computedAt) }
      setInjuryPreview({ insight, freshness })
    } catch {
      // keep prior preview if any
    } finally {
      setInjuryPreviewLoading(false)
    }
  }, [leagueId, resolvedLeague])

  const loadWarRoomGridPreview = useCallback(async () => {
    if (!leagueId) {
      setWarRoomPreview(null)
      return
    }
    setWarRoomPreviewLoading(true)
    try {
      const sportFilter =
        resolvedLeague && isSupportedSport(resolvedLeague.sport) ? String(resolvedLeague.sport).toUpperCase() : 'ALL'
      const res = await fetch('/api/ai-tools/war-room/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sportFilter,
          leagueId,
          teamContext: 'my_team',
          strategyMode: 'balanced',
          timeHorizon: 'this_week',
          specificTeamExternalId: null,
          opponentTeamExternalId: null,
          skipAi: true,
          toggles: {
            includeNews: true,
            includeInjuries: true,
            includeWaiverSuggestions: true,
            includeTradeSuggestions: false,
            includeStartSitRecommendations: true,
            includePowerRankings: true,
            includeTrendingPlayers: true,
            includeRookieProspectIntel: false,
            includePlayoffImpact: true,
            includeDynastyWeighting: true,
            includeMatchupPrep: true,
            includeTodayActions: true,
          },
        }),
      })
      const json = (await res.json()) as WarRoomCommandCenterResult | { ok: false; error?: string }
      if (!res.ok || !json.ok) {
        return
      }
      const n = json.actions.length
      const pri = Math.round(json.scores.commandPriority)
      const insight = `${n} queued action${n === 1 ? '' : 's'} · Command ${pri}/100`
      const freshness: FreshnessBadge = json.overview.degraded
        ? { status: 'stale', label: 'Partial data' }
        : { status: 'recent', label: formatShortAgo(json.computedAt) }
      setWarRoomPreview({ insight, freshness })
    } catch {
      /* keep prior preview */
    } finally {
      setWarRoomPreviewLoading(false)
    }
  }, [leagueId, resolvedLeague])

  const loadMatchupGridPreview = useCallback(async () => {
    if (!leagueId) {
      setMatchupPreview(null)
      return
    }
    setMatchupPreviewLoading(true)
    try {
      const sportFilter =
        resolvedLeague && isSupportedSport(resolvedLeague.sport) ? String(resolvedLeague.sport).toUpperCase() : 'ALL'
      const res = await fetch('/api/ai-tools/matchup-prep/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sportFilter,
          leagueId,
          teamFocus: 'my_team',
          teamExternalId: null,
          opponentExternalId: null,
          timeHorizon: 'this_matchup',
          strategyMode: 'balanced',
          skipAi: true,
          toggles: {
            includeLiveNews: true,
            includeInjuries: true,
            includeScheduleAdjustments: true,
            includeWeather: false,
            includeStreamingRecommendations: true,
            includeOpponentTrendAnalysis: true,
            includePlayoffContext: true,
            includeRookieProspectContext: false,
          },
        }),
      })
      const json = (await res.json()) as MatchupPrepDashboardResult | { ok: false; error?: string }
      if (!res.ok || !json.ok) {
        return
      }
      const edge = json.projectedEdge
      const win = json.winProbability
      const edgeStr = edge != null ? `${edge > 0 ? '+' : ''}${edge.toFixed(1)} pt edge` : 'Edge —'
      const winStr = win != null ? `${win}% win` : 'Win % —'
      const insight = `${edgeStr} · ${winStr}`
      const freshness: FreshnessBadge = json.degraded
        ? { status: 'stale', label: 'Partial data' }
        : { status: 'recent', label: formatShortAgo(json.computedAt) }
      setMatchupPreview({ insight, freshness })
    } catch {
      /* keep prior */
    } finally {
      setMatchupPreviewLoading(false)
    }
  }, [leagueId, resolvedLeague])

  const loadLongTermGridPreview = useCallback(async () => {
    if (!leagueId) {
      setLongTermPreview(null)
      return
    }
    setLongTermPreviewLoading(true)
    try {
      const res = await fetch('/api/ai-tools/long-term-coaching', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId,
          horizonYears: 3,
          strategyMode: 'auto',
          teamExternalId: null,
          skipAi: true,
        }),
      })
      const json = (await res.json()) as
        | { ok: true; analysis: LongTermCoachingAnalysis }
        | { ok: false; error?: string }
      if (!res.ok || !json.ok || !('analysis' in json) || !json.analysis) {
        return
      }
      const a = json.analysis
      const cls = a.signals.strategyClass.replace(/_/g, ' ')
      const st = a.signals.shortTermStrengthIndex
      const lt = a.signals.longTermAssetIndex
      const insight = `${cls} · short ${st} · long ${lt}`
      const freshness: FreshnessBadge = { status: 'recent', label: formatShortAgo(a.computedAt) }
      setLongTermPreview({ insight, freshness })
    } catch {
      /* keep prior */
    } finally {
      setLongTermPreviewLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    setInjuryPreview(null)
    setWarRoomPreview(null)
    setMatchupPreview(null)
    setLongTermPreview(null)
  }, [leagueId])

  useEffect(() => {
    void loadInjuryGridPreview()
  }, [loadInjuryGridPreview])

  useEffect(() => {
    void loadWarRoomGridPreview()
  }, [loadWarRoomGridPreview])

  useEffect(() => {
    void loadMatchupGridPreview()
  }, [loadMatchupGridPreview])

  useEffect(() => {
    void loadLongTermGridPreview()
  }, [loadLongTermGridPreview])

  const toolConfigs = useMemo(() => {
    return TOOL_CONFIGS.map((c) => {
      let row = c
      if (c.id === 'injury' && leagueId) {
        if (injuryPreviewLoading && !injuryPreview) {
          row = {
            ...row,
            status: 'loading' as const,
            insight: 'Syncing injury intelligence…',
            freshness: { status: 'live' as const, label: 'Syncing' },
          }
        } else if (injuryPreview) {
          row = {
            ...row,
            status: injuryPreviewLoading ? ('loading' as const) : undefined,
            insight: injuryPreview.insight,
            freshness: injuryPreview.freshness,
          }
        }
      }
      if (c.id === 'warRoom' && leagueId) {
        if (warRoomPreviewLoading && !warRoomPreview) {
          row = {
            ...row,
            status: 'loading' as const,
            insight: 'Building command queue…',
            freshness: { status: 'live' as const, label: 'Syncing' },
          }
        } else if (warRoomPreview) {
          row = {
            ...row,
            status: warRoomPreviewLoading ? ('loading' as const) : undefined,
            insight: warRoomPreview.insight,
            freshness: warRoomPreview.freshness,
          }
        }
      }
      if (c.id === 'matchupPrep' && leagueId) {
        if (matchupPreviewLoading && !matchupPreview) {
          row = {
            ...row,
            status: 'loading' as const,
            insight: 'Computing matchup board…',
            freshness: { status: 'live' as const, label: 'Syncing' },
          }
        } else if (matchupPreview) {
          row = {
            ...row,
            status: matchupPreviewLoading ? ('loading' as const) : undefined,
            insight: matchupPreview.insight,
            freshness: matchupPreview.freshness,
          }
        }
      }
      if (c.id === 'longTermCoach' && leagueId) {
        if (longTermPreviewLoading && !longTermPreview) {
          row = {
            ...row,
            status: 'loading' as const,
            insight: 'Building long-term outlook…',
            freshness: { status: 'live' as const, label: 'Syncing' },
          }
        } else if (longTermPreview) {
          row = {
            ...row,
            status: longTermPreviewLoading ? ('loading' as const) : undefined,
            insight: longTermPreview.insight,
            freshness: longTermPreview.freshness,
          }
        }
      }
      return row
    })
  }, [
    leagueId,
    injuryPreview,
    injuryPreviewLoading,
    warRoomPreview,
    warRoomPreviewLoading,
    matchupPreview,
    matchupPreviewLoading,
    longTermPreview,
    longTermPreviewLoading,
  ])

  const sportsConn: IntelligenceChipState | 'loading' =
    intelLoading && !intel ? 'loading' : intel?.health.sportsData ?? 'unavailable'
  const newsConn: IntelligenceChipState | 'loading' =
    intelLoading && !intel ? 'loading' : intel?.health.news ?? 'unavailable'
  const aiConn: IntelligenceChipState | 'loading' =
    intelLoading && !intel ? 'loading' : intel?.health.aiEngine ?? 'unavailable'
  const rollingConn: IntelligenceChipState | 'loading' =
    intelLoading && !intel ? 'loading' : intel?.health.rollingInsights ?? 'unavailable'
  const clearConn: IntelligenceChipState | 'loading' =
    intelLoading && !intel ? 'loading' : intel?.health.clearSports ?? 'unavailable'

  return (
    <section className="ai-tools-tactical space-y-4" data-testid="ai-tools-grid">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#00d4aa] bg-[rgba(0,212,170,0.12)]"
            aria-hidden
          >
            <Sparkles className="h-4 w-4 text-[#00d4aa]" />
          </div>
          <div>
            <p className="text-[16px] font-bold leading-none tracking-tight text-[#e8eaf6]">
              {t('dashboard.aiTools.globalSectionTitle')}
            </p>
            <p className="mt-1 text-[11px] leading-none text-[#5c6480]">{t('dashboard.aiTools.globalSectionSubtitle')}</p>
          </div>
        </div>
        <Link
          href={getChimmyChatHref({ source: 'dashboard' })}
          className="inline-flex items-center gap-1 rounded-[6px] border border-[#00d4aa]/45 bg-[rgba(0,212,170,0.08)] px-3 py-1.5 text-[11px] font-semibold text-[#00d4aa] transition hover:border-[#00d4aa]/70 hover:bg-[rgba(0,212,170,0.14)]"
        >
          {t('dashboard.aiTools.askChimmy')}
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {resolvedLeague ? (
          <span
            className="inline-flex max-w-full items-center truncate rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold text-cyan-100/95"
            title={resolvedLeague.name}
          >
            {tInterpolate('dashboard.aiTools.contextLeagueMode', { name: resolvedLeague.name })}
          </span>
        ) : (
          <span className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium text-white/55">
            {t('dashboard.aiTools.contextGlobalMode')}
          </span>
        )}
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-[#0a1220] px-2 py-1 text-[10px] text-white/65"
          title={t('dashboard.aiTools.chipSportsHint')}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${chipTone(sportsConn)}`} aria-hidden />
          {t('dashboard.aiTools.chipSports')}
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-[#0a1220] px-2 py-1 text-[10px] text-white/65"
          title={t('dashboard.aiTools.chipNewsHint')}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${chipTone(newsConn)}`} aria-hidden />
          {t('dashboard.aiTools.chipNews')}
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-[#0a1220] px-2 py-1 text-[10px] text-white/65"
          title={t('dashboard.aiTools.chipAiHint')}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${chipTone(aiConn)}`} aria-hidden />
          {t('dashboard.aiTools.chipAi')}
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-[#0a1220] px-2 py-1 text-[10px] text-white/65"
          title={t('dashboard.aiTools.chipRollingHint')}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${chipTone(rollingConn)}`} aria-hidden />
          {t('dashboard.aiTools.chipRolling')}
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-[#0a1220] px-2 py-1 text-[10px] text-white/65"
          title={t('dashboard.aiTools.chipClearSportsHint')}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${chipTone(clearConn)}`} aria-hidden />
          {t('dashboard.aiTools.chipClearSports')}
        </span>
      </div>

      {/* Tool card grid */}
      <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        {toolConfigs.map((config) => (
          <AIToolCard
            key={config.id}
            config={config}
            onClick={() => openToolFromGrid(config.id)}
          />
        ))}
      </div>

      {/* Modals — one per tool, rendered unconditionally; internal `open` gate */}
      <StartSitModal
        open={activeTool === 'startSit'}
        onClose={closeActiveTool}
        leagueId={leagueId}
        leagueName={leagueName}
        leagues={leagues}
        initialSport={sport}
      />
      <TradeValueModal
        open={activeTool === 'trade'}
        onClose={closeActiveTool}
        leagues={leagues}
        initialLeagueId={leagueId}
        initialSport={sport}
        initialPrefillGivePlayer={pendingTradePrefill}
      />
      <WaiverWireModal
        open={activeTool === 'waiver'}
        onClose={closeActiveTool}
        leagues={leagues}
        initialLeagueId={leagueId}
        initialSport={sport}
        initialJumpToPlayer={pendingWaiverJump}
      />
      <TrendingPlayersModal
        open={activeTool === 'trending'}
        onClose={closeActiveTool}
        leagues={leagues}
        initialLeagueId={leagueId}
        initialSport={resolvedLeague ? String(resolvedLeague.sport) : 'ALL'}
      />
      <PowerRankingsModal
        open={activeTool === 'power'}
        onClose={closeActiveTool}
        leagues={leagues}
        initialLeagueId={leagueId}
        initialSport={resolvedLeague ? String(resolvedLeague.sport) : 'ALL'}
      />
      <InjuryImpactModal
        open={activeTool === 'injury'}
        onClose={closeActiveTool}
        leagues={leagues}
        initialLeagueId={leagueId}
        initialSport={resolvedLeague ? String(resolvedLeague.sport) : 'ALL'}
        initialFocusPlayerName={pendingInjuryFocusName}
      />
      <AFWarRoomModal
        open={activeTool === 'warRoom'}
        onClose={closeActiveTool}
        leagues={leagues}
        initialLeagueId={leagueId}
        initialSport={resolvedLeague ? String(resolvedLeague.sport) : 'ALL'}
      />
      <MatchupPrepModal
        open={activeTool === 'matchupPrep'}
        onClose={closeActiveTool}
        leagues={leagues}
        initialLeagueId={leagueId}
        initialSport={resolvedLeague ? String(resolvedLeague.sport) : 'ALL'}
      />
      <LongTermCoachingModal
        open={activeTool === 'longTermCoach'}
        onClose={closeActiveTool}
        leagues={leagues}
        initialLeagueId={leagueId}
        initialSport={resolvedLeague ? String(resolvedLeague.sport) : 'ALL'}
      />
    </section>
  )
}
