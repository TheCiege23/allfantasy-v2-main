'use client'

import Image from 'next/image'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  Crosshair,
  Loader2,
  Newspaper,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react'
import { AIToolModalShell } from '../AIToolModalShell'
import { currentPathForReturn, readPlanRefusal, type PlanRefusal } from '@/lib/monetization/planRefusal'
import type { UserLeague } from '@/app/dashboard/types'
import { getChimmyChatHrefWithPrompt } from '@/lib/ai-product-layer/UnifiedChimmyEntryResolver'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import type {
  StartSitAnalyzeResult,
  StartSitMode,
  StartSitPlayerRow,
  StartSitRec,
} from '@/lib/ai-tools-start-sit/types'

type SportFilter = 'ALL' | (typeof SUPPORTED_SPORTS)[number]

type PlayerRow = StartSitPlayerRow
type Rec = StartSitRec
type AnalyzeResult = StartSitAnalyzeResult

/** League dropdown: sport-level snapshot without roster (real DB players, not league-scored). */
const GLOBAL_START_SIT = '__af_global__'

const MODES: { id: StartSitMode; label: string; icon: React.ReactNode; tone: string }[] = [
  { id: 'balanced', label: 'Balanced', icon: <Crosshair className="h-3 w-3" />, tone: 'Median EV' },
  { id: 'safe', label: 'Safe floor', icon: <Shield className="h-3 w-3" />, tone: 'Limit variance' },
  { id: 'upside', label: 'Upside', icon: <TrendingUp className="h-3 w-3" />, tone: 'Ceiling' },
]

function RecCard({ title, rec, accent }: { title: string; rec: Rec | null; accent: string }) {
  if (!rec) {
    return (
      <div className="rounded-[10px] border border-[#2e3347] bg-[#161b22] px-3 py-3 text-[11px] text-[#5c6480]">
        <p className="text-[10px] font-bold uppercase tracking-wide text-[#5c6480]">{title}</p>
        <p className="mt-2">Not enough projected data for this pick.</p>
      </div>
    )
  }
  const p = rec.player
  return (
    <div className={`rounded-[10px] border border-[#2e3347] bg-[#161b22] px-3 py-3 ${accent}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-[#5c6480]">{title}</p>
      <div className="mt-2 flex items-start gap-2">
        {p.headshotUrl ? (
          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-[#2e3347]">
            <Image src={p.headshotUrl} alt="" fill className="object-cover" unoptimized />
          </div>
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#2e3347] bg-[#242838] text-[10px] font-bold text-[#5c6480]">
            {p.position}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold text-[#e8eaf6]">{p.name}</p>
          <p className="text-[10px] text-[#5c6480]">
            {p.position} · {p.team}
          </p>
          <div className="mt-1 grid grid-cols-3 gap-1 text-center">
            <div className="rounded-[6px] bg-[#242838] px-1 py-1">
              <p className="text-[8px] text-[#5c6480]">Proj</p>
              <p className="text-[12px] font-bold text-[#e8eaf6]">{p.projectedPoints != null ? p.projectedPoints.toFixed(1) : '—'}</p>
            </div>
            <div className="rounded-[6px] bg-[#242838] px-1 py-1">
              <p className="text-[8px] text-[#5c6480]">Floor</p>
              <p className="text-[12px] font-bold text-[#e8eaf6]">{p.floor != null ? p.floor.toFixed(1) : '—'}</p>
            </div>
            <div className="rounded-[6px] bg-[#242838] px-1 py-1">
              <p className="text-[8px] text-[#5c6480]">Ceil</p>
              <p className="text-[12px] font-bold text-[#e8eaf6]">{p.ceiling != null ? p.ceiling.toFixed(1) : '—'}</p>
            </div>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-[#9ba3bf]">{rec.reason}</p>
          <p className="mt-1 text-[9px] text-[#5c6480]">Confidence {rec.confidence}%</p>
        </div>
      </div>
    </div>
  )
}

export function StartSitModal({
  open,
  onClose,
  leagueId,
  leagueName,
  leagues = [],
  initialSport = 'NFL',
}: {
  open: boolean
  onClose: () => void
  leagueId: string
  leagueName: string
  leagues?: UserLeague[]
  initialSport?: string
}) {
  const [sportFilter, setSportFilter] = useState<SportFilter>('ALL')
  const [activeLeagueId, setActiveLeagueId] = useState(leagueId)
  const [teamExternalId, setTeamExternalId] = useState('')
  const [week, setWeek] = useState('current')
  const [mode, setMode] = useState<StartSitMode>('balanced')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<PlanRefusal | null>(null)
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [leagueTeams, setLeagueTeams] = useState<
    Array<{ externalId: string; teamName: string; ownerName: string; isYou?: boolean }>
  >([])

  useEffect(() => {
    if (!open) return
    const s = (initialSport || 'NFL').toUpperCase()
    const match = SUPPORTED_SPORTS.includes(s as (typeof SUPPORTED_SPORTS)[number])
    setSportFilter(match ? (s as SportFilter) : 'ALL')
    setActiveLeagueId(leagueId)
  }, [open, leagueId, initialSport])

  useEffect(() => {
    if (!open || !activeLeagueId || activeLeagueId === GLOBAL_START_SIT) {
      setLeagueTeams([])
      return
    }
    let cancelled = false
    fetch(`/api/trade-value/league-teams?leagueId=${encodeURIComponent(activeLeagueId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.teams) return
        setLeagueTeams(j.teams)
      })
      .catch(() => {
        if (!cancelled) setLeagueTeams([])
      })
    return () => {
      cancelled = true
    }
  }, [open, activeLeagueId])

  const activeLeague = useMemo(
    () => leagues.find((l) => l.id === activeLeagueId) ?? null,
    [leagues, activeLeagueId],
  )
  const isGlobalMode = activeLeagueId === GLOBAL_START_SIT
  const displayLeagueName = isGlobalMode ? 'Global (sport snapshot)' : activeLeague?.name ?? leagueName

  const canAnalyze = useMemo(() => {
    if (!activeLeagueId) return false
    if (isGlobalMode) return sportFilter !== 'ALL'
    return true
  }, [activeLeagueId, isGlobalMode, sportFilter])

  const filteredLeagues = useMemo(() => {
    if (sportFilter === 'ALL') return leagues
    return leagues.filter((l) => String(l.sport).toUpperCase() === sportFilter)
  }, [leagues, sportFilter])

  const runAnalyze = useCallback(async () => {
    if (!activeLeagueId) {
      setResult(null)
      setError(null)
      setRefusal(null)
      return
    }
    if (isGlobalMode && sportFilter === 'ALL') {
      setError('Select a specific sport for global Start/Sit.')
      setResult(null)
      return
    }
    setLoading(true)
    setError(null)
    setRefusal(null)
    try {
      const effectiveSport =
        sportFilter === 'ALL' && activeLeague
          ? (String(activeLeague.sport).toUpperCase() as SportFilter)
          : sportFilter
      const r = await fetch('/api/ai-tools/start-sit/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sportFilter: effectiveSport,
          leagueId: isGlobalMode ? null : activeLeagueId,
          week,
          mode,
          teamExternalId: teamExternalId || null,
        }),
      })
      const j = (await r.json()) as AnalyzeResult & { ok?: boolean; error?: string; code?: string }
      if (!r.ok || !j.ok) {
        setRefusal(readPlanRefusal(r.status, j, { returnTo: currentPathForReturn() }))
        setError(j.error || 'Analysis failed.')
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
  }, [activeLeagueId, activeLeague, isGlobalMode, sportFilter, week, mode, teamExternalId])

  useEffect(() => {
    if (open && canAnalyze) void runAnalyze()
  }, [open, canAnalyze, runAnalyze])

  const chimmyHref = getChimmyChatHrefWithPrompt(
    result?.chimmyPayload
      ? 'Explain Start/Sit using only the attached structured league and roster payload.'
      : `Start/Sit help for ${displayLeagueName}`,
    {
      leagueId: isGlobalMode ? undefined : activeLeagueId || undefined,
      leagueName: displayLeagueName,
      sport: sportFilter === 'ALL' ? undefined : sportFilter,
      insightType: 'matchup',
      source: 'lineup_tool',
    },
  )

  const badges = result?.leagueSettingsSnapshot?.quickModeBadges
  const quickBadges = Array.isArray(badges) ? (badges as string[]) : []

  return (
    <AIToolModalShell
      open={open}
      onClose={onClose}
      title="Start/Sit"
      subtitle="AI decision engine · live roster data"
      accentColor="cyan"
      icon={<Crosshair className="h-5 w-5" />}
      wide
      loading={false}
      error={error}
      refusal={refusal}
      empty={!canAnalyze}
      emptyMessage={
        isGlobalMode
          ? 'Pick a sport to run a league-agnostic projection snapshot (not your roster or scoring).'
          : 'Choose a league for roster-aware Start/Sit, or pick “Global” plus a sport for a sport snapshot.'
      }
      onRefresh={() => void runAnalyze()}
      refreshing={loading}
      chimmyPrompt={
        result?.chimmyPayload
          ? 'Review Start/Sit with Chimmy — structured context is ready.'
          : `Start/Sit in ${displayLeagueName}`
      }
      chimmyContext={result?.chimmyPayload ?? { source: 'start_sit_modal' }}
      headerBadge={
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
              isGlobalMode
                ? 'border-amber-500/35 bg-amber-500/10 text-amber-100'
                : 'border-cyan-500/25 bg-cyan-500/10 text-cyan-200'
            }`}
          >
            <Activity className="h-3 w-3" />
            {isGlobalMode ? 'Global mode' : 'League mode'}
          </span>
          {result?.sourceFlags ? (
            <>
              <span
                title={
                  result.sourceFlags.sportsDataReady
                    ? 'Normalized sports player data loaded for this roster'
                    : 'Sports data layer unavailable — projections may be partial'
                }
                className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase ${
                  result.sourceFlags.sportsDataReady ? 'bg-emerald-500/15 text-emerald-200' : 'bg-white/5 text-white/35'
                }`}
              >
                Data
              </span>
              <span
                title={
                  result.sourceFlags.injuryNewsLayerReady
                    ? 'Injury/news feed returned headlines for this roster'
                    : 'No injury/news headlines returned for this roster'
                }
                className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase ${
                  result.sourceFlags.injuryNewsLayerReady ? 'bg-emerald-500/15 text-emerald-200' : 'bg-white/5 text-white/35'
                }`}
              >
                News
              </span>
              <span
                title={
                  result.sourceFlags.weatherLayerReady
                    ? 'Weather layer attached for at least one outdoor game'
                    : 'Weather layer inactive (indoor or no outdoor games)'
                }
                className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase ${
                  result.sourceFlags.weatherLayerReady ? 'bg-emerald-500/15 text-emerald-200' : 'bg-white/5 text-white/35'
                }`}
              >
                Wx
              </span>
              <span
                title={
                  result.sourceFlags.leagueScoringApplied
                    ? 'League scoring rules applied to projections'
                    : 'League scoring not applied — generic projections'
                }
                className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase ${
                  result.sourceFlags.leagueScoringApplied ? 'bg-emerald-500/15 text-emerald-200' : 'bg-amber-500/12 text-amber-100/90'
                }`}
              >
                {result.sourceFlags.leagueScoringApplied ? 'Scoring' : 'No lg scoring'}
              </span>
              <span
                title={
                  result.sourceFlags.aiEnvelopeReady
                    ? 'AI time/league envelope attached'
                    : 'AI envelope missing — Chimmy context may be degraded'
                }
                className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase ${
                  result.sourceFlags.aiEnvelopeReady ? 'bg-emerald-500/15 text-emerald-200' : 'bg-white/5 text-white/35'
                }`}
              >
                AI
              </span>
              {result.sourceFlags.strategicCoachingReady !== null ? (
                <span
                  title={
                    result.sourceFlags.strategicCoachingReady
                      ? 'Long-term strategic coaching snapshot attached to AI context'
                      : 'Strategic coaching snapshot unavailable for this league'
                  }
                  className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase ${
                    result.sourceFlags.strategicCoachingReady ? 'bg-emerald-500/15 text-emerald-200' : 'bg-white/5 text-white/35'
                  }`}
                >
                  LT
                </span>
              ) : null}
            </>
          ) : null}
        </div>
      }
    >
      <div className="at-panel mb-3 p-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
          <label className="flex flex-col gap-1">
            <span className="at-section-title !mb-0">Sport</span>
            <select
              value={sportFilter}
              onChange={(e) => {
                setSportFilter(e.target.value as SportFilter)
                setActiveLeagueId('')
              }}
              className="at-select w-full px-2 py-2"
            >
              <option value="ALL">All</option>
              {SUPPORTED_SPORTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 lg:col-span-2">
            <span className="at-section-title !mb-0">League</span>
            <select
              value={activeLeagueId}
              onChange={(e) => {
                const v = e.target.value
                setActiveLeagueId(v)
                if (v === GLOBAL_START_SIT && sportFilter === 'ALL') {
                  setSportFilter('NFL')
                }
                const lg = leagues.find((l) => l.id === v)
                if (lg) setSportFilter(String(lg.sport).toUpperCase() as SportFilter)
                setTeamExternalId('')
              }}
              className="at-select w-full px-2 py-2"
              disabled={filteredLeagues.length === 0 && leagues.length === 0}
            >
              <option value="">— Select league —</option>
              <option value={GLOBAL_START_SIT}>Global (sport snapshot — not your roster)</option>
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
          <label className="flex flex-col gap-1">
            <span className="at-section-title !mb-0">Team</span>
            <select
              value={teamExternalId}
              onChange={(e) => setTeamExternalId(e.target.value)}
              className="at-select w-full px-2 py-2"
              disabled={!activeLeagueId || leagueTeams.length === 0}
            >
              <option value="">My team (default)</option>
              {leagueTeams.map((t) => (
                <option key={t.externalId} value={t.externalId}>
                  {t.teamName || t.ownerName}
                  {t.isYou ? ' (you)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="at-section-title !mb-0">Week</span>
            <select value={week} onChange={(e) => setWeek(e.target.value)} className="at-select w-full px-2 py-2">
              <option value="current">Current</option>
              <option value="next">Next</option>
              {Array.from({ length: 18 }, (_, i) => (
                <option key={i + 1} value={String(i + 1)}>
                  Week {i + 1}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={`at-lens-btn flex min-w-[100px] flex-1 flex-col items-center gap-0.5 py-2 sm:flex-row sm:justify-center ${
              mode === m.id ? 'at-lens-btn--active' : ''
            }`}
          >
            <span className="inline-flex items-center gap-1 text-[12px] font-semibold">
              {m.icon} {m.label}
            </span>
            <span className={`text-[10px] opacity-80 ${mode === m.id ? 'text-[#5b8ef0]' : 'text-[#5c6480]'}`}>
              {m.tone}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-[#5c6480]">
          <Loader2 className="h-5 w-5 animate-spin text-cyan-400" /> Building lineup intelligence…
        </div>
      ) : null}

      {result && !loading ? (
        <>
          {result.summary ? (
            <p className="mb-2 text-[11px] leading-snug text-sky-200/75">{result.summary}</p>
          ) : null}
          {result.bestBallInformational ? (
            <div className="mb-3 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-[11px] text-amber-100/90">
              Best ball: optimal lineup scoring runs automatically — these picks are informational, not manual
              start/sit.
            </div>
          ) : null}
          {result.timeContext ? (
            <div className="mb-3 rounded-lg border border-white/[0.08] bg-[#0d111a] px-3 py-2 text-[10px] text-white/55">
              <span className="font-semibold text-white/70">Time · </span>
              Local {result.timeContext.userLocalTime ?? '—'} ({result.timeContext.userTimezone ?? '—'})
              {result.timeContext.timezoneMismatch ? (
                <span className="text-amber-200/85"> · device TZ differs from account — server time is truth</span>
              ) : null}
              {result.lockStatusLabel ? (
                <span className="mt-1 block text-sky-200/80">{result.lockStatusLabel}</span>
              ) : null}
              {result.timeContext.nextLockTimeUTC && result.timeContext.timeUntilNextLockMs != null ? (
                <span className="mt-1 block text-white/45">
                  Next lock UTC: {result.timeContext.nextLockTimeUTC}
                </span>
              ) : null}
            </div>
          ) : null}
          {result.validation && !result.validation.rosterLoaded ? (
            <p className="mb-2 text-[11px] text-amber-200/85">
              Roster not synced — connect your league import for full Start/Sit.
            </p>
          ) : null}
          {result.dataQuality === 'degraded' ? (
            <p className="mb-2 text-[11px] text-amber-200/85">Partial data — confidence is reduced; review gaps below.</p>
          ) : null}
          <div className="at-panel mb-3 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#5c6480]">{result.weekLabel}</p>
              <p className="text-[14px] font-semibold text-[#e8eaf6]">{result.leagueName}</p>
              <p className="mt-1 text-[11px] text-[#9ba3bf]">{result.reasoning.league}</p>
              {quickBadges.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {quickBadges.map((b) => (
                    <span
                      key={b}
                      className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#9ba3bf]"
                    >
                      {b}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="text-right">
              <p className="at-section-title !mb-0 text-right">Confidence</p>
              <p className="text-[22px] font-bold tabular-nums text-[#00d4aa]">{result.confidenceScore}%</p>
            </div>
          </div>

          <div className="at-panel mb-3 px-4 py-3">
            <p className="at-section-title mb-2 flex items-center gap-2">
              <Target className="h-3.5 w-3.5 text-cyan-400" /> Team context
            </p>
            <p className="text-[12px] text-[#9ba3bf]">{result.reasoning.team}</p>
            {result.opponent?.name ? (
              <p className="mt-2 text-[12px] font-semibold text-[#e8eaf6]">
                Opponent: <span className="text-cyan-300">{result.opponent.name}</span>
              </p>
            ) : null}
            {result.matchupNotes.map((n, i) => (
              <p key={i} className="mt-1 text-[11px] text-[#5c6480]">
                {n}
              </p>
            ))}
          </div>

          <p className="at-section-title mb-2">AI recommendations (data-grounded)</p>
          <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <RecCard title="Primary start" rec={result.recommendations.bestStart} accent="border-l-[3px] border-l-cyan-500/70" />
            <RecCard title="Sit candidate" rec={result.recommendations.bestSit} accent="border-l-[3px] border-l-rose-500/50" />
            <RecCard title="Safest" rec={result.recommendations.safest} accent="border-l-[3px] border-l-emerald-500/50" />
            <RecCard title="Upside" rec={result.recommendations.upside} accent="border-l-[3px] border-l-amber-500/50" />
            <RecCard title="Floor play" rec={result.recommendations.floorOption} accent="border-l-[3px] border-l-sky-500/50" />
          </div>
          {result.lineupSlotAnalysis && result.lineupSlotAnalysis.some((s) => s.canLateSwap !== null) ? (
            <div className="at-panel mb-3 px-3 py-2">
              <p className="at-section-title mb-1">Slot lock status</p>
              <div className="flex flex-wrap gap-1.5">
                {result.lineupSlotAnalysis.map((s, i) => {
                  const tone =
                    s.canLateSwap === true
                      ? 'bg-emerald-500/12 text-emerald-200 border-emerald-500/30'
                      : s.canLateSwap === false
                        ? 'bg-rose-500/12 text-rose-200 border-rose-500/30'
                        : 'bg-white/5 text-white/45 border-white/10'
                  const label =
                    s.canLateSwap === true ? 'Swap OK' : s.canLateSwap === false ? 'Locked' : 'No game data'
                  return (
                    <span
                      key={`${s.slotName}-${i}`}
                      title={s.topCandidateGameStart ? `Top candidate game: ${new Date(s.topCandidateGameStart).toLocaleString()}` : 'No game time available'}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${tone}`}
                    >
                      {s.slotName} · {label}
                    </span>
                  )
                })}
              </div>
            </div>
          ) : null}
          {result.unresolvedDecisions && result.unresolvedDecisions.length > 0 ? (
            <div className="at-panel mb-3 px-3 py-2">
              <p className="at-section-title mb-1">Close calls (same-slot)</p>
              <ul className="space-y-1 text-[10px] text-[#9ba3bf]">
                {result.unresolvedDecisions.map((u, i) => (
                  <li key={`${u.slotLabel}-${i}`}>
                    <span className="font-semibold text-[#e8eaf6]">{u.slotLabel}</span>: {u.optionA} vs {u.optionB}{' '}
                    <span className="text-white/45">(~{u.projectedGap} pts)</span>
                    {u.informationalOnly ? (
                      <span className="text-amber-200/80"> · informational (best ball)</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mb-3 grid gap-3 md:grid-cols-2">
            <div className="at-panel p-3">
              <div className="mb-2 flex items-center gap-2">
                <Newspaper className="h-3.5 w-3.5 text-[#f06060]" />
                <p className="at-section-title !mb-0">Injury & news (real feeds)</p>
              </div>
              <ul className="max-h-[140px] space-y-2 overflow-y-auto text-[11px] text-[#9ba3bf] [scrollbar-width:thin]">
                {result.injuryNewsNotes.length === 0 ? (
                  <li className="text-[#5c6480]">No headlines returned for this snapshot.</li>
                ) : (
                  result.injuryNewsNotes.map((line, i) => (
                    <li key={i} className="border-b border-[#2e3347]/80 pb-2 last:border-0">
                      {line}
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div className="at-panel p-3">
              <p className="at-section-title mb-2">Matchup notes</p>
              <ul className="text-[11px] text-[#9ba3bf]">
                {result.matchupNotes.length === 0 ? (
                  <li className="text-[#5c6480]">No extra matchup notes.</li>
                ) : (
                  result.matchupNotes.map((n, i) => <li key={i}>{n}</li>)
                )}
              </ul>
            </div>
          </div>

          <p className="at-section-title mb-2">Roster (live DB)</p>
          <div className="at-panel overflow-x-auto p-0">
            <table className="w-full min-w-[520px] text-left text-[11px]">
              <thead className="border-b border-[#2e3347] bg-[#161b22] text-[9px] font-bold uppercase tracking-wide text-[#5c6480]">
                <tr>
                  <th className="px-2 py-2">Player</th>
                  <th className="px-2 py-2">Pos</th>
                  <th className="px-2 py-2">Proj</th>
                  <th className="px-2 py-2">Floor</th>
                  <th className="px-2 py-2">Ceil</th>
                  <th className="px-2 py-2">RI FPPG</th>
                  <th className="px-2 py-2">Injury</th>
                </tr>
              </thead>
              <tbody>
                {result.players.map((p) => (
                  <tr key={p.playerId} className="border-b border-[#2e3347]/60">
                    <td className="px-2 py-2 font-semibold text-[#e8eaf6]">{p.name}</td>
                    <td className="px-2 py-2 text-[#9ba3bf]">{p.position}</td>
                    <td className="px-2 py-2 tabular-nums">{p.projectedPoints != null ? p.projectedPoints.toFixed(1) : '—'}</td>
                    <td className="px-2 py-2 tabular-nums">{p.floor != null ? p.floor.toFixed(1) : '—'}</td>
                    <td className="px-2 py-2 tabular-nums">{p.ceiling != null ? p.ceiling.toFixed(1) : '—'}</td>
                    <td className="px-2 py-2 tabular-nums">{p.rollingFppg != null ? p.rollingFppg.toFixed(1) : '—'}</td>
                    <td className="px-2 py-2 text-[10px] text-amber-200/90">{p.injuryStatus ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.dataGaps.length > 0 ? (
            <p className="mt-3 text-[10px] text-amber-200/85">
              Data gaps: {result.dataGaps.slice(0, 4).join(' · ')}
              {result.dataGaps.length > 4 ? '…' : ''}
            </p>
          ) : null}
          <p className="mt-1 text-[9px] text-[#5c6480]">Updated {new Date(result.dataFreshness).toLocaleString()}</p>
        </>
      ) : null}

      <div className="at-panel mt-4 border-[#2e3347] bg-[#161b22] p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[#a78bfa]/50 bg-[rgba(167,139,250,0.12)] text-[11px] font-bold text-[#a78bfa]">
            C
          </div>
          <div>
            <p className="text-[13px] font-semibold text-[#a78bfa]">Ask Chimmy</p>
            <p className="text-[9px] text-[#5c6480]">Uses structured roster + league payload when analysis has run</p>
          </div>
        </div>
        <Link
          href={chimmyHref}
          className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#a78bfa]/40 bg-[rgba(167,139,250,0.1)] px-3 py-2 text-[11px] font-semibold text-[#a78bfa] no-underline hover:bg-[rgba(167,139,250,0.18)]"
        >
          <Sparkles className="h-3.5 w-3.5" /> Open in Messages AI
        </Link>
        <p className="mt-2 text-[11px] text-[#5c6480]">
          Projections and floors use your `sports_players` row and league scoring hints — nothing is invented.
        </p>
      </div>
    </AIToolModalShell>
  )
}
