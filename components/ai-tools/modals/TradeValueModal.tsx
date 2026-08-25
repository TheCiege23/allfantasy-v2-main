'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  ArrowUp,
  GripVertical,
  Loader2,
  Minus,
  Plus,
  Scale,
  Sparkles,
  User,
  X,
} from 'lucide-react'
import type { UserLeague } from '@/app/dashboard/types'
import { AIToolModalShell } from '../AIToolModalShell'
import { getChimmyChatHrefWithPrompt } from '@/lib/ai-product-layer/UnifiedChimmyEntryResolver'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import { buildLeagueFormatLabel } from '@/lib/leagues/leagueFormatLabel'

type SportFilter = 'ALL' | (typeof SUPPORTED_SPORTS)[number]

type Strategy = 'contender' | 'rebuilder' | 'win_now' | 'long_term' | 'neutral'
type TeamCtx = 'my_team' | 'team_a' | 'team_b' | 'neutral'
type AnalysisTab = 'raw' | 'fit' | 'risk' | 'outlook' | 'rebalance'

type SideRow =
  | { key: string; kind: 'player'; playerId?: string | null; name: string; sportHint?: string }
  | { key: string; kind: 'pick'; year: number; round: number; tier?: 'early' | 'mid' | 'late' }
  | { key: string; kind: 'faab'; amount: number }

type TradeConsolePlayerLine = {
  name: string
  playerId: string | null
  composite: number
  marketValue: number
  injuryStatus: string | null
  position: string
  team: string
}

type SearchHit = {
  kind: 'player'
  sport: string
  playerId: string | null
  name: string
  position: string
  team: string
  headshotUrl?: string | null
}

function newKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
}

function emptyPlayerRow(): SideRow {
  return { key: newKey(), kind: 'player', name: '' }
}

/** Explicit global: valuations without a league (API receives leagueId: null). */
const GLOBAL_TRADE = '__af_global_trade__'

export function TradeValueModal({
  open,
  onClose,
  leagues,
  initialLeagueId = '',
  initialSport = 'NFL',
  initialPrefillGivePlayer = null,
}: {
  open: boolean
  onClose: () => void
  leagues: UserLeague[]
  initialLeagueId?: string
  initialSport?: string
  /** When opening from Trending, seed the "give" side with a named player. */
  initialPrefillGivePlayer?: { name: string; playerId?: string | null; sportHint?: string } | null
}) {
  const [sportFilter, setSportFilter] = useState<SportFilter>('ALL')
  const [leagueId, setLeagueId] = useState<string>('')
  const [strategy, setStrategy] = useState<Strategy>('neutral')
  const [teamContext, setTeamContext] = useState<TeamCtx>('neutral')
  const [tab, setTab] = useState<AnalysisTab>('raw')
  const [give, setGive] = useState<SideRow[]>([emptyPlayerRow()])
  const [getRows, setGetRows] = useState<SideRow[]>([emptyPlayerRow()])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [searchGive, setSearchGive] = useState<SearchHit[]>([])
  const [searchGet, setSearchGet] = useState<SearchHit[]>([])
  const [searchLoading, setSearchLoading] = useState<'give' | 'get' | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [leagueTeams, setLeagueTeams] = useState<
    Array<{ externalId: string; teamName: string; ownerName: string; isYou?: boolean }>
  >([])
  const [opponentTeamExternalId, setOpponentTeamExternalId] = useState('')
  const [teamsLoading, setTeamsLoading] = useState(false)
  const prefillGiveConsumed = useRef(false)

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
      setLoading(false)
      prefillGiveConsumed.current = false
    }
  }, [open])

  useEffect(() => {
    if (!open || !initialPrefillGivePlayer?.name?.trim() || prefillGiveConsumed.current) return
    prefillGiveConsumed.current = true
    const n = initialPrefillGivePlayer.name.trim()
    setGive([
      {
        key: newKey(),
        kind: 'player',
        name: n,
        playerId: initialPrefillGivePlayer.playerId ?? undefined,
        sportHint: initialPrefillGivePlayer.sportHint,
      },
    ])
  }, [open, initialPrefillGivePlayer])

  const isGlobalLeague = !leagueId || leagueId === GLOBAL_TRADE
  const effectiveLeagueId = isGlobalLeague ? null : leagueId

  useEffect(() => {
    if (!effectiveLeagueId) {
      setLeagueTeams([])
      setOpponentTeamExternalId('')
      return
    }
    let cancelled = false
    setTeamsLoading(true)
    fetch(`/api/trade-value/league-teams?leagueId=${encodeURIComponent(effectiveLeagueId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.teams) return
        const teams = j.teams as Array<{
          externalId: string
          teamName: string
          ownerName: string
          isYou?: boolean
        }>
        setLeagueTeams(teams)
        const firstOpp = teams.find((t) => !t.isYou)
        setOpponentTeamExternalId((prev) => (prev && teams.some((t) => t.externalId === prev) ? prev : firstOpp?.externalId ?? ''))
      })
      .catch(() => {
        if (!cancelled) setLeagueTeams([])
      })
      .finally(() => {
        if (!cancelled) setTeamsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [effectiveLeagueId])

  useEffect(() => {
    if (effectiveLeagueId && leagues.some((l) => l.id === effectiveLeagueId)) {
      setTeamContext('my_team')
    }
  }, [effectiveLeagueId, leagues])

  const selectedLeague = useMemo(
    () => (effectiveLeagueId ? leagues.find((l) => l.id === effectiveLeagueId) ?? null : null),
    [leagues, effectiveLeagueId],
  )

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
    if (!leagueId || leagueId === GLOBAL_TRADE) return
    if (!filteredLeagues.some((l) => l.id === leagueId)) setLeagueId('')
  }, [sportFilter, leagueId, filteredLeagues])

  const formatLine = useMemo(() => {
    if (!selectedLeague) return 'General analysis'
    return buildLeagueFormatLabel({
      format: selectedLeague.format,
      scoring: selectedLeague.scoring,
      isDynasty: selectedLeague.isDynasty,
      leagueVariant: selectedLeague.leagueVariant,
      teamCount: selectedLeague.teamCount,
      season: selectedLeague.season,
    })
  }, [selectedLeague])

  const tePremium = Boolean(
    selectedLeague?.settings &&
      typeof selectedLeague.settings === 'object' &&
      (selectedLeague.settings as { tePremium?: number }).tePremium,
  )
  const isSuperFlex = Boolean(
    selectedLeague?.settings &&
      typeof selectedLeague.settings === 'object' &&
      (selectedLeague.settings as { superflex?: boolean }).superflex,
  )

  const searchSportParam = sportFilter === 'ALL' ? 'ALL' : sportFilter

  const runSearch = useCallback(
    async (side: 'give' | 'get', q: string) => {
      if (q.trim().length < 2) {
        if (side === 'give') setSearchGive([])
        else setSearchGet([])
        return
      }
      setSearchLoading(side)
      try {
        const r = await fetch(
          `/api/trade-value/player-search?q=${encodeURIComponent(q)}&sport=${encodeURIComponent(searchSportParam)}`,
          { cache: 'no-store' },
        )
        const j = (await r.json()) as SearchHit[]
        if (side === 'give') setSearchGive(Array.isArray(j) ? j : [])
        else setSearchGet(Array.isArray(j) ? j : [])
      } catch {
        if (side === 'give') setSearchGive([])
        else setSearchGet([])
      } finally {
        setSearchLoading(null)
      }
    },
    [searchSportParam],
  )

  const toPayload = useCallback(() => {
    const mapRow = (r: SideRow): Record<string, unknown> | null => {
      if (r.kind === 'player') {
        const n = r.name.trim()
        if (!n && !r.playerId) return null
        return {
          kind: 'player',
          playerId: r.playerId ?? undefined,
          name: n || undefined,
          sportHint: r.sportHint ?? (sportFilter !== 'ALL' ? sportFilter : undefined),
        }
      }
      if (r.kind === 'pick') return { kind: 'pick', year: r.year, round: r.round, tier: r.tier }
      return { kind: 'faab', amount: r.amount }
    }
    const g = give.map(mapRow).filter(Boolean) as Record<string, unknown>[]
    const t = getRows.map(mapRow).filter(Boolean) as Record<string, unknown>[]
    return { g, t }
  }, [give, getRows, sportFilter])

  const canRunTrade = useMemo(() => {
    if (isGlobalLeague && sportFilter === 'ALL') return false
    return true
  }, [isGlobalLeague, sportFilter])

  const analyze = useCallback(async () => {
    const { g, t } = toPayload()
    if (g.length === 0 || t.length === 0) {
      setError('Add at least one priced asset on each side.')
      return
    }
    if (!canRunTrade) {
      setError('Select a specific sport for global trade mode, or choose a league.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const body = {
        sportFilter,
        leagueId: effectiveLeagueId,
        leagueSize: selectedLeague?.teamCount,
        tePremium: tePremium || undefined,
        isSuperFlex: isSuperFlex || undefined,
        waiverBudget: (selectedLeague?.settings as { waiverBudget?: number } | undefined)?.waiverBudget,
        strategy,
        teamContext,
        analysisTab: tab,
        sideGive: g,
        sideGet: t,
        opponentTeamExternalId: opponentTeamExternalId || null,
      }
      const r = await fetch('/api/trade-value/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) {
        setError((j as { error?: string }).error || 'Analysis failed')
        setResult(null)
        return
      }
      setResult(j as Record<string, unknown>)
    } catch {
      setError('Network error')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [
    toPayload,
    sportFilter,
    leagueId,
    selectedLeague,
    tePremium,
    isSuperFlex,
    strategy,
    teamContext,
    tab,
    opponentTeamExternalId,
    effectiveLeagueId,
    canRunTrade,
  ])

  useEffect(() => {
    if (!detailId) {
      setDetail(null)
      return
    }
    let cancelled = false
    fetch(`/api/trade-value/player-detail?id=${encodeURIComponent(detailId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j) setDetail(j as Record<string, unknown>)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [detailId])

  const fairnessScore = typeof result?.fairnessScore === 'number' ? result.fairnessScore : null
  const labels = result?.labels as { fairnessLabel?: string; confidenceLabel?: string } | undefined
  const secondary = result?.secondary as Record<string, unknown> | undefined
  const evaluation = result?.evaluation as { bullets?: string[]; sensitivity?: string } | undefined
  const chimmyPayload = result?.chimmyPayload as Record<string, unknown> | undefined
  const rosterSummary = result?.rosterSummary as
    | {
        lineupSimulation?: boolean
        yourRosterPlayers?: number
        theirRosterPlayers?: number
      }
    | undefined

  const giveTotalNum = typeof result?.giveTotal === 'number' ? result.giveTotal : null
  const getTotalNum = typeof result?.getTotal === 'number' ? result.getTotal : null
  const toolkit = result?.negotiationToolkit as
    | {
        counters?: Array<{ id?: string; description?: string }>
        sweeteners?: Array<{ suggestion?: string }>
      }
    | undefined

  const tradeIntelligence = result?.tradeIntelligence as
    | {
        fairnessVerdict?: string
        confidenceScore?: number
        whoWinsNow?: string
        whoWinsLongTerm?: string
        contenderRecommendation?: string
        rebuilderRecommendation?: string
        tradeWarnings?: string[]
        rebalanceSuggestions?: string[]
        alternateTargetsNote?: string
        alternateTargets?: Array<{ name: string; marketValue: number; position?: string | null }>
        why?: string
        projectedImpact?: {
          giveTotal: number | null
          getTotal: number | null
          net: number | null
          summary: string
        }
        leagueReasoning?: string
        teamReasoning?: string
        leagueHistoryNote?: string | null
        syncedDataHighlights?: string[]
      }
    | undefined

  const summaryLineRes = typeof result?.summaryLine === 'string' ? result.summaryLine : null
  const timeCtx = result?.timeContext as
    | { userLocalTime?: string; userTimezone?: string; timezoneMismatch?: boolean }
    | undefined

  const formatModes = ['REDRAFT', 'DYNASTY', 'KEEPER', 'ZOMBIE', 'SURVIVOR'] as const
  const activeFormat = useMemo(() => {
    if (!selectedLeague) return 'REDRAFT'
    const v = (selectedLeague.leagueVariant || '').toLowerCase()
    if (v.includes('zombie')) return 'ZOMBIE'
    if (selectedLeague.isDynasty) return 'DYNASTY'
    if (v.includes('survivor')) return 'SURVIVOR'
    if (v.includes('keeper') || v === 'keeper') return 'KEEPER'
    return 'REDRAFT'
  }, [selectedLeague])

  const headerActions = (
    <button
      type="button"
      onClick={() => analyze()}
      disabled={loading || !canRunTrade}
      className="rounded-lg border border-purple-400/30 bg-purple-500/15 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-purple-200 transition hover:bg-purple-500/25 disabled:opacity-40"
    >
      {loading ? <Loader2 className="inline h-3 w-3 animate-spin" /> : 'Run analysis'}
    </button>
  )

  return (
    <AIToolModalShell
      open={open}
      onClose={onClose}
      title="Trade Value"
      subtitle="Analytical evaluation console"
      accentColor="purple"
      icon={<ArrowLeftRight className="h-5 w-5" />}
      wide
      headerBadge={
        <span className="flex flex-wrap items-center gap-1">
          <span
            className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
              (result?.analysisMode as string) === 'global' || isGlobalLeague
                ? 'border-amber-500/35 bg-amber-500/10 text-amber-100'
                : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
            }`}
          >
            {(result?.analysisMode as string) === 'global' || isGlobalLeague ? 'Global' : 'League'}
          </span>
          <span className="at-api-pill at-api-pill--live text-[9px] font-semibold uppercase tracking-wide">
            Live data
          </span>
          {(() => {
            const sf = result?.sourceFlags as
              | {
                  fantasyCalcReady?: boolean
                  sportsDataReady?: boolean
                  projectionLayerReady?: boolean
                  injuryNewsLayerReady?: boolean
                  leagueScoringApplied?: boolean
                  aiEnvelopeReady?: boolean
                }
              | undefined
            if (!sf) {
              return (
                <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#8b9dc8]">
                  FantasyCalc · DB
                </span>
              )
            }
            const chipBase =
              'rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide'
            const green = 'bg-emerald-500/15 text-emerald-200'
            const dim = 'bg-white/5 text-white/35'
            const amber = 'bg-amber-500/12 text-amber-100/90'
            return (
              <>
                <span
                  title={sf.fantasyCalcReady ? 'FantasyCalc valuations active' : 'FantasyCalc unavailable for this sport'}
                  className={`${chipBase} ${sf.fantasyCalcReady ? green : dim}`}
                >
                  FC
                </span>
                <span
                  title={sf.sportsDataReady ? 'All assets resolved to sports_players rows' : 'Some assets missing DB rows'}
                  className={`${chipBase} ${sf.sportsDataReady ? green : dim}`}
                >
                  Data
                </span>
                <span
                  title={sf.projectionLayerReady ? 'Projection engine attached' : 'No projections merged'}
                  className={`${chipBase} ${sf.projectionLayerReady ? green : dim}`}
                >
                  Proj
                </span>
                <span
                  title={sf.injuryNewsLayerReady ? 'Injury/news signals attached' : 'No injury/news signals for these players'}
                  className={`${chipBase} ${sf.injuryNewsLayerReady ? green : dim}`}
                >
                  News
                </span>
                <span
                  title={sf.leagueScoringApplied ? 'League scoring rules applied' : 'League scoring not applied'}
                  className={`${chipBase} ${sf.leagueScoringApplied ? green : amber}`}
                >
                  {sf.leagueScoringApplied ? 'Scoring' : 'No lg scoring'}
                </span>
                <span
                  title={sf.aiEnvelopeReady ? 'AI context envelope ready' : 'AI envelope missing'}
                  className={`${chipBase} ${sf.aiEnvelopeReady ? green : dim}`}
                >
                  AI
                </span>
              </>
            )
          })()}
        </span>
      }
      showApiPills={false}
      loading={false}
      error={null}
      onRefresh={analyze}
      refreshing={loading && !!result}
      actions={headerActions}
      chimmyPrompt={
        chimmyPayload
          ? 'Explain this trade evaluation with Chimmy using the attached structured context.'
          : 'Open Chimmy for trade help'
      }
      chimmyContext={chimmyPayload ?? { source: 'trade_value_modal' }}
    >
      {error ? (
        <div className="mb-3 rounded-[10px] border border-[#f06060]/25 bg-[rgba(240,96,96,0.08)] px-3 py-2 text-[12px] text-[#f08080]">
          {error}
        </div>
      ) : null}

      {summaryLineRes ? (
        <p className="mb-2 text-[11px] leading-snug text-sky-200/90">{summaryLineRes}</p>
      ) : null}
      {timeCtx?.userLocalTime ? (
        <p className="mb-3 text-[10px] text-[#5c6480]">
          Local {timeCtx.userLocalTime} ({timeCtx.userTimezone ?? '—'})
          {timeCtx.timezoneMismatch ? <span className="text-amber-200/90"> · device TZ ≠ account TZ</span> : null}
        </p>
      ) : null}

      {/* Global filters — Sport / League / Week */}
      <div className="at-panel mb-3 p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="at-section-title !mb-0">Sport</span>
            <select
              value={sportFilter}
              onChange={(e) => setSportFilter(e.target.value as SportFilter)}
              className="at-select w-full px-2 py-2 text-[13px]"
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
              className="at-select w-full px-2 py-2 text-[13px]"
            >
              <option value="">—</option>
              <option value={GLOBAL_TRADE}>Global (sport-only — no league roster)</option>
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
        </div>
      </div>

      {/* League format strip (read-only signal from league metadata) */}
      <div className="mb-3 flex flex-wrap gap-1">
        {formatModes.map((m) => (
          <span
            key={m}
            className={`rounded-[6px] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
              activeFormat === m ? 'bg-[#242838] text-[#e8eaf6] ring-1 ring-[#5b8ef0]/40' : 'text-[#5c6480]'
            }`}
          >
            {m}
          </span>
        ))}
      </div>

      {/* Advanced controls */}
      <div className="mb-3 space-y-2 rounded-[10px] border border-[#2e3347] bg-[#161b22] p-2.5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {effectiveLeagueId && leagueTeams.length > 0 ? (
            <label className="flex flex-col gap-1">
              <span className="at-section-title !mb-0">Opponent (lineup context)</span>
              <select
                value={opponentTeamExternalId}
                onChange={(e) => setOpponentTeamExternalId(e.target.value)}
                disabled={teamsLoading}
                className="at-select w-full px-2 py-2 text-[12px] disabled:opacity-50"
              >
                <option value="">Auto pick first other team</option>
                {leagueTeams
                  .filter((t) => !t.isYou)
                  .map((t) => (
                    <option key={t.externalId} value={t.externalId}>
                      {t.teamName} — {t.ownerName}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
          <label className="flex flex-col gap-1">
            <span className="at-section-title !mb-0">Strategy</span>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as Strategy)}
              className="at-select w-full px-2 py-2 text-[12px]"
            >
              <option value="neutral">Neutral</option>
              <option value="contender">Contender</option>
              <option value="win_now">Win now</option>
              <option value="rebuilder">Rebuilder</option>
              <option value="long_term">Long term</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="at-section-title !mb-0">Team lens</span>
            <select
              value={teamContext}
              onChange={(e) => setTeamContext(e.target.value as TeamCtx)}
              className="at-select w-full px-2 py-2 text-[12px]"
            >
              <option value="neutral">Neutral / raw value</option>
              <option value="my_team">My team</option>
              <option value="team_a">Team A</option>
              <option value="team_b">Team B</option>
            </select>
          </label>
        </div>
        <p className="text-[10px] text-[#5c6480]">Scoring / format: {formatLine}</p>
      </div>

      {/* Analysis tabs */}
      <div className="mb-3 flex gap-1 overflow-x-auto rounded-[10px] border border-[#2e3347] bg-[#161b22] p-1 text-[10px] font-bold">
        {(
          [
            ['raw', 'Raw value'],
            ['fit', 'Team fit'],
            ['risk', 'Risk'],
            ['outlook', 'Outlook'],
            ['rebalance', 'Rebalance'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`shrink-0 rounded-[8px] px-2.5 py-1.5 transition ${
              tab === id ? 'bg-[#242838] text-[#a78bfa] ring-1 ring-[#a78bfa]/35' : 'text-[#5c6480] hover:text-[#9ba3bf]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* You give vs You get */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
        <TradeColumn
          label="You give"
          accent="purple"
          rows={give}
          searchHits={searchGive}
          searchLoading={searchLoading === 'give'}
          onSearch={(q) => runSearch('give', q)}
          onChange={setGive}
          onPickPlayer={(index, hit) => {
            setGive((rows) =>
              rows.map((r, j) =>
                j === index && r.kind === 'player'
                  ? { ...r, name: hit.name, playerId: hit.playerId, sportHint: hit.sport }
                  : r,
              ),
            )
            setSearchGive([])
          }}
        />
        <div className="hidden h-full min-h-[100px] flex-col items-center justify-center sm:flex">
          <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[#2e3347] bg-[#161b22] text-[10px] font-black tracking-tight text-[#5c6480]">
            VS
          </div>
        </div>
        <TradeColumn
          label="You get"
          accent="cyan"
          rows={getRows}
          searchHits={searchGet}
          searchLoading={searchLoading === 'get'}
          onSearch={(q) => runSearch('get', q)}
          onChange={setGetRows}
          onPickPlayer={(index, hit) => {
            setGetRows((rows) =>
              rows.map((r, j) =>
                j === index && r.kind === 'player'
                  ? { ...r, name: hit.name, playerId: hit.playerId, sportHint: hit.sport }
                  : r,
              ),
            )
            setSearchGet([])
          }}
        />
      </div>

      {(giveTotalNum != null || getTotalNum != null) && (
        <div className="mt-2 grid grid-cols-2 gap-2 border-t border-[#2e3347] pt-3">
          <div className="text-right">
            <p className="at-section-title !mb-0">Total value (give)</p>
            <p className="text-[18px] font-black tabular-nums text-[#f08080]">{giveTotalNum ?? '—'}</p>
          </div>
          <div>
            <p className="at-section-title !mb-0">Total value (get)</p>
            <p className="text-[18px] font-black tabular-nums text-[#00d4aa]">{getTotalNum ?? '—'}</p>
          </div>
        </div>
      )}

      {/* Fairness + gauge */}
      <div className="at-panel mt-4 border-[#00d4aa]/20 bg-[rgba(0,212,170,0.05)] px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-[#00d4aa]" />
            <p className="mb-0 text-[11px] font-semibold uppercase tracking-wider text-[#5c6480]">Fairness</p>
          </div>
          <p className="text-[20px] font-black tabular-nums text-[#00d4aa]">
            {fairnessScore != null ? fairnessScore : '—'}
            <span className="text-[11px] font-bold text-[#5c6480]">/100</span>
          </p>
        </div>
        <div className="relative mt-4">
          <div className="mb-1 flex justify-between text-[9px] font-bold uppercase tracking-wide text-[#5c6480]">
            <span>LOPSIDED</span>
            <span className="text-[#9ba3bf]">EVEN</span>
            <span>LOPSIDED</span>
          </div>
          <div className="relative h-2 rounded-full bg-[#2e3347]">
            <div
              className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#0b0e14] bg-[#00d4aa] shadow-[0_0_12px_rgba(0,212,170,0.45)]"
              style={{ left: `${Math.min(100, Math.max(0, fairnessScore ?? 50))}%` }}
            />
          </div>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-[#9ba3bf]">
          <span className="font-semibold text-[#00d4aa]">{labels?.fairnessLabel ?? 'Run analysis to score this deal.'}</span>{' '}
          {labels?.confidenceLabel ? <span className="text-[#5c6480]">· {labels.confidenceLabel}</span> : null}
        </p>
        {rosterSummary?.lineupSimulation ? (
          <p className="mt-2 text-[10px] text-[#5c6480]">
            Lineup context: {rosterSummary.yourRosterPlayers ?? 0} your roster players priced,{' '}
            {rosterSummary.theirRosterPlayers ?? 0} opponent.
          </p>
        ) : result && effectiveLeagueId ? (
          <p className="mt-2 text-[10px] text-[#5c6480]">No synced roster — value-only (no lineup simulation).</p>
        ) : null}
      </div>

      {tradeIntelligence ? (
        <div
          className="at-panel mt-4 border border-sky-500/20 bg-[rgba(56,189,248,0.04)] px-4 py-4"
          data-testid="trade-value-ai-intelligence"
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4 text-sky-300/90" />
            <p className="mb-0 text-[11px] font-semibold uppercase tracking-wider text-sky-200/90">
              Trade Value AI engine
            </p>
            {typeof tradeIntelligence.confidenceScore === 'number' ? (
              <span className="rounded-md border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-sky-100/90">
                Confidence {tradeIntelligence.confidenceScore}%
              </span>
            ) : null}
          </div>
          <p className="text-[13px] leading-relaxed text-[#c8d4f0]">{tradeIntelligence.fairnessVerdict}</p>
          {tradeIntelligence.why ? (
            <p className="mt-3 text-[12px] leading-relaxed text-[#b0bdd8]" data-testid="trade-value-why-summary">
              {tradeIntelligence.why}
            </p>
          ) : null}
          {tradeIntelligence.projectedImpact &&
          (tradeIntelligence.projectedImpact.giveTotal != null ||
            tradeIntelligence.projectedImpact.getTotal != null) ? (
            <div
              className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.05] px-3 py-2"
              data-testid="trade-value-projection-impact"
            >
              <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-cyan-200/80">
                League-scored weekly projection stack
              </p>
              <p className="text-[11px] leading-snug text-[#a8c4d8]">
                Give ~{tradeIntelligence.projectedImpact.giveTotal ?? '—'} · Get ~
                {tradeIntelligence.projectedImpact.getTotal ?? '—'} · Net{' '}
                {tradeIntelligence.projectedImpact.net != null
                  ? `${tradeIntelligence.projectedImpact.net >= 0 ? '+' : ''}${tradeIntelligence.projectedImpact.net}`
                  : '—'}
              </p>
            </div>
          ) : null}
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-white/[0.08] bg-[#0a1228]/80 px-3 py-2">
              <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-[#5c6480]">Who wins now</p>
              <p className="text-[14px] font-bold text-[#e8eaf6]">
                {tradeIntelligence.whoWinsNow === 'you'
                  ? 'You (proj-first when available)'
                  : tradeIntelligence.whoWinsNow === 'opponent'
                    ? 'Opponent (proj-first when available)'
                    : 'Even / mixed'}
              </p>
            </div>
            <div className="rounded-lg border border-white/[0.08] bg-[#0a1228]/80 px-3 py-2">
              <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-[#5c6480]">Who wins long term</p>
              <p className="text-[14px] font-bold text-[#e8eaf6]">
                {tradeIntelligence.whoWinsLongTerm === 'you'
                  ? 'You (framework lean)'
                  : tradeIntelligence.whoWinsLongTerm === 'opponent'
                    ? 'Opponent (framework lean)'
                    : 'Even / close'}
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/[0.06] px-3 py-2">
              <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-emerald-200/70">Contender read</p>
              <p className="text-[12px] leading-snug text-[#c8e6d8]">{tradeIntelligence.contenderRecommendation}</p>
            </div>
            <div className="rounded-lg border border-violet-500/15 bg-violet-500/[0.06] px-3 py-2">
              <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-violet-200/70">Rebuilder read</p>
              <p className="text-[12px] leading-snug text-[#d8cff5]">{tradeIntelligence.rebuilderRecommendation}</p>
            </div>
          </div>
          {tradeIntelligence.tradeWarnings && tradeIntelligence.tradeWarnings.length > 0 ? (
            <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2">
              <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-amber-200/80">Warnings</p>
              <ul className="list-inside list-disc space-y-1 text-[11px] text-amber-50/90">
                {tradeIntelligence.tradeWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {tradeIntelligence.rebalanceSuggestions && tradeIntelligence.rebalanceSuggestions.length > 0 ? (
            <div className="mt-3 rounded-lg border border-[#a78bfa]/25 bg-[#a78bfa]/[0.06] px-3 py-2">
              <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-[#c4b5fd]">Rebalance ideas</p>
              <ul className="list-inside list-disc space-y-1 text-[11px] text-[#e8e0ff]">
                {tradeIntelligence.rebalanceSuggestions.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {tradeIntelligence.alternateTargets && tradeIntelligence.alternateTargets.length > 0 ? (
            <div className="mt-3 rounded-lg border border-white/[0.08] bg-[#0a1228]/80 px-3 py-2">
              <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-[#5c6480]">
                Alternate counter targets (their roster)
              </p>
              <ul className="list-none space-y-1 text-[11px] text-[#9eb0d0]">
                {tradeIntelligence.alternateTargets.map((t, i) => (
                  <li key={`${t.name}-${i}`}>
                    {t.name}
                    {t.position ? ` (${t.position})` : ''} — ~{t.marketValue}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {tradeIntelligence.alternateTargetsNote ? (
            <p className="mt-3 text-[11px] leading-relaxed text-[#8b9dc8]">{tradeIntelligence.alternateTargetsNote}</p>
          ) : null}
          {tradeIntelligence.syncedDataHighlights && tradeIntelligence.syncedDataHighlights.length > 0 ? (
            <div className="mt-3 rounded-lg border border-sky-500/15 bg-[#0a1228]/90 px-3 py-2">
              <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-sky-200/75">
                Synced league data
              </p>
              <ul className="list-inside list-disc space-y-1 text-[11px] text-[#a8b8d8]">
                {tradeIntelligence.syncedDataHighlights.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-3 space-y-2 border-t border-white/[0.06] pt-3">
            <p className="text-[11px] leading-relaxed text-[#9ba3bf]">
              <span className="font-semibold text-[#8b9dc8]">League:</span> {tradeIntelligence.leagueReasoning}
            </p>
            <p className="text-[11px] leading-relaxed text-[#9ba3bf]">
              <span className="font-semibold text-[#8b9dc8]">Team lens:</span> {tradeIntelligence.teamReasoning}
            </p>
            {tradeIntelligence.leagueHistoryNote ? (
              <p className="text-[11px] leading-relaxed text-[#7a849e]">
                <span className="font-semibold text-[#8b9dc8]">Trade archive:</span> {tradeIntelligence.leagueHistoryNote}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {toolkit?.counters && toolkit.counters.length > 0 ? (
        <div className="at-panel mt-3 p-3">
          <p className="at-section-title mb-2">Rebalance</p>
          <p className="mb-2 text-[11px] text-[#5c6480]">Players / pieces to adjust to even the deal:</p>
          <ul className="list-none space-y-2">
            {toolkit.counters.slice(0, 5).map((c, i) => (
              <li key={c.id ?? `c-${i}`} className="border-l-2 border-[#a78bfa]/50 pl-2 text-[12px] text-[#9ba3bf]">
                {c.description}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Secondary cards */}
      {secondary ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MiniCard title="Raw Δ" value={`${(secondary.rawValue as { deltaPct?: number })?.deltaPct ?? '—'}%`} />
          <MiniCard title="Contender" value={`${(secondary.contenderScore as number) ?? '—'}`} />
          <MiniCard title="Rebuilder" value={`${(secondary.rebuilderScore as number) ?? '—'}`} />
          <MiniCard
            title="Injury"
            lineOnly
            line={(secondary.injuryImpact as { note?: string })?.note ?? '—'}
          />
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-4 text-center text-[11px] text-white/35">
          Add players, picks, or FAAB, then run analysis. Search is powered by FantasyCalc (NFL) and live sports
          player data for other sports.
        </div>
      )}

      {/* Tab body */}
      {result ? (
        <div className="mt-3 space-y-2">
          {tab === 'raw' ? (
            <Panel title="Raw value snapshot">
              <p className="text-[12px] text-white/65">
                Composite totals blend market, impact, and VORP-style value with risk discounts. Market delta ≈{' '}
                {(secondary?.rawValue as { deltaPct?: number })?.deltaPct ?? '—'}%.
              </p>
            </Panel>
          ) : null}
          {tab === 'fit' ? (
            <Panel title="Team fit">
              <p className="text-[12px] text-white/65">
                {(secondary?.teamFit as { note?: string })?.note ?? '—'}
              </p>
            </Panel>
          ) : null}
          {tab === 'risk' ? (
            <Panel title="Risk profile">
              <p className="text-[12px] text-white/65">{(secondary?.risk as { note?: string })?.note ?? '—'}</p>
            </Panel>
          ) : null}
          {tab === 'outlook' ? (
            <Panel title="Outlook">
              <p className="text-[12px] text-white/65">
                {(secondary?.shortTermOutlook as { note?: string })?.note ?? '—'}
              </p>
              <p className="mt-2 text-[12px] text-white/55">
                {(secondary?.longTermOutlook as { note?: string })?.note ?? ''}
              </p>
            </Panel>
          ) : null}
          {tab === 'rebalance' ? (
            <Panel title="Rebalance ideas">
              <p className="text-[12px] text-white/65">
                Use negotiation counters from the toolkit when available — Chimmy can phrase DM-ready language
                from the same deterministic drivers.
              </p>
            </Panel>
          ) : null}

          {evaluation?.bullets?.length ? (
            <div className="rounded-xl border border-purple-500/10 bg-purple-500/[0.03] px-4 py-3">
              <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-purple-300/70">
                Explanation
              </p>
              <ul className="list-inside list-disc space-y-1 text-[12px] text-white/70">
                {evaluation.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
              {evaluation.sensitivity ? (
                <p className="mt-2 text-[11px] text-white/45">{evaluation.sensitivity}</p>
              ) : null}
            </div>
          ) : null}

          {/*
            Bye-week collisions. ADVISORY, AND DELIBERATELY NOT PART OF THE
            VERDICT above: the value maths decides whether the deal is fair,
            this says what the maths cannot see. Trading for a quarterback who
            is off the same week as the one you already hold does not fix the
            hole it looks like it fixes -- and the manager may well take the
            deal anyway, because two years of a player of that calibre is worth
            one unstartable Sunday. The point is that they decide on purpose.
          */}
          {/*
            What this deal is worth to THIS roster, over the market price.
            The scarcity half is the point: a hole at a position with a dozen
            free agents behind it is a waiver claim, not a need. The same hole
            with an empty wire can only be filled by trading, and that is when a
            replacement-level player is genuinely worth more here than his
            market price. Two identical teams can be quoted different numbers,
            and the difference is entirely what is sitting unrostered.
          */}
          {Array.isArray(result?.needNotes) && (result.needNotes as string[]).length > 0 ? (
            <div className="rounded-xl border border-[#00d4aa]/20 bg-[#00d4aa]/[0.06] px-3 py-2 text-[11px] text-[#c9f5ec]">
              <div className="mb-1 font-semibold uppercase tracking-wide text-[10px] text-[#00d4aa]/80">
                Worth to your roster
              </div>
              {(result.needNotes as string[]).map((n) => (
                <div key={n}>{n}</div>
              ))}
            </div>
          ) : null}

          {Array.isArray(result?.byeNotes) && (result.byeNotes as string[]).length > 0 ? (
            <div className="rounded-xl border border-sky-500/20 bg-sky-500/[0.06] px-3 py-2 text-[11px] text-sky-100/90">
              <div className="mb-1 font-semibold uppercase tracking-wide text-[10px] text-sky-200/80">
                Bye weeks
              </div>
              {(result.byeNotes as string[]).map((n) => (
                <div key={n}>{n}</div>
              ))}
            </div>
          ) : null}

          {Array.isArray(result?.dataGaps) && (result.dataGaps as string[]).length > 0 ? (
            <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.05] px-3 py-2 text-[11px] text-amber-100/90">
              Data gaps: {(result.dataGaps as string[]).join(' · ')}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Player lines — tap for detail */}
      {result?.players ? (
        <PlayerBreakdown
          players={result.players as { give: TradeConsolePlayerLine[]; get: TradeConsolePlayerLine[] }}
          onOpen={(id) => setDetailId(id)}
        />
      ) : null}

      <div className="at-panel mt-4 border-[#2e3347] bg-[#161b22] p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[#a78bfa]/50 bg-[rgba(167,139,250,0.12)] text-[11px] font-bold text-[#a78bfa]">
            C
          </div>
          <div>
            <p className="text-[13px] font-semibold text-[#a78bfa]">Ask Chimmy</p>
            <p className="text-[9px] text-[#5c6480]">OpenAI · DeepSeek · Grok · Anthropic</p>
          </div>
        </div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {['Explain this trade', 'Who wins value?', 'Dynasty angle'].map((q) => (
            <Link
              key={q}
              href={getChimmyChatHrefWithPrompt(q, chimmyPayload ?? { source: 'trade_value_modal_quick' })}
              className="rounded-[6px] border border-[#3d4460] bg-[#242838] px-2 py-1 text-[10px] text-[#9ba3bf] no-underline hover:border-[#5c6480] hover:text-[#e8eaf6]"
            >
              {q}
            </Link>
          ))}
        </div>
        <p className="rounded-[8px] border border-[#2e3347] bg-[#242838] px-3 py-2 text-[12px] text-[#5c6480]">
          Ask a follow-up in full Chimmy chat — your trade payload can be attached from the bar below.
        </p>
      </div>

      {/* Detail drawer */}
      {detailId && detail ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
          <button
            type="button"
            className="absolute inset-0 bg-black/70"
            aria-label="Close"
            onClick={() => setDetailId(null)}
          />
          <div className="relative m-4 max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-[#0a1228] p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[15px] font-bold text-white">{String(detail.name)}</p>
                <p className="text-[11px] text-white/45">
                  {String(detail.team)} · {String(detail.position)} · {String(detail.sport)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailId(null)}
                className="rounded-lg border border-white/10 p-1 text-white/50 hover:text-white/80"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {detail.injuryStatus ? (
              <p className="mt-2 text-[12px] text-amber-200/90">Injury: {String(detail.injuryStatus)}</p>
            ) : null}
            <p className="mt-2 text-[10px] text-white/35">Source: {String(detail.dataSource)} · Updated {String(detail.lastUpdated)}</p>
            <LinkChimmy detail={detail} />
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={async () => {
            if (!chimmyPayload) return
            const r = await fetch('/api/trade-value/chimmy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ payload: chimmyPayload }),
            })
            const j = await r.json().catch(() => null)
            if (j?.chimmy) {
              alert(JSON.stringify(j.chimmy, null, 2))
            }
          }}
          className="inline-flex items-center gap-1 rounded-lg border border-purple-500/25 bg-purple-500/10 px-3 py-1.5 text-[11px] font-semibold text-purple-200 hover:bg-purple-500/15"
        >
          <Sparkles className="h-3.5 w-3.5" /> Chimmy deep dive (JSON)
        </button>
      </div>
    </AIToolModalShell>
  )
}

function PlayerBreakdown({
  players,
  onOpen,
}: {
  players: { give: TradeConsolePlayerLine[]; get: TradeConsolePlayerLine[] }
  onOpen: (id: string) => void
}) {
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-[#5c6480]">You give</p>
        <div className="space-y-1.5">
          {players.give.map((p, i) => (
            <button
              key={i}
              type="button"
              onClick={() => p.playerId && onOpen(p.playerId)}
              className="flex w-full items-center justify-between gap-2 rounded-[10px] border border-[#2e3347] bg-[#161b22] px-2 py-2 text-left text-[11px] text-[#e8eaf6] hover:border-[#f08080]/35"
            >
              <span className="min-w-0 truncate">
                {p.name}{' '}
                <span className="text-[10px] text-[#5c6480]">
                  {p.position} {p.team}
                </span>
              </span>
              <span className="shrink-0 rounded-[6px] bg-[#f08080]/15 px-2 py-0.5 text-[11px] font-bold tabular-nums text-[#f08080]">
                {Math.round(p.marketValue ?? p.composite)}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-[#5c6480]">You get</p>
        <div className="space-y-1.5">
          {players.get.map((p, i) => (
            <button
              key={i}
              type="button"
              onClick={() => p.playerId && onOpen(p.playerId)}
              className="flex w-full items-center justify-between gap-2 rounded-[10px] border border-[#2e3347] bg-[#161b22] px-2 py-2 text-left text-[11px] text-[#e8eaf6] hover:border-[#00d4aa]/35"
            >
              <span className="min-w-0 truncate">
                {p.name}{' '}
                <span className="text-[10px] text-[#5c6480]">
                  {p.position} {p.team}
                </span>
              </span>
              <span className="shrink-0 rounded-[6px] bg-[#00d4aa]/15 px-2 py-0.5 text-[11px] font-bold tabular-nums text-[#00d4aa]">
                {Math.round(p.marketValue ?? p.composite)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function LinkChimmy({ detail }: { detail: Record<string, unknown> }) {
  const href = getChimmyChatHrefWithPrompt(`Player detail: ${detail.name}`, { player: detail })
  return (
    <a href={href} className="mt-3 inline-flex text-[11px] font-semibold text-cyan-300 hover:text-cyan-200">
      Ask Chimmy about this player →
    </a>
  )
}

function MiniCard({
  title,
  value,
  line,
  lineOnly,
}: {
  title: string
  value?: string
  line?: string
  lineOnly?: boolean
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-2">
      <p className="text-[8px] font-bold uppercase tracking-widest text-white/30">{title}</p>
      {lineOnly || line ? (
        <p className="mt-1 line-clamp-3 text-[10px] text-white/55">{line}</p>
      ) : (
        <p className="mt-1 text-[16px] font-black tabular-nums text-white/85">{value}</p>
      )}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-white/30">{title}</p>
      {children}
    </div>
  )
}

function TradeColumn({
  label,
  accent,
  rows,
  searchHits,
  searchLoading,
  onSearch,
  onChange,
  onPickPlayer,
}: {
  label: string
  accent: 'purple' | 'cyan'
  rows: SideRow[]
  searchHits: SearchHit[]
  searchLoading: boolean
  onSearch: (q: string) => void
  onChange: (fn: (r: SideRow[]) => SideRow[]) => void
  onPickPlayer: (index: number, hit: SearchHit) => void
}) {
  const accentCls =
    accent === 'purple'
      ? 'shadow-[inset_0_0_40px_rgba(240,128,128,0.06)]'
      : 'shadow-[inset_0_0_40px_rgba(0,212,170,0.06)]'

  const updateRow = (i: number, next: SideRow) => {
    onChange((prev) => prev.map((r, j) => (j === i ? next : r)))
  }

  return (
    <div className={`rounded-[12px] border border-[#2e3347] bg-[#161b22] p-2.5 ${accentCls}`}>
      <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-[#5c6480]">{label}</p>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={row.key} className="rounded-[10px] border border-[#2e3347]/90 bg-[#0b0e14] p-1.5">
            <div className="flex items-center gap-1">
              <GripVertical className="h-3 w-3 shrink-0 text-white/15" />
              <select
                value={row.kind}
                onChange={(e) => {
                  const k = e.target.value as SideRow['kind']
                  if (k === 'player') updateRow(i, { key: row.key, kind: 'player', name: '' })
                  if (k === 'pick') updateRow(i, { key: row.key, kind: 'pick', year: new Date().getFullYear() + 1, round: 2 })
                  if (k === 'faab') updateRow(i, { key: row.key, kind: 'faab', amount: 10 })
                }}
                className="rounded bg-transparent text-[10px] font-bold text-white/50"
              >
                <option value="player">Player</option>
                <option value="pick">Pick</option>
                <option value="faab">FAAB</option>
              </select>
            </div>
            {row.kind === 'player' ? (
              <div className="relative mt-1">
                <input
                  value={row.name}
                  onChange={(e) => {
                    updateRow(i, { ...row, name: e.target.value })
                    onSearch(e.target.value)
                  }}
                  placeholder="Search player"
                  className="w-full rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 text-[11px] text-white/80 placeholder-white/25"
                />
                {searchLoading ? (
                  <Loader2 className="absolute right-2 top-2 h-3 w-3 animate-spin text-white/30" />
                ) : null}
                {searchHits.length > 0 ? (
                  <div className="absolute left-0 right-0 z-10 mt-1 max-h-40 overflow-y-auto rounded-md border border-white/10 bg-[#0a1228] shadow-xl">
                    {searchHits.map((h, idx) => (
                      <button
                        key={`${h.name}-${idx}`}
                        type="button"
                        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-white/[0.04]"
                        onClick={() => onPickPlayer(i, h)}
                      >
                        <User className="h-3 w-3 shrink-0 text-white/35" />
                        <span className="truncate">
                          {h.name}{' '}
                          <span className="text-white/35">
                            {h.position} · {h.team} · {h.sport}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {row.kind === 'pick' ? (
              <div className="mt-1 flex gap-1">
                <input
                  type="number"
                  className="w-16 rounded-md border border-white/[0.06] bg-white/[0.03] px-1 py-1 text-[11px] text-white/80"
                  value={row.year}
                  onChange={(e) => updateRow(i, { ...row, year: Number(e.target.value) })}
                />
                <input
                  type="number"
                  min={1}
                  max={4}
                  className="w-12 rounded-md border border-white/[0.06] bg-white/[0.03] px-1 py-1 text-[11px] text-white/80"
                  value={row.round}
                  onChange={(e) => updateRow(i, { ...row, round: Number(e.target.value) })}
                />
              </div>
            ) : null}
            {row.kind === 'faab' ? (
              <input
                type="number"
                className="mt-1 w-full rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 text-[11px] text-white/80"
                value={row.amount}
                onChange={(e) => updateRow(i, { ...row, amount: Number(e.target.value) })}
              />
            ) : null}
            {rows.length > 1 ? (
              <button
                type="button"
                className="mt-1 text-[9px] font-bold uppercase text-white/35 hover:text-white/60"
                onClick={() => onChange((prev) => prev.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-white/40 hover:text-white/70"
          onClick={() => onChange((prev) => [...prev, emptyPlayerRow()])}
        >
          <Plus className="h-3 w-3" /> Add
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-white/40 hover:text-white/70"
          onClick={() => onChange((prev) => [...prev, { key: newKey(), kind: 'pick', year: new Date().getFullYear() + 1, round: 2 }])}
        >
          <ArrowUp className="h-3 w-3" /> Pick
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-white/40 hover:text-white/70"
          onClick={() => onChange((prev) => [...prev, { key: newKey(), kind: 'faab', amount: 10 }])}
        >
          <Minus className="h-3 w-3" /> FAAB
        </button>
      </div>
    </div>
  )
}
