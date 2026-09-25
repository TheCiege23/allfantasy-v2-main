'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Clock,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Target,
  X,
  Zap,
} from 'lucide-react'
import type { UserLeague } from '@/app/dashboard/types'
import { AIToolModalShell } from '../AIToolModalShell'
import { currentPathForReturn, readPlanRefusal, type PlanRefusal } from '@/lib/monetization/planRefusal'
import type { UrgencyLevel } from '../types'
import { getChimmyChatHrefWithPrompt } from '@/lib/ai-product-layer/UnifiedChimmyEntryResolver'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import { buildLeagueFormatLabel } from '@/lib/leagues/leagueFormatLabel'

type SportFilter = 'ALL' | (typeof SUPPORTED_SPORTS)[number]

type WaiverTeamContext = 'my_team' | 'specific_team' | 'league_wide' | 'neutral'
type WaiverStrategy =
  | 'best_available'
  | 'win_now'
  | 'safe_floor'
  | 'upside'
  | 'rebuilder'
  | 'streamers'
  | 'stash'
  | 'injury_replacement'
  | 'prospect_build'
  | 'neutral'
type WaiverTimeHorizon = 'this_week' | 'two_weeks' | 'month' | 'ros' | 'dynasty'
type AnalysisTab =
  | 'summary'
  | 'best_adds'
  | 'team_fit'
  | 'streamers'
  | 'stashes'
  | 'drops'
  | 'rookies'
  | 'risk'
  | 'outlook'

type ApiPick = {
  sport: string
  rank: number
  positionRank: number
  recordId: string | null
  playerId: string
  name: string
  position: string
  team: string
  headshotUrl: string | null
  imageUrl: string | null
  waiverScore: number
  composite: number
  marketValue: number
  faabPct: number
  urgency: UrgencyLevel
  confidence: number
  tier: string
  tag: string
  why: string
  shortTerm: boolean
  longTerm: boolean
  injuryStatus: string | null
  trendingAdds: number
  isRookie: boolean
  suggestedDrop: { name: string; playerId: string; reason: string } | null
  rollingFppg?: number | null
}

type ApiSection = { sport: string; picks: ApiPick[]; summary: Record<string, unknown> }

/** Mirrors `WaiverStructuredRecommendations` from waiver-intelligence (client-safe copy). */
type WaiverStructuredRecommendationsClient = {
  bestAddOverall: {
    name: string
    position: string
    why: string
    confidence: number
    faabPct: number
    projectedPoints: number | null
  }
  bestAddByPosition: Array<{
    position: string
    name: string
    why: string
    faabPct: number
    projectedPoints: number | null
  }>
  bestStreamer: { name: string; why: string; confidence: number; projectedPoints: number | null } | null
  bestStash: { name: string; why: string; confidence: number; projectedPoints: number | null } | null
  bestRookieAdd: { name: string; why: string; confidence: number; projectedPoints: number | null } | null
  dropCandidate: { name: string; reason: string } | null
  faabRecommendation: string
  lockAndProcessingNote: string | null
  teamNeedsNote: string | null
}

type ApiResult = {
  ok: true
  analysisMode?: 'league' | 'global'
  mode: string
  sport: string
  leagueId: string | null
  leagueName: string | null
  generalAnalysis: boolean
  faabRemaining: number | null
  faabBudget: number
  waiverTypeLabel: string
  summary: {
    priorityAdds: number
    critical: number
    high: number
    medium: number
    faabAvgPct: number
  }
  picks: ApiPick[]
  sections: ApiSection[] | null
  suggestedDrops: Array<{ playerId: string; name: string; position: string; reason: string }>
  dataGaps: string[]
  dataFreshness: string
  chimmyPayload: Record<string, unknown>
  leagueSettingsSnapshot?: Record<string, unknown> | null
  summaryLine?: string
  lockStatusLabel?: string | null
  timeContext?: {
    userLocalTime?: string
    userTimezone?: string
    nextLockTimeUTC?: string | null
    timeUntilNextLockMs?: number | null
    timezoneMismatch?: boolean
    waiversProcessAt?: string | null
  }
  sourceFlags?: {
    sportsDataReady: boolean
    trendingFeedReady: boolean
    injuryReportReady: boolean
    projectionLayerReady: boolean
    leagueRulesReady: boolean
  }
  dataQuality?: 'full' | 'partial' | 'degraded'
  structuredRecommendations?: WaiverStructuredRecommendationsClient | null
  teamNeeds?: string[]
}

const URGENCY_STYLES: Record<
  UrgencyLevel,
  { label: string; text: string; bg: string; bar: string }
> = {
  critical: { label: 'Critical', text: 'text-red-200', bg: 'bg-red-500/15 border-red-500/30', bar: 'bg-red-400' },
  high: { label: 'High', text: 'text-amber-200', bg: 'bg-amber-500/15 border-amber-500/25', bar: 'bg-amber-400' },
  medium: { label: 'Medium', text: 'text-cyan-200', bg: 'bg-cyan-500/10 border-cyan-500/20', bar: 'bg-cyan-400' },
  low: { label: 'Low', text: 'text-white/60', bg: 'bg-white/[0.04] border-white/[0.08]', bar: 'bg-white/30' },
}

const TIER_LABEL: Record<string, string> = {
  must_add: 'Must add',
  strong_add: 'Strong add',
  stream: 'Stream',
  stash: 'Stash',
  deep: 'Deep',
  watchlist: 'Watchlist',
}

function formatProjPts(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  return Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2)
}

function StructuredWaiverSummary({
  sr,
  rosterTeamNeeds,
  layout = 'inline',
  onJumpToPick,
  onOpenDropsTab,
}: {
  sr: WaiverStructuredRecommendationsClient
  rosterTeamNeeds?: string[]
  layout?: 'inline' | 'focus'
  onJumpToPick?: (args: { name: string; position?: string }) => void
  onOpenDropsTab?: () => void
}) {
  const jump = onJumpToPick
  const mb = layout === 'focus' ? 'mb-0' : 'mb-3'
  const mini = (
    label: string,
    body: string | null,
    sub?: string,
    jumpArgs?: { name: string; position?: string },
  ) => (
    <div className="rounded-lg border border-white/[0.08] bg-[#0c1018] p-2.5">
      <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">{label}</p>
      {body ? (
        jump && jumpArgs ? (
          <button
            type="button"
            onClick={() => jump(jumpArgs)}
            className="mt-1 w-full text-left"
          >
            <p className="text-[12px] font-semibold text-white/88 hover:text-cyan-50">{body}</p>
            <span className="mt-0.5 block text-[9px] font-semibold text-cyan-400/90">View in ranked list →</span>
          </button>
        ) : (
          <p className="mt-1 text-[12px] font-semibold text-white/88">{body}</p>
        )
      ) : (
        <p className="mt-1 text-[11px] text-white/35">—</p>
      )}
      {sub ? <p className="mt-1 line-clamp-2 text-[10px] text-white/45">{sub}</p> : null}
    </div>
  )

  return (
    <div
      className={`${mb} rounded-2xl border border-cyan-500/15 bg-gradient-to-br from-cyan-500/[0.05] to-transparent px-4 py-3`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-200/75">Grounded summary</p>
        <p className="text-[9px] text-white/35">Same players as the list — not synthetic</p>
      </div>

      {rosterTeamNeeds && rosterTeamNeeds.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {rosterTeamNeeds.map((n) => (
            <span
              key={n}
              className="rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-100/90"
            >
              Thin: {n}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-xl border border-white/[0.08] bg-[#0a0d12] p-3">
          <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-200/70">Best add overall</p>
          {jump ? (
            <button
              type="button"
              onClick={() => jump({ name: sr.bestAddOverall.name, position: sr.bestAddOverall.position })}
              className="mt-1 w-full text-left"
            >
              <p className="text-[14px] font-bold text-white/90 hover:text-cyan-50">
                {sr.bestAddOverall.name}{' '}
                <span className="text-[11px] font-semibold text-white/45">{sr.bestAddOverall.position}</span>
              </p>
              <span className="mt-0.5 block text-[9px] font-semibold text-cyan-400/90">View in ranked list →</span>
            </button>
          ) : (
            <p className="mt-1 text-[14px] font-bold text-white/90">
              {sr.bestAddOverall.name}{' '}
              <span className="text-[11px] font-semibold text-white/45">{sr.bestAddOverall.position}</span>
            </p>
          )}
          <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-white/55">{sr.bestAddOverall.why}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-white/45">
            <span className="rounded bg-white/[0.06] px-2 py-0.5">Conf {Math.round(sr.bestAddOverall.confidence)}</span>
            <span className="rounded bg-white/[0.06] px-2 py-0.5">FAAB ~{sr.bestAddOverall.faabPct}%</span>
            <span className="rounded bg-white/[0.06] px-2 py-0.5">Proj {formatProjPts(sr.bestAddOverall.projectedPoints)}</span>
          </div>
        </div>
        <div className="space-y-2 text-[11px] text-white/60">
          <p className="rounded-lg border border-white/[0.06] bg-[#0c1018] p-2.5 leading-snug">
            <span className="text-[9px] font-bold uppercase tracking-wide text-cyan-200/60">FAAB / priority</span>
            <span className="mt-1 block text-white/70">{sr.faabRecommendation}</span>
          </p>
          {sr.lockAndProcessingNote ? (
            <p className="rounded-lg border border-white/[0.06] bg-[#0c1018] p-2.5 text-[10px] text-white/50">
              <span className="font-bold text-white/55">League waiver rules · </span>
              {sr.lockAndProcessingNote}
            </p>
          ) : null}
          {sr.teamNeedsNote ? (
            <p className="rounded-lg border border-amber-500/15 bg-amber-500/[0.04] p-2.5 text-[10px] text-amber-100/85">{sr.teamNeedsNote}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {mini(
          'Best streamer',
          sr.bestStreamer?.name ?? null,
          sr.bestStreamer
            ? `${sr.bestStreamer.why} · proj ${formatProjPts(sr.bestStreamer.projectedPoints)} · conf ${Math.round(sr.bestStreamer.confidence)}`
            : undefined,
          sr.bestStreamer ? { name: sr.bestStreamer.name } : undefined,
        )}
        {mini(
          'Best stash',
          sr.bestStash?.name ?? null,
          sr.bestStash
            ? `${sr.bestStash.why} · proj ${formatProjPts(sr.bestStash.projectedPoints)} · conf ${Math.round(sr.bestStash.confidence)}`
            : undefined,
          sr.bestStash ? { name: sr.bestStash.name } : undefined,
        )}
        {mini(
          'Best rookie',
          sr.bestRookieAdd?.name ?? null,
          sr.bestRookieAdd
            ? `${sr.bestRookieAdd.why} · proj ${formatProjPts(sr.bestRookieAdd.projectedPoints)} · conf ${Math.round(sr.bestRookieAdd.confidence)}`
            : undefined,
          sr.bestRookieAdd ? { name: sr.bestRookieAdd.name } : undefined,
        )}
      </div>

      {sr.dropCandidate ? (
        <div className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/[0.04] px-3 py-2">
          <p className="text-[9px] font-bold uppercase tracking-wide text-rose-200/80">Suggested drop (to open a spot)</p>
          <p className="mt-0.5 text-[12px] font-semibold text-white/88">{sr.dropCandidate.name}</p>
          <p className="mt-1 text-[10px] text-white/50">{sr.dropCandidate.reason}</p>
          {onOpenDropsTab ? (
            <button
              type="button"
              onClick={onOpenDropsTab}
              className="mt-2 text-[9px] font-semibold text-rose-200/90 hover:text-rose-100"
            >
              Open Drops tab →
            </button>
          ) : null}
        </div>
      ) : null}

      {sr.bestAddByPosition.length > 0 ? (
        <div className="mt-3">
          <p className="text-[9px] font-bold uppercase tracking-wide text-white/40">Best by position (from this pool)</p>
          <div className="mt-2 flex max-h-40 flex-col gap-1.5 overflow-y-auto pr-1 sm:max-h-none sm:flex-row sm:flex-wrap">
            {sr.bestAddByPosition.map((row) => (
              <div
                key={row.position}
                className="min-w-0 flex-1 rounded-lg border border-white/[0.06] bg-[#0c1018] px-2.5 py-2 sm:min-w-[140px] sm:max-w-[200px]"
              >
                <p className="text-[9px] font-bold uppercase text-cyan-200/70">{row.position}</p>
                {jump ? (
                  <button
                    type="button"
                    onClick={() => jump({ name: row.name, position: row.position })}
                    className="mt-0.5 w-full truncate text-left"
                  >
                    <span className="text-[11px] font-semibold text-white/85 hover:text-cyan-100">{row.name}</span>
                    <span className="mt-0.5 block text-[8px] font-semibold text-cyan-500/90">In list →</span>
                  </button>
                ) : (
                  <p className="mt-0.5 truncate text-[11px] font-semibold text-white/85">{row.name}</p>
                )}
                <p className="mt-0.5 line-clamp-2 text-[9px] text-white/40">{row.why}</p>
                <p className="mt-1 text-[9px] text-white/35">
                  ~{row.faabPct}% FAAB · proj {formatProjPts(row.projectedPoints)}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function positionsForSport(s: SportFilter): string[] {
  if (s === 'ALL') return ['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST', 'IDP']
  if (s === 'NFL') return ['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST', 'IDP']
  if (s === 'NBA' || s === 'NCAAB')
    return ['ALL', 'G', 'PG', 'SG', 'SF', 'PF', 'C', 'UTIL']
  if (s === 'MLB')
    return ['ALL', 'SP', 'RP', 'P', 'C', '1B', '2B', '3B', 'SS', 'OF', 'UTIL']
  if (s === 'NHL') return ['ALL', 'C', 'W', 'LW', 'RW', 'D', 'G']
  if (s === 'SOCCER') return ['ALL', 'F', 'M', 'D', 'GK']
  if (s === 'NCAAF') return ['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST']
  return ['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST']
}

function streamerPositions(s: SportFilter): Set<string> {
  if (s === 'NHL') return new Set(['G'])
  if (s === 'NBA' || s === 'NCAAB') return new Set(['PG', 'SG', 'G'])
  return new Set(['QB', 'TE', 'K', 'DST', 'DEF'])
}

/** Explicit global: sport snapshot without a league (API receives leagueId: null). */
const GLOBAL_WAIVER = '__af_global__'

function urgencyWidth(u: UrgencyLevel): string {
  return u === 'critical' ? '95%' : u === 'high' ? '72%' : u === 'medium' ? '45%' : '20%'
}

function filterByTab(picks: ApiPick[], tab: AnalysisTab, sport: SportFilter): ApiPick[] {
  if (tab === 'best_adds') return picks
  if (tab === 'team_fit') {
    const withDrop = picks.filter((p) => p.suggestedDrop)
    return withDrop.length > 0 ? withDrop : picks
  }
  if (tab === 'streamers')
    return picks.filter((p) => streamerPositions(sport).has(p.position) || p.tag.includes('STREAM'))
  if (tab === 'stashes')
    return picks.filter((p) => ['stash', 'deep', 'watchlist'].includes(p.tier) || p.tag === 'STASH')
  if (tab === 'rookies') return picks.filter((p) => p.isRookie)
  if (tab === 'risk')
    return [...picks].sort((a, b) => a.confidence - b.confidence)
  if (tab === 'outlook') return picks.filter((p) => p.longTerm || p.tier === 'stash')
  return picks
}

export function WaiverWireModal({
  open,
  onClose,
  leagues,
  initialLeagueId = '',
  initialSport = 'NFL',
  initialJumpToPlayer = null,
}: {
  open: boolean
  onClose: () => void
  leagues: UserLeague[]
  initialLeagueId?: string
  initialSport?: string
  /** When opening from Trending / War Room, scroll to this pick after waiver intel loads. */
  initialJumpToPlayer?: { name: string; position?: string } | null
}) {
  const [sportFilter, setSportFilter] = useState<SportFilter>('ALL')
  const [leagueId, setLeagueId] = useState('')
  const [rookiesOnly, setRookiesOnly] = useState(false)
  const [teamContext, setTeamContext] = useState<WaiverTeamContext>('neutral')
  const [strategy, setStrategy] = useState<WaiverStrategy>('neutral')
  const [timeHorizon, setTimeHorizon] = useState<WaiverTimeHorizon>('this_week')
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>('best_adds')
  const [position, setPosition] = useState('ALL')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<PlanRefusal | null>(null)
  const [result, setResult] = useState<ApiResult | null>(null)
  const [queue, setQueue] = useState<Array<{ playerId: string; name: string; bid: number }>>([])
  const [detailPick, setDetailPick] = useState<ApiPick | null>(null)
  const [detailBody, setDetailBody] = useState<Record<string, unknown> | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const pendingScrollPlayerId = useRef<string | null>(null)
  const jumpFromExternalConsumed = useRef(false)

  useEffect(() => {
    if (!open) return
    const s = (initialSport || 'NFL').toUpperCase()
    const match = SUPPORTED_SPORTS.includes(s as (typeof SUPPORTED_SPORTS)[number])
    setSportFilter(match ? (s as SportFilter) : 'ALL')
    setLeagueId(initialLeagueId || '')
  }, [open, initialLeagueId, initialSport])

  useEffect(() => {
    if (!open) {
      setResult(null)
      setError(null)
      setRefusal(null)
      setQueue([])
      setDetailPick(null)
      setDetailBody(null)
      jumpFromExternalConsumed.current = false
    }
  }, [open])

  const isGlobalMode = leagueId === GLOBAL_WAIVER

  const selectedLeague = useMemo(
    () => (isGlobalMode ? null : leagues.find((l) => l.id === leagueId) ?? null),
    [leagues, leagueId, isGlobalMode],
  )

  const canRunWaiver = useMemo(() => {
    if (isGlobalMode && sportFilter === 'ALL') return false
    return true
  }, [isGlobalMode, sportFilter])

  const filteredLeagues = useMemo(() => {
    if (sportFilter === 'ALL') return leagues
    return leagues.filter((l) => String(l.sport).toUpperCase() === sportFilter)
  }, [leagues, sportFilter])

  const formatLine = useMemo(() => {
    if (!selectedLeague)
      return 'General analysis — pick a league for roster-specific waiver scoring.'
    return buildLeagueFormatLabel({
      format: selectedLeague.format,
      scoring: selectedLeague.scoring,
      isDynasty: selectedLeague.isDynasty,
      leagueVariant: selectedLeague.leagueVariant,
      teamCount: selectedLeague.teamCount,
      season: selectedLeague.season,
    })
  }, [selectedLeague])

  const posOptions = useMemo(() => {
    const eff =
      sportFilter === 'ALL'
        ? selectedLeague
          ? (String(selectedLeague.sport).toUpperCase() as SportFilter)
          : 'NFL'
        : sportFilter
    return positionsForSport(eff === 'ALL' ? 'NFL' : eff)
  }, [sportFilter, selectedLeague])

  const runAnalysis = useCallback(async () => {
    if (!canRunWaiver) {
      setError('Select a specific sport for global waiver mode, or choose a league.')
      setResult(null)
      return
    }
    setLoading(true)
    setError(null)
    setRefusal(null)
    try {
      const effectiveLeagueId = isGlobalMode ? null : leagueId || null
      const r = await fetch('/api/ai-tools/waiver-intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sportFilter,
          leagueId: effectiveLeagueId,
          position,
          rookiesOnly,
          strategy,
          teamContext,
          timeHorizon,
        }),
      })
      const j = (await r.json()) as ApiResult & { ok?: boolean; error?: string }
      if (!r.ok || !j.ok) {
        setRefusal(readPlanRefusal(r.status, j, { returnTo: currentPathForReturn() }))
        setError(j.error || 'Could not load waiver intelligence.')
        setResult(null)
        return
      }
      setResult(j)
    } catch {
      setError('Network error.')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [sportFilter, leagueId, position, rookiesOnly, strategy, teamContext, timeHorizon])

  useEffect(() => {
    if (!open) return
    void runAnalysis()
  }, [open, runAnalysis])

  const rawPicks = result?.picks ?? []
  const tabFiltered = useMemo(() => {
    if (analysisTab === 'summary') return []
    const effSport: SportFilter =
      sportFilter === 'ALL'
        ? ((result?.sport || 'NFL') as SportFilter)
        : sportFilter
    let list: ApiPick[]
    if (analysisTab === 'drops') {
      list = []
    } else {
      list = filterByTab(rawPicks, analysisTab, effSport)
    }
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.team.toLowerCase().includes(q) ||
          p.position.toLowerCase().includes(q) ||
          p.tag.toLowerCase().includes(q),
      )
    }
    return list
  }, [rawPicks, analysisTab, search, sportFilter, result?.sport])

  const resolvePickId = useCallback((name: string, position?: string) => {
    const picks = result?.picks ?? []
    const n = name.trim().toLowerCase()
    const match = picks.filter((p) => p.name.trim().toLowerCase() === n)
    if (match.length === 0) return null
    if (match.length === 1) return match[0].playerId
    if (position) {
      const pu = position.trim().toUpperCase()
      const byPos = match.find((p) => p.position.toUpperCase() === pu)
      return byPos?.playerId ?? match[0].playerId
    }
    return match[0].playerId
  }, [result?.picks])

  const jumpToPick = useCallback(
    (args: { name: string; position?: string }) => {
      const id = resolvePickId(args.name, args.position)
      if (!id) return
      pendingScrollPlayerId.current = id
      setAnalysisTab('best_adds')
      setSearch('')
      setPosition('ALL')
    },
    [resolvePickId],
  )

  useEffect(() => {
    if (!open || !initialJumpToPlayer?.name?.trim() || jumpFromExternalConsumed.current) return
    if (loading || !result?.picks?.length) return
    const id = resolvePickId(initialJumpToPlayer.name.trim(), initialJumpToPlayer.position)
    if (!id) return
    jumpToPick({ name: initialJumpToPlayer.name.trim(), position: initialJumpToPlayer.position })
    jumpFromExternalConsumed.current = true
  }, [open, initialJumpToPlayer, loading, result?.picks, jumpToPick, resolvePickId])

  const openDropsTab = useCallback(() => {
    setAnalysisTab('drops')
  }, [])

  useEffect(() => {
    const id = pendingScrollPlayerId.current
    if (!id || analysisTab !== 'best_adds') return
    if (loading) return
    if (!rawPicks.some((p) => p.playerId === id)) {
      pendingScrollPlayerId.current = null
      return
    }
    const t = window.setTimeout(() => {
      const el = document.getElementById(`waiver-pick-${id}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      pendingScrollPlayerId.current = null
    }, 120)
    return () => clearTimeout(t)
  }, [analysisTab, rawPicks, tabFiltered, loading])

  const chimmyPayload = result?.chimmyPayload
  const chimmyHref = getChimmyChatHrefWithPrompt(
    chimmyPayload
      ? 'Review my waiver intelligence context (structured payload attached).'
      : 'Open Chimmy for waiver help',
    {
      leagueId: isGlobalMode ? undefined : leagueId || undefined,
      leagueName: selectedLeague?.name,
      sport: sportFilter === 'ALL' ? undefined : sportFilter,
      insightType: 'waiver',
      source: 'waiver_tool',
    },
  )

  const openDetail = async (p: ApiPick) => {
    setDetailPick(p)
    setDetailBody(null)
    const id = p.recordId || p.playerId
    setDetailLoading(true)
    try {
      const r = await fetch(`/api/trade-value/player-detail?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
      if (r.ok) setDetailBody((await r.json()) as Record<string, unknown>)
    } catch {
      setDetailBody(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const faabRem = result?.faabRemaining
  const faabBudget = result?.faabBudget ?? 100
  const queueFaabTotal = queue.reduce((s, q) => s + q.bid, 0)

  const analysisTabs: { id: AnalysisTab; label: string }[] = [
    { id: 'summary', label: 'Summary' },
    { id: 'best_adds', label: 'Best adds' },
    { id: 'team_fit', label: 'Team fit' },
    { id: 'streamers', label: 'Streamers' },
    { id: 'stashes', label: 'Stashes' },
    { id: 'drops', label: 'Drops' },
    { id: 'rookies', label: 'Rookies' },
    { id: 'risk', label: 'Risk' },
    { id: 'outlook', label: 'Outlook' },
  ]

  return (
    <>
      <AIToolModalShell
        open={open}
        onClose={onClose}
        title="Waiver Wire"
        subtitle="Opportunity scanner"
        accentColor="emerald"
        wide
        icon={<Target className="h-5 w-5" />}
        headerBadge={
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                result?.analysisMode === 'global' || isGlobalMode
                  ? 'border-amber-500/35 bg-amber-500/10 text-amber-100'
                  : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
              }`}
            >
              {result?.analysisMode === 'global' || isGlobalMode ? 'Global scan' : 'League scan'}
            </span>
            {result?.sourceFlags ? (
              <>
                <span
                  className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase ${
                    result.sourceFlags.sportsDataReady ? 'bg-emerald-500/15 text-emerald-200' : 'bg-white/5 text-white/35'
                  }`}
                >
                  DB
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase ${
                    result.sourceFlags.trendingFeedReady ? 'bg-emerald-500/15 text-emerald-200' : 'bg-white/5 text-white/35'
                  }`}
                >
                  Trend
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase ${
                    result.sourceFlags.projectionLayerReady ? 'bg-emerald-500/15 text-emerald-200' : 'bg-white/5 text-white/35'
                  }`}
                >
                  Proj
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase ${
                    result.sourceFlags.leagueRulesReady ? 'bg-emerald-500/15 text-emerald-200' : 'bg-amber-500/12 text-amber-100/90'
                  }`}
                >
                  {result.sourceFlags.leagueRulesReady ? 'League rules' : 'No league'}
                </span>
              </>
            ) : (
              <span className="text-[9px] text-white/35">Run analysis for status</span>
            )}
          </div>
        }
        loading={false}
        error={error}
        refusal={refusal}
        empty={false}
        emptyMessage="No waiver candidates matched. Try another sport, league, or position."
        onRefresh={() => void runAnalysis()}
        refreshing={loading}
        chimmyPrompt={
          chimmyPayload
            ? 'Explain waiver recommendations using the structured AllFantasy payload only.'
            : 'Open Chimmy for waiver help'
        }
        chimmyContext={chimmyPayload ?? { source: 'waiver_wire_modal' }}
        actions={
          <button
            type="button"
            disabled={!chimmyPayload}
            onClick={async () => {
              if (!chimmyPayload) return
              const r = await fetch('/api/ai-tools/waiver-intelligence/chimmy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ payload: chimmyPayload }),
              })
              const j = (await r.json()) as { chimmy?: unknown }
              if (j?.chimmy) window.alert(JSON.stringify(j.chimmy, null, 2))
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-[#3d4460] bg-[#242838] px-2.5 py-1.5 text-[11px] font-semibold text-[#9ba3bf] hover:border-[#5c6480] disabled:opacity-40"
          >
            <Sparkles className="h-3.5 w-3.5" /> Chimmy JSON
          </button>
        }
      >
        {/* Controls */}
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-[10px] font-bold uppercase tracking-wide text-white/40">
              Sport
              <select
                value={sportFilter}
                onChange={(e) => {
                  setSportFilter(e.target.value as SportFilter)
                  setPosition('ALL')
                }}
                className="mt-1 w-full rounded-lg border border-white/[0.08] bg-[#0f141d] px-2 py-1.5 text-[12px] text-white/90"
              >
                <option value="ALL">All</option>
                {SUPPORTED_SPORTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-white/40">
              League
              <select
                value={leagueId}
                onChange={(e) => {
                  const v = e.target.value
                  setLeagueId(v)
                  if (v === GLOBAL_WAIVER && sportFilter === 'ALL') {
                    setSportFilter('NFL')
                  }
                  const lg = leagues.find((l) => l.id === v)
                  if (lg) setSportFilter(String(lg.sport).toUpperCase() as SportFilter)
                }}
                className="mt-1 w-full rounded-lg border border-white/[0.08] bg-[#0f141d] px-2 py-1.5 text-[12px] text-white/90"
              >
                <option value="">— All leagues / general —</option>
                <option value={GLOBAL_WAIVER}>Global (sport scan — no league FAAB)</option>
                {sportFilter === 'ALL'
                  ? SUPPORTED_SPORTS.map((sp) => {
                      const group = leagues.filter((l) => String(l.sport).toUpperCase() === sp)
                      if (group.length === 0) return null
                      return (
                        <optgroup key={sp} label={sp}>
                          {group.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                        </optgroup>
                      )
                    })
                  : filteredLeagues.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wide text-white/40">
              Rookies
              <button
                type="button"
                onClick={() => setRookiesOnly((v) => !v)}
                className={`rounded-lg border px-2 py-1.5 text-left text-[12px] font-semibold ${
                  rookiesOnly ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-white/[0.08] bg-[#0f141d] text-white/70'
                }`}
              >
                {rookiesOnly ? 'On' : 'Off'}
              </button>
            </label>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-white/40">
              Team context
              <select
                value={teamContext}
                onChange={(e) => setTeamContext(e.target.value as WaiverTeamContext)}
                className="mt-1 w-full rounded-lg border border-white/[0.08] bg-[#0f141d] px-2 py-1.5 text-[12px] text-white/90"
              >
                <option value="my_team">My team</option>
                <option value="specific_team">Specific team</option>
                <option value="league_wide">League-wide</option>
                <option value="neutral">Neutral / general</option>
              </select>
            </label>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-white/40">
              Strategy
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as WaiverStrategy)}
                className="mt-1 w-full rounded-lg border border-white/[0.08] bg-[#0f141d] px-2 py-1.5 text-[12px] text-white/90"
              >
                <option value="best_available">Best available</option>
                <option value="win_now">Win now</option>
                <option value="safe_floor">Safe floor</option>
                <option value="upside">Upside</option>
                <option value="rebuilder">Rebuilder</option>
                <option value="streamers">Streamers</option>
                <option value="stash">Stash</option>
                <option value="injury_replacement">Injury replacement</option>
                <option value="prospect_build">Prospect build</option>
                <option value="neutral">Neutral</option>
              </select>
            </label>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-white/40">
              Horizon
              <select
                value={timeHorizon}
                onChange={(e) => setTimeHorizon(e.target.value as WaiverTimeHorizon)}
                className="mt-1 w-full rounded-lg border border-white/[0.08] bg-[#0f141d] px-2 py-1.5 text-[12px] text-white/90"
              >
                <option value="this_week">This week</option>
                <option value="two_weeks">Next 2 weeks</option>
                <option value="month">Next month</option>
                <option value="ros">Rest of season</option>
                <option value="dynasty">Dynasty / long term</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-1 overflow-x-auto rounded-xl bg-white/[0.03] p-1">
            {analysisTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setAnalysisTab(t.id)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition ${
                  analysisTab === t.id ? 'bg-emerald-500/15 text-emerald-200' : 'text-white/35 hover:text-white/60'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[160px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search players, team, position…"
                className="w-full rounded-lg border border-white/[0.08] bg-[#0f141d] py-1.5 pl-8 pr-2 text-[12px] text-white/90 placeholder:text-white/30"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            {posOptions.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPosition(p)}
                className={`shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                  position === p ? 'bg-emerald-500/15 text-emerald-200' : 'text-white/35 hover:text-white/60'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Summary */}
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-white/45">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-400" /> Loading waiver intelligence…
          </div>
        ) : null}

        {result ? (
          <div className="mb-3 rounded-2xl border border-emerald-500/15 bg-gradient-to-br from-emerald-500/[0.06] to-transparent px-4 py-3">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-300/70">
              {result.generalAnalysis ? 'Trending / FA pool · ' : ''}
              {selectedLeague?.name ?? (isGlobalMode ? 'Global sport scan' : 'AllFantasy leagues')}
            </p>
            {result.summaryLine ? (
              <p className="mt-1 text-[11px] leading-snug text-sky-200/80">{result.summaryLine}</p>
            ) : null}
            {result.timeContext ? (
              <div className="mt-1 text-[10px] text-white/45">
                <span>
                  Local {result.timeContext.userLocalTime ?? '—'} ({result.timeContext.userTimezone ?? '—'})
                </span>
                {result.timeContext.timezoneMismatch ? (
                  <span className="text-amber-200/85"> · device TZ ≠ account TZ (server is truth)</span>
                ) : null}
                {result.timeContext.waiversProcessAt ? (
                  <span className="mt-1 block text-white/35">Next waiver ref (UTC): {result.timeContext.waiversProcessAt}</span>
                ) : null}
                {result.lockStatusLabel ? (
                  <span className="mt-1 block text-sky-200/70">{result.lockStatusLabel}</span>
                ) : null}
              </div>
            ) : null}
            {result.dataQuality === 'degraded' ? (
              <p className="mt-1 text-[10px] text-amber-200/85">Degraded data — review gaps below before bidding.</p>
            ) : null}
            <p className="mt-1 text-[12px] text-white/55">{formatLine}</p>
            {result.leagueSettingsSnapshot &&
            Array.isArray((result.leagueSettingsSnapshot as { quickModeBadges?: string[] }).quickModeBadges) ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {(result.leagueSettingsSnapshot as { quickModeBadges: string[] }).quickModeBadges.map((b) => (
                  <span key={b} className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/55">
                    {b}
                  </span>
                ))}
              </div>
            ) : null}
            <p className="mt-1 text-[13px] font-semibold text-white/85">
              {result.summary.priorityAdds} priority adds · {result.summary.faabAvgPct}% FAAB avg ·{' '}
              <span className="text-emerald-300/90">{result.waiverTypeLabel}</span>
              {faabRem != null ? (
                <span className="ml-2 rounded-md bg-cyan-500/15 px-2 py-0.5 text-[11px] font-bold text-cyan-200">
                  ${faabRem} / ${faabBudget} FAAB
                </span>
              ) : null}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-bold">
              <span className="rounded-md bg-red-500/15 px-2 py-0.5 text-red-200">{result.summary.critical} critical</span>
              <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-amber-200">{result.summary.high} high</span>
              <span className="rounded-md bg-cyan-500/10 px-2 py-0.5 text-cyan-200">{result.summary.medium} medium</span>
            </div>
            {result.dataGaps.length > 0 ? (
              <p className="mt-2 text-[10px] text-amber-200/80">
                Data gaps: {result.dataGaps.slice(0, 3).join(' · ')}
                {result.dataGaps.length > 3 ? '…' : ''}
              </p>
            ) : null}
            <p className="mt-1 text-[9px] text-white/35">Updated {new Date(result.dataFreshness).toLocaleString()}</p>
          </div>
        ) : null}

        {analysisTab !== 'summary' && result?.structuredRecommendations ? (
          <StructuredWaiverSummary
            layout="inline"
            sr={result.structuredRecommendations}
            rosterTeamNeeds={result.teamNeeds}
            onJumpToPick={jumpToPick}
            onOpenDropsTab={openDropsTab}
          />
        ) : null}

        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1 space-y-2">
            {analysisTab === 'summary' ? (
              result?.structuredRecommendations ? (
                <div className="space-y-2">
                  <StructuredWaiverSummary
                    layout="focus"
                    sr={result.structuredRecommendations}
                    rosterTeamNeeds={result.teamNeeds}
                    onJumpToPick={jumpToPick}
                    onOpenDropsTab={openDropsTab}
                  />
                  <p className="text-[10px] text-white/40">
                    Tip: switch to <span className="font-semibold text-white/55">Best adds</span> for the full ranked list and
                    waiver queue.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] py-10 text-center">
                  <p className="text-[12px] font-semibold text-white/70">No grounded summary yet</p>
                  <p className="mt-1 px-4 text-[11px] text-white/45">
                    Run analysis with picks returned, or choose a league so free-agent pool + scoring can populate.
                  </p>
                </div>
              )
            ) : analysisTab === 'drops' ? (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <p className="text-[12px] font-semibold text-white/85">Suggested drops (your roster)</p>
                <p className="mt-1 text-[11px] text-white/45">
                  Based on lowest composite value from your synced roster when &quot;My team&quot; is selected and a league is chosen.
                </p>
                <ul className="mt-3 space-y-2">
                  {(result?.suggestedDrops ?? []).map((d) => (
                    <li
                      key={d.playerId}
                      className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#0f141d] px-3 py-2 text-[12px]"
                    >
                      <span className="font-semibold text-white/85">
                        {d.name}{' '}
                        <span className="text-white/40">
                          {d.position}
                        </span>
                      </span>
                      <span className="max-w-[55%] text-right text-[10px] text-white/45">{d.reason}</span>
                    </li>
                  ))}
                  {(result?.suggestedDrops ?? []).length === 0 ? (
                    <li className="text-[11px] text-white/40">No drop candidates — select a league and My team, or your roster data is not linked yet.</li>
                  ) : null}
                </ul>
              </div>
            ) : tabFiltered.length === 0 ? (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] py-8 text-center text-[11px] text-white/40">
                No picks for this tab/filter.
              </div>
            ) : (
              tabFiltered.map((pick) => (
                <div
                  key={`${pick.playerId}-${pick.rank}`}
                  id={`waiver-pick-${pick.playerId}`}
                  className="block w-full cursor-pointer text-left scroll-mt-24"
                  onClick={() => void openDetail(pick)}
                >
                  <WaiverPickRow
                    pick={pick}
                    sportFilter={sportFilter}
                    onQueue={() => {
                      setQueue((q) => {
                        if (q.some((x) => x.playerId === pick.playerId)) return q
                        return [...q, { playerId: pick.playerId, name: pick.name, bid: pick.faabPct }]
                      })
                    }}
                  />
                </div>
              ))
            )}
          </div>

          {/* Queue */}
          <div className="w-full shrink-0 rounded-xl border border-white/[0.08] bg-[#080b11] p-3 lg:w-64">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-white/50">Waiver queue</p>
              <span className="text-[10px] text-cyan-200/90">
                {queue.length} · ${queueFaabTotal} bid
              </span>
            </div>
            <p className="mt-1 text-[10px] text-white/35">
              Local plan only — submit claims in your host platform (Sleeper/Yahoo/ESPN).
            </p>
            <ul className="mt-3 space-y-2">
              {queue.map((q) => (
                <li key={q.playerId} className="rounded-lg border border-white/[0.06] bg-[#0f141d] p-2">
                  <p className="truncate text-[11px] font-semibold text-white/85">{q.name}</p>
                  <label className="mt-1 flex items-center gap-2 text-[10px] text-white/45">
                    FAAB %
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={q.bid}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        setQueue((list) =>
                          list.map((x) => (x.playerId === q.playerId ? { ...x, bid: Number.isFinite(n) ? n : 0 } : x)),
                        )
                      }}
                      className="w-full rounded border border-white/[0.08] bg-[#0b0e14] px-1 py-0.5 text-[12px] text-white/90"
                    />
                  </label>
                </li>
              ))}
            </ul>
            {queue.length > 0 ? (
              <button
                type="button"
                disabled
                className="mt-3 w-full rounded-lg border border-white/[0.08] bg-white/[0.04] py-2 text-[11px] font-semibold text-white/35"
              >
                Submit via host app
              </button>
            ) : null}
          </div>
        </div>

        {/* Sections (All sports) */}
        {result?.sections && result.sections.length > 0 ? (
          <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-white/40">By sport (All mode)</p>
            {result.sections.map((sec) => (
              <div key={sec.sport} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <p className="text-[12px] font-bold text-emerald-200/90">{sec.sport}</p>
                <ul className="mt-2 space-y-1 text-[11px] text-white/70">
                  {sec.picks.slice(0, 5).map((p) => (
                    <li key={p.playerId}>
                      {p.rank}. {p.name} · {p.position} · {Math.round(p.waiverScore)} score
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-4 rounded-xl border border-[#2e3347] bg-[#0a0d12] p-3">
          <p className="text-[11px] font-semibold text-emerald-200/90">Ask Chimmy</p>
          <p className="mt-1 text-[10px] leading-relaxed text-white/45">
            Chimmy reasons from the waiver payload (trending counts, composites, FAAB, league context). Use JSON for a full
            structured interpretation.
          </p>
          <Link
            href={chimmyHref}
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300 hover:text-emerald-200"
          >
            Open in Messages AI →
          </Link>
        </div>
      </AIToolModalShell>

      {detailPick ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
          <button type="button" className="absolute inset-0 bg-black/70" aria-label="Close" onClick={() => setDetailPick(null)} />
          <div className="relative z-[61] max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-xl border border-[#2e3347] bg-[#0b0e14] p-4 sm:rounded-xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[15px] font-bold text-white/90">{detailPick.name}</p>
                <p className="text-[11px] text-white/45">
                  {detailPick.position} · {detailPick.team} · #{detailPick.positionRank} at position
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailPick(null)}
                className="rounded-md border border-white/[0.08] p-1 text-white/50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {detailPick.imageUrl || detailPick.headshotUrl ? (
              <div className="relative mx-auto mt-3 h-24 w-24 overflow-hidden rounded-full border border-white/[0.08]">
                <Image
                  src={(detailPick.imageUrl || detailPick.headshotUrl) as string}
                  alt=""
                  fill
                  className="object-cover"
                  unoptimized
                />
              </div>
            ) : null}
            {detailLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
              </div>
            ) : detailBody ? (
              <div className="mt-3 space-y-2 text-[11px] text-white/65">
                <p>Injury: {String(detailBody.injuryStatus ?? '—')}</p>
                <p>Last updated: {String(detailBody.lastUpdated ?? '—')}</p>
                <p className="text-white/45">Source: {String(detailBody.dataSource ?? '—')}</p>
              </div>
            ) : (
              <p className="mt-3 text-[11px] text-amber-200/80">
                No detailed `sports_players` row for this id yet — waiver card fields above are from live trending + pool
                data.
              </p>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-white/55">{detailPick.why}</p>
          </div>
        </div>
      ) : null}
    </>
  )
}

function WaiverPickRow({
  pick,
  sportFilter,
  onQueue,
}: {
  pick: ApiPick
  sportFilter: SportFilter
  onQueue: () => void
}) {
  const s = URGENCY_STYLES[pick.urgency]
  const showSport = sportFilter === 'ALL'
  return (
    <div className={`rounded-xl border p-3 transition hover:border-emerald-500/25 ${s.bg}`}>
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-[#0b1020]/80 text-[13px] font-black text-white/80">
          {pick.rank}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-[13px] font-bold text-white/90">{pick.name}</p>
            {showSport ? (
              <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-bold text-white/50">{pick.sport}</span>
            ) : null}
            {pick.trendingAdds > 500 ? <Zap className="h-3 w-3 shrink-0 text-amber-400" /> : null}
            {pick.trendingAdds > 2000 ? <Activity className="h-3 w-3 shrink-0 text-orange-400" /> : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-white/40">
            <span className="font-bold text-white/60">{pick.position}</span>
            <span>·</span>
            <span>{pick.team}</span>
            <span>·</span>
            <span>Pos rank {pick.positionRank}</span>
            {pick.injuryStatus ? (
              <>
                <span>·</span>
                <span className="font-semibold text-amber-200/90">{pick.injuryStatus}</span>
              </>
            ) : null}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/55">
              {TIER_LABEL[pick.tier] ?? pick.tier}
            </span>
            <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase text-emerald-200/90">
              {pick.tag}
            </span>
          </div>
          {pick.rollingFppg != null ? (
            <p className="mt-1 text-[10px] font-semibold text-sky-300/90">Rolling Insights FPPG {pick.rollingFppg.toFixed(1)}</p>
          ) : null}
          <p className="mt-1.5 text-[11px] leading-relaxed text-white/60">{pick.why}</p>
          {pick.suggestedDrop ? (
            <p className="mt-1 text-[10px] text-rose-200/80">
              Drop candidate: {pick.suggestedDrop.name} — {pick.suggestedDrop.reason}
            </p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[8px] font-bold uppercase tracking-widest text-white/30">FAAB %</p>
          <p className={`text-[15px] font-black tabular-nums ${s.text}`}>{pick.faabPct}%</p>
          <p className="text-[9px] text-white/35">conf {pick.confidence}</p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onQueue()
            }}
            className="mt-1 inline-flex items-center gap-0.5 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase text-emerald-200"
          >
            <Plus className="h-3 w-3" /> Queue
          </button>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <Clock className="h-3 w-3 text-white/30" />
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div className={`h-full rounded-full ${s.bar}`} style={{ width: urgencyWidth(pick.urgency) }} />
        </div>
        <span className={`text-[8px] font-bold uppercase tracking-widest ${s.text}`}>{s.label}</span>
      </div>
    </div>
  )
}
