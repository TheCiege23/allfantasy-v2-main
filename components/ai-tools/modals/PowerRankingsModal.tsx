'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Crown, ExternalLink, Minus, Sparkles, TrendingDown, TrendingUp, X } from 'lucide-react'
import type { UserLeague } from '@/app/dashboard/types'
import { AIToolModalShell } from '../AIToolModalShell'
import { currentPathForReturn, readPlanRefusal, type PlanRefusal } from '@/lib/monetization/planRefusal'
import { getChimmyChatHrefWithPrompt } from '@/lib/ai-product-layer/UnifiedChimmyEntryResolver'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import type {
  EnrichedTeamRow,
  PowerRankingsDashboardResult,
  RankingModeId,
  TeamContextId,
  TimeWindowId,
} from '@/lib/power-rankings-dashboard/types'

type SportFilter = 'ALL' | (typeof SUPPORTED_SPORTS)[number]

type ViewTab =
  | 'rankings'
  | 'momentum'
  | 'tiers'
  | 'outlooks'
  | 'playoff'
  | 'sos'
  | 'roster'
  | 'ai'

const RANKING_MODES: { id: RankingModeId; label: string }[] = [
  { id: 'current_power', label: 'Current Power' },
  { id: 'weekly_power', label: 'Weekly Power' },
  { id: 'rest_of_season', label: 'Rest of Season' },
  { id: 'playoff_odds', label: 'Playoff Odds' },
  { id: 'championship_odds', label: 'Championship Odds' },
  { id: 'dynasty_power', label: 'Dynasty Power' },
  { id: 'rebuild_index', label: 'Rebuild Index' },
  { id: 'contender_index', label: 'Contender Index' },
  { id: 'momentum', label: 'Momentum' },
  { id: 'all_around', label: 'All-Around' },
]

const TEAM_CONTEXTS: { id: TeamContextId; label: string }[] = [
  { id: 'full_league', label: 'Full League' },
  { id: 'my_team', label: 'My Team' },
  { id: 'specific_team', label: 'Specific Team' },
  { id: 'division', label: 'Division / Conference' },
  { id: 'playoff_teams', label: 'Playoff Teams Only' },
  { id: 'bubble', label: 'Bubble Teams' },
  { id: 'bottom', label: 'Bottom Teams' },
]

const VIEW_TABS: { id: ViewTab; label: string }[] = [
  { id: 'rankings', label: 'Rankings' },
  { id: 'momentum', label: 'Momentum' },
  { id: 'tiers', label: 'Tier Breakdown' },
  { id: 'outlooks', label: 'Team Outlooks' },
  { id: 'playoff', label: 'Playoff Picture' },
  { id: 'sos', label: 'Strength of Schedule' },
  { id: 'roster', label: 'Roster Strength' },
  { id: 'ai', label: 'AI Insights' },
]

function recordLabel(t: EnrichedTeamRow) {
  const { wins, losses, ties } = t.record
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`
}

function rankDeltaDisplay(delta: number | null) {
  if (delta == null) return { text: '—', tone: 'flat' as const }
  if (delta > 0) return { text: `↑${delta}`, tone: 'up' as const }
  if (delta < 0) return { text: `↓${Math.abs(delta)}`, tone: 'down' as const }
  return { text: '—', tone: 'flat' as const }
}

export function PowerRankingsModal({
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
  const [rankingMode, setRankingMode] = useState<RankingModeId>('current_power')
  const [timeWindow, setTimeWindow] = useState<TimeWindowId>('season')
  const [teamContext, setTeamContext] = useState<TeamContextId>('full_league')
  const [specificTeamExternalId, setSpecificTeamExternalId] = useState('')
  const [week, setWeek] = useState<string>('')
  const [viewTab, setViewTab] = useState<ViewTab>('rankings')
  const [toggles, setToggles] = useState({
    includeProjections: true,
    includeScheduleStrength: true,
    includeInjuries: true,
    includeTransactionMomentum: true,
    includeRookies: true,
    includePlayoffHistory: true,
    includeRecentForm: true,
    includeDynastyWeighting: true,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<PlanRefusal | null>(null)
  const [data, setData] = useState<PowerRankingsDashboardResult | null>(null)
  const [detail, setDetail] = useState<EnrichedTeamRow | null>(null)
  const [leagueTeams, setLeagueTeams] = useState<
    Array<{ externalId: string; teamName: string; ownerName: string; isYou?: boolean }>
  >([])
  const [teamsLoading, setTeamsLoading] = useState(false)
  const [snapshotHistory, setSnapshotHistory] = useState<
    Array<{ season: number; week: number; computedAt: string; engine: string }>
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
    setTeamsLoading(true)
    fetch(`/api/trade-value/league-teams?leagueId=${encodeURIComponent(leagueId)}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        setLeagueTeams(Array.isArray(j.teams) ? j.teams : [])
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
  }, [open, leagueId])

  useEffect(() => {
    if (!open || !leagueId.trim()) {
      setSnapshotHistory([])
      return
    }
    let cancelled = false
    fetch(
      `/api/ai-tools/power-rankings/snapshots?leagueId=${encodeURIComponent(leagueId.trim())}&limit=12&rankingMode=${encodeURIComponent(rankingMode)}`,
    )
      .then((r) => r.json())
      .then(
        (j: {
          ok?: boolean
          snapshots?: Array<{ season: number; week: number; computedAt: string; engine: string }>
        }) => {
          if (cancelled || !j?.ok || !Array.isArray(j.snapshots)) return
          setSnapshotHistory(
            j.snapshots.map((s) => ({
              season: s.season,
              week: s.week,
              computedAt: s.computedAt,
              engine: s.engine,
            })),
          )
        },
      )
      .catch(() => {
        if (!cancelled) setSnapshotHistory([])
      })
    return () => {
      cancelled = true
    }
  }, [open, leagueId, rankingMode])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setRefusal(null)
    try {
      const weekNum = week.trim() === '' ? null : Number.parseInt(week, 10)
      const r = await fetch('/api/ai-tools/power-rankings/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sportFilter,
          leagueId: leagueId.trim() || null,
          rankingMode,
          timeWindow,
          teamContext,
          specificTeamExternalId:
            teamContext === 'specific_team' && specificTeamExternalId.trim()
              ? specificTeamExternalId.trim()
              : null,
          week: weekNum != null && Number.isFinite(weekNum) ? weekNum : null,
          skipAi: false,
          toggles,
        }),
      })
      const json = (await r.json()) as PowerRankingsDashboardResult | { ok: false; error?: string }
      if (!r.ok) {
        setData(null)
        setRefusal(readPlanRefusal(r.status, json, { returnTo: currentPathForReturn() }))
        setError((json as { error?: string }).error || 'Request failed')
        return
      }
      if (!json.ok) {
        setData(null)
        setRefusal(readPlanRefusal(r.status, json, { returnTo: currentPathForReturn() }))
        setError((json as { error?: string }).error || 'Power rankings unavailable')
        return
      }
      setData(json)
    } catch {
      setData(null)
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [
    sportFilter,
    leagueId,
    rankingMode,
    timeWindow,
    teamContext,
    specificTeamExternalId,
    week,
    toggles,
  ])

  useEffect(() => {
    if (!open) return
    void load()
  }, [open, load])

  const myRow = useMemo(() => data?.teams.find((t) => t.isCurrentUser), [data])

  const headerBadge =
    data?.ok && data.analysisScope === 'league' ? (
      <div className="flex flex-wrap items-center gap-1">
        <span className="rounded border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-200">
          {data.engine === 'sleeper_v2' ? 'Sleeper engine' : 'DB standings'}
        </span>
        {data.degraded ? (
          <span className="rounded border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-200">
            Partial data
          </span>
        ) : (
          <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-200">
            Live
          </span>
        )}
        {(() => {
          const sf = data.sourceFlags
          if (!sf) return null
          const chipBase = 'rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide'
          const green = 'bg-emerald-500/15 text-emerald-200'
          const dim = 'bg-white/5 text-white/35'
          const amber = 'bg-amber-500/12 text-amber-100/90'
          return (
            <>
              <span title={sf.standingsReady ? 'Standings (W/L/PF/PA) loaded' : 'Standings unavailable'} className={`${chipBase} ${sf.standingsReady ? green : dim}`}>Stand</span>
              <span title={sf.rostersReady ? 'Team rosters resolved' : 'Rosters unavailable — standings-only mode'} className={`${chipBase} ${sf.rostersReady ? green : dim}`}>Rost</span>
              <span title={sf.projectionLayerReady ? 'League-scored projections attached' : 'No projections attached'} className={`${chipBase} ${sf.projectionLayerReady ? green : dim}`}>Proj</span>
              <span title={sf.injuryNewsLayerReady ? 'Injury-aware signals included' : 'Injuries not blended'} className={`${chipBase} ${sf.injuryNewsLayerReady ? green : dim}`}>Inj</span>
              <span title={sf.priorSnapshotReady ? 'Prior snapshot found — rank movement is real' : 'No prior snapshot yet — movement will appear next refresh'} className={`${chipBase} ${sf.priorSnapshotReady ? green : dim}`}>Δ</span>
              <span title={sf.leagueScoringApplied ? 'League scoring rules applied' : 'League scoring not applied'} className={`${chipBase} ${sf.leagueScoringApplied ? green : amber}`}>{sf.leagueScoringApplied ? 'Scoring' : 'No lg scoring'}</span>
              <span title={sf.aiEnvelopeReady ? 'AI envelope attached' : 'AI envelope missing'} className={`${chipBase} ${sf.aiEnvelopeReady ? green : dim}`}>AI</span>
            </>
          )
        })()}
      </div>
    ) : null

  const chimmyPrompt = useMemo(() => {
    const ln = data?.leagueName || 'my league'
    return `Power Rankings analysis for ${ln}: explain who is too high or too low using only the structured data you receive.`
  }, [data?.leagueName])

  const chimmyContext = useMemo(() => data?.chimmyPayload ?? {}, [data?.chimmyPayload])

  return (
    <>
      <AIToolModalShell
        open={open}
        onClose={onClose}
        title="Power Rankings"
        subtitle="League intelligence from real standings, schedules, and roster signals"
        accentColor="violet"
        icon={<Crown className="h-5 w-5" />}
        wide
        showApiPills={false}
        loading={loading}
        error={error}
        refusal={refusal}
        onRefresh={load}
        refreshing={loading}
        headerBadge={headerBadge}
        chimmyPrompt={data?.ok && data.analysisScope === 'league' ? chimmyPrompt : undefined}
        chimmyContext={chimmyContext}
        actions={
          data?.ok && data.analysisScope === 'league' ? (
            <div className="flex flex-wrap gap-2">
              <Link
                href={getChimmyChatHrefWithPrompt(
                  `Open waiver suggestions for roster weaknesses in ${data.leagueName ?? 'this league'}`,
                  { source: 'power_rankings', leagueId },
                )}
                className="text-[11px] font-semibold text-violet-300/90 underline-offset-2 hover:underline"
              >
                Waiver needs
              </Link>
              <Link
                href={getChimmyChatHrefWithPrompt(
                  `Trade targets to address roster gaps in ${data.leagueName ?? 'this league'}`,
                  { source: 'power_rankings', leagueId },
                )}
                className="text-[11px] font-semibold text-violet-300/90 underline-offset-2 hover:underline"
              >
                Trade targets
              </Link>
            </div>
          ) : null
        }
      >
        <div className="space-y-3">
          {/* Control bar */}
          <div className="rounded-xl border border-white/[0.08] bg-[#0a0f18] p-3 space-y-2">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block text-[10px] font-bold uppercase tracking-wide text-[#5c6480]">
                Sport
                <select
                  value={sportFilter}
                  onChange={(e) => setSportFilter(e.target.value as SportFilter)}
                  className="mt-1 w-full rounded-lg border border-[#2e3347] bg-[#121725] px-2 py-1.5 text-[12px] text-[#e8eaf6]"
                >
                  <option value="ALL">All</option>
                  {SUPPORTED_SPORTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-[#5c6480] sm:col-span-2">
                League
                <select
                  value={leagueId}
                  onChange={(e) => setLeagueId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[#2e3347] bg-[#121725] px-2 py-1.5 text-[12px] text-[#e8eaf6]"
                >
                  <option value="">— Select league —</option>
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
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block text-[10px] font-bold uppercase tracking-wide text-[#5c6480]">
                Ranking mode
                <select
                  value={rankingMode}
                  onChange={(e) => setRankingMode(e.target.value as RankingModeId)}
                  className="mt-1 w-full rounded-lg border border-[#2e3347] bg-[#121725] px-2 py-1.5 text-[11px] text-[#e8eaf6]"
                >
                  {RANKING_MODES.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-[#5c6480]">
                Team context
                <select
                  value={teamContext}
                  onChange={(e) => setTeamContext(e.target.value as TeamContextId)}
                  className="mt-1 w-full rounded-lg border border-[#2e3347] bg-[#121725] px-2 py-1.5 text-[11px] text-[#e8eaf6]"
                >
                  {TEAM_CONTEXTS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-[#5c6480]">
                Week (optional)
                <input
                  value={week}
                  onChange={(e) => setWeek(e.target.value.replace(/[^\d]/g, '').slice(0, 2))}
                  placeholder="Auto"
                  className="mt-1 w-full rounded-lg border border-[#2e3347] bg-[#121725] px-2 py-1.5 text-[12px] text-[#e8eaf6] placeholder:text-[#5c6480]"
                />
              </label>
            </div>

            {teamContext === 'specific_team' ? (
              <label className="block text-[10px] font-bold uppercase tracking-wide text-[#5c6480]">
                Team
                <select
                  value={specificTeamExternalId}
                  onChange={(e) => setSpecificTeamExternalId(e.target.value)}
                  disabled={!leagueId || teamsLoading}
                  className="mt-1 w-full rounded-lg border border-[#2e3347] bg-[#121725] px-2 py-1.5 text-[12px] text-[#e8eaf6] disabled:opacity-50"
                >
                  <option value="">{teamsLoading ? 'Loading…' : '— Pick team —'}</option>
                  {leagueTeams.map((t) => (
                    <option key={t.externalId} value={t.externalId}>
                      {t.teamName} ({t.ownerName}){t.isYou ? ' · You' : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <details className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
              <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wide text-[#7a8199]">
                Intelligence toggles
              </summary>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    ['includeProjections', 'Projections'],
                    ['includeScheduleStrength', 'Schedule strength'],
                    ['includeInjuries', 'Injuries'],
                    ['includeTransactionMomentum', 'Transactions'],
                    ['includeRookies', 'Rookies / prospects'],
                    ['includePlayoffHistory', 'Playoff history'],
                    ['includeRecentForm', 'Recent form'],
                    ['includeDynastyWeighting', 'Dynasty weight'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex cursor-pointer items-center gap-2 text-[11px] text-[#c4c9dc]">
                    <input
                      type="checkbox"
                      checked={toggles[key]}
                      onChange={(e) => setToggles((t) => ({ ...t, [key]: e.target.checked }))}
                      className="rounded border-[#3d4460]"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </details>

            {data?.computedAt ? (
              <p className="text-[10px] text-[#5c6480]">
                Updated {new Date(data.computedAt).toLocaleString()}
                {data.week != null ? ` · Week ${data.week}` : ''}
                {data.season ? ` · ${data.season}` : ''}
              </p>
            ) : null}

            {leagueId.trim() && snapshotHistory.length > 0 ? (
              <details className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
                <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wide text-[#7a8199]">
                  Saved snapshots ({rankingMode}) · {snapshotHistory.length}
                </summary>
                <ul
                  className="mt-2 max-h-28 space-y-1 overflow-y-auto text-[10px] text-[#8b93ab] [scrollbar-width:thin]"
                  data-testid="power-rankings-snapshot-history"
                >
                  {snapshotHistory.map((s) => (
                    <li key={`${s.season}-${s.week}-${s.computedAt}`}>
                      S{s.season} Wk {s.week} · {new Date(s.computedAt).toLocaleString()} · {s.engine}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>

          {data?.ok && data.analysisScope === 'league' && myRow ? (
            <div className="rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.07] to-purple-500/[0.03] px-3 py-3">
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-violet-300/80">Your team</p>
              <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-[24px] font-black tabular-nums text-white/95">#{myRow.rank}</p>
                  <p className="text-[13px] font-semibold text-white/85">{myRow.teamName}</p>
                </div>
                <div className="text-right text-[11px] text-white/55">
                  {recordLabel(myRow)} · PF {myRow.pointsFor.toFixed(1)}
                  <br />
                  <span className="text-violet-200/90">{myRow.tierLabel}</span>
                </div>
              </div>
            </div>
          ) : null}

          {/* View tabs */}
          <div className="flex gap-1 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {VIEW_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setViewTab(t.id)}
                className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide transition ${
                  viewTab === t.id
                    ? 'bg-violet-500/20 text-violet-100 border border-violet-500/35'
                    : 'border border-transparent text-[#7a8199] hover:bg-white/[0.04]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {data?.ok && data.analysisScope === 'league' ? (
            <ViewBody
              tab={viewTab}
              teams={data.teams}
              aiNarrative={data.aiNarrative}
              onOpenTeam={setDetail}
            />
          ) : data?.ok && data.analysisScope === 'none' ? (
            <p className="text-[12px] leading-relaxed text-[#8b93ab]">
              {data.aiNarrative ||
                'Select a league to load standings-backed power rankings. With Sport = All, group leagues by sport in the dropdown above.'}
            </p>
          ) : null}

          {data?.dataGaps && data.dataGaps.length > 0 ? (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2">
              <p className="text-[9px] font-bold uppercase tracking-wide text-amber-200/90">Data notes</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-amber-100/85">
                {data.dataGaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </AIToolModalShell>

      {detail ? (
        <TeamDetailDrawer
          team={detail}
          leagueName={data?.leagueName ?? ''}
          leagueId={leagueId}
          rankingMode={rankingMode}
          onClose={() => setDetail(null)}
        />
      ) : null}
    </>
  )
}

function ViewBody({
  tab,
  teams,
  aiNarrative,
  onOpenTeam,
}: {
  tab: ViewTab
  teams: EnrichedTeamRow[]
  aiNarrative: string | null
  onOpenTeam: (t: EnrichedTeamRow) => void
}) {
  if (teams.length === 0) {
    return <p className="text-[12px] text-[#7a8199]">No teams in this view for the selected filters.</p>
  }

  if (tab === 'rankings') {
    return (
      <div className="space-y-1.5">
        {teams.map((t) => (
          <button
            key={`${t.rank}-${t.externalId ?? t.rosterId}`}
            type="button"
            onClick={() => onOpenTeam(t)}
            className="flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-left transition hover:border-violet-500/25"
          >
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[12px] font-black ${
                t.rank <= 3 ? 'bg-amber-500/15 text-amber-200' : 'bg-white/[0.05] text-white/55'
              }`}
            >
              {t.rank}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {t.avatarUrl ? (
                  <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full border border-white/10">
                    <Image src={t.avatarUrl} alt="" fill className="object-cover" sizes="28px" />
                  </span>
                ) : null}
                <p className="truncate text-[12px] font-bold text-white/90">{t.teamName}</p>
                {t.isCurrentUser ? (
                  <span className="rounded bg-violet-500/20 px-1 text-[8px] font-bold uppercase text-violet-100">
                    You
                  </span>
                ) : null}
                <MomentumPill label={t.momentumLabel} />
              </div>
              <p className="truncate text-[10px] text-white/45">
                {recordLabel(t)} · PF {t.pointsFor.toFixed(1)} · {t.tierLabel}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[13px] font-bold tabular-nums text-cyan-200/95">{t.powerScore.toFixed(1)}</p>
              <DeltaBadge delta={t.rankDelta} />
            </div>
          </button>
        ))}
      </div>
    )
  }

  if (tab === 'momentum') {
    const sorted = [...teams].sort((a, b) => (b.rankDelta ?? -999) - (a.rankDelta ?? -999))
    return (
      <div className="space-y-2">
        {sorted.map((t) => (
          <div
            key={t.rosterId}
            className="flex items-center justify-between rounded-lg border border-white/[0.06] px-3 py-2"
          >
            <div>
              <p className="text-[12px] font-semibold text-white/85">{t.teamName}</p>
              <p className="text-[10px] text-white/45">{t.momentumLabel} · recent {t.recentPerformanceScore.toFixed(0)}</p>
            </div>
            <DeltaBadge delta={t.rankDelta} />
          </div>
        ))}
      </div>
    )
  }

  if (tab === 'tiers') {
    const byTier = new Map<string, EnrichedTeamRow[]>()
    for (const t of teams) {
      const k = t.tierLabel
      if (!byTier.has(k)) byTier.set(k, [])
      byTier.get(k)!.push(t)
    }
    return (
      <div className="space-y-3">
        {[...byTier.entries()].map(([tier, list]) => (
          <div key={tier}>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-violet-300/80">{tier}</p>
            <div className="space-y-1">
              {list.map((t) => (
                <button
                  key={t.rosterId}
                  type="button"
                  onClick={() => onOpenTeam(t)}
                  className="flex w-full items-center justify-between rounded-lg border border-white/[0.05] bg-white/[0.02] px-2 py-1.5 text-left text-[11px] text-white/80"
                >
                  <span>
                    #{t.rank} {t.teamName}
                  </span>
                  <span className="tabular-nums text-cyan-200/90">{t.powerScore.toFixed(1)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (tab === 'outlooks') {
    return (
      <div className="space-y-2">
        {teams.map((t) => (
          <button
            key={t.rosterId}
            type="button"
            onClick={() => onOpenTeam(t)}
            className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-left"
          >
            <p className="text-[12px] font-bold text-white/90">
              #{t.rank} {t.teamName}
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-white/55">{t.snippet}</p>
          </button>
        ))}
      </div>
    )
  }

  if (tab === 'playoff') {
    return (
      <div className="space-y-2">
        {teams.map((t) => (
          <div key={t.rosterId} className="rounded-lg border border-white/[0.06] px-3 py-2">
            <p className="text-[12px] font-semibold text-white/85">{t.teamName}</p>
            <p className="text-[11px] text-white/50">
              Playoff field: {t.playoffFieldStatus === 'inside' ? 'Inside cut' : t.playoffFieldStatus === 'bubble' ? 'Bubble' : t.playoffFieldStatus === 'outside' ? 'Outside cut' : 'Unknown (configure playoff teams in league)'}
              {' · '}
              Contender signal: {t.contenderSignal}
            </p>
            {t.contenderFactors?.rationale ? (
              <p className="mt-0.5 text-[10px] text-white/55">{t.contenderFactors.rationale}</p>
            ) : null}
            <p className="mt-1 text-[10px] text-amber-200/80">
              Not sportsbook odds — derived from power components in your league settings.
            </p>
          </div>
        ))}
      </div>
    )
  }

  if (tab === 'sos') {
    const sorted = [...teams].sort((a, b) => b.strengthOfSchedule - a.strengthOfSchedule)
    return (
      <div className="space-y-2">
        {sorted.map((t) => (
          <div key={t.rosterId} className="flex items-center justify-between rounded-lg border border-white/[0.06] px-3 py-2">
            <p className="text-[12px] text-white/85">{t.teamName}</p>
            <p className="text-[12px] font-mono tabular-nums text-sky-200/90">{(t.strengthOfSchedule * 100).toFixed(1)}%</p>
          </div>
        ))}
      </div>
    )
  }

  if (tab === 'roster') {
    return (
      <div className="space-y-2">
        {teams.map((t) => (
          <button
            key={t.rosterId}
            type="button"
            onClick={() => onOpenTeam(t)}
            className="w-full rounded-lg border border-white/[0.06] px-3 py-2 text-left"
          >
            <p className="text-[12px] font-semibold text-white/85">{t.teamName}</p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-500/80 to-cyan-400/80"
                style={{ width: `${Math.min(100, t.rosterStrengthScore)}%` }}
              />
            </div>
            <p className="mt-1 text-[10px] text-white/45">
              Roster {t.rosterStrengthScore.toFixed(1)} · Proj {t.projectionStrengthScore.toFixed(1)}
            </p>
          </button>
        ))}
      </div>
    )
  }

  /* ai */
  return (
    <div className="rounded-xl border border-violet-500/15 bg-violet-500/[0.04] px-3 py-3">
      <div className="mb-2 flex items-center gap-2 text-violet-200/90">
        <Sparkles className="h-4 w-4" />
        <p className="text-[11px] font-bold uppercase tracking-wide">Chimmy summary</p>
      </div>
      {aiNarrative ? (
        <p className="text-[12px] leading-relaxed text-white/75">{aiNarrative}</p>
      ) : (
        <p className="text-[12px] leading-relaxed text-white/55">
          No AI narrative returned (check OpenAI configuration). Use Ask Chimmy with the structured payload from this
          tool.
        </p>
      )}
      <p className="mt-2 text-[10px] text-[#5c6480]">
        Narrative is generated only from structured standings and engine outputs — never from invented stats.
      </p>
    </div>
  )
}

function MomentumPill({ label }: { label: EnrichedTeamRow['momentumLabel'] }) {
  const map: Record<EnrichedTeamRow['momentumLabel'], string> = {
    surging: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/25',
    hot: 'bg-amber-500/15 text-amber-100 border-amber-500/25',
    stable: 'bg-white/[0.04] text-white/45 border-white/10',
    cold: 'bg-sky-500/10 text-sky-200 border-sky-500/20',
    fading: 'bg-red-500/10 text-red-200 border-red-500/25',
  }
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide ${map[label]}`}>
      {label}
    </span>
  )
}

function RankSparkline({ ranks }: { ranks: number[] }) {
  if (ranks.length < 2) return null
  const w = 128
  const h = 40
  const min = Math.min(...ranks)
  const max = Math.max(...ranks)
  const pad = 4
  const pts = ranks
    .map((r, i) => {
      const x = pad + (ranks.length === 1 ? w / 2 - pad : (i / (ranks.length - 1)) * (w - 2 * pad))
      const y = max === min ? h / 2 : pad + ((max - r) / (max - min)) * (h - 2 * pad)
      return `${x},${y}`
    })
    .join(' ')
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="power-rankings-rank-sparkline">
      <svg width={w} height={h} className="shrink-0 text-violet-400/90" viewBox={`0 0 ${w} ${h}`} aria-hidden>
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={pts}
        />
      </svg>
      <p className="max-w-[12rem] text-[10px] leading-snug text-[#5c6480]">
        Rank from saved snapshots (lower is better). Uses real stored standings only.
      </p>
    </div>
  )
}

function DeltaBadge({ delta }: { delta: number | null }) {
  const d = rankDeltaDisplay(delta)
  const cls =
    d.tone === 'up'
      ? 'text-emerald-300'
      : d.tone === 'down'
        ? 'text-red-300'
        : 'text-white/40'
  const Icon = d.tone === 'up' ? TrendingUp : d.tone === 'down' ? TrendingDown : Minus
  return (
    <div className={`inline-flex items-center gap-0.5 text-[10px] font-bold tabular-nums ${cls}`}>
      <Icon className="h-3 w-3" />
      {d.text}
    </div>
  )
}

function TeamDetailDrawer({
  team,
  leagueName,
  leagueId,
  rankingMode,
  onClose,
}: {
  team: EnrichedTeamRow
  leagueName: string
  leagueId: string
  rankingMode: RankingModeId
  onClose: () => void
}) {
  const [trail, setTrail] = useState<number[] | undefined>(undefined)
  const [trailLoading, setTrailLoading] = useState(false)

  useEffect(() => {
    if (!leagueId.trim() || !team.externalId) {
      setTrail(undefined)
      setTrailLoading(false)
      return
    }
    let cancelled = false
    setTrailLoading(true)
    setTrail(undefined)
    fetch(
      `/api/ai-tools/power-rankings/snapshots?leagueId=${encodeURIComponent(leagueId.trim())}&limit=16&rankingMode=${encodeURIComponent(rankingMode)}&teamExternalId=${encodeURIComponent(team.externalId)}`,
    )
      .then((r) => r.json())
      .then((j: { ok?: boolean; rankTrail?: number[] }) => {
        if (cancelled || !j?.ok) return
        setTrail(Array.isArray(j.rankTrail) ? j.rankTrail : [])
      })
      .catch(() => {
        if (!cancelled) setTrail([])
      })
      .finally(() => {
        if (!cancelled) setTrailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId, team.externalId, rankingMode])

  const d = rankDeltaDisplay(team.rankDelta)
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal
      aria-label="Team outlook"
    >
      <button type="button" className="absolute inset-0 bg-black/70" onClick={onClose} aria-label="Close" />
      <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-[#2e3347] bg-[#0b0e14] p-4 shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {team.avatarUrl ? (
              <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-white/10">
                <Image src={team.avatarUrl} alt="" fill className="object-cover" sizes="48px" />
              </span>
            ) : null}
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#5c6480]">
                #{team.rank} {leagueName ? `· ${leagueName}` : ''}
              </p>
              <p className="truncate text-[16px] font-bold text-white/95">{team.teamName}</p>
              <p className="text-[11px] text-white/45">{team.username || 'Manager'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#3d4460] p-1.5 text-[#9ba3bf] hover:bg-white/[0.04]"
            aria-label="Close drawer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5">
            <p className="text-[9px] uppercase text-[#5c6480]">Record</p>
            <p className="font-semibold text-white/90">{recordLabel(team)}</p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5">
            <p className="text-[9px] uppercase text-[#5c6480]">Movement</p>
            <p className={`font-semibold ${d.tone === 'up' ? 'text-emerald-300' : d.tone === 'down' ? 'text-red-300' : 'text-white/50'}`}>
              {d.text}
              {team.prevRank != null ? ` (was #${team.prevRank})` : ''}
            </p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5">
            <p className="text-[9px] uppercase text-[#5c6480]">Points for / against</p>
            <p className="font-semibold text-white/90">
              {team.pointsFor.toFixed(1)} / {team.pointsAgainst.toFixed(1)}
            </p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5">
            <p className="text-[9px] uppercase text-[#5c6480]">SOS (scale)</p>
            <p className="font-semibold text-sky-200/90">{(team.strengthOfSchedule * 100).toFixed(1)}%</p>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-violet-300/80">Signals</p>
          <div className="space-y-1 text-[11px] text-white/65">
            <p>Power {team.powerScore.toFixed(1)} · Momentum {team.momentumLabel} · {team.tierLabel}</p>
            <p>{team.snippet}</p>
          </div>
        </div>

        {trailLoading ? (
          <p className="mt-3 text-[10px] text-[#5c6480]">Loading rank history from snapshots…</p>
        ) : trail && trail.length >= 2 ? (
          <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
            <p className="text-[9px] font-bold uppercase tracking-wide text-[#7a8199]">Rank history (snapshots)</p>
            <RankSparkline ranks={trail} />
            <p className="mt-1 font-mono text-[11px] tabular-nums text-white/55">
              {trail.map((n) => `#${n}`).join(' → ')}
            </p>
          </div>
        ) : trail && trail.length === 1 ? (
          <p className="mt-3 text-[10px] text-[#5c6480]">One saved snapshot for this team — more points appear as rankings are stored over time.</p>
        ) : trail && trail.length === 0 && leagueId.trim() && team.externalId ? (
          <p className="mt-3 text-[10px] text-[#5c6480]">
            No snapshot trail for this team yet in this mode — run power rankings after standings sync to build history.
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={getChimmyChatHrefWithPrompt(
              `Team outlook for ${team.teamName} in ${leagueName || 'this league'} — use my league standings and roster data only.`,
              { source: 'power_rankings_team', teamName: team.teamName },
            )}
            className="inline-flex items-center gap-1 rounded-lg border border-violet-500/35 bg-violet-500/10 px-3 py-1.5 text-[11px] font-semibold text-violet-100"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Ask Chimmy (team)
          </Link>
          <span className="inline-flex items-center gap-1 text-[10px] text-[#5c6480]">
            <ExternalLink className="h-3 w-3" />
            Start/Sit &amp; waivers live in AI Tools grid
          </span>
        </div>
      </div>
    </div>
  )
}
