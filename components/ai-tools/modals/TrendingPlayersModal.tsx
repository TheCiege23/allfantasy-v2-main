'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  ExternalLink,
  Flame,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react'
import type { UserLeague } from '@/app/dashboard/types'
import { AIToolModalShell } from '../AIToolModalShell'
import { getChimmyChatHrefWithPrompt } from '@/lib/ai-product-layer/UnifiedChimmyEntryResolver'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import { positionsForSport } from '@/lib/trending-players/position-filters'
import type { TrendPlayerCard } from '@/lib/trending-players/types'
import { parseTrendPlayerId } from '@/lib/trending-players/parseTrendPlayerId'

type OpenAiToolDetail = {
  tool?: string
  waiverJump?: { name: string; position?: string }
  tradePrefillGive?: { name: string; playerId?: string | null; sportHint?: string }
  injuryFocusName?: string
}

function openDashboardAiTool(detail: OpenAiToolDetail) {
  window.dispatchEvent(new CustomEvent('af-open-ai-tool', { detail }))
}

const ACTION_LABEL: Record<string, string> = {
  add: 'Add',
  hold: 'Hold',
  sell: 'Sell / explore trade',
  monitor: 'Monitor',
  watch: 'Watch',
}

const RELEVANCE_LABEL: Record<string, string> = {
  on_your_roster: 'On your roster — trend matters for starts/trades.',
  rostered_elsewhere: 'Rostered in this league — trade or game the wire.',
  likely_available: 'Not on a synced roster — waiver wire relevant.',
  unknown: 'Pick a league for roster-aware relevance.',
}

type SportFilter = 'ALL' | (typeof SUPPORTED_SPORTS)[number]

const TREND_TYPES: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All Trends' },
  { id: 'add', label: 'Add Trends' },
  { id: 'drop', label: 'Drop Trends' },
  { id: 'start', label: 'Start Trends' },
  { id: 'sit', label: 'Sit Trends' },
  { id: 'trade', label: 'Trade Trends' },
  { id: 'performance', label: 'Performance Trends' },
  { id: 'usage', label: 'Usage Trends' },
  { id: 'injury_replacement', label: 'Injury Replacement Trends' },
  { id: 'rookie', label: 'Rookie Trends' },
]

const TIME_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: '24h', label: '24 Hours' },
  { id: '3d', label: '3 Days' },
  { id: '7d', label: '7 Days' },
  { id: '14d', label: '14 Days' },
  { id: '30d', label: '30 Days' },
  { id: 'season', label: 'Season' },
  { id: 'dynasty_long', label: 'Dynasty / Long Term' },
]

const CONTEXT_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'my_leagues', label: 'My Leagues' },
  { id: 'my_team', label: 'My Team' },
  { id: 'league_wide', label: 'League-Wide' },
  { id: 'opponent_watch', label: 'Opponent Watch' },
  { id: 'waiver_watch', label: 'Waiver Watch' },
  { id: 'trade_market', label: 'Trade Market' },
  { id: 'start_sit_market', label: 'Start/Sit Market' },
]

type DashboardPayload = {
  ok: true
  analysisScope: string
  sportLabel: string
  leagueName: string | null
  summary: {
    riserCount: number
    fallerCount: number
    biggestGainer: TrendPlayerCard | null
    biggestFaller: TrendPlayerCard | null
  }
  risers: TrendPlayerCard[]
  fallers: TrendPlayerCard[]
  aiNarrative: string | null
  chimmyPayload: Record<string, unknown>
  dataGaps: string[]
  degraded: boolean
  fetchedAt: string
  sourceFlags?: {
    fantasyCalcReady: boolean
    sleeperTrendingReady: boolean
    metaTrendsReady: boolean
    projectionLayerReady: boolean
    injuryNewsLayerReady: boolean
    leagueScoringApplied: boolean
    aiEnvelopeReady: boolean
  }
}

export function TrendingPlayersModal({
  open,
  onClose,
  leagues,
  initialLeagueId = '',
  initialSport = 'ALL',
}: {
  open: boolean
  onClose: () => void
  leagues: UserLeague[]
  initialLeagueId?: string
  initialSport?: string
}) {
  const [sportFilter, setSportFilter] = useState<SportFilter>('ALL')
  const [leagueId, setLeagueId] = useState<string>('')
  const [trendType, setTrendType] = useState('all')
  const [position, setPosition] = useState('ALL')
  const [rookiesOnly, setRookiesOnly] = useState(false)
  const [timeWindow, setTimeWindow] = useState('7d')
  const [contextMode, setContextMode] = useState('general')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<DashboardPayload | null>(null)
  const [detail, setDetail] = useState<TrendPlayerCard | null>(null)

  useEffect(() => {
    if (!open) return
    const s = (initialSport || 'ALL').toUpperCase()
    if (s === 'ALL') setSportFilter('ALL')
    else if (SUPPORTED_SPORTS.includes(s as (typeof SUPPORTED_SPORTS)[number])) {
      setSportFilter(s as SportFilter)
    }
    setLeagueId(initialLeagueId || '')
  }, [open, initialLeagueId, initialSport])

  const posSport = sportFilter === 'ALL' ? 'NFL' : sportFilter
  const positionOptions = useMemo(
    () => positionsForSport(posSport as (typeof SUPPORTED_SPORTS)[number]),
    [posSport],
  )

  useEffect(() => {
    if (!positionOptions.includes(position)) setPosition('ALL')
  }, [positionOptions, position])

  const filteredLeagues = useMemo(() => {
    if (sportFilter === 'ALL') return leagues
    return leagues.filter((l) => String(l.sport).toUpperCase() === sportFilter)
  }, [leagues, sportFilter])

  const leaguesBySport = useMemo(() => {
    const map = new Map<string, UserLeague[]>()
    for (const l of filteredLeagues) {
      const k = String(l.sport)
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(l)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filteredLeagues])

  useEffect(() => {
    if (!leagueId) return
    if (!filteredLeagues.some((l) => l.id === leagueId)) setLeagueId('')
  }, [sportFilter, leagueId, filteredLeagues])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/ai-tools/trending-players/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sportFilter,
          leagueId: leagueId || null,
          trendType,
          position,
          rookiesOnly,
          timeWindow,
          contextMode,
          limitPerSide: 8,
          skipAi: false,
        }),
      })
      const j = await r.json()
      if (!r.ok) {
        setError(j.error || 'Failed to load trends')
        setData(null)
        return
      }
      if (!j.ok) {
        setError(j.error || 'Trending unavailable')
        setData(null)
        return
      }
      setData(j as DashboardPayload)
    } catch (e) {
      setError((e as Error).message)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [sportFilter, leagueId, trendType, position, rookiesOnly, timeWindow, contextMode])

  useEffect(() => {
    if (!open) return
    load()
  }, [open, load])

  const scopeLabel =
    data?.analysisScope === 'league' && data.leagueName
      ? `League: ${data.leagueName}`
      : 'General platform trends (pick a league for scoring-aware context)'

  return (
    <>
      <AIToolModalShell
        open={open}
        onClose={onClose}
        title="Trending"
        subtitle="Who's hot, who's cold"
        accentColor="amber"
        icon={<Flame className="h-5 w-5" />}
        wide
        headerBadge={
          <span className="flex flex-wrap items-center gap-1">
            <span className="at-api-pill at-api-pill--live text-[9px] font-semibold uppercase tracking-wide">
              Live data
            </span>
            {data?.degraded ? (
              <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-semibold text-amber-100/90">
                Partial
              </span>
            ) : (
              <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[9px] font-semibold text-[#8b9dc8]">
                Ready
              </span>
            )}
            {(() => {
              const sf = data?.sourceFlags
              if (!sf) return null
              const chipBase = 'rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide'
              const green = 'bg-emerald-500/15 text-emerald-200'
              const dim = 'bg-white/5 text-white/35'
              const amber = 'bg-amber-500/12 text-amber-100/90'
              return (
                <>
                  <span title={sf.fantasyCalcReady ? 'FantasyCalc value trend feed live' : 'FantasyCalc not contributing'} className={`${chipBase} ${sf.fantasyCalcReady ? green : dim}`}>FC</span>
                  <span title={sf.sleeperTrendingReady ? 'Sleeper trending_players feed active' : 'Sleeper trending unavailable'} className={`${chipBase} ${sf.sleeperTrendingReady ? green : dim}`}>Sleeper</span>
                  <span title={sf.metaTrendsReady ? 'player_meta_trends rollup active' : 'Meta trends unavailable'} className={`${chipBase} ${sf.metaTrendsReady ? green : dim}`}>Meta</span>
                  <span title={sf.projectionLayerReady ? 'League-scored projections attached' : 'No projections attached'} className={`${chipBase} ${sf.projectionLayerReady ? green : dim}`}>Proj</span>
                  <span title={sf.injuryNewsLayerReady ? 'Injury/news signals attached' : 'No injury/news signals'} className={`${chipBase} ${sf.injuryNewsLayerReady ? green : dim}`}>News</span>
                  <span title={sf.leagueScoringApplied ? 'League scoring rules applied' : 'No league scoring (global mode)'} className={`${chipBase} ${sf.leagueScoringApplied ? green : amber}`}>{sf.leagueScoringApplied ? 'Scoring' : 'No lg scoring'}</span>
                  <span title={sf.aiEnvelopeReady ? 'AI envelope attached' : 'AI envelope missing'} className={`${chipBase} ${sf.aiEnvelopeReady ? green : dim}`}>AI</span>
                </>
              )
            })()}
          </span>
        }
        showApiPills={false}
        loading={false}
        error={error}
        empty={!loading && !data?.risers?.length && !data?.fallers?.length}
        emptyMessage="No trend rows for these filters. Try another sport, window, or connect league imports."
        onRefresh={load}
        refreshing={loading && !!data}
        chimmyPrompt="Explain these player trends with Chimmy using the attached structured payload."
        chimmyContext={data?.chimmyPayload ?? { source: 'trending_players_modal' }}
        actions={
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-100/90 disabled:opacity-40"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Refresh
          </button>
        }
      >
        <p className="mb-3 text-[11px] leading-relaxed text-[#5c6480]">{scopeLabel}</p>

        {/* Control bar */}
        <div className="sticky top-0 z-10 mb-3 space-y-2 rounded-[10px] border border-[#2e3347] bg-[#0a1228]/95 p-2.5 backdrop-blur">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1">
              <span className="at-section-title !mb-0">Sport</span>
              <select
                value={sportFilter}
                onChange={(e) => setSportFilter(e.target.value as SportFilter)}
                className="at-select w-full px-2 py-2 text-[12px]"
              >
                <option value="ALL">All</option>
                {SUPPORTED_SPORTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="at-section-title !mb-0">League</span>
              <select
                value={leagueId}
                onChange={(e) => setLeagueId(e.target.value)}
                className="at-select w-full px-2 py-2 text-[12px]"
              >
                <option value="">All leagues</option>
                {sportFilter === 'ALL' && leaguesBySport.length > 0
                  ? leaguesBySport.map(([sport, list]) => (
                      <optgroup key={sport} label={sport}>
                        {list.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </optgroup>
                    ))
                  : filteredLeagues.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.sport})
                      </option>
                    ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="at-section-title !mb-0">Trend type</span>
              <select
                value={trendType}
                onChange={(e) => setTrendType(e.target.value)}
                className="at-select w-full px-2 py-2 text-[12px]"
              >
                {TREND_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="at-section-title !mb-0">Position</span>
              <select
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                className="at-select w-full px-2 py-2 text-[12px]"
              >
                {positionOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="at-section-title !mb-0">Time window</span>
              <select
                value={timeWindow}
                onChange={(e) => setTimeWindow(e.target.value)}
                className="at-select w-full px-2 py-2 text-[12px]"
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="at-section-title !mb-0">Context</span>
              <select
                value={contextMode}
                onChange={(e) => setContextMode(e.target.value)}
                className="at-select w-full px-2 py-2 text-[12px]"
              >
                {CONTEXT_OPTIONS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-1">
              <span className="at-section-title !mb-0">Rookies</span>
              <button
                type="button"
                onClick={() => setRookiesOnly((v) => !v)}
                className={`rounded-lg border px-3 py-2 text-left text-[12px] font-semibold transition ${
                  rookiesOnly
                    ? 'border-amber-500/50 bg-amber-500/15 text-amber-100'
                    : 'border-[#2e3347] bg-[#161b22] text-[#9ba3bf]'
                }`}
              >
                {rookiesOnly ? 'On — rookies prioritized' : 'Off — all players'}
              </button>
            </div>
          </div>
        </div>

        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[12px] text-[#5c6480]">
            <Loader2 className="h-5 w-5 animate-spin text-amber-400/80" />
            Loading live trends…
          </div>
        ) : null}

        {/* Summary strip */}
        {data ? (
          <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2">
              <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-200/70">Risers</p>
              <p className="text-[22px] font-black tabular-nums text-emerald-300">{data.summary.riserCount}</p>
              <p className="text-[10px] text-[#5c6480]">Trending up</p>
            </div>
            <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] px-3 py-2">
              <p className="text-[9px] font-bold uppercase tracking-wider text-red-200/70">Fallers</p>
              <p className="text-[22px] font-black tabular-nums text-red-300">{data.summary.fallerCount}</p>
              <p className="text-[10px] text-[#5c6480]">Trending down</p>
            </div>
            <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/[0.04] px-3 py-2">
              <p className="text-[9px] font-bold uppercase tracking-wider text-cyan-200/70">Biggest mover</p>
              <p className="truncate text-[12px] font-bold text-cyan-100/90">
                {data.summary.biggestGainer?.name ?? '—'}
              </p>
              <p className="text-[11px] font-mono text-cyan-300/90">
                {data.summary.biggestGainer ? `${data.summary.biggestGainer.trendDelta > 0 ? '+' : ''}${data.summary.biggestGainer.trendDelta}` : ''}
              </p>
            </div>
            <div className="rounded-xl border border-rose-500/15 bg-rose-500/[0.04] px-3 py-2">
              <p className="text-[9px] font-bold uppercase tracking-wider text-rose-200/70">Biggest faller</p>
              <p className="truncate text-[12px] font-bold text-rose-100/90">
                {data.summary.biggestFaller?.name ?? '—'}
              </p>
              <p className="text-[11px] font-mono text-rose-300/90">
                {data.summary.biggestFaller ? `${data.summary.biggestFaller.trendDelta}` : ''}
              </p>
            </div>
          </div>
        ) : null}

        {/* Dual columns */}
        {data && (data.risers.length > 0 || data.fallers.length > 0) ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <TrendColumn
              title="Trending up"
              accent="emerald"
              icon={<TrendingUp className="h-4 w-4" />}
              players={data.risers}
              sportFilter={sportFilter}
              onSelect={setDetail}
            />
            <TrendColumn
              title="Trending down"
              accent="red"
              icon={<TrendingDown className="h-4 w-4" />}
              players={data.fallers}
              sportFilter={sportFilter}
              onSelect={setDetail}
            />
          </div>
        ) : null}

        {data?.aiNarrative ? (
          <div className="mt-4 rounded-xl border border-amber-500/15 bg-amber-500/[0.04] px-4 py-3">
            <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-amber-200/75">AI read</p>
            <p className="text-[12px] leading-relaxed text-[#c8d4f0]">{data.aiNarrative}</p>
          </div>
        ) : null}

        {data?.dataGaps?.length ? (
          <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[11px] text-amber-50/90">
            {data.dataGaps.join(' · ')}
          </div>
        ) : null}

        {data?.fetchedAt ? (
          <p className="mt-2 text-[10px] text-[#5c6480]">Updated {new Date(data.fetchedAt).toLocaleString()}</p>
        ) : null}

        {/* Chimmy */}
        <div className="at-panel mt-4 border-[#2e3347] bg-[#161b22] p-3">
          <div className="mb-2 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10 text-[11px] font-bold text-amber-200">
              C
            </div>
            <div>
              <p className="text-[13px] font-semibold text-amber-100/90">Ask Chimmy</p>
              <p className="text-[9px] text-[#5c6480]">Uses structured trend payload only</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {['Why is this player rising?', 'Waiver or watch?', 'Sell-high candidates?'].map((q) => (
              <Link
                key={q}
                href={getChimmyChatHrefWithPrompt(q, data?.chimmyPayload ?? { source: 'trending_players' })}
                className="rounded-[6px] border border-[#3d4460] bg-[#242838] px-2 py-1 text-[10px] text-[#9ba3bf] no-underline hover:border-[#5c6480] hover:text-[#e8eaf6]"
              >
                {q}
              </Link>
            ))}
          </div>
        </div>
      </AIToolModalShell>

      {/* Detail drawer */}
      {detail ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
          <button type="button" className="absolute inset-0 bg-black/70" aria-label="Close" onClick={() => setDetail(null)} />
          <div className="relative m-4 max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-[#0a1228] p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-2">
              <div className="flex gap-3">
                {detail.headshotUrl ? (
                  <Image
                    src={detail.headshotUrl}
                    alt=""
                    width={56}
                    height={56}
                    className="h-14 w-14 rounded-full border border-white/10 object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-[#161b22] text-[14px] font-bold text-white/50">
                    {detail.name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-[16px] font-bold text-white">{detail.name}</p>
                  <p className="text-[11px] text-white/45">
                    {detail.position} · {detail.team}
                    {sportFilter === 'ALL' || String(detail.sport) !== sportFilter ? (
                      <span className="ml-1 rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-200/80">
                        {detail.sport}
                      </span>
                    ) : null}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="rounded-lg border border-white/10 p-1 text-white/50 hover:text-white/80"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {detail.injuryStatus ? (
              <p className="mt-2 text-[12px] text-amber-200/90">Injury: {detail.injuryStatus}</p>
            ) : null}
            {detail.isRookie ? (
              <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-sky-200/80">Rookie / prospect</p>
            ) : null}
            {detail.actionRecommendation ? (
              <p className="mt-2 text-[11px] text-cyan-100/90">
                <span className="text-[#5c6480]">Suggested action · </span>
                {ACTION_LABEL[detail.actionRecommendation] ?? detail.actionRecommendation}
              </p>
            ) : null}
            {detail.leagueRelevance ? (
              <p className="mt-1 text-[10px] leading-snug text-[#7a849e]">
                {RELEVANCE_LABEL[detail.leagueRelevance] ?? detail.leagueRelevance}
              </p>
            ) : null}
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg border border-white/[0.06] bg-[#161b22] px-2 py-1.5">
                <span className="text-[#5c6480]">Δ</span>{' '}
                <span className="font-mono font-bold text-white/90">{detail.trendDelta}</span>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-[#161b22] px-2 py-1.5">
                <span className="text-[#5c6480]">Confidence</span>{' '}
                <span className="font-mono font-bold text-white/90">{detail.confidence}%</span>
              </div>
              {detail.projectedFantasyPoints != null && Number.isFinite(detail.projectedFantasyPoints) ? (
                <div className="rounded-lg border border-white/[0.06] bg-[#161b22] px-2 py-1.5">
                  <span className="text-[#5c6480]">Proj (league)</span>{' '}
                  <span className="font-mono font-bold text-cyan-200/90">{detail.projectedFantasyPoints}</span>
                </div>
              ) : null}
              {detail.rosteredPct != null ? (
                <div className="rounded-lg border border-white/[0.06] bg-[#161b22] px-2 py-1.5">
                  <span className="text-[#5c6480]">Rostered</span>{' '}
                  <span className="font-mono font-bold text-white/90">{detail.rosteredPct}%</span>
                </div>
              ) : null}
            </div>
            {detail.structuredWhy?.length ? (
              <div className="mt-3 rounded-lg border border-white/[0.06] bg-[#0b1020]/80 px-3 py-2">
                <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-[#5c6480]">Why (structured)</p>
                <ul className="list-inside list-disc space-y-1 text-[11px] leading-relaxed text-white/75">
                  {detail.structuredWhy.map((line, i) => (
                    <li key={`${i}-${line.slice(0, 32)}`}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="mt-3 text-[12px] leading-relaxed text-white/70">{detail.snippet}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {detail.chips.map((c) => (
                <span
                  key={c}
                  className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-100/80"
                >
                  {c}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-white/35">Sources: {detail.sources.join(' · ')}</p>
            <p className="mt-1 text-[10px] text-white/35">{detail.dataFreshness}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={getChimmyChatHrefWithPrompt(
                  `Analyze ${detail.name} trend in context`,
                  { ...(data?.chimmyPayload ?? {}), focusPlayer: detail },
                )}
                className="inline-flex items-center gap-1 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-100 no-underline"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Ask Chimmy
              </Link>
              {(detail.integrationHints?.waiverWire ?? true) ? (
                <button
                  type="button"
                  onClick={() =>
                    openDashboardAiTool({
                      tool: 'waiver',
                      waiverJump: { name: detail.name, position: detail.position },
                    })
                  }
                  className="inline-flex items-center gap-1 rounded-lg border border-[#2e3347] px-3 py-1.5 text-[11px] text-[#9ba3bf] hover:border-[#5c6480]"
                >
                  Waiver Wire
                  <ExternalLink className="h-3 w-3 opacity-50" />
                </button>
              ) : null}
              {(detail.integrationHints?.tradeValue ?? true) ? (
                <button
                  type="button"
                  onClick={() => {
                    const { platformId } = parseTrendPlayerId(detail.playerId)
                    openDashboardAiTool({
                      tool: 'trade',
                      tradePrefillGive: {
                        name: detail.name,
                        playerId: platformId,
                        sportHint: String(detail.sport),
                      },
                    })
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-[#2e3347] px-3 py-1.5 text-[11px] text-[#9ba3bf] hover:border-[#5c6480]"
                >
                  Trade Value
                  <ExternalLink className="h-3 w-3 opacity-50" />
                </button>
              ) : null}
              {(detail.integrationHints?.injuryImpact ?? Boolean(detail.injuryStatus?.trim())) ? (
                <button
                  type="button"
                  onClick={() =>
                    openDashboardAiTool({
                      tool: 'injury',
                      injuryFocusName: detail.name,
                    })
                  }
                  className="inline-flex items-center gap-1 rounded-lg border border-[#2e3347] px-3 py-1.5 text-[11px] text-[#9ba3bf] hover:border-[#5c6480]"
                >
                  Injury Impact
                  <ExternalLink className="h-3 w-3 opacity-50" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => openDashboardAiTool({ tool: 'warRoom' })}
                className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/25 bg-cyan-500/5 px-3 py-1.5 text-[11px] text-cyan-100/90 hover:border-cyan-400/40"
              >
                AF War Room
                <ExternalLink className="h-3 w-3 opacity-50" />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function TrendColumn({
  title,
  accent,
  icon,
  players,
  sportFilter,
  onSelect,
}: {
  title: string
  accent: 'emerald' | 'red'
  icon: React.ReactNode
  players: TrendPlayerCard[]
  sportFilter: SportFilter
  onSelect: (p: TrendPlayerCard) => void
}) {
  const border = accent === 'emerald' ? 'border-emerald-500/20 bg-emerald-500/[0.03]' : 'border-red-500/20 bg-red-500/[0.03]'
  const text = accent === 'emerald' ? 'text-emerald-300' : 'text-red-300'
  return (
    <div className={`rounded-xl border ${border} p-3`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className={`flex items-center gap-1.5 ${text}`}>
          {icon}
          <p className="text-[10px] font-bold uppercase tracking-widest">{title}</p>
        </div>
        <span className="rounded-md bg-white/[0.04] px-2 py-0.5 text-[9px] font-bold text-white/40">{players.length}</span>
      </div>
      <div className="space-y-2">
        {players.map((p) => (
          <button
            key={`${p.playerId}-${p.rank}`}
            type="button"
            onClick={() => onSelect(p)}
            className="w-full rounded-lg border border-white/[0.06] bg-[#0b1020]/80 p-2.5 text-left transition hover:border-amber-500/25"
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 w-5 text-[10px] font-black tabular-nums text-white/30">{p.rank}</span>
              {p.headshotUrl ? (
                <Image
                  src={p.headshotUrl}
                  alt=""
                  width={36}
                  height={36}
                  className="h-9 w-9 shrink-0 rounded-full border border-white/10 object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-[#161b22] text-[10px] font-bold text-white/40">
                  {p.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[12px] font-bold text-white/90">{p.name}</p>
                  {accent === 'emerald' ? (
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-emerald-400/90" />
                  ) : (
                    <ArrowDownRight className="h-3.5 w-3.5 shrink-0 text-red-400/90" />
                  )}
                </div>
                <p className="truncate text-[10px] text-white/40">
                  {p.position} · {p.team}
                  {sportFilter === 'ALL' ? (
                    <span className="ml-1 rounded bg-white/[0.06] px-1 text-[8px] font-bold uppercase text-amber-200/70">
                      {p.sport}
                    </span>
                  ) : null}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span
                    className={`font-mono text-[11px] font-black tabular-nums ${accent === 'emerald' ? 'text-emerald-300' : 'text-red-300'}`}
                  >
                    {p.trendDelta > 0 ? '+' : ''}
                    {p.trendDelta}
                  </span>
                  <span className="text-[9px] text-white/35">· {p.confidence}% conf</span>
                  {p.projectedFantasyPoints != null && Number.isFinite(p.projectedFantasyPoints) ? (
                    <span className="text-[9px] text-cyan-200/70">· ~{p.projectedFantasyPoints} proj</span>
                  ) : null}
                  {p.rosteredPct != null ? (
                    <span className="text-[9px] text-white/35">· {p.rosteredPct}% rost</span>
                  ) : null}
                  {p.actionRecommendation ? (
                    <span className="text-[8px] font-bold uppercase tracking-wide text-cyan-200/75">
                      · {ACTION_LABEL[p.actionRecommendation] ?? p.actionRecommendation}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-white/45">{p.snippet}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {p.chips.slice(0, 2).map((c) => (
                    <span
                      key={c}
                      className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-amber-200/70"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
