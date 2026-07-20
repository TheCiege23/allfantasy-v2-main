'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import DemandHeatmap from './DemandHeatmap'
import { WhatChangedPanel, TierLabel, WinWindowPanel } from './RankingsMicroPanels'
import ManagerPsychology from './ManagerPsychology'

interface PositionValue {
  starter: number
  bench: number
  total: number
}

interface DriverType {
  id: string
  polarity: 'UP' | 'DOWN' | 'NEUTRAL'
  impact: number
  evidence: Record<string, any>
}

interface ActionType {
  id: string
  title: string
  why: string
  expectedImpact: 'LOW' | 'MEDIUM' | 'HIGH'
  cta: { label: string; href: string }
}

interface RankExplanation {
  confidence: {
    score: number
    rating: 'HIGH' | 'MEDIUM' | 'LEARNING'
    drivers: DriverType[]
  }
  drivers: DriverType[]
  nextActions: ActionType[]
  valid: boolean
}

interface MotivationalFrame {
  headline: string
  subtext: string
  suggestedAction: string
  tone: 'encouraging' | 'cautionary' | 'neutral' | 'celebratory'
  trigger: string
}

interface RankChangeDriverType {
  id: string
  label: string
  polarity: 'UP' | 'DOWN' | 'NEUTRAL'
  value: number
  prevValue: number | null
  delta: number | null
  unit: string
}

interface ForwardOddsType {
  playoffPct: number
  top3Pct: number
  titlePct: number
  simCount: number
}

interface ConfidenceBadgeType {
  tier: 'GOLD' | 'SILVER' | 'BRONZE'
  label: string
  tooltip: string
}

interface TeamScore {
  rosterId: number
  ownerId: string
  username: string | null
  displayName: string | null
  avatar: string | null
  winScore: number
  powerScore: number
  luckScore: number
  marketValueScore: number
  managerSkillScore: number
  composite: number
  rank: number
  prevRank: number | null
  rankDelta: number | null
  record: { wins: number; losses: number; ties: number }
  pointsFor: number
  pointsAgainst: number
  expectedWins: number
  streak: number
  luckDelta: number
  shouldBeRecord: { wins: number; losses: number }
  bounceBackIndex: number
  motivationalFrame: MotivationalFrame
  starterValue: number
  benchValue: number
  totalRosterValue: number
  pickValue: number
  positionValues: Record<string, PositionValue>
  rosterExposure: Record<string, number>
  portfolioProjection?: { year1: number; year3: number; year5: number; volatilityBand: number }
  marketAdj: number
  phase: string
  explanation: RankExplanation
  badges: { id: string; label: string; icon: string; tier: string }[]
  rankChangeDrivers?: RankChangeDriverType[]
  forwardOdds?: ForwardOddsType
  confidenceBadge?: ConfidenceBadgeType
  rankSparkline?: number[]
}

interface MarketInsight {
  position: string
  premiumPct: number
  sample: number
  label: string
}

interface WeeklyAward {
  id: string
  week: number
  rosterId: number
  title: string
  subtitle: string
  value: number
  evidence: Record<string, any>
}

interface TradeHubShortcut {
  rosterId: number
  headline: string
  body: string
  ldiPos: string
  ldiScore: number
  leverageScore: number
  ctas: Array<{ id: string; label: string; href: string }>
  evidence: { exposureByPos: Record<string, number>; ldiByPos: Record<string, number>; topCurrencyPos: string }
}

interface RankingsData {
  leagueId: string
  leagueName: string
  season: string
  week: number
  phase: string
  isDynasty: boolean
  isSuperFlex: boolean
  teams: TeamScore[]
  weeklyPointsDistribution: { rosterId: number; weeklyPoints: number[] }[]
  computedAt: number
  marketInsights: MarketInsight[]
  ldiChips: { position: string; ldi: number; label: string; type: 'hot' | 'cold' }[]
  weeklyAwards?: { week: number; awards: WeeklyAward[] } | null
  tradeHubShortcuts?: TradeHubShortcut[]
  partnerTendencies?: Array<{ partnerName: string; sample: number; topOverpayPos: string | null; topDiscountPos: string | null }>
  meta?: {
    modelConfidence?: { score: number; rating: 'HIGH' | 'MEDIUM' | 'LOW'; teamsCovered: number; teamsTotal: number; avgDataCoverage: number }
    dataFreshness?: { overall: 'fresh' | 'aging' | 'stale'; avgStalenessHours: number; staleSourceCount: number }
    weightVersion?: string
    weightCalibratedAt?: string
    learnedParams?: any
    segmentKey?: string
    [key: string]: any
  }
}

interface CoachInsight {
  bullets: string[]
  challenge: string
  tone: string
}

interface Props {
  leagueId: string
  leagueName?: string
  username?: string
}

type RankingView = 'power' | 'dynasty' | 'composite'

const BADGE_ICONS: Record<string, string> = {
  crown: '\u{1F451}',
  storm: '\u{26C8}\uFE0F',
  handshake: '\u{1F91D}',
  gem: '\u{1F48E}',
  trophy: '\u{1F3C6}',
  fire: '\u{1F525}',
  clover: '\u{1F340}',
  rocket: '\u{1F680}',
}

function cx(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

const DRIVER_LABELS: Record<string, string> = {
  record_surge: 'Win Streak Surge',
  record_slide: 'Losing Slide',
  points_for_spike: 'Scoring Spike',
  points_for_dip: 'Scoring Dip',
  points_against_luck: 'Schedule Luck',
  power_strength_gain: 'Strong Starters',
  power_strength_drop: 'Weak Starters',
  depth_safety_gain: 'Deep Bench',
  depth_safety_drop: 'Thin Bench',
  luck_positive: 'Running Hot',
  luck_negative: 'Running Cold',
  market_value_gain: 'High Asset Value',
  market_value_drop: 'Low Asset Value',
  league_demand_tailwind: 'Market Tailwind',
  league_demand_headwind: 'Market Headwind',
  trade_edge_positive: 'Trade Edge',
  trade_edge_negative: 'Trade Losses',
  waiver_roi_positive: 'Waiver ROI',
  waiver_roi_negative: 'Poor Waiver ROI',
}

function driverEvidence(d: DriverType): string {
  const e = d.evidence
  switch (d.id) {
    case 'record_surge':
    case 'record_slide':
      return `${e.wins}-${e.losses}, ${e.streak > 0 ? '+' : ''}${e.streak} streak`
    case 'points_for_spike':
    case 'points_for_dip':
      return `Recent avg ${e.pointsForWeek} vs season ${e.pointsForAvg}`
    case 'points_against_luck':
      return `Opp avg ${e.pointsAgainstWeek} vs league ${e.leagueAvgPA}`
    case 'luck_positive':
    case 'luck_negative':
      return `Expected ${e.expectedWins}W, Actual ${e.actualWins}W (${e.delta > 0 ? '+' : ''}${e.delta})`
    case 'power_strength_gain':
    case 'power_strength_drop':
      return `Starter percentile: ${e.psPercentile}%`
    case 'depth_safety_gain':
    case 'depth_safety_drop':
      return `Bench rank #${e.benchRank}, value ${e.benchValue.toLocaleString()}`
    case 'market_value_gain':
    case 'market_value_drop':
      return `Market percentile: ${e.marketPercentile}%`
    case 'trade_edge_positive':
    case 'trade_edge_negative':
      return `${e.avgTradePremiumPct > 0 ? '+' : ''}${e.avgTradePremiumPct}% avg premium (${e.sampleTrades} trades)`
    case 'league_demand_tailwind':
    case 'league_demand_headwind':
      return `LDI: QB ${e.ldiQB ?? '—'}, RB ${e.ldiRB ?? '—'}, WR ${e.ldiWR ?? '—'}, TE ${e.ldiTE ?? '—'}`
    default:
      return ''
  }
}

function ConfidenceBadge({ rating, score }: { rating: string; score: number }) {
  const config = rating === 'HIGH'
    ? { bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', text: 'text-emerald-300' }
    : rating === 'MEDIUM'
    ? { bg: 'bg-amber-500/15', border: 'border-amber-500/30', text: 'text-amber-300' }
    : { bg: 'bg-white/10', border: 'border-white/20', text: 'text-white/50' }

  return (
    <span className={cx('text-[9px] px-2 py-0.5 rounded-full font-semibold border', config.bg, config.border, config.text)}>
      {rating} ({score})
    </span>
  )
}

function TeamConfidenceBadge({ badge }: { badge: ConfidenceBadgeType }) {
  const config = badge.tier === 'GOLD'
    ? { bg: 'bg-amber-500/15', border: 'border-amber-500/30', text: 'text-amber-300', icon: '\u{1F947}' }
    : badge.tier === 'SILVER'
    ? { bg: 'bg-slate-300/15', border: 'border-slate-300/30', text: 'text-slate-300', icon: '\u{1F948}' }
    : { bg: 'bg-orange-700/15', border: 'border-orange-700/30', text: 'text-orange-400', icon: '\u{1F949}' }

  return (
    <div className={cx('flex items-center gap-2 px-3 py-2 rounded-lg border text-[10px]', config.bg, config.border)} title={badge.tooltip}>
      <span className="text-base">{config.icon}</span>
      <div className="flex flex-col">
        <span className={cx('font-semibold', config.text)}>{badge.label}</span>
        <span className="text-white/30 text-[9px] leading-snug">{badge.tooltip}</span>
      </div>
    </div>
  )
}

function ForwardOddsCard({ odds }: { odds: ForwardOddsType }) {
  if (odds.simCount === 0) return null
  const items = [
    { label: 'Playoffs', pct: odds.playoffPct, color: 'text-emerald-400', bar: 'bg-emerald-500' },
    { label: 'Top 3', pct: odds.top3Pct, color: 'text-cyan-400', bar: 'bg-cyan-500' },
    { label: 'Title', pct: odds.titlePct, color: 'text-amber-400', bar: 'bg-amber-500' },
  ]
  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">Forward Odds</span>
        <span className="text-[8px] text-white/20">{odds.simCount.toLocaleString()} sims</span>
      </div>
      {items.map(it => (
        <div key={it.label} className="space-y-0.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-white/50">{it.label}</span>
            <span className={cx('font-bold tabular-nums', it.color)}>{it.pct}%</span>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className={cx('h-full rounded-full transition-all duration-500', it.bar)} style={{ width: `${Math.min(it.pct, 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function RankChangeDriversCard({ drivers }: { drivers: RankChangeDriverType[] }) {
  if (!drivers || drivers.length === 0) return null
  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3 space-y-2">
      <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">Why Rank Changed</span>
      <div className="space-y-1.5">
        {drivers.map(d => {
          const isUp = d.polarity === 'UP'
          const isDown = d.polarity === 'DOWN'
          return (
            <div key={d.id} className={cx(
              'flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[10px]',
              isUp ? 'bg-emerald-500/8 border-emerald-500/20' : isDown ? 'bg-red-500/8 border-red-500/20' : 'bg-white/5 border-white/10',
            )}>
              <span className={cx('text-[10px] font-bold', isUp ? 'text-emerald-400' : isDown ? 'text-red-400' : 'text-white/40')}>
                {isUp ? '\u25B2' : isDown ? '\u25BC' : '\u25CF'}
              </span>
              <div className="flex-1 min-w-0">
                <span className={cx('font-medium', isUp ? 'text-emerald-300' : isDown ? 'text-red-300' : 'text-white/60')}>
                  {d.label}
                </span>
              </div>
              <div className="text-right shrink-0">
                <span className="text-white/70 font-bold tabular-nums">{typeof d.value === 'number' ? d.value : '—'}</span>
                <span className="text-white/25 ml-0.5">{d.unit}</span>
                {d.delta != null && (
                  <span className={cx('ml-1.5 text-[9px] font-semibold', d.delta > 0 ? 'text-emerald-400' : d.delta < 0 ? 'text-red-400' : 'text-white/30')}>
                    {d.delta > 0 ? '+' : ''}{d.delta}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RankSparklineCard({ sparkline, currentRank }: { sparkline: number[]; currentRank: number }) {
  if (!sparkline || sparkline.length < 2) return null
  const invertedPoints = sparkline.map(r => -r)
  const best = Math.min(...sparkline)
  const worst = Math.max(...sparkline)
  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">Rank History</span>
        <div className="flex items-center gap-2 text-[9px] text-white/25">
          <span>Best: #{best}</span>
          <span>Worst: #{worst}</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <MiniSparkline points={invertedPoints} width={120} height={28} />
        <span className="text-xl font-bold text-white/70 tabular-nums">#{currentRank}</span>
      </div>
      <div className="flex gap-1 flex-wrap">
        {sparkline.map((r, i) => (
          <span key={i} className={cx(
            'text-[8px] w-5 text-center rounded py-0.5 tabular-nums',
            r === currentRank ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'bg-white/5 text-white/30',
          )}>
            {r}
          </span>
        ))}
      </div>
    </div>
  )
}

function DriverChip({ driver }: { driver: DriverType }) {
  const label = DRIVER_LABELS[driver.id] || driver.id
  const evidence = driverEvidence(driver)
  const isUp = driver.polarity === 'UP'
  const isDown = driver.polarity === 'DOWN'

  return (
    <div className={cx(
      'text-[10px] px-2.5 py-1.5 rounded-lg border flex flex-col gap-0.5',
      isUp ? 'bg-emerald-500/10 border-emerald-500/20' : isDown ? 'bg-red-500/10 border-red-500/20' : 'bg-white/5 border-white/10',
    )}>
      <div className="flex items-center gap-1.5">
        <span className={cx('text-[9px] font-bold', isUp ? 'text-emerald-400' : isDown ? 'text-red-400' : 'text-white/40')}>
          {isUp ? '\u25B2' : isDown ? '\u25BC' : '\u25CF'}
        </span>
        <span className={cx('font-medium', isUp ? 'text-emerald-300' : isDown ? 'text-red-300' : 'text-white/60')}>
          {label}
        </span>
        <span className="text-white/20 ml-auto text-[9px]">{Math.round(driver.impact * 100)}%</span>
      </div>
      {evidence && <span className="text-white/35 text-[9px] leading-snug pl-4">{evidence}</span>}
    </div>
  )
}

function NextActionButton({ action }: { action: ActionType }) {
  const impactColor = action.expectedImpact === 'HIGH' ? 'bg-cyan-500/15 border-cyan-500/25 text-cyan-300'
    : action.expectedImpact === 'MEDIUM' ? 'bg-purple-500/15 border-purple-500/25 text-purple-300'
    : 'bg-white/5 border-white/15 text-white/50'

  return (
    <div className={cx('rounded-lg border p-2.5', impactColor)}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold">{action.title}</span>
        <span className="text-[8px] uppercase tracking-wider opacity-60">{action.expectedImpact} impact</span>
      </div>
      <p className="text-[9px] opacity-60 mt-0.5 leading-snug">{action.why}</p>
    </div>
  )
}

function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function MiniSparkline({ points, width = 60, height = 20 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return null
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1
  const coords = points.map((p, i) => ({
    x: (i / (points.length - 1)) * width,
    y: height - ((p - min) / range) * (height - 4) - 2,
  }))
  const pathD = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ')
  const trend = points[points.length - 1] >= points[0]
  return (
    <svg width={width} height={height} className="shrink-0">
      <path d={pathD} fill="none" stroke={trend ? '#34d399' : '#f87171'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y} r="2" fill={trend ? '#34d399' : '#f87171'} />
    </svg>
  )
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] text-white/40 w-7 text-right shrink-0 uppercase">{label}</span>
      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className={cx('h-full rounded-full transition-all duration-700', color)} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="text-[9px] font-bold text-white/60 w-5 text-right">{value}</span>
    </div>
  )
}

function RankMovement({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) return <span className="text-white/15 text-xs">—</span>
  if (delta > 0) {
    return <span className="text-red-400 text-[11px] font-bold flex items-center gap-0.5"><span className="text-[9px]">&#x25BC;</span>{Math.abs(delta)}</span>
  }
  return <span className="text-emerald-400 text-[11px] font-bold flex items-center gap-0.5"><span className="text-[9px]">&#x25B2;</span>{Math.abs(delta)}</span>
}

function PhaseLabel({ phase, week }: { phase: string; week: number }) {
  if (phase === 'offseason') return <>Offseason</>
  if (phase === 'post_draft') return <>Post-Draft</>
  if (phase === 'post_season') return <>Postseason</>
  return <>Week {week}</>
}

function HeroCard({ title, subtitle, detail, accent, icon, cta, onCta }: {
  title: string
  subtitle: string
  detail?: string
  accent: string
  icon: string
  cta?: string
  onCta?: () => void
}) {
  return (
    <div className={cx(
      'rounded-xl border p-4 flex flex-col justify-between min-h-[140px] lg:min-h-[180px]',
      accent,
    )}>
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">{icon}</span>
          <span className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">{title}</span>
        </div>
        <div className="text-sm font-bold text-white leading-tight">{subtitle}</div>
        {detail && <div className="text-[11px] text-white/50 mt-1 leading-snug">{detail}</div>}
      </div>
      {cta && (
        <button
          onClick={onCta}
          className="mt-3 text-[10px] font-semibold text-cyan-300 hover:text-cyan-200 self-start transition-colors"
        >
          {cta} &rarr;
        </button>
      )}
    </div>
  )
}

function RankHistoryChart({ teams, weeklyPtsMap, selectedTeam, onSelectTeam }: {
  teams: TeamScore[]
  weeklyPtsMap: Map<number, number[]>
  selectedTeam: number | null
  onSelectTeam: (id: number) => void
}) {
  const teamPts = selectedTeam ? weeklyPtsMap.get(selectedTeam) ?? [] : []
  const teamInfo = teams.find(t => t.rosterId === selectedTeam)

  if (!selectedTeam || teamPts.length < 2) {
    return (
      <div className="text-center py-6">
        <span className="text-xs text-white/30">Select a team to see their weekly performance</span>
      </div>
    )
  }

  const maxPts = Math.max(...teamPts, 1)
  const barWidth = Math.max(8, Math.min(24, Math.floor(280 / teamPts.length) - 2))

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-white/70">{teamInfo?.displayName || teamInfo?.username || 'Team'}</span>
        <span className="text-[10px] text-white/30">Weekly Points</span>
      </div>
      <div className="flex items-end gap-px h-20">
        {teamPts.map((pts, i) => {
          const h = (pts / maxPts) * 100
          return (
            <div key={i} className="flex flex-col items-center flex-1 min-w-0">
              <div
                className="w-full rounded-t bg-gradient-to-t from-cyan-600 to-cyan-400 transition-all duration-300"
                style={{ height: `${h}%`, minHeight: pts > 0 ? '2px' : '0' }}
                title={`Wk ${i + 1}: ${pts.toFixed(1)}`}
              />
            </div>
          )
        })}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[8px] text-white/20">Wk 1</span>
        <span className="text-[8px] text-white/20">Wk {teamPts.length}</span>
      </div>
    </div>
  )
}

export default function LeagueRankingsV2Panel({ leagueId, leagueName, username }: Props) {
  const [data, setData] = useState<RankingsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  /** Non-retryable access outcomes from the member-gated rankings endpoint. */
  const [accessState, setAccessState] = useState<'signed-out' | 'not-member' | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [coachInsights, setCoachInsights] = useState<Record<number, CoachInsight>>({})
  const [loadingCoach, setLoadingCoach] = useState<number | null>(null)
  const [rankingView, setRankingView] = useState<RankingView>('composite')
  const [timelineTeam, setTimelineTeam] = useState<number | null>(null)
  const [yearPlan, setYearPlan] = useState<any>(null)
  const [yearPlanLoading, setYearPlanLoading] = useState(false)
  const [yearPlanError, setYearPlanError] = useState('')

  const fetchRankings = useCallback(async () => {
    setLoading(true)
    setError('')
    setAccessState(null)
    try {
      const res = await fetch(`/api/rankings/league-v2?leagueId=${leagueId}`)
      // Member-gated endpoint: 401/403 are not retryable failures, so they get their own states
      // below rather than the generic "Failed to compute" card with a Retry button.
      if (res.status === 401 || res.status === 403) {
        setAccessState(res.status === 401 ? 'signed-out' : 'not-member')
        return
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        throw new Error(err.error || 'Failed to load rankings')
      }
      const result = await res.json()
      setData(result)
      const uLower = username?.toLowerCase()
      const userTeam = result.teams.find(
        (t: TeamScore) => t.username?.toLowerCase() === uLower || t.displayName?.toLowerCase() === uLower,
      )
      if (userTeam) setTimelineTeam(userTeam.rosterId)
      import("@/lib/telemetry/client").then(m => m.logLegacyToolUsage({ tool: "LeagueRankingsV2Panel", leagueId, action: "run" })).catch(() => {})
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [leagueId, username])

  useEffect(() => { fetchRankings() }, [fetchRankings])

  const requestCoach = async (team: TeamScore) => {
    setLoadingCoach(team.rosterId)
    try {
      const res = await fetch('/api/rankings/league-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team,
          leagueContext: { isDynasty: data?.isDynasty, isSuperFlex: data?.isSuperFlex, week: data?.week, phase: data?.phase },
        }),
      })
      const insight = await res.json()
      setCoachInsights(prev => ({ ...prev, [team.rosterId]: insight }))
    } catch {
      setCoachInsights(prev => ({
        ...prev,
        [team.rosterId]: { bullets: ['AI Coach is temporarily unavailable.'], challenge: '', tone: 'motivational' },
      }))
    } finally {
      setLoadingCoach(null)
    }
  }

  const requestYearPlan = async (team: TeamScore) => {
    setYearPlanLoading(true)
    setYearPlanError('')
    try {
      const positionValues = team.positionValues || {}
      const exposure = team.rosterExposure || {}
      const posStrengths: Record<string, number> = {}
      const weakPositions: string[] = []
      const allPos = Object.keys(positionValues)
      const maxTotal = Math.max(...allPos.map(p => positionValues[p]?.total ?? 0), 1)
      for (const pos of allPos) {
        const score = Math.round(((positionValues[pos]?.total ?? 0) / maxTotal) * 100)
        posStrengths[pos] = score
        if (score < 40) weakPositions.push(pos)
      }
      const topAssets = allPos
        .sort((a, b) => (positionValues[b]?.total ?? 0) - (positionValues[a]?.total ?? 0))
        .slice(0, 3)
        .map(p => `${p} group (${(exposure[p] ?? 0).toFixed(0)}% exposure)`)

      const rosterSignals = allPos.map(pos => ({
        position: pos,
        playerName: `${pos} group`,
        age: null,
        marketValue: positionValues[pos]?.total ?? 0,
        impactScore: posStrengths[pos] ?? 50,
        trend30Day: 0,
      }))

      const portfolio = team.portfolioProjection || { year1: 50, year3: 45, year5: 40 }
      const avgAge = portfolio.year5 >= portfolio.year1 ? 23 : portfolio.year5 < 30 ? 28 : 30
      const phase = team.phase || data?.phase || 'in_season'
      const isContending = team.composite >= 60

      const res = await fetch('/api/rankings/dynasty-roadmap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueType: data?.isDynasty ? 'Dynasty' : 'Redraft',
          isSF: data?.isSuperFlex ?? false,
          goal: isContending ? 'compete' : 'rebuild',
          rosterSignals,
          avgAge,
          totalValue: team.totalRosterValue ?? 0,
          positionStrengths: posStrengths,
          weakPositions,
          topAssets,
          leagueName: data?.leagueName,
        }),
      })
      if (!res.ok) throw new Error('Failed to generate plan')
      const result = await res.json()
      setYearPlan(result.roadmap)
    } catch (err: any) {
      setYearPlanError(err.message || 'Something went wrong')
    } finally {
      setYearPlanLoading(false)
    }
  }

  const weeklyPtsMap = useMemo(() => {
    const m = new Map<number, number[]>()
    if (data?.weeklyPointsDistribution) {
      for (const entry of data.weeklyPointsDistribution) m.set(entry.rosterId, entry.weeklyPoints)
    }
    return m
  }, [data?.weeklyPointsDistribution])

  const sortedTeams = useMemo(() => {
    if (!data?.teams) return []
    if (rankingView === 'power') return [...data.teams].sort((a, b) => b.powerScore - a.powerScore)
    if (rankingView === 'dynasty') return [...data.teams].sort((a, b) => b.marketValueScore - a.marketValueScore)
    return data.teams
  }, [data?.teams, rankingView])

  const userTeam = useMemo(() => {
    const uLower = username?.toLowerCase()
    return data?.teams.find(t => t.username?.toLowerCase() === uLower || t.displayName?.toLowerCase() === uLower) ?? null
  }, [data?.teams, username])

  const heroCards = useMemo(() => {
    if (!data?.teams || data.teams.length === 0) return null
    const champion = sortedTeams[0]

    const hasRankDeltas = data.teams.some(t => t.rankDelta !== null && t.rankDelta !== 0)
    const hasGames = data.teams.some(t => (t.record?.wins ?? 0) + (t.record?.losses ?? 0) > 0)

    let riser: typeof data.teams[0]
    let riserDetail: string
    if (hasRankDeltas) {
      riser = [...data.teams].sort((a, b) => (a.rankDelta ?? 0) - (b.rankDelta ?? 0))[0]
      riserDetail = riser.rankDelta !== null && riser.rankDelta < 0
        ? `+${Math.abs(riser.rankDelta)} spots this week`
        : 'Strong Starters'
    } else if (hasGames) {
      riser = [...data.teams].sort((a, b) => (b.streak ?? 0) - (a.streak ?? 0))[0]
      riserDetail = (riser.streak ?? 0) > 0
        ? `${riser.streak}W streak · ${riser.record?.wins}-${riser.record?.losses}`
        : `${riser.record?.wins}-${riser.record?.losses} · Power ${riser.powerScore}`
    } else {
      riser = [...data.teams].sort((a, b) => (b.starterValue ?? 0) - (a.starterValue ?? 0))[0]
      riserDetail = `Best starters · Value ${(riser.starterValue ?? 0).toLocaleString()}`
    }

    let unluckiest: typeof data.teams[0]
    let unluckyDetail: string
    if (hasGames) {
      unluckiest = [...data.teams].sort((a, b) => (a.luckDelta ?? 0) - (b.luckDelta ?? 0))[0]
      const expectedW = Math.round(unluckiest.expectedWins ?? 0)
      const totalGames = (unluckiest.record?.wins ?? 0) + (unluckiest.record?.losses ?? 0)
      const expectedL = totalGames - expectedW
      unluckyDetail = `Should be ${expectedW}-${expectedL} · Luck: ${(unluckiest.luckDelta ?? 0) > 0 ? '+' : ''}${(unluckiest.luckDelta ?? 0).toFixed(1)}`
    } else {
      unluckiest = [...data.teams].sort((a, b) => (b.marketValueScore ?? 0) - (a.marketValueScore ?? 0))[0]
      unluckyDetail = `Highest market value · Score ${unluckiest.marketValueScore}`
    }

    const hotInsight = data.marketInsights?.[0] ?? null

    return { champion, riser, riserDetail, unluckiest, unluckyDetail, hotInsight }
  }, [data?.teams, data?.marketInsights, sortedTeams])

  const serverAwards = data?.weeklyAwards ?? null

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="w-10 h-10 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
        <span className="text-sm text-white/40">Computing league rankings...</span>
      </div>
    )
  }

  if (accessState) {
    const signedOut = accessState === 'signed-out'
    return (
      <div className="text-center py-12 px-4" data-testid="rankings-v2-access-state">
        <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-3">
          <span className="text-xl">{signedOut ? '🔒' : '👋'}</span>
        </div>
        <p className="text-white/70 text-sm font-medium mb-1">
          {signedOut ? 'Your session has expired' : "You're not in this league"}
        </p>
        <p className="text-white/30 text-xs mb-4 max-w-xs mx-auto">
          {signedOut
            ? 'Sign in again to see rankings for this league.'
            : 'League rankings are only visible to members of that league.'}
        </p>
        {signedOut ? (
          <a
            href="/login"
            data-testid="rankings-v2-signin-link"
            className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors px-4 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20"
          >
            Sign in
          </a>
        ) : null}
      </div>
    )
  }

  if (error) {
    const isNotFound = error.includes('not found') || error.includes('no data')
    return (
      <div className="text-center py-12 px-4">
        <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-3">
          <span className="text-xl">{isNotFound ? '📭' : '⚠️'}</span>
        </div>
        <p className="text-white/70 text-sm font-medium mb-1">
          {isNotFound ? 'No ranking data available yet' : 'Failed to compute league rankings'}
        </p>
        <p className="text-white/30 text-xs mb-4 max-w-xs mx-auto">
          {isNotFound
            ? 'This league may be from a previous season or hasn\'t started yet. Rankings require active roster and matchup data.'
            : error}
        </p>
        <button onClick={fetchRankings} data-testid="rankings-v2-retry-button" className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors px-4 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20">Retry</button>
      </div>
    )
  }

  if (!data) return null

  const coachInsight = userTeam ? coachInsights[userTeam.rosterId] ?? null : null
  const coachLoading = userTeam ? loadingCoach === userTeam.rosterId : false

  return (
    <div className="max-w-[1280px] mx-auto space-y-8" data-testid="rankings-v2-panel">

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 min-h-[64px]">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Rankings</h1>
          <p className="text-xs text-white/40 mt-0.5">
            {data.leagueName} &middot; {data.season}
            {data.computedAt && <> &middot; Updated {timeAgo(data.computedAt)}</>}
            {data.meta?.modelConfidence && (
              <span className={cx(
                'ml-2 inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full border font-medium',
                data.meta.modelConfidence.rating === 'HIGH' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                data.meta.modelConfidence.rating === 'MEDIUM' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
                'bg-red-500/10 border-red-500/20 text-red-400',
              )} title={`Model confidence: ${data.meta.modelConfidence.score}/100, ${data.meta.modelConfidence.teamsCovered}/${data.meta.modelConfidence.teamsTotal} teams covered`}>
                {data.meta.modelConfidence.rating === 'HIGH' ? '\u2713' : data.meta.modelConfidence.rating === 'MEDIUM' ? '\u26A0' : '\u2717'} Model: {data.meta.modelConfidence.score}
              </span>
            )}
            {data.meta?.dataFreshness && (
              <span className={cx(
                'ml-1 inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full border font-medium',
                data.meta.dataFreshness.overall === 'fresh' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                data.meta.dataFreshness.overall === 'aging' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
                'bg-red-500/10 border-red-500/20 text-red-400',
              )} title={`Avg staleness: ${data.meta.dataFreshness.avgStalenessHours}h, ${data.meta.dataFreshness.staleSourceCount} stale sources`}>
                Data: {data.meta.dataFreshness.overall}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-black/40 border border-white/10 rounded-lg overflow-hidden">
            <span className={cx(
              'px-3 py-1.5 text-[11px] font-medium',
              data.phase === 'offseason' ? 'bg-white/10 text-white' : 'text-white/30',
            )}>Offseason</span>
            <span className={cx(
              'px-3 py-1.5 text-[11px] font-medium',
              data.phase === 'post_draft' ? 'bg-white/10 text-white' : 'text-white/30',
            )}>Post-Draft</span>
            {data.phase === 'in_season' && (
              <span className="px-3 py-1.5 text-[11px] font-medium bg-cyan-500/20 text-cyan-300">
                Week {data.week}
              </span>
            )}
            <span className={cx(
              'px-3 py-1.5 text-[11px] font-medium',
              data.phase === 'post_season' ? 'bg-white/10 text-white' : 'text-white/30',
            )}>Postseason</span>
          </div>

          <div className="flex bg-black/40 border border-white/10 rounded-lg overflow-hidden">
            {([
              { id: 'power' as RankingView, label: 'Power' },
              { id: 'dynasty' as RankingView, label: 'Dynasty Outlook' },
              { id: 'composite' as RankingView, label: 'Composite' },
            ]).map(t => (
              <button
                key={t.id}
                onClick={() => setRankingView(t.id)}
                data-testid={`rankings-v2-view-tab-${t.id}`}
                className={cx(
                  'px-3 py-1.5 text-[11px] font-medium transition-all',
                  rankingView === t.id ? 'bg-gradient-to-b from-cyan-500/20 to-purple-500/20 text-white' : 'text-white/30 hover:text-white/60',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <span className={cx(
              'text-[10px] px-2 py-0.5 rounded-full font-semibold border',
              'bg-cyan-500/15 border-cyan-500/30 text-cyan-300',
            )}>
              {data.isDynasty ? 'Dynasty' : 'Redraft'}
            </span>
            <span className={cx(
              'text-[10px] px-2 py-0.5 rounded-full font-semibold border',
              'bg-purple-500/15 border-purple-500/30 text-purple-300',
            )}>
              {data.isSuperFlex ? 'SF' : '1QB'}
            </span>
          </div>
        </div>
      </div>

      {heroCards && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <HeroCard
            title="Champion Favorite"
            subtitle={heroCards.champion.displayName || heroCards.champion.username || `Team ${heroCards.champion.rosterId}`}
            detail={`Rank #${heroCards.champion.rank} · ${heroCards.champion.record.wins}-${heroCards.champion.record.losses} · Score ${heroCards.champion.composite}`}
            accent="bg-gradient-to-br from-amber-900/30 to-amber-800/10 border-amber-500/20"
            icon={BADGE_ICONS.trophy}
          />
          <HeroCard
            title={heroCards.riser.rankDelta !== null && heroCards.riser.rankDelta !== 0 ? 'Biggest Riser' : heroCards.riser.streak && heroCards.riser.streak > 0 ? 'Hot Streak' : 'Strongest Roster'}
            subtitle={heroCards.riser.displayName || heroCards.riser.username || `Team ${heroCards.riser.rosterId}`}
            detail={heroCards.riserDetail}
            accent="bg-gradient-to-br from-emerald-900/30 to-emerald-800/10 border-emerald-500/20"
            icon="⬆️"
          />
          <HeroCard
            title={data.teams.some(t => (t.record?.wins ?? 0) + (t.record?.losses ?? 0) > 0) ? 'Best Process, Worst Luck' : 'Market Leader'}
            subtitle={heroCards.unluckiest.displayName || heroCards.unluckiest.username || `Team ${heroCards.unluckiest.rosterId}`}
            detail={heroCards.unluckyDetail}
            accent="bg-gradient-to-br from-purple-900/30 to-purple-800/10 border-purple-500/20"
            icon={data.teams.some(t => (t.record?.wins ?? 0) + (t.record?.losses ?? 0) > 0) ? '\u{1F340}' : '💰'}
          />
          <HeroCard
            title="Trade Market"
            subtitle={heroCards.hotInsight ? `${heroCards.hotInsight.position} demand ${heroCards.hotInsight.premiumPct > 0 ? '🔥' : '❄️'}` : 'Market Analysis'}
            detail={heroCards.hotInsight?.label || 'Import trades to unlock market data'}
            accent="bg-gradient-to-br from-purple-900/30 to-purple-800/10 border-purple-500/20"
            icon="📊"
            cta="Open Trade Hub"
          />
        </div>
      )}

      {data.ldiChips && data.ldiChips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.ldiChips.map(chip => (
            <span
              key={chip.position}
              className={cx(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border',
                chip.type === 'hot'
                  ? 'bg-red-500/10 border-red-500/25 text-red-300'
                  : 'bg-cyan-500/10 border-cyan-500/25 text-cyan-300',
              )}
            >
              <span>{chip.type === 'hot' ? '\uD83D\uDD25' : '\u2744\uFE0F'}</span>
              <span>{chip.label}</span>
              <span className="text-[10px] opacity-60">LDI {chip.ldi}</span>
            </span>
          ))}
        </div>
      )}

      {sortedTeams.length > 0 && (() => {
        const totalPoints = sortedTeams.reduce((sum, t) => sum + (t.pointsFor || 0), 0)
        const BAR_COLORS = [
          'linear-gradient(to right, #a855f7, #c084fc)',
          'linear-gradient(to right, #ec4899, #f472b6)',
          'linear-gradient(to right, #f97316, #fb923c)',
          'linear-gradient(to right, #06b6d4, #22d3ee)',
          'linear-gradient(to right, #10b981, #34d399)',
          'linear-gradient(to right, #eab308, #facc15)',
          'linear-gradient(to right, #6366f1, #818cf8)',
          'linear-gradient(to right, #ef4444, #f87171)',
          'linear-gradient(to right, #8b5cf6, #a78bfa)',
          'linear-gradient(to right, #14b8a6, #2dd4bf)',
          'linear-gradient(to right, #f59e0b, #fbbf24)',
          'linear-gradient(to right, #3b82f6, #60a5fa)',
          'linear-gradient(to right, #d946ef, #e879f9)',
          'linear-gradient(to right, #84cc16, #a3e635)',
        ]
        return totalPoints > 0 ? (
          <div className="mb-6 glass-card rounded-2xl p-6">
            <h3 className="text-sm font-medium mb-4 flex items-center gap-2 text-white/80">
              League Power Breakdown <span className="text-[10px] text-cyan-400 font-normal">(by total points scored)</span>
            </h3>
            <div className="h-7 bg-gray-900 rounded-full overflow-hidden flex">
              {sortedTeams.map((team, i) => {
                const pct = (team.pointsFor / totalPoints) * 100
                return pct > 0 ? (
                  <div
                    key={team.rosterId}
                    className="h-full flex items-center justify-center text-[10px] font-mono text-white/90 relative group cursor-default transition-all hover:brightness-125"
                    style={{ width: `${pct}%`, background: BAR_COLORS[i % BAR_COLORS.length] }}
                    title={`${team.displayName || team.username || `Team ${team.rosterId}`} — ${team.pointsFor.toFixed(1)} pts (${pct.toFixed(1)}%)`}
                  >
                    {pct > 4 && <span className="group-hover:scale-125 transition-transform truncate px-0.5">{team.rank}</span>}
                  </div>
                ) : null
              })}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
              {sortedTeams.slice(0, 6).map((team, i) => (
                <div key={team.rosterId} className="flex items-center gap-1.5 text-[10px] text-white/50">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: BAR_COLORS[i % BAR_COLORS.length].replace('linear-gradient(to right, ', '').split(',')[0] }} />
                  <span>{team.displayName || team.username || `#${team.rank}`}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">
              {rankingView === 'power' ? 'Power Rankings' : rankingView === 'dynasty' ? 'Dynasty Outlook' : 'Composite Rankings'}
            </span>
            <span className="text-[10px] text-white/25">{sortedTeams.length} teams</span>
          </div>

          <div className="hidden md:grid grid-cols-[40px_1fr_60px_140px_60px_24px] gap-2 px-3 py-1.5 text-[9px] text-white/25 uppercase tracking-wider">
            <span>Rank</span>
            <span>Team</span>
            <span className="text-center">Score</span>
            <span className="text-center">WS / PS / MVS</span>
            <span className="text-center">Trend</span>
            <span />
          </div>

          {sortedTeams.map((team, idx) => {
            const displayRank = rankingView === 'composite' ? team.rank : idx + 1
            const displayScore = rankingView === 'power' ? team.powerScore : rankingView === 'dynasty' ? team.marketValueScore : team.composite
            const isUser = team.username?.toLowerCase() === username?.toLowerCase()
            const isExpanded = expandedId === team.rosterId
            const weeklyPts = weeklyPtsMap.get(team.rosterId) || []
            const recentPts = weeklyPts.slice(-6)
            const explanation = team.explanation
            const upDrivers = explanation?.drivers?.filter(d => d.polarity === 'UP').slice(0, 2) ?? []
            const downDrivers = explanation?.drivers?.filter(d => d.polarity === 'DOWN').slice(0, 1) ?? []

            return (
              <div key={team.rosterId} className={cx(
                'border rounded-xl overflow-hidden transition-all duration-200',
                isUser ? 'border-cyan-500/30 bg-gradient-to-r from-cyan-950/30 to-purple-950/20' : 'border-white/[0.06] bg-white/[0.02]',
                displayRank <= 3 && 'shadow-lg shadow-black/20',
              )}>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : team.rosterId)}
                  data-testid={`rankings-v2-team-toggle-desktop-${team.rosterId}`}
                  className="w-full hidden md:grid grid-cols-[40px_1fr_60px_140px_60px_24px] items-center gap-2 px-3 py-3 text-left hover:bg-white/[0.03] transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <div className={cx(
                      'w-7 h-7 flex items-center justify-center rounded-lg font-bold text-xs',
                      displayRank === 1 ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-black' :
                      displayRank === 2 ? 'bg-gradient-to-br from-slate-300 to-slate-500 text-black' :
                      displayRank === 3 ? 'bg-gradient-to-br from-orange-400 to-orange-600 text-black' :
                      'bg-white/10 text-white/50',
                    )}>
                      {displayRank}
                    </div>
                    <RankMovement delta={team.rankDelta} />
                  </div>

                  <div className="flex items-center gap-2 min-w-0">
                    {team.avatar ? (
                      <img src={`https://sleepercdn.com/avatars/thumbs/${team.avatar}`} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                        {(team.displayName || team.username || '?')[0].toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-white truncate">
                          {team.displayName || team.username || `Team ${team.rosterId}`}
                        </span>
                        {isUser && <span className="text-[8px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded-full font-bold shrink-0">YOU</span>}
                        {team.badges.slice(0, 3).map(b => (
                          <span key={b.id} className="text-xs shrink-0" title={b.label}>{BADGE_ICONS[b.icon] || b.icon}</span>
                        ))}
                        <span className={cx(
                          'text-[8px] px-1.5 py-0.5 rounded-full shrink-0',
                          team.composite > 90 ? 'tier-contender' :
                          team.composite > 80 ? 'tier-frisky' :
                          team.composite > 65 ? 'tier-midpack' :
                          'tier-rebuild',
                        )}>
                          {team.composite > 90 ? 'Contender' : team.composite > 80 ? 'Frisky' : team.composite > 65 ? 'Mid-Pack' : 'Rebuilding'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-white/35">{team.record.wins}-{team.record.losses}{team.record.ties > 0 ? `-${team.record.ties}` : ''}</span>
                        <span className={cx('text-[10px] font-medium', team.streak > 0 ? 'text-emerald-400' : team.streak < 0 ? 'text-red-400' : 'text-white/20')}>
                          {team.streak > 0 ? `${team.streak}W` : team.streak < 0 ? `${Math.abs(team.streak)}L` : ''}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-center">
                    <div className={cx(
                      'text-lg font-bold tabular-nums',
                      displayScore >= 75 ? 'text-emerald-400' :
                      displayScore >= 50 ? 'text-cyan-400' :
                      displayScore >= 30 ? 'text-amber-400' : 'text-red-400',
                    )}>
                      {displayScore}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1 px-2">
                    <ScoreBar label="WS" value={team.winScore} color="bg-emerald-500" />
                    <ScoreBar label="PS" value={team.powerScore} color="bg-cyan-500" />
                    <ScoreBar label="MVS" value={team.marketValueScore} color="bg-purple-500" />
                  </div>

                  <div className="flex justify-center">
                    <MiniSparkline points={recentPts} />
                  </div>

                  <span className={cx(
                    'text-white/20 text-xs transition-transform inline-block text-center',
                    isExpanded ? 'rotate-90' : '',
                  )}>&#x25B6;</span>
                </button>

                <button
                  onClick={() => setExpandedId(isExpanded ? null : team.rosterId)}
                  data-testid={`rankings-v2-team-toggle-mobile-${team.rosterId}`}
                  className="w-full md:hidden flex items-center gap-3 px-3 py-3 text-left hover:bg-white/[0.03] transition-colors"
                >
                  <div className={cx(
                    'w-8 h-8 flex items-center justify-center rounded-lg font-bold text-sm shrink-0',
                    displayRank === 1 ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-black' :
                    displayRank === 2 ? 'bg-gradient-to-br from-slate-300 to-slate-500 text-black' :
                    displayRank === 3 ? 'bg-gradient-to-br from-orange-400 to-orange-600 text-black' :
                    'bg-white/10 text-white/50',
                  )}>
                    {displayRank}
                  </div>

                  {team.avatar ? (
                    <img src={`https://sleepercdn.com/avatars/thumbs/${team.avatar}`} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                      {(team.displayName || team.username || '?')[0].toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold text-white truncate">
                        {team.displayName || team.username || `Team ${team.rosterId}`}
                      </span>
                      {isUser && <span className="text-[8px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded-full font-bold shrink-0">YOU</span>}
                      {team.badges.slice(0, 2).map(b => (
                        <span key={b.id} className="text-xs shrink-0" title={b.label}>{BADGE_ICONS[b.icon] || b.icon}</span>
                      ))}
                      <span className={cx(
                        'text-[8px] px-1.5 py-0.5 rounded-full shrink-0',
                        team.composite > 90 ? 'tier-contender' :
                        team.composite > 80 ? 'tier-frisky' :
                        team.composite > 65 ? 'tier-midpack' :
                        'tier-rebuild',
                      )}>
                        {team.composite > 90 ? 'Contender' : team.composite > 80 ? 'Frisky' : team.composite > 65 ? 'Mid-Pack' : 'Rebuilding'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-white/35">{team.record.wins}-{team.record.losses}{team.record.ties > 0 ? `-${team.record.ties}` : ''}</span>
                      <RankMovement delta={team.rankDelta} />
                      <span className={cx('text-[10px] font-medium', team.streak > 0 ? 'text-emerald-400' : team.streak < 0 ? 'text-red-400' : 'text-white/20')}>
                        {team.streak > 0 ? `${team.streak}W` : team.streak < 0 ? `${Math.abs(team.streak)}L` : ''}
                      </span>
                    </div>
                    <div className="flex gap-1 mt-1.5">
                      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${team.winScore}%` }} />
                      </div>
                      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full bg-cyan-500" style={{ width: `${team.powerScore}%` }} />
                      </div>
                      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full bg-purple-500" style={{ width: `${team.marketValueScore}%` }} />
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className={cx(
                      'text-xl font-bold tabular-nums',
                      displayScore >= 75 ? 'text-emerald-400' :
                      displayScore >= 50 ? 'text-cyan-400' :
                      displayScore >= 30 ? 'text-amber-400' : 'text-red-400',
                    )}>
                      {displayScore}
                    </div>
                    <span className={cx(
                      'text-white/20 text-[10px] transition-transform inline-block',
                      isExpanded ? 'rotate-90' : '',
                    )}>&#x25B6; details</span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-white/[0.05] pt-4 space-y-4" data-testid={`rankings-v2-team-expanded-${team.rosterId}`}>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">Rank Explanation</span>
                      <div className="flex items-center gap-2">
                        {team.confidenceBadge && (
                          <span className={cx(
                            'text-[9px] px-2 py-0.5 rounded-full font-semibold border',
                            team.confidenceBadge.tier === 'GOLD' ? 'bg-amber-500/15 border-amber-500/30 text-amber-300' :
                            team.confidenceBadge.tier === 'SILVER' ? 'bg-slate-300/15 border-slate-300/30 text-slate-300' :
                            'bg-orange-700/15 border-orange-700/30 text-orange-400',
                          )} title={team.confidenceBadge.tooltip}>
                            {team.confidenceBadge.tier === 'GOLD' ? '\u{1F947}' : team.confidenceBadge.tier === 'SILVER' ? '\u{1F948}' : '\u{1F949}'} {team.confidenceBadge.label}
                          </span>
                        )}
                        {explanation && <ConfidenceBadge rating={explanation.confidence.rating} score={explanation.confidence.score} />}
                      </div>
                    </div>

                    <TierLabel team={team as any} />

                    <div className="grid grid-cols-5 gap-1.5">
                      <ScoreBar label="WIN" value={team.winScore} color="bg-emerald-500" />
                      <ScoreBar label="PWR" value={team.powerScore} color="bg-cyan-500" />
                      <ScoreBar label="LCK" value={team.luckScore} color="bg-amber-500" />
                      <ScoreBar label="MKT" value={team.marketValueScore} color="bg-purple-500" />
                      <ScoreBar label="MGR" value={team.managerSkillScore} color="bg-pink-500" />
                    </div>

                    {team.rankChangeDrivers && team.rankChangeDrivers.length > 0 && (
                      <RankChangeDriversCard drivers={team.rankChangeDrivers} />
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {team.forwardOdds && team.forwardOdds.simCount > 0 && (
                        <ForwardOddsCard odds={team.forwardOdds} />
                      )}
                      {team.rankSparkline && team.rankSparkline.length >= 2 && (
                        <RankSparklineCard sparkline={team.rankSparkline} currentRank={team.rank} />
                      )}
                    </div>

                    {team.confidenceBadge && (
                      <TeamConfidenceBadge badge={team.confidenceBadge} />
                    )}

                    {explanation && explanation.valid && explanation.drivers.length > 0 ? (
                      <div className="space-y-1.5">
                        <span className="text-[9px] text-white/30 uppercase tracking-wider">Key Drivers</span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {explanation.drivers.slice(0, 4).map(d => (
                            <DriverChip key={d.id} driver={d} />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="bg-white/[0.03] rounded-lg p-3 text-center">
                        <span className="text-[10px] text-white/30">Not enough data to explain movement this week.</span>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <WhatChangedPanel team={team as any} />
                      <WinWindowPanel team={team as any} />
                    </div>

                    <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                          {'\u{1F340}'} Luck Meter
                        </span>
                        <span className={cx(
                          'text-[10px] font-bold px-2 py-0.5 rounded-full',
                          team.luckScore >= 65 ? 'bg-emerald-500/15 text-emerald-400' :
                          team.luckScore <= 35 ? 'bg-red-500/15 text-red-400' :
                          'bg-amber-500/15 text-amber-400',
                        )}>
                          {team.luckScore >= 65 ? 'Running Hot' : team.luckScore <= 35 ? 'Unlucky' : 'Neutral'}
                        </span>
                      </div>

                      <div className="relative h-4 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className={cx(
                            'absolute top-0 left-0 h-full rounded-full transition-all duration-700',
                            team.luckScore >= 65 ? 'bg-gradient-to-r from-emerald-600 to-emerald-400' :
                            team.luckScore <= 35 ? 'bg-gradient-to-r from-red-600 to-red-400' :
                            'bg-gradient-to-r from-amber-600 to-amber-400',
                          )}
                          style={{ width: `${team.luckScore}%` }}
                        />
                        <div className="absolute top-0 left-1/2 w-px h-full bg-white/20" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-[9px] font-bold text-white/80 drop-shadow-sm">{team.luckScore}</span>
                        </div>
                      </div>
                      <div className="flex justify-between text-[9px] text-white/25">
                        <span>Unlucky</span>
                        <span>Lucky</span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-white/[0.04] rounded-lg p-2.5 text-center">
                          <div className="text-[9px] text-white/30 mb-0.5">Actual Record</div>
                          <div className="text-sm font-bold text-white">{team.record.wins}–{team.record.losses}</div>
                        </div>
                        <div className="bg-white/[0.04] rounded-lg p-2.5 text-center">
                          <div className="text-[9px] text-white/30 mb-0.5">Should-Be Record</div>
                          <div className={cx(
                            'text-sm font-bold',
                            team.luckDelta <= -1.5 ? 'text-emerald-400' :
                            team.luckDelta >= 1.5 ? 'text-amber-400' : 'text-white',
                          )}>
                            {team.shouldBeRecord.wins}–{team.shouldBeRecord.losses}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-center gap-2 text-[10px]">
                        <span className="text-white/40">Luck:</span>
                        <span className={cx(
                          'font-bold',
                          team.luckDelta <= -1 ? 'text-red-400' :
                          team.luckDelta >= 1 ? 'text-emerald-400' : 'text-white/60',
                        )}>
                          {team.luckDelta > 0 ? '+' : ''}{team.luckDelta} wins
                        </span>
                      </div>

                      {team.bounceBackIndex > 0 && team.luckDelta < -0.5 && (
                        <div className="bg-white/[0.03] rounded-lg p-2 flex items-center gap-2">
                          <span className="text-[10px]">{'\u{1F680}'}</span>
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] text-white/30 uppercase tracking-wider">Bounce-Back Index</span>
                              <span className={cx(
                                'text-[10px] font-bold',
                                team.bounceBackIndex >= 70 ? 'text-emerald-400' :
                                team.bounceBackIndex >= 45 ? 'text-amber-400' : 'text-white/50',
                              )}>
                                {team.bounceBackIndex}/100
                              </span>
                            </div>
                            <div className="relative h-1.5 bg-white/5 rounded-full overflow-hidden mt-1">
                              <div
                                className={cx(
                                  'absolute top-0 left-0 h-full rounded-full transition-all duration-500',
                                  team.bounceBackIndex >= 70 ? 'bg-emerald-500' :
                                  team.bounceBackIndex >= 45 ? 'bg-amber-500' : 'bg-white/20',
                                )}
                                style={{ width: `${team.bounceBackIndex}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {team.motivationalFrame && (
                      <div className={cx(
                        'rounded-xl p-3 border',
                        team.motivationalFrame.tone === 'encouraging' ? 'bg-emerald-500/5 border-emerald-500/15' :
                        team.motivationalFrame.tone === 'cautionary' ? 'bg-amber-500/5 border-amber-500/15' :
                        team.motivationalFrame.tone === 'celebratory' ? 'bg-cyan-500/5 border-cyan-500/15' :
                        'bg-white/[0.02] border-white/[0.06]',
                      )}>
                        <div className="flex items-start gap-2">
                          <span className="text-sm mt-0.5">
                            {team.motivationalFrame.tone === 'encouraging' ? '\u{1F4AA}' :
                             team.motivationalFrame.tone === 'cautionary' ? '\u{26A0}\uFE0F' :
                             team.motivationalFrame.tone === 'celebratory' ? '\u{1F389}' : '\u{1F4CA}'}
                          </span>
                          <div className="flex-1 space-y-1.5">
                            <div className="text-[11px] font-semibold text-white leading-tight">
                              {team.motivationalFrame.headline}
                            </div>
                            <div className="text-[10px] text-white/50 leading-relaxed">
                              {team.motivationalFrame.subtext}
                            </div>
                            <div className={cx(
                              'text-[10px] font-medium leading-relaxed',
                              team.motivationalFrame.tone === 'encouraging' ? 'text-emerald-300/70' :
                              team.motivationalFrame.tone === 'cautionary' ? 'text-amber-300/70' :
                              team.motivationalFrame.tone === 'celebratory' ? 'text-cyan-300/70' :
                              'text-white/40',
                            )}>
                              {'\u{2192}'} {team.motivationalFrame.suggestedAction}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-4 gap-2 text-[10px]">
                      {['QB', 'RB', 'WR', 'TE'].map(pos => {
                        const pv = team.positionValues?.[pos]
                        return (
                          <div key={pos} className="bg-white/[0.03] rounded-lg p-2 text-center">
                            <span className="text-white/30 text-[9px]">{pos}</span>
                            <div className="text-white font-semibold text-[11px]">
                              {pv ? (pv.total > 999 ? `${(pv.total / 1000).toFixed(1)}k` : pv.total) : '—'}
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {team.badges.length > 0 && (
                      <div className="flex gap-2 flex-wrap">
                        {team.badges.map(b => (
                          <span key={b.id} className={cx(
                            'inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border',
                            b.tier === 'gold' ? 'bg-amber-500/10 border-amber-500/25 text-amber-300' :
                            b.tier === 'silver' ? 'bg-slate-400/10 border-slate-400/25 text-slate-300' :
                            'bg-orange-400/10 border-orange-400/25 text-orange-300',
                          )}>
                            {BADGE_ICONS[b.icon] || ''} {b.label}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div className="bg-white/[0.03] rounded-lg p-2.5">
                        <div className="text-white/35">Starter Value</div>
                        <div className="text-white font-semibold">{team.starterValue.toLocaleString()}</div>
                      </div>
                      <div className="bg-white/[0.03] rounded-lg p-2.5">
                        <div className="text-white/35">Bench Depth</div>
                        <div className="text-white font-semibold">{team.benchValue.toLocaleString()}</div>
                      </div>
                    </div>

                    {explanation && explanation.valid && explanation.nextActions.length > 0 && (
                      <div className="space-y-1.5">
                        <span className="text-[9px] text-white/30 uppercase tracking-wider">Next Steps</span>
                        <div className="grid grid-cols-1 gap-1.5">
                          {explanation.nextActions.map(a => (
                            <NextActionButton key={a.id} action={a} />
                          ))}
                        </div>
                      </div>
                    )}

                    <ManagerPsychology
                      leagueId={leagueId}
                      rosterId={team.rosterId}
                      username={team.username}
                      teamData={team}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="lg:col-span-4 space-y-4">
          <div className="bg-gradient-to-br from-cyan-950/40 to-purple-950/30 border border-cyan-500/15 rounded-xl p-5 sticky top-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white">Your Coach</h3>
              {userTeam?.explanation ? (
                <ConfidenceBadge rating={userTeam.explanation.confidence.rating} score={userTeam.explanation.confidence.score} />
              ) : (
                <span className={cx(
                  'text-[9px] px-2 py-0.5 rounded-full font-semibold border',
                  'bg-white/10 border-white/20 text-white/50',
                )}>
                  LEARNING
                </span>
              )}
            </div>

            {!userTeam && (
              <p className="text-xs text-white/40">Sign in and import your league to get personalized coaching insights.</p>
            )}

            {userTeam && !coachInsight && !coachLoading && (
              <div className="space-y-3">
                <p className="text-xs text-white/40">Get personalized coaching based on your team's performance, strengths, and opportunities.</p>
                <button
                  onClick={() => requestCoach(userTeam)}
                  data-testid="rankings-v2-coach-insight-button"
                  className="w-full py-2.5 text-xs font-semibold bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 text-white rounded-lg transition-all"
                >
                  Get My Coaching Insight
                </button>
              </div>
            )}

            {coachLoading && (
              <div className="flex items-center gap-3 py-4">
                <div className="w-5 h-5 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
                <span className="text-xs text-white/40">Analyzing your team...</span>
              </div>
            )}

            {coachInsight && (
              <div className="space-y-3">
                <div>
                  <span className="text-[10px] text-emerald-400/70 uppercase tracking-wider font-semibold">What you're doing well</span>
                  {coachInsight.bullets.slice(0, 1).map((b, i) => (
                    <p key={i} className="text-xs text-white/70 mt-1 leading-relaxed">{b}</p>
                  ))}
                </div>
                <div>
                  <span className="text-[10px] text-amber-400/70 uppercase tracking-wider font-semibold">What's holding you back</span>
                  {coachInsight.bullets.slice(1, 2).map((b, i) => (
                    <p key={i} className="text-xs text-white/70 mt-1 leading-relaxed">{b}</p>
                  ))}
                </div>
                <div>
                  <span className="text-[10px] text-cyan-400/70 uppercase tracking-wider font-semibold">1 move to climb</span>
                  {coachInsight.bullets.slice(2, 3).map((b, i) => (
                    <p key={i} className="text-xs text-white/70 mt-1 leading-relaxed">{b}</p>
                  ))}
                </div>
                {coachInsight.challenge && (
                  <div className="bg-amber-500/10 border border-amber-500/15 rounded-lg p-2.5 text-[11px] text-amber-200/80 leading-relaxed">
                    {coachInsight.challenge}
                  </div>
                )}
              </div>
            )}

            {userTeam && !yearPlan && !yearPlanLoading && (
              <button
                onClick={() => requestYearPlan(userTeam)}
                data-testid="rankings-v2-generate-year-plan-button"
                className="w-full mt-4 py-2 text-[11px] font-medium border border-white/10 text-white/40 hover:text-white/70 hover:border-white/20 rounded-lg transition-all"
              >
                Generate 3–5 Year Plan
              </button>
            )}

            {yearPlanLoading && (
              <div className="flex items-center gap-3 py-4 mt-4">
                <div className="w-5 h-5 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
                <span className="text-xs text-white/40">Building your dynasty roadmap...</span>
              </div>
            )}

            {yearPlanError && (
              <div className="mt-4 bg-red-500/10 border border-red-500/15 rounded-lg p-2.5 text-[11px] text-red-300/80">
                {yearPlanError}
              </div>
            )}

            {yearPlan && (
              <div className="mt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-white/60 uppercase tracking-wider">{yearPlan.horizon || '3-5 Year Plan'}</h4>
                  <span className={cx(
                    'text-[10px] px-2 py-0.5 rounded-full font-medium',
                    yearPlan.currentPhase === 'Contending' ? 'bg-emerald-500/15 text-emerald-400' :
                    yearPlan.currentPhase === 'Rebuilding' ? 'bg-red-500/15 text-red-400' :
                    yearPlan.currentPhase === 'Retooling' ? 'bg-amber-500/15 text-amber-400' :
                    'bg-cyan-500/15 text-cyan-400'
                  )}>
                    {yearPlan.currentPhase}
                  </span>
                </div>

                {yearPlan.overallStrategy && (
                  <p className="text-[11px] text-white/50 leading-relaxed">{yearPlan.overallStrategy}</p>
                )}

                {yearPlan.yearPlans?.map((yp: any) => (
                  <div key={yp.year} className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-cyan-400/80 shrink-0">Y{yp.year}</span>
                      <span className="text-[11px] font-semibold text-white/70">{yp.label?.replace(`Year ${yp.year}: `, '') || `Year ${yp.year}`}</span>
                    </div>
                    {yp.priorities?.length > 0 && (
                      <div className="space-y-1">
                        {yp.priorities.map((p: string, i: number) => (
                          <div key={i} className="flex items-start gap-1.5 text-[11px] text-white/50 leading-relaxed">
                            <span className="text-purple-400/60 mt-0.5 shrink-0">&#x25B8;</span>
                            <span>{p}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {yp.keyMoves?.length > 0 && (
                      <div className="space-y-1 pt-1 border-t border-white/[0.04]">
                        <span className="text-[9px] text-white/30 uppercase tracking-wider font-semibold">Key Moves</span>
                        {yp.keyMoves.map((m: string, i: number) => (
                          <p key={i} className="text-[10px] text-white/40 leading-relaxed pl-2">{m}</p>
                        ))}
                      </div>
                    )}
                    {yp.targetPositions?.length > 0 && (
                      <div className="flex gap-1 pt-1">
                        {yp.targetPositions.map((pos: string) => (
                          <span key={pos} className="text-[9px] bg-cyan-500/10 text-cyan-400/70 px-1.5 py-0.5 rounded">{pos}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {yearPlan.riskFactors?.length > 0 && (
                  <div className="bg-amber-500/5 border border-amber-500/10 rounded-lg p-2.5 space-y-1">
                    <span className="text-[9px] text-amber-400/60 uppercase tracking-wider font-semibold">Risk Factors</span>
                    {yearPlan.riskFactors.map((r: string, i: number) => (
                      <p key={i} className="text-[10px] text-amber-200/50 leading-relaxed">{r}</p>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => { setYearPlan(null); setYearPlanError('') }}
                  data-testid="rankings-v2-regenerate-year-plan-button"
                  className="w-full py-1.5 text-[10px] text-white/30 hover:text-white/50 transition-colors"
                >
                  Regenerate Plan
                </button>
              </div>
            )}
          </div>

          {data.marketInsights && data.marketInsights.length > 0 && (
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
              <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">Market Insights</h4>
              <div className="space-y-2">
                {data.marketInsights.slice(0, 4).map(ins => (
                  <div key={ins.position} className="flex items-center gap-2 text-[11px]">
                    <span className={cx(
                      'w-2 h-2 rounded-full shrink-0',
                      ins.premiumPct > 0 ? 'bg-red-400' : 'bg-emerald-400',
                    )} />
                    <span className="text-white/60 flex-1">{ins.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {serverAwards && serverAwards.awards.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5">
            <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">Week {serverAwards.week} Awards</h3>
            <div className="grid grid-cols-2 gap-3">
              {serverAwards.awards.map((award) => {
                const colorMap: Record<string, string> = {
                  top_score: 'text-emerald-400',
                  boss_win: 'text-emerald-400',
                  high_score_margin: 'text-cyan-400',
                  biggest_upset: 'text-amber-400',
                  unluckiest: 'text-purple-400',
                  luckiest: 'text-yellow-400',
                  bounceback_alert: 'text-orange-400',
                  points_against_victim: 'text-red-400',
                }
                return (
                  <div key={award.id} className="bg-white/[0.03] rounded-lg p-3">
                    <div className="text-[10px] text-white/30 mb-1">{award.title}</div>
                    <div className={`text-sm font-bold ${colorMap[award.id] || 'text-white'}`}>{award.subtitle.split(' ')[0]}</div>
                    <div className="text-[10px] text-white/40">{award.subtitle}</div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider">Rank History</h3>
              <select
                value={timelineTeam ?? ''}
                onChange={e => setTimelineTeam(e.target.value ? Number(e.target.value) : null)}
                className="text-[10px] bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-white/60 appearance-none"
              >
                <option value="">Select team</option>
                {data.teams.map(t => (
                  <option key={t.rosterId} value={t.rosterId}>
                    {t.displayName || t.username || `Team ${t.rosterId}`}
                  </option>
                ))}
              </select>
            </div>
            <RankHistoryChart
              teams={data.teams}
              weeklyPtsMap={weeklyPtsMap}
              selectedTeam={timelineTeam}
              onSelectTeam={setTimelineTeam}
            />
          </div>
        </div>
      )}

      {data.tradeHubShortcuts && data.tradeHubShortcuts.length > 0 && (
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5">
          <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">Trade Leverage</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.tradeHubShortcuts.slice(0, 3).map((sc: TradeHubShortcut) => (
              <div key={sc.rosterId} className="bg-white/[0.03] rounded-lg p-4 space-y-2">
                <div className="text-sm font-bold text-cyan-400">{sc.headline}</div>
                <div className="text-[11px] text-white/50 leading-relaxed">{sc.body}</div>
                <div className="flex gap-2 flex-wrap pt-1">
                  {sc.ctas.map((cta) => (
                    <a
                      key={cta.id}
                      href={cta.href}
                      className="text-[10px] px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors"
                    >
                      {cta.label}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <DemandHeatmap leagueId={leagueId} week={data?.week ?? 0} />
    </div>
  )
}
