'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, ChevronRight, Loader2, MessageSquare, Swords, Trophy } from 'lucide-react'
import type { UserLeague } from '@/app/dashboard/types'
import { AIToolModalShell } from '../AIToolModalShell'
import { getChimmyChatHrefWithPrompt } from '@/lib/ai-product-layer/UnifiedChimmyEntryResolver'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import type {
  MatchupPrepDashboardResult,
  MatchupPrepToggles,
  MatchupPrepViewTabId,
  MatchupStrategyModeId,
  MatchupTeamFocusId,
  MatchupTimeHorizonId,
} from '@/lib/matchup-prep-dashboard/types'

type SportFilter = 'ALL' | (typeof SUPPORTED_SPORTS)[number]

const TEAM_FOCUS: { id: MatchupTeamFocusId; label: string }[] = [
  { id: 'my_team', label: 'My Team' },
  { id: 'specific_team', label: 'Specific Team' },
]

const TIME_HORIZONS: { id: MatchupTimeHorizonId; label: string }[] = [
  { id: 'this_matchup', label: 'This Matchup' },
  { id: 'next_matchup', label: 'Next Matchup' },
  { id: 'next_2_matchups', label: 'Next 2 Matchups' },
  { id: 'playoff_window', label: 'Playoff Matchup Window' },
  { id: 'rest_of_season', label: 'Rest of Season Opponent Outlook' },
]

const STRATEGIES: { id: MatchupStrategyModeId; label: string }[] = [
  { id: 'balanced', label: 'Balanced' },
  { id: 'high_upside', label: 'High Upside' },
  { id: 'safe_floor', label: 'Safe Floor' },
  { id: 'aggressive', label: 'Aggressive' },
  { id: 'injury_protected', label: 'Injury-Protected' },
  { id: 'streaming_focus', label: 'Streaming Focus' },
  { id: 'playoff_prep', label: 'Playoff Prep' },
  { id: 'neutral', label: 'Neutral' },
]

const VIEW_TABS: { id: MatchupPrepViewTabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'game_plan', label: 'Game Plan' },
  { id: 'lineup_edge', label: 'Lineup Edge' },
  { id: 'opponent_weaknesses', label: 'Opponent Weaknesses' },
  { id: 'injuries', label: 'Injuries' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'streaming', label: 'Streaming' },
  { id: 'ai_insights', label: 'AI Insights' },
]

const DEFAULT_TOGGLES: MatchupPrepToggles = {
  includeLiveNews: true,
  includeInjuries: true,
  includeScheduleAdjustments: true,
  includeWeather: true,
  includeStreamingRecommendations: true,
  includeOpponentTrendAnalysis: true,
  includePlayoffContext: true,
  includeRookieProspectContext: false,
}

function openTool(tool: string) {
  window.dispatchEvent(new CustomEvent('af-open-ai-tool', { detail: { tool } }))
}

export function MatchupPrepModal({
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
  const [leagueId, setLeagueId] = useState('')
  const [teamFocus, setTeamFocus] = useState<MatchupTeamFocusId>('my_team')
  const [teamExternalId, setTeamExternalId] = useState('')
  const [opponentExternalId, setOpponentExternalId] = useState('')
  const [timeHorizon, setTimeHorizon] = useState<MatchupTimeHorizonId>('this_matchup')
  const [strategyMode, setStrategyMode] = useState<MatchupStrategyModeId>('balanced')
  const [toggles, setToggles] = useState<MatchupPrepToggles>(DEFAULT_TOGGLES)
  const [viewTab, setViewTab] = useState<MatchupPrepViewTabId>('overview')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<MatchupPrepDashboardResult | null>(null)
  const [leagueTeams, setLeagueTeams] = useState<
    Array<{ externalId: string; teamName: string; ownerName: string; isYou?: boolean }>
  >([])

  useEffect(() => {
    if (!open) return
    const s = (initialSport || 'ALL').toUpperCase()
    if (s === 'ALL') setSportFilter('ALL')
    else if (SUPPORTED_SPORTS.includes(s as (typeof SUPPORTED_SPORTS)[number])) {
      setSportFilter(s as SportFilter)
    }
    setLeagueId(initialLeagueId || '')
  }, [open, initialLeagueId, initialSport])

  const filteredLeagues = useMemo(() => {
    if (sportFilter === 'ALL') return leagues
    return leagues.filter((l) => String(l.sport).toUpperCase() === sportFilter)
  }, [leagues, sportFilter])

  useEffect(() => {
    if (!open || !leagueId) {
      setLeagueTeams([])
      return
    }
    let cancelled = false
    fetch(`/api/trade-value/league-teams?leagueId=${encodeURIComponent(leagueId)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setLeagueTeams(Array.isArray(j.teams) ? j.teams : [])
      })
      .catch(() => {
        if (!cancelled) setLeagueTeams([])
      })
    return () => {
      cancelled = true
    }
  }, [open, leagueId])

  const load = useCallback(async () => {
    if (!leagueId.trim()) {
      setData(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/ai-tools/matchup-prep/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sportFilter,
          leagueId: leagueId.trim(),
          teamFocus,
          teamExternalId: teamFocus === 'specific_team' && teamExternalId.trim() ? teamExternalId.trim() : null,
          opponentExternalId: opponentExternalId.trim() || null,
          timeHorizon,
          strategyMode,
          skipAi: false,
          toggles,
        }),
      })
      const json = (await r.json()) as MatchupPrepDashboardResult | { ok: false; error?: string }
      if (!r.ok || !json.ok) {
        setData(null)
        setError((json as { error?: string }).error || 'Matchup prep failed.')
        return
      }
      setData(json)
    } catch {
      setData(null)
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [sportFilter, leagueId, teamFocus, teamExternalId, opponentExternalId, timeHorizon, strategyMode, toggles])

  useEffect(() => {
    if (!open) return
    void load()
  }, [open, load])

  const chimmyHref = useMemo(() => {
    const prompt = data?.aiSummary
      ? `Matchup prep (facts):\n${data.aiSummary}\n\nHelp me finalize start/sit and game plan.`
      : 'Matchup prep: review my head-to-head edge using synced league data only.'
    return getChimmyChatHrefWithPrompt(prompt, {
      source: 'matchup_prep',
      leagueId: leagueId || undefined,
    })
  }, [data?.aiSummary, leagueId])

  const headerBadge = (
    <span className="flex flex-wrap items-center gap-1">
      {data?.degraded || data?.dataGaps?.length ? (
        <span className="rounded border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase text-amber-200">
          Partial data
        </span>
      ) : (
        <span className="rounded border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase text-emerald-200">
          Live
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
            <span title={sf.opponentResolved ? 'Opponent resolved (native or Sleeper)' : 'Opponent could not be resolved'} className={`${chipBase} ${sf.opponentResolved ? green : amber}`}>Opp</span>
            <span title={sf.myProjectionReady ? 'Your team projections ready' : 'Your team projections missing'} className={`${chipBase} ${sf.myProjectionReady ? green : dim}`}>Mine</span>
            <span title={sf.oppProjectionReady ? 'Opponent projections ready' : 'Opponent projections missing'} className={`${chipBase} ${sf.oppProjectionReady ? green : dim}`}>Opp Proj</span>
            <span title={sf.injuryNewsLayerReady ? 'Injury/news signals attached' : 'No injury/news signals'} className={`${chipBase} ${sf.injuryNewsLayerReady ? green : dim}`}>Inj</span>
            <span title={sf.weatherLayerReady ? 'Weather influence captured' : 'No weather influence (indoor / clear)'} className={`${chipBase} ${sf.weatherLayerReady ? green : dim}`}>Wx</span>
            <span title={sf.leagueScoringApplied ? 'League scoring rules applied' : 'League scoring not applied'} className={`${chipBase} ${sf.leagueScoringApplied ? green : amber}`}>{sf.leagueScoringApplied ? 'Scoring' : 'No lg scoring'}</span>
            <span title={sf.aiEnvelopeReady ? 'AI envelope attached' : 'AI envelope missing'} className={`${chipBase} ${sf.aiEnvelopeReady ? green : dim}`}>AI</span>
          </>
        )
      })()}
    </span>
  )

  return (
    <AIToolModalShell
      open={open}
      onClose={onClose}
      title="Matchup Prep"
      subtitle="Opponent scouting + game plan"
      accentColor="sky"
      icon={<Swords className="h-5 w-5" />}
      wide
      loading={loading && !data}
      error={error}
      headerBadge={headerBadge}
      onRefresh={() => void load()}
      refreshing={loading}
      chimmyPrompt="Matchup prep: what is the safest path to win this week?"
      chimmyContext={data?.chimmyPayload}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <select
            value={sportFilter}
            onChange={(e) => setSportFilter(e.target.value as SportFilter)}
            className="rounded-lg border border-white/10 bg-[#121725] px-2 py-1.5 text-[11px] text-white"
          >
            <option value="ALL">All sports</option>
            {SUPPORTED_SPORTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={leagueId}
            onChange={(e) => setLeagueId(e.target.value)}
            className="min-w-[160px] rounded-lg border border-white/10 bg-[#121725] px-2 py-1.5 text-[11px] text-white"
          >
            <option value="">Select league…</option>
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
          <select
            value={teamFocus}
            onChange={(e) => setTeamFocus(e.target.value as MatchupTeamFocusId)}
            className="rounded-lg border border-white/10 bg-[#121725] px-2 py-1.5 text-[11px] text-white"
          >
            {TEAM_FOCUS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <select
            value={opponentExternalId}
            onChange={(e) => setOpponentExternalId(e.target.value)}
            className="min-w-[140px] rounded-lg border border-white/10 bg-[#121725] px-2 py-1.5 text-[11px] text-white"
          >
            <option value="">Opponent (auto: Sleeper or native schedule)</option>
            {leagueTeams.map((t) => (
              <option key={t.externalId} value={t.externalId}>
                {t.teamName} {t.isYou ? '(you)' : ''}
              </option>
            ))}
          </select>
          <select
            value={timeHorizon}
            onChange={(e) => setTimeHorizon(e.target.value as MatchupTimeHorizonId)}
            className="rounded-lg border border-white/10 bg-[#121725] px-2 py-1.5 text-[11px] text-white"
          >
            {TIME_HORIZONS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <select
            value={strategyMode}
            onChange={(e) => setStrategyMode(e.target.value as MatchupStrategyModeId)}
            className="rounded-lg border border-white/10 bg-[#121725] px-2 py-1.5 text-[11px] text-white"
          >
            {STRATEGIES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {teamFocus === 'specific_team' && leagueId ? (
          <select
            value={teamExternalId}
            onChange={(e) => setTeamExternalId(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-[#121725] px-2 py-1.5 text-[11px] text-white"
          >
            <option value="">Your team to scout…</option>
            {leagueTeams.map((t) => (
              <option key={`me-${t.externalId}`} value={t.externalId}>
                {t.teamName}
              </option>
            ))}
          </select>
        ) : null}

        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {(Object.keys(toggles) as (keyof MatchupPrepToggles)[]).map((k) => (
            <label
              key={k}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-[9px] text-white/70"
            >
              <input
                type="checkbox"
                checked={toggles[k]}
                onChange={(e) => setToggles((prev) => ({ ...prev, [k]: e.target.checked }))}
                className="rounded border-white/20"
              />
              <span className="leading-tight">{k.replace(/include/g, '').replace(/([A-Z])/g, ' $1').trim()}</span>
            </label>
          ))}
        </div>

        <div className="flex flex-wrap gap-1 border-b border-white/[0.06] pb-2">
          {VIEW_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setViewTab(t.id)}
              className={`rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                viewTab === t.id ? 'bg-sky-500/20 text-sky-100' : 'text-white/45 hover:text-white/75'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading && !data ? (
          <div className="flex items-center gap-2 py-8 text-[12px] text-white/50">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading matchup intelligence…
          </div>
        ) : data ? (
          <MatchupTabBody viewTab={viewTab} data={data} chimmyHref={chimmyHref} />
        ) : !leagueId ? (
          <p className="text-[11px] text-amber-200/90">Select a league for head-to-head prep.</p>
        ) : null}
      </div>
    </AIToolModalShell>
  )
}

function MatchupTabBody({
  viewTab,
  data,
  chimmyHref,
}: {
  viewTab: MatchupPrepViewTabId
  data: MatchupPrepDashboardResult
  chimmyHref: string
}) {
  const edge = data.projectedEdge
  const win = data.winProbability

  if (viewTab === 'overview') {
    return (
      <div className="space-y-3">
        {data.scoringSummary ? (
          <div className="rounded-xl border border-white/[0.06] bg-[#0d111a] px-3 py-2 text-[10px] text-white/70">
            <span className="font-bold text-cyan-200/90">Scoring</span>{' '}
            {data.scoringSummary.scoringModel}
            {data.scoringSummary.receptionFormat ? ` · ${data.scoringSummary.receptionFormat}` : ''}
            {data.scoringSummary.superflex ? ' · superflex' : ''}
          </div>
        ) : null}
        {data.matchupPeriod ? (
          <p className="text-[10px] text-white/45">
            Period: {data.matchupPeriod.weekLabel} · season {data.matchupPeriod.season}
            {data.matchupPeriod.periodSource ? ` · ${data.matchupPeriod.periodSource}` : ''}
          </p>
        ) : null}
        <div className="overflow-hidden rounded-2xl border border-sky-500/20 bg-gradient-to-br from-sky-500/[0.08] via-cyan-500/[0.04] to-transparent px-4 py-3">
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-sky-300/70">
            Week {data.week} · {data.leagueName ?? 'League'}
          </p>
          <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <div className="text-right">
              <p className="text-[10px] uppercase text-white/35">{data.myTeamName ?? 'You'}</p>
              <p className="text-[22px] font-black tabular-nums text-white">
                {data.myProjectedTotal != null ? data.myProjectedTotal.toFixed(1) : '—'}
              </p>
              <p className="text-[10px] text-white/40">{data.myRecord ?? '—'}</p>
            </div>
            <div className="flex flex-col items-center px-1">
              <span className="text-[9px] font-bold uppercase text-sky-300/60">edge</span>
              <span
                className={`mt-0.5 rounded-md border px-1.5 py-0.5 text-[11px] font-black tabular-nums ${
                  edge != null && edge > 0
                    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                    : edge != null && edge < 0
                      ? 'border-red-500/25 bg-red-500/10 text-red-300'
                      : 'border-white/[0.08] text-white/50'
                }`}
              >
                {edge != null ? `${edge > 0 ? '+' : ''}${edge.toFixed(1)}` : '—'}
              </span>
            </div>
            <div className="text-left">
              <p className="text-[10px] uppercase text-white/35">{data.oppTeamName ?? 'Opponent'}</p>
              <p className="text-[22px] font-black tabular-nums text-white/70">
                {data.oppProjectedTotal != null ? data.oppProjectedTotal.toFixed(1) : '—'}
              </p>
              <p className="text-[10px] text-white/40">{data.oppRecord ?? '—'}</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.04] p-2">
            <div className="flex items-center gap-1">
              <Trophy className="h-3 w-3 text-emerald-400" />
              <p className="text-[8px] font-bold uppercase text-emerald-300">Win chance</p>
            </div>
            <p className="mt-0.5 text-xl font-black tabular-nums text-emerald-200">{win != null ? `${win}%` : '—'}</p>
            <p className="mt-1 text-[8px] leading-snug text-white/35">
              {data.winProbabilityModel === 'starter_spread_normal'
                ? 'From projection spread (fantasy pts)'
                : 'From mean edge (logistic)'}
            </p>
          </div>
          <div className="rounded-xl border border-sky-500/15 bg-sky-500/[0.04] p-2">
            <p className="text-[8px] font-bold uppercase text-sky-300">Confidence</p>
            <p className="mt-0.5 text-xl font-black tabular-nums text-sky-200">{data.confidence}</p>
          </div>
          <div className="rounded-xl border border-violet-500/15 bg-violet-500/[0.04] p-2">
            <p className="text-[8px] font-bold uppercase text-violet-300">Matchup</p>
            <p className="mt-0.5 text-[11px] font-bold capitalize text-violet-100">{data.matchupDifficulty}</p>
          </div>
          <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.04] p-2">
            <p className="text-[8px] font-bold uppercase text-amber-300">Urgency</p>
            <p className="mt-0.5 text-xl font-black tabular-nums text-amber-100">{data.urgencyScore}</p>
          </div>
        </div>
        {data.winProbabilityNotes ? (
          <p className="text-[9px] leading-relaxed text-white/40">{data.winProbabilityNotes}</p>
        ) : null}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
          <p className="text-[9px] font-bold uppercase text-white/45">Floor vs upside (Start/Sit)</p>
          <p className="mt-1 text-[10px] text-white/75">{data.floorVsUpside.note}</p>
        </div>
        {data.gamePlan.length > 0 ? (
          <p className="text-[10px] text-white/50">
            Next: <span className="text-white/80">{data.gamePlan[0]?.title}</span>
          </p>
        ) : null}
        <p className="text-[10px] text-white/35">Updated {new Date(data.computedAt).toLocaleString()}</p>
      </div>
    )
  }

  if (viewTab === 'game_plan') {
    return (
      <div className="space-y-2">
        {data.gamePlan.map((g) => (
          <div
            key={g.id}
            className="flex items-start justify-between gap-2 rounded-xl border border-white/[0.06] bg-[#0d111a] px-2 py-2"
          >
            <div>
              <p className="text-[11px] font-bold text-white/90">{g.title}</p>
              <p className="text-[10px] text-white/45">{g.detail}</p>
            </div>
            {g.linkTool ? (
              <button
                type="button"
                onClick={() => openTool(g.linkTool!)}
                className="shrink-0 text-[9px] font-bold uppercase text-cyan-300"
              >
                Open
              </button>
            ) : null}
          </div>
        ))}
        {data.conflicts.length > 0 ? (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-2">
            <p className="text-[9px] font-bold uppercase text-amber-200">Trade-offs</p>
            {data.conflicts.map((c) => (
              <p key={c.id} className="mt-1 text-[10px] text-amber-100/85">
                {c.summary}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  if (viewTab === 'lineup_edge') {
    return (
      <div className="space-y-3">
        {data.slotEdges.length > 0 ? (
          <div>
            <p className="mb-1.5 text-[9px] font-bold uppercase text-sky-300/80">By lineup slot</p>
            <div className="space-y-2">
              {data.slotEdges.map((e) => (
                <div key={e.slotName} className="rounded-lg border border-white/[0.06] bg-[#0d111a] px-2 py-1.5">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-bold text-white/80">{e.slotName}</span>
                    <span
                      className={`font-black tabular-nums ${e.edge > 0 ? 'text-emerald-300' : e.edge < 0 ? 'text-red-300' : 'text-white/45'}`}
                    >
                      {e.edge > 0 ? '+' : ''}
                      {e.edge.toFixed(1)}
                    </span>
                  </div>
                  <p className="text-[9px] text-white/40">
                    You {e.myStarterName ?? '—'} ({e.myPoints.toFixed(1)}) · Opp {e.oppStarterName ?? '—'} (
                    {e.oppPoints.toFixed(1)})
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div>
          <p className="mb-1.5 text-[9px] font-bold uppercase text-white/50">By position group</p>
          {data.positionEdges.map((e) => (
            <EdgeBar key={e.position} label={e.position} mine={e.myPoints} theirs={e.oppPoints} />
          ))}
        </div>
        {data.positionEdges.length === 0 && data.slotEdges.length === 0 ? (
          <p className="text-[11px] text-white/45">No split — opponent projections unavailable.</p>
        ) : null}
      </div>
    )
  }

  if (viewTab === 'opponent_weaknesses') {
    const weak = data.positionEdges.filter((x) => x.edge > 0)
    const strong = data.positionEdges.filter((x) => x.edge < 0)
    return (
      <div className="space-y-2 text-[11px] text-white/70">
        <p className="font-bold text-emerald-200/90">Where you project ahead</p>
        <ul className="list-inside list-disc space-y-1">
          {weak.slice(0, 8).map((e) => (
            <li key={e.position}>
              {e.position}: +{e.edge.toFixed(1)} pts vs opponent slot
            </li>
          ))}
        </ul>
        <p className="mt-2 font-bold text-red-200/85">Opponent edges</p>
        <ul className="list-inside list-disc space-y-1">
          {strong.slice(0, 8).map((e) => (
            <li key={e.position}>
              {e.position}: {e.edge.toFixed(1)} pts
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (viewTab === 'injuries') {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => openTool('injury')}
          className="w-full rounded-xl border border-red-500/20 bg-red-500/5 py-2 text-[11px] font-semibold text-red-100"
        >
          Open Injury Impact
        </button>
        {data.injuryPivots.length > 0 ? (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-2 py-2">
            <p className="text-[9px] font-bold uppercase text-amber-200">Pivots to watch</p>
            {data.injuryPivots.map((p, i) => (
              <p key={i} className="mt-1 text-[10px] text-amber-100/90">
                {p.player}: {p.detail}
              </p>
            ))}
          </div>
        ) : null}
        {data.injuryHighlights.map((h, i) => (
          <div key={i} className="rounded-lg border border-white/[0.06] px-2 py-1.5 text-[10px] text-white/70">
            <span className="font-bold text-white/85">{h.side === 'you' ? 'You' : 'Opp'} · {h.name}</span> — {h.status}
          </div>
        ))}
      </div>
    )
  }

  if (viewTab === 'schedule') {
    return (
      <div className="space-y-3">
        <ul className="list-inside list-disc space-y-1 text-[11px] text-white/65">
          {data.scheduleNotes.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
        {data.timeContext?.nextLockTimeUTC || data.timeContext?.matchupLockAt ? (
          <p className="text-[10px] text-cyan-200/80">
            Next lineup lock (UTC): {data.timeContext.nextLockTimeUTC ?? data.timeContext.matchupLockAt}
          </p>
        ) : null}
        {data.timeContext?.timeAuthorityNote ? (
          <p className="text-[9px] text-white/45">{data.timeContext.timeAuthorityNote}</p>
        ) : null}
        <MarketEnvironment rows={data.marketContext ?? []} />
        {data.weatherInfluence.length > 0 ? (
          <div className="rounded-xl border border-sky-500/15 bg-sky-500/[0.04] px-2 py-2">
            <p className="text-[9px] font-bold uppercase text-sky-300/80">Weather (your starters)</p>
            {data.weatherInfluence.map((w, i) => (
              <p key={i} className="mt-1 text-[10px] text-white/70">
                {w.name} ({w.team}): {w.summary}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  if (viewTab === 'streaming') {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => openTool('waiver')}
          className="flex w-full items-center justify-between rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-2 py-2 text-[11px] font-semibold text-emerald-100"
        >
          Waiver Wire — matchup adds
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        {data.streamingOpportunities.length > 0 ? (
          <ul className="space-y-2">
            {data.streamingOpportunities.map((s) => (
              <li key={s.id} className="rounded-lg border border-white/[0.06] px-2 py-2 text-[10px] text-white/75">
                <span className="font-bold text-emerald-200/90">{s.title}</span>
                <p className="mt-0.5 text-white/50">{s.detail}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[10px] text-white/45">No clear positional stream need vs this opponent in projections.</p>
        )}
        <p className="text-[10px] text-white/45">
          Uses the same normalized projections as Start/Sit — open Waiver Wire for FAAB, priority, and adds.
        </p>
      </div>
    )
  }

  if (viewTab === 'ai_insights') {
    return (
      <div className="space-y-3">
        {data.aiSummary ? (
          <div className="rounded-xl border border-sky-500/20 bg-sky-500/[0.06] p-3 text-[12px] leading-relaxed text-white/85">
            {data.aiSummary}
          </div>
        ) : (
          <p className="text-[11px] text-white/45">AI summary unavailable — check OpenAI configuration.</p>
        )}
        <p className="text-[10px] text-white/35">Gaps: {data.dataGaps.join('; ') || 'none'}</p>
        <Link
          href={chimmyHref}
          className="flex items-center justify-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 py-2.5 text-[12px] font-semibold text-sky-100"
        >
          <MessageSquare className="h-4 w-4" />
          Ask Chimmy with matchup context
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    )
  }

  return null
}

type MarketRow = NonNullable<MatchupPrepDashboardResult['marketContext']>[number]

/**
 * Scoring environment for your starters, from the betting market read as a FORECAST.
 *
 * 🛑 THIS IS NOT A BETTING CARD, AND THE WORDING IS THE BOUNDARY.
 * AllFantasy consumes the market as a projection input and is deliberately not a
 * gambling product. The read layer already refuses to hand over prices or
 * sportsbook names (see lib/odds/gameOddsReads.ts, enforced by a runtime test), so
 * this component *cannot* render odds even by mistake. What it must still get
 * right is the language:
 *
 *   - the headline is EXPECTED POINTS for that player's offense, not a line
 *   - the spread is stated as game script in words — "favored by 3.5" — never as
 *     "-3.5", which is betting notation
 *   - the total is "combined", not "O/U"
 *
 * ⚠ AN EMPTY PANEL IS A NORMAL STATE, NOT A FAULT. Measured against the live
 * vendor: a game 3 days out returns ZERO odds, and only fixtures inside roughly
 * two days of kickoff are populated. So early in a week this is legitimately empty
 * for most of the slate. Saying that plainly is the difference between "not yet"
 * and "this feature is broken".
 */
export function MarketEnvironment({ rows }: { rows: MarketRow[] }) {
  const usable = rows.filter((r) => r.impliedTeamTotal != null)

  if (usable.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-2 py-2">
        <p className="text-[9px] font-bold uppercase text-white/45">Scoring environment</p>
        <p className="mt-1 text-[10px] text-white/45">
          No market read yet — expected team scoring posts closer to kickoff.
        </p>
      </div>
    )
  }

  const anyStale = usable.some((r) => r.isStale)

  return (
    <div className="rounded-xl border border-violet-500/15 bg-violet-500/[0.04] px-2 py-2">
      <div className="flex items-baseline justify-between">
        <p className="text-[9px] font-bold uppercase text-violet-300/80">
          Scoring environment (your starters)
        </p>
        <span className="text-[8px] uppercase text-white/30">expected pts</span>
      </div>

      <div className="mt-1.5 space-y-1.5">
        {usable.map((r, i) => {
          const pts = r.impliedTeamTotal as number
          // Light emphasis only. NFL team totals sit roughly 17-30, so these bands
          // read as "strong / thin" rather than as a recommendation to act on.
          const tone =
            pts >= 26 ? 'text-emerald-300' : pts <= 19 ? 'text-amber-300' : 'text-white/80'

          const script =
            r.spread == null
              ? null
              : r.spread < 0
                ? `favored by ${Math.abs(r.spread)}`
                : r.spread > 0
                  ? `underdog by ${r.spread}`
                  : 'even game'

          return (
            <div
              key={`${r.name}-${i}`}
              className="rounded-lg border border-white/[0.06] bg-[#0d111a] px-2 py-1.5"
            >
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-bold text-white/80">
                  {r.name} <span className="text-white/40">({r.team})</span>
                </span>
                <span className={`font-black tabular-nums ${tone}`}>{pts.toFixed(1)}</span>
              </div>
              <p className="text-[9px] text-white/40">
                {r.isHome ? 'vs' : 'at'} {r.opponent ?? '—'}
                {script ? ` · ${script}` : ''}
                {r.gameTotal != null ? ` · ${r.gameTotal.toFixed(1)} combined` : ''}
              </p>
            </div>
          )
        })}
      </div>

      {anyStale ? (
        <p className="mt-1.5 text-[9px] text-amber-300/70">
          Past its refresh window — re-check before locking.
        </p>
      ) : null}
      <p className="mt-1 text-[8px] text-white/30">
        Market-implied team scoring. Not a wager, and not your matchup win chance.
      </p>
    </div>
  )
}

function EdgeBar({ label, mine, theirs }: { label: string; mine: number; theirs: number }) {
  const total = mine + theirs || 1
  const w = (mine / total) * 100
  const diff = mine - theirs
  return (
    <div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="font-bold text-white/75">{label}</span>
        <span
          className={`font-black tabular-nums ${diff > 0 ? 'text-emerald-300' : diff < 0 ? 'text-red-300' : 'text-white/45'}`}
        >
          {diff > 0 ? '+' : ''}
          {diff.toFixed(1)}
        </span>
      </div>
      <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
        <div className="h-full bg-gradient-to-r from-sky-400 to-cyan-300" style={{ width: `${w}%` }} />
        <div className="h-full flex-1 bg-red-400/35" />
      </div>
      <p className="mt-0.5 text-[9px] text-white/35">
        You {mine.toFixed(1)} · Opp {theirs.toFixed(1)}
      </p>
    </div>
  )
}
