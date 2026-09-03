'use client'

import Link from 'next/link'
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  Crown,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Swords,
  TrendingUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  buildLineupForSimulationPreset,
  getDefaultScheduleFactorsForPreset,
  getSimulationTeamPresets,
} from '@/lib/matchup-simulator'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import type { CoachEvaluationResult } from '@/lib/fantasy-coach/types'
import type { GlobalFantasyInsights } from '@/lib/global-fantasy-intelligence'
import type { PlatformPowerLeaderboardResult } from '@/lib/platform-power-rankings'

type AdvantageDashboardContext = {
  sport: string
  teamName: string
  week: number
}

type AdvantageSourceKey = 'global' | 'coach' | 'power' | 'simulation'

export interface AdvantageSimulationPreview {
  teamAName: string
  teamBName: string
  favoriteTeam: string
  underdogTeam: string
  favoriteWinProbability: number
  projectedFavoriteScore: number
  projectedUnderdogScore: number
  projectedMargin: number
  iterations: number
  volatilityTag: 'low' | 'medium' | 'high'
  deterministicSeed: number | null
  updatedAt?: string | null
}

export type AdvantageGlobalLoader = (
  context: AdvantageDashboardContext
) => Promise<GlobalFantasyInsights>

export type AdvantageCoachLoader = (
  context: AdvantageDashboardContext
) => Promise<CoachEvaluationResult>

export type AdvantagePowerLoader = (
  context: Pick<AdvantageDashboardContext, 'sport'>
) => Promise<PlatformPowerLeaderboardResult>

export type AdvantageSimulationLoader = (
  context: AdvantageDashboardContext
) => Promise<AdvantageSimulationPreview>

export interface AdvantageDashboardPageProps {
  initialSport?: string
  initialTeamName?: string
  initialWeek?: number
  loadGlobalInsights?: AdvantageGlobalLoader
  loadCoachEvaluation?: AdvantageCoachLoader
  loadPowerRankings?: AdvantagePowerLoader
  loadSimulationPreview?: AdvantageSimulationLoader
}

type MatchupSimulationApiResponse = {
  createdAt?: string | null
  winProbabilityA: number
  winProbabilityB: number
  projectedScoreA: number
  projectedScoreB: number
  iterations: number
  volatilityTag: 'low' | 'medium' | 'high'
  deterministicSeed: number | null
}

type AdvantageDashboardData = {
  global: GlobalFantasyInsights | null
  coach: CoachEvaluationResult | null
  power: PlatformPowerLeaderboardResult | null
  simulation: AdvantageSimulationPreview | null
}

type AdvantageDashboardErrors = Partial<Record<AdvantageSourceKey, string>>

const TOOL_DESTINATIONS = {
  trendAlerts: '/app/trend-feed',
  coachAdvice: '/app/coach',
  // Canonical path. `/app/power-rankings` is a deprecated alias that middleware
  // 307s here (redirectDeprecatedAppRoutes), costing a redirect on every click.
  powerRankings: '/power-rankings',
  simulationInsights: '/app/matchup-simulation',
} as const

async function parseErrorMessage(response: Response, fallback: string) {
  const data = await response.json().catch(() => null)
  return typeof data?.error === 'string' ? data.error : fallback
}

async function defaultLoadGlobalInsights(
  context: AdvantageDashboardContext
): Promise<GlobalFantasyInsights> {
  const params = new URLSearchParams()
  params.set('sport', context.sport)
  params.set('weekOrPeriod', String(context.week))
  params.set('trendLimit', '12')
  params.set('metaWindowDays', '21')

  const response = await fetch(`/api/global-fantasy-intelligence?${params.toString()}`, {
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to load global intelligence'))
  }

  return (await response.json()) as GlobalFantasyInsights
}

async function defaultLoadCoachEvaluation(
  context: AdvantageDashboardContext
): Promise<CoachEvaluationResult> {
  const params = new URLSearchParams()
  params.set('sport', context.sport)
  params.set('teamName', context.teamName)
  params.set('week', String(context.week))

  const response = await fetch(`/api/coach/evaluation?${params.toString()}`, {
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to load coach advice'))
  }

  return (await response.json()) as CoachEvaluationResult
}

async function defaultLoadPowerRankings(
  context: Pick<AdvantageDashboardContext, 'sport'>
): Promise<PlatformPowerLeaderboardResult> {
  const params = new URLSearchParams()
  params.set('sport', context.sport)
  params.set('limit', '5')

  const response = await fetch(`/api/platform/power-rankings?${params.toString()}`, {
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to load power rankings'))
  }

  return (await response.json()) as PlatformPowerLeaderboardResult
}

async function defaultLoadSimulationPreview(
  context: AdvantageDashboardContext
): Promise<AdvantageSimulationPreview> {
  const presets = getSimulationTeamPresets(context.sport)
  const fallbackPresets = getSimulationTeamPresets('NFL')
  const teamA = presets[0] ?? fallbackPresets[0]!
  const teamB = presets[1] ?? fallbackPresets[1] ?? fallbackPresets[0]!

  const response = await fetch('/api/simulation/matchup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sport: context.sport,
      teamAName: teamA.name,
      teamBName: teamB.name,
      weekOrPeriod: context.week,
      iterations: 1500,
      deterministicSeed: `advantage-dashboard|${context.sport}|${context.week}`,
      teamA: {
        mean: teamA.mean,
        stdDev: teamA.stdDev,
        lineup: buildLineupForSimulationPreset(context.sport, teamA),
        scheduleFactors: getDefaultScheduleFactorsForPreset(teamA),
      },
      teamB: {
        mean: teamB.mean,
        stdDev: teamB.stdDev,
        lineup: buildLineupForSimulationPreset(context.sport, teamB),
        scheduleFactors: getDefaultScheduleFactorsForPreset(teamB),
      },
    }),
  })

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to load simulation insights'))
  }

  const data = (await response.json()) as MatchupSimulationApiResponse
  const favoriteIsTeamA = data.winProbabilityA >= data.winProbabilityB

  return {
    teamAName: teamA.name,
    teamBName: teamB.name,
    favoriteTeam: favoriteIsTeamA ? teamA.name : teamB.name,
    underdogTeam: favoriteIsTeamA ? teamB.name : teamA.name,
    favoriteWinProbability: favoriteIsTeamA ? data.winProbabilityA : data.winProbabilityB,
    projectedFavoriteScore: favoriteIsTeamA ? data.projectedScoreA : data.projectedScoreB,
    projectedUnderdogScore: favoriteIsTeamA ? data.projectedScoreB : data.projectedScoreA,
    projectedMargin: Math.abs(data.projectedScoreA - data.projectedScoreB),
    iterations: data.iterations,
    volatilityTag: data.volatilityTag,
    deterministicSeed: data.deterministicSeed,
    updatedAt: data.createdAt ?? null,
  }
}

function formatSportLabel(sport: string) {
  switch (sport) {
    case 'NCAAB':
      return 'NCAA Basketball'
    case 'NCAAF':
      return 'NCAA Football'
    case 'SOCCER':
      return 'Soccer'
    default:
      return sport
  }
}

function formatTrendType(trendType: string | null | undefined) {
  if (!trendType) return 'trend'
  return trendType
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatPercent(value: number | null | undefined, digits = 0) {
  if (value == null || Number.isNaN(value)) return '--'
  return `${(value * 100).toFixed(digits)}%`
}

function formatScore(value: number | null | undefined, digits = 1) {
  if (value == null || Number.isNaN(value)) return '--'
  return value.toFixed(digits)
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleString()
}

function sourcePillClasses(hasError: boolean) {
  if (hasError) return 'border-rose-400/30 bg-rose-500/10 text-rose-200'
  return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100'
}

function simulationVolatilityLabel(volatility: AdvantageSimulationPreview['volatilityTag'] | null) {
  if (volatility === 'high') return 'High volatility'
  if (volatility === 'medium') return 'Medium volatility'
  if (volatility === 'low') return 'Low volatility'
  return 'Simulation ready'
}

function cardStatusLabel(
  loading: boolean,
  error: string | undefined,
  updatedAt: string | null | undefined
) {
  if (loading) return 'Refreshing'
  if (error) return 'Attention needed'
  return updatedAt ? `Updated ${updatedAt}` : 'Live preview'
}

export default function AdvantageDashboardPage({
  initialSport = SUPPORTED_SPORTS[0]!,
  initialTeamName = 'Advantage United',
  initialWeek = 1,
  loadGlobalInsights = defaultLoadGlobalInsights,
  loadCoachEvaluation = defaultLoadCoachEvaluation,
  loadPowerRankings = defaultLoadPowerRankings,
  loadSimulationPreview = defaultLoadSimulationPreview,
}: AdvantageDashboardPageProps) {
  const [sport, setSport] = useState(initialSport)
  const [teamNameInput, setTeamNameInput] = useState(initialTeamName)
  const [week, setWeek] = useState(initialWeek)
  const deferredTeamName = useDeferredValue(teamNameInput.trim())
  const [data, setData] = useState<AdvantageDashboardData>({
    global: null,
    coach: null,
    power: null,
    simulation: null,
  })
  const [errors, setErrors] = useState<AdvantageDashboardErrors>({})
  const [loading, setLoading] = useState(true)

  const loadDashboard = useCallback(async () => {
    const context = {
      sport,
      teamName: deferredTeamName || initialTeamName,
      week,
    }

    setLoading(true)

    const [globalResult, coachResult, powerResult, simulationResult] = await Promise.allSettled([
      loadGlobalInsights(context),
      loadCoachEvaluation(context),
      loadPowerRankings({ sport: context.sport }),
      loadSimulationPreview(context),
    ])

    const nextData: AdvantageDashboardData = {
      global: globalResult.status === 'fulfilled' ? globalResult.value : null,
      coach: coachResult.status === 'fulfilled' ? coachResult.value : null,
      power: powerResult.status === 'fulfilled' ? powerResult.value : null,
      simulation: simulationResult.status === 'fulfilled' ? simulationResult.value : null,
    }

    const nextErrors: AdvantageDashboardErrors = {
      global:
        globalResult.status === 'rejected'
          ? globalResult.reason instanceof Error
            ? globalResult.reason.message
            : 'Failed to load global intelligence'
          : undefined,
      coach:
        coachResult.status === 'rejected'
          ? coachResult.reason instanceof Error
            ? coachResult.reason.message
            : 'Failed to load coach advice'
          : undefined,
      power:
        powerResult.status === 'rejected'
          ? powerResult.reason instanceof Error
            ? powerResult.reason.message
            : 'Failed to load power rankings'
          : undefined,
      simulation:
        simulationResult.status === 'rejected'
          ? simulationResult.reason instanceof Error
            ? simulationResult.reason.message
            : 'Failed to load simulation insights'
          : undefined,
    }

    setData(nextData)
    setErrors(nextErrors)
    setLoading(false)
  }, [
    deferredTeamName,
    initialTeamName,
    loadCoachEvaluation,
    loadGlobalInsights,
    loadPowerRankings,
    loadSimulationPreview,
    sport,
    week,
  ])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  const topTrend = data.global?.trend.strongestSignal ?? null
  const topCoachAction = data.coach?.actionRecommendations[0] ?? null
  const topRankedManager = data.power?.rows[0] ?? null
  const errorEntries = useMemo(
    () =>
      Object.entries(errors).filter(
        (entry): entry is [AdvantageSourceKey, string] => typeof entry[1] === 'string'
      ),
    [errors]
  )
  const heroUpdatedAt = formatTimestamp(
    data.global?.generatedAt ??
      data.coach?.lastEvaluatedAt ??
      data.power?.generatedAt ??
      data.simulation?.updatedAt
  )

  const pulseStats = useMemo(() => {
    if (!data.global && !data.coach) {
      return [
        { id: 'sources', label: 'Sources online', value: loading ? 'Syncing' : '0/4' },
        { id: 'signal', label: 'Trend heat', value: '--' },
        { id: 'projection', label: 'Coach outlook', value: '--' },
      ]
    }

    return [
      {
        id: 'sources',
        label: 'Sources online',
        value: data.global
          ? `${data.global.sourceStatus.availableSources}/4`
          : errorEntries.length === 0
            ? '3/4'
            : '2/4',
      },
      {
        id: 'signal',
        label: 'Trend heat',
        value: data.global ? String(Math.round(data.global.systemScores.trendHeat)) : '--',
      },
      {
        id: 'projection',
        label: 'Coach outlook',
        value:
          data.coach != null
            ? `${formatScore(data.coach.teamSnapshot.adjustedProjection, 1)} pts`
            : '--',
      },
    ]
  }, [data.coach, data.global, errorEntries.length, loading])

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07111a] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.16),_transparent_32%),radial-gradient(circle_at_85%_18%,_rgba(34,197,94,0.12),_transparent_28%),linear-gradient(180deg,_rgba(7,17,26,0.9),_rgba(7,17,26,1))]" />
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] [background-size:32px_32px]" />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04] shadow-[0_24px_120px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          <div className="grid gap-6 px-5 py-6 lg:grid-cols-[1.5fr_0.9fr] lg:px-7">
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-amber-100">
                  <Sparkles className="h-3.5 w-3.5" />
                  Unified Intelligence Surface
                </span>
                <span
                  className={`inline-flex rounded-full border px-3 py-1 text-[11px] ${sourcePillClasses(
                    errorEntries.length > 0
                  )}`}
                >
                  {errorEntries.length > 0
                    ? `${errorEntries.length} source${errorEntries.length === 1 ? '' : 's'} need attention`
                    : 'All core systems responding'}
                </span>
              </div>

              <div className="space-y-3">
                <h1 className="max-w-4xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  Fantasy Advantage Dashboard
                </h1>
                <p className="max-w-3xl text-sm leading-6 text-slate-200/80 sm:text-base">
                  Surface trend alerts, coach advice, power rankings, and matchup simulation reads
                  in one command center. Everything here stays actionable: each card opens the
                  related tool when you need to go deeper.
                </p>
              </div>

              <div className="rounded-3xl border border-white/10 bg-black/25 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/70">
                      Advantage Pulse
                    </p>
                    <p
                      className="mt-2 max-w-3xl text-sm leading-6 text-white/88"
                      data-testid="advantage-hero-summary"
                    >
                      {data.global?.summary ??
                        `${formatSportLabel(sport)} advantage is syncing. The dashboard will combine trend pressure, coach leverage, ranking movement, and matchup probability into one read.`}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-right">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-white/45">
                      Last sync
                    </p>
                    <p className="mt-1 text-sm font-medium text-white">
                      {heroUpdatedAt ?? (loading ? 'Refreshing now' : 'Waiting on data')}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {pulseStats.map((stat) => (
                    <div key={stat.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                        {stat.label}
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-white">{stat.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <Card className="border-white/10 bg-black/25">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <BrainCircuit className="h-5 w-5 text-cyan-300" />
                  Dashboard Controls
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div>
                  <label className="mb-1 block text-sm text-white/70">Sport</label>
                  <Select value={sport} onValueChange={(value) => setSport(value)}>
                    <SelectTrigger className="border-white/10 bg-black/30 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SUPPORTED_SPORTS.map((supportedSport) => (
                        <SelectItem key={supportedSport} value={supportedSport}>
                          {formatSportLabel(supportedSport)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="mb-1 block text-sm text-white/70">Team label</label>
                  <Input
                    value={teamNameInput}
                    onChange={(event) => setTeamNameInput(event.target.value)}
                    className="border-white/10 bg-black/30 text-white placeholder:text-white/35"
                    placeholder="My squad"
                    data-testid="advantage-team-name-input"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm text-white/70">Week / period</label>
                  <Input
                    type="number"
                    min={1}
                    max={38}
                    value={week}
                    onChange={(event) =>
                      setWeek(Math.max(1, Math.min(38, Number(event.target.value || 1))))
                    }
                    className="border-white/10 bg-black/30 text-white"
                    data-testid="advantage-week-input"
                  />
                </div>

                <Button
                  onClick={() => void loadDashboard()}
                  disabled={loading}
                  className="gap-2 bg-amber-500 text-slate-950 hover:bg-amber-400"
                  data-testid="advantage-refresh-button"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Refresh dashboard
                </Button>

                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/70">
                  <p className="font-medium text-white/90">Current focus</p>
                  <p className="mt-1">
                    {formatSportLabel(sport)} / {deferredTeamName || initialTeamName} / Week {week}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {errorEntries.length > 0 && (
          <section className="rounded-3xl border border-rose-400/25 bg-rose-500/10 p-4 text-sm text-rose-100">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-200" />
              <div className="space-y-1">
                <p className="font-medium">Some dashboard sources are unavailable right now.</p>
                <p className="text-rose-100/80">
                  The cards still open their related tools, and healthy sources continue to render.
                </p>
              </div>
            </div>
          </section>
        )}

        <section className="grid gap-4 lg:grid-cols-2">
          <Link
            href={TOOL_DESTINATIONS.trendAlerts}
            prefetch={false}
            className="group block rounded-[28px] border border-amber-400/18 bg-[linear-gradient(145deg,rgba(245,158,11,0.18),rgba(15,23,42,0.88))] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.28)] transition hover:-translate-y-1 hover:border-amber-300/30"
            data-testid="advantage-card-trend-alerts"
            data-advantage-card="trend-alerts"
            data-advantage-href={TOOL_DESTINATIONS.trendAlerts}
            aria-label="Open Trend Feed"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-amber-100">
                  <TrendingUp className="h-5 w-5" />
                  <span className="text-sm font-semibold uppercase tracking-[0.22em]">
                    Trend Alerts
                  </span>
                </div>
                <div>
                  <p className="text-2xl font-semibold text-white">
                    {topTrend?.displayName ?? 'No trend leader yet'}
                  </p>
                  <p className="mt-1 text-sm text-amber-50/85">
                    {topTrend
                      ? `${formatTrendType(topTrend.trendType)} / ${topTrend.team ?? 'Team TBD'} / ${topTrend.position ?? 'Flexible usage'}`
                      : 'Surface the hottest player signal, breakout path, and sell-high pressure.'}
                  </p>
                </div>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-[11px] ${sourcePillClasses(
                  Boolean(errors.global)
                )}`}
              >
                {cardStatusLabel(loading, errors.global, formatTimestamp(data.global?.generatedAt))}
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                  Strongest signal
                </p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {topTrend ? `${Math.round(topTrend.signalStrength)}` : '--'}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                  Avg signal
                </p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {data.global?.trend.averageSignalStrength != null
                    ? Math.round(data.global.trend.averageSignalStrength)
                    : '--'}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                  Best action
                </p>
                <p className="mt-2 text-sm font-medium text-white/90">
                  {topTrend?.recommendation ?? 'Open the feed for the latest trend callout.'}
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between text-sm text-white/80">
              <span>Open Player Trend Feed</span>
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
            </div>
          </Link>

          <Link
            href={TOOL_DESTINATIONS.coachAdvice}
            prefetch={false}
            className="group block rounded-[28px] border border-cyan-400/18 bg-[linear-gradient(145deg,rgba(34,211,238,0.18),rgba(15,23,42,0.88))] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.28)] transition hover:-translate-y-1 hover:border-cyan-300/30"
            data-testid="advantage-card-coach-advice"
            data-advantage-card="coach-advice"
            data-advantage-href={TOOL_DESTINATIONS.coachAdvice}
            aria-label="Open Coach Mode"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-cyan-100">
                  <BrainCircuit className="h-5 w-5" />
                  <span className="text-sm font-semibold uppercase tracking-[0.22em]">
                    Coach Advice
                  </span>
                </div>
                <div>
                  <p className="text-2xl font-semibold text-white">
                    {topCoachAction?.label ?? 'Coach recommendations syncing'}
                  </p>
                  <p className="mt-1 text-sm text-cyan-50/85">
                    {data.coach?.weeklyAdvice ??
                      data.coach?.teamSummary ??
                      'Lineup, waiver, and trade guidance stay tied to your current team context.'}
                  </p>
                </div>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-[11px] ${sourcePillClasses(
                  Boolean(errors.coach)
                )}`}
              >
                {cardStatusLabel(
                  loading,
                  errors.coach,
                  formatTimestamp(data.coach?.lastEvaluatedAt)
                )}
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                  Projection band
                </p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {data.coach ? formatScore(data.coach.teamSnapshot.adjustedProjection, 1) : '--'}
                </p>
                <p className="mt-1 text-[11px] text-white/55">Adjusted weekly outlook</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                  Weakest slot
                </p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {data.coach?.teamSnapshot.weakestSlot ?? '--'}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                  Next move
                </p>
                <p className="mt-2 text-sm font-medium text-white/90">
                  {topCoachAction?.summary ?? 'Open Coach Mode for the latest recommendation stack.'}
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between text-sm text-white/80">
              <span>Open Coach Mode</span>
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
            </div>
          </Link>

          <Link
            href={TOOL_DESTINATIONS.powerRankings}
            prefetch={false}
            className="group block rounded-[28px] border border-emerald-400/18 bg-[linear-gradient(145deg,rgba(16,185,129,0.18),rgba(15,23,42,0.88))] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.28)] transition hover:-translate-y-1 hover:border-emerald-300/30"
            data-testid="advantage-card-power-rankings"
            data-advantage-card="power-rankings"
            data-advantage-href={TOOL_DESTINATIONS.powerRankings}
            aria-label="Open Power Rankings"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-emerald-100">
                  <Crown className="h-5 w-5" />
                  <span className="text-sm font-semibold uppercase tracking-[0.22em]">
                    Power Rankings
                  </span>
                </div>
                <div>
                  <p className="text-2xl font-semibold text-white">
                    {topRankedManager?.displayName ?? topRankedManager?.managerId ?? 'Waiting on leaderboard'}
                  </p>
                  <p className="mt-1 text-sm text-emerald-50/85">
                    {topRankedManager
                      ? `#${topRankedManager.rank} platform power / ${formatPercent(
                          topRankedManager.powerScore,
                          1
                        )} composite score`
                      : 'See who is carrying the strongest platform-wide power score in this sport.'}
                  </p>
                </div>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-[11px] ${sourcePillClasses(
                  Boolean(errors.power)
                )}`}
              >
                {cardStatusLabel(loading, errors.power, formatTimestamp(data.power?.generatedAt))}
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                  Leader legacy
                </p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {topRankedManager?.legacyScore != null
                    ? topRankedManager.legacyScore.toFixed(1)
                    : '--'}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                  Championships
                </p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {topRankedManager?.championshipCount ?? '--'}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                  Managers tracked
                </p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {data.power?.total ?? '--'}
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between text-sm text-white/80">
              <span>Open Power Rankings</span>
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
            </div>
          </Link>

          <Link
            href={TOOL_DESTINATIONS.simulationInsights}
            prefetch={false}
            className="group block rounded-[28px] border border-sky-400/18 bg-[linear-gradient(145deg,rgba(56,189,248,0.18),rgba(15,23,42,0.88))] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.28)] transition hover:-translate-y-1 hover:border-sky-300/30"
            data-testid="advantage-card-simulation-insights"
            data-advantage-card="simulation-insights"
            data-advantage-href={TOOL_DESTINATIONS.simulationInsights}
            aria-label="Open Matchup Simulation"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sky-100">
                  <Swords className="h-5 w-5" />
                  <span className="text-sm font-semibold uppercase tracking-[0.22em]">
                    Simulation Insights
                  </span>
                </div>
                <div>
                  <p className="text-2xl font-semibold text-white">
                    {data.simulation?.favoriteTeam ?? 'Simulation preview syncing'}
                  </p>
                  <p className="mt-1 text-sm text-sky-50/85">
                    {data.simulation
                      ? `${formatPercent(data.simulation.favoriteWinProbability)} favorite over ${
                          data.simulation.underdogTeam
                        }`
                      : 'Run deterministic matchup scenarios with lineup-aware score bands and outcome ranges.'}
                  </p>
                </div>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-[11px] ${sourcePillClasses(
                  Boolean(errors.simulation)
                )}`}
              >
                {loading
                  ? 'Refreshing'
                  : errors.simulation
                    ? 'Attention needed'
                    : simulationVolatilityLabel(data.simulation?.volatilityTag ?? null)}
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                  Favorite score
                </p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {formatScore(data.simulation?.projectedFavoriteScore, 1)}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                  Expected margin
                </p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {formatScore(data.simulation?.projectedMargin, 1)}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                  Iterations
                </p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {data.simulation?.iterations ?? '--'}
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between text-sm text-white/80">
              <span>Open Matchup Simulation</span>
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
            </div>
          </Link>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <Card className="border-white/10 bg-white/[0.04]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <Sparkles className="h-5 w-5 text-amber-300" />
                Platform Pulse Notes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(data.global?.headlines.length ?? 0) > 0 ? (
                data.global!.headlines.slice(0, 3).map((headline) => (
                  <div key={headline.id} className="rounded-2xl border border-white/8 bg-black/20 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-white">{headline.title}</p>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/65">
                        {headline.priority}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-white/72">{headline.summary}</p>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/12 bg-black/20 p-4 text-sm text-white/60">
                  Headline synthesis will appear here once the global intelligence layer returns.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.04]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <BarChart3 className="h-5 w-5 text-cyan-300" />
                Scoreboard
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                  Opportunity index
                </p>
                <p className="mt-2 text-2xl font-semibold text-white">
                  {data.global ? Math.round(data.global.systemScores.opportunityIndex) : '--'}
                </p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                  Risk index
                </p>
                <p className="mt-2 text-2xl font-semibold text-white">
                  {data.global ? Math.round(data.global.systemScores.riskIndex) : '--'}
                </p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                  Coach actions live
                </p>
                <p className="mt-2 text-2xl font-semibold text-white">
                  {data.coach?.actionRecommendations.length ?? '--'}
                </p>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  )
}
