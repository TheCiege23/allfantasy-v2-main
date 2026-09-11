'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import NextLink from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Play, Pause, SkipForward, RefreshCw, Download, RotateCcw, Users, Loader2, Link, ArrowUp, ArrowDown, X, TrendingUp, TrendingDown, Minus, Star, Handshake, Check, Newspaper, Beaker, Zap, Clock3, Bot } from 'lucide-react'
import { useAI } from '@/hooks/useAI'
import { toast } from 'sonner'
import { AIDraftAssistantPanel } from '@/components/mock-draft'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { getManagerColorBySeed, withAlpha } from '@/lib/draft-room/ManagerColorResolver'
import { MOCK_DRAFT_ROSTER_HINT_DELAY_MS } from '@/lib/draft-room/mock-draft-ui-constants'

interface ADPPlayer {
  name: string
  position: string
  team: string | null
  adp: number
  adpTrend: number | null
  value: number | null
}

interface LeagueOption {
  id: string
  name: string
  platform: string
  leagueSize: number
  isDynasty: boolean
  scoring: string | null
  sport?: string
}

interface InitialMockConfig {
  rounds?: number
  draftType?: 'snake' | 'linear' | 'auction'
  scoring?: string
  aiEnabled?: boolean
}

interface VolatilityMeter {
  chaosLevel: 'low' | 'medium' | 'high'
  chaosScore: number
  confidenceBands: { high: number; mid: number; low: number }
  tierStability: 'stable' | 'fragile'
  tierSpread: number
  topConcentration: number
}

interface AIScorecard {
  adpWeight: number
  teamNeedWeight: number
  managerTendencyWeight: number
  newsImpactWeight: number
  rookieRankBoostWeight: number
  total: number
}

interface BoardForecast {
  overall: number
  round: number
  pick: number
  manager: string
  topTargets: Array<{ player: string; position: string; probability: number; why: string; scorecard?: AIScorecard }>
  volatility: VolatilityMeter
}

interface SnipeAlert {
  player: string
  position: string
  adp: number
  value: number
  snipeProbability: number
  snipedByManagers: Array<{ manager: string; probability: number }>
  expectedValueLost: number
  urgencyLevel: 'critical' | 'warning' | 'watch'
}

interface SnipeRadarEntry {
  userPickOverall: number
  round: number
  pick: number
  picksBefore: number
  alerts: SnipeAlert[]
  topAvailableIfNoSnipe: Array<{ player: string; position: string; probability: number }>
}

interface TradeOffer {
  rank: number
  direction: 'up' | 'down'
  partnerManager: string
  userGives: Array<{ pickOverall: number; round: number; pick: number; value: number }>
  userGets: Array<{ pickOverall: number; round: number; pick: number; value: number }>
  netEV: number
  grossEV: number
  acceptanceOdds: number
  riskAdjustedEV: number
  minimumAsk: { pickOverall: number; round: number; value: number }
  walkAwayThreshold: number
  topPlayerGain: string | null
  verdict: string
}

interface AdpMover {
  name: string
  adjustedAdp: number
  delta: number
  reasons: string[]
}

interface DraftPick {
  round: number
  pick: number
  overall: number
  playerName: string
  position: string
  team: string
  manager: string
  managerAvatar?: string
  confidence: number
  isUser: boolean
  value: number
  notes: string
  isBotPick?: boolean
}

const POSITION_COLORS: Record<string, string> = {
  QB: 'text-red-400 bg-red-500/15 border-red-500/30',
  RB: 'text-cyan-400 bg-cyan-500/15 border-cyan-500/30',
  WR: 'text-green-400 bg-green-500/15 border-green-500/30',
  TE: 'text-purple-400 bg-purple-500/15 border-purple-500/30',
  K: 'text-amber-400 bg-amber-500/15 border-amber-500/30',
  DEF: 'text-slate-400 bg-slate-500/15 border-slate-500/30',
  PG: 'text-sky-400 bg-sky-500/15 border-sky-500/30',
  SG: 'text-orange-400 bg-orange-500/15 border-orange-500/30',
  SF: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30',
  PF: 'text-fuchsia-400 bg-fuchsia-500/15 border-fuchsia-500/30',
  C: 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30',
  OF: 'text-teal-400 bg-teal-500/15 border-teal-500/30',
  P: 'text-rose-400 bg-rose-500/15 border-rose-500/30',
  LW: 'text-cyan-400 bg-cyan-500/15 border-cyan-500/30',
  RW: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30',
  D: 'text-indigo-400 bg-indigo-500/15 border-indigo-500/30',
  G: 'text-orange-400 bg-orange-500/15 border-orange-500/30',
  MID: 'text-sky-400 bg-sky-500/15 border-sky-500/30',
  FWD: 'text-red-400 bg-red-500/15 border-red-500/30',
  GK: 'text-amber-400 bg-amber-500/15 border-amber-500/30',
  '1B': 'text-blue-400 bg-blue-500/15 border-blue-500/30',
  '2B': 'text-cyan-400 bg-cyan-500/15 border-cyan-500/30',
  '3B': 'text-indigo-400 bg-indigo-500/15 border-indigo-500/30',
  SS: 'text-violet-400 bg-violet-500/15 border-violet-500/30',
}

const FLEXISH_SLOTS = new Set(['FLEX', 'SUPER_FLEX', 'OP', 'UTIL', 'BENCH', 'BN', 'IR', 'G', 'F'])

function normalizeMockSport(sport?: string | null): string {
  return normalizeToSupportedSport(sport)
}

function clampMetric(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function getDefaultRosterSlotsForSport(sport?: string | null, isDynasty?: boolean): string[] {
  switch (normalizeMockSport(sport)) {
    case 'NHL':
      return ['C', 'C', 'LW', 'LW', 'RW', 'RW', 'D', 'D', 'UTIL', 'G']
    case 'NBA':
      return ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL']
    case 'MLB':
      return ['C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'UTIL', 'P', 'P']
    case 'NCAAB':
      return ['G', 'G', 'F', 'F', 'C', 'UTIL']
    case 'NCAAF':
      return ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX']
    case 'SOCCER':
      return ['GK', 'DEF', 'DEF', 'MID', 'MID', 'FWD', 'UTIL']
    default:
      return isDynasty
        ? ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'SUPER_FLEX']
        : ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX']
  }
}

function getPrimaryPositionsForSport(sport?: string | null): string[] {
  switch (normalizeMockSport(sport)) {
    case 'NHL':
      return ['C', 'LW', 'RW', 'D', 'G']
    case 'NBA':
      return ['PG', 'SG', 'SF', 'PF', 'C']
    case 'MLB':
      return ['C', '1B', '2B', '3B', 'SS', 'OF', 'P']
    case 'NCAAB':
      return ['G', 'F', 'C']
    case 'NCAAF':
      return ['QB', 'RB', 'WR', 'TE']
    case 'SOCCER':
      return ['GK', 'DEF', 'MID', 'FWD']
    default:
      return ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
  }
}

function normalizeAnalyticsPosition(position: string | null | undefined, sport?: string | null): string {
  const normalizedSport = normalizeMockSport(sport)
  const raw = String(position || '').toUpperCase().trim()
  if (!raw) return 'UTIL'
  const parts = raw.split(/[\/,]/).map((part) => part.trim()).filter(Boolean)

  if (normalizedSport === 'NFL') {
    const first = parts[0] || raw
    return first === 'DST' || first === 'D/ST' ? 'DEF' : first
  }

  if (normalizedSport === 'NBA') {
    const known = new Set(['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'])
    return parts.find((part) => known.has(part)) || parts[0] || raw
  }

  if (normalizedSport === 'MLB') {
    const first = parts[0] || raw
    if (['SP', 'RP'].includes(first)) return 'P'
    if (['LF', 'CF', 'RF'].includes(first)) return 'OF'
    return first
  }

  return parts[0] || raw
}

function buildAnalyticsPositions(args: {
  sport?: string | null
  rosterSlots: string[]
  adpData: ADPPlayer[]
  draftResults: DraftPick[]
}): string[] {
  const normalizedSport = normalizeMockSport(args.sport)
  const seen = new Set<string>()
  const ordered: string[] = []
  const add = (position: string | null | undefined) => {
    const normalized = normalizeAnalyticsPosition(position, normalizedSport)
    if (!normalized || normalized === 'UTIL' || seen.has(normalized)) return
    seen.add(normalized)
    ordered.push(normalized)
  }

  for (const position of getPrimaryPositionsForSport(normalizedSport)) {
    add(position)
  }
  for (const slot of args.rosterSlots || []) {
    const normalized = normalizeAnalyticsPosition(slot, normalizedSport)
    if (!normalized || FLEXISH_SLOTS.has(normalized)) continue
    add(normalized)
  }
  for (const player of args.adpData || []) {
    add(player.position)
  }
  for (const pick of args.draftResults || []) {
    add(pick.position)
  }

  return ordered
}

function defaultStarterTargetsForSport(sport?: string | null): Record<string, number> {
  switch (normalizeMockSport(sport)) {
    case 'NHL':
      return { C: 2, LW: 2, RW: 2, D: 2, G: 1 }
    case 'NBA':
      return { PG: 1, SG: 1, SF: 1, PF: 1, C: 1 }
    case 'MLB':
      return { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, OF: 3, P: 3 }
    case 'NCAAB':
      return { G: 2, F: 2, C: 1 }
    case 'NCAAF':
      return { QB: 1, RB: 2, WR: 2, TE: 1 }
    case 'SOCCER':
      return { GK: 1, DEF: 2, MID: 2, FWD: 1 }
    default:
      return { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 }
  }
}

function buildStarterTargets(args: {
  sport?: string | null
  rosterSlots: string[]
  positions: string[]
}): Record<string, number> {
  const defaults = defaultStarterTargetsForSport(args.sport)
  const targets: Record<string, number> = {}

  for (const rawSlot of args.rosterSlots || []) {
    const slot = normalizeAnalyticsPosition(rawSlot, args.sport)
    if (!slot || FLEXISH_SLOTS.has(slot)) continue
    targets[slot] = (targets[slot] || 0) + 1
  }

  return args.positions.reduce<Record<string, number>>((acc, position) => {
    acc[position] = targets[position] || defaults[position] || 1
    return acc
  }, {})
}

function getPositionBarColor(position: string): string {
  const map: Record<string, string> = {
    QB: 'bg-red-500',
    RB: 'bg-cyan-500',
    WR: 'bg-green-500',
    TE: 'bg-purple-500',
    K: 'bg-amber-500',
    DEF: 'bg-slate-500',
    PG: 'bg-sky-500',
    SG: 'bg-orange-500',
    SF: 'bg-emerald-500',
    PF: 'bg-fuchsia-500',
    C: 'bg-yellow-500',
    OF: 'bg-teal-500',
    P: 'bg-rose-500',
    '1B': 'bg-blue-500',
    '2B': 'bg-cyan-500',
    '3B': 'bg-indigo-500',
    SS: 'bg-violet-500',
  }
  return map[position] || 'bg-gray-500'
}

function getMockAiAdp(player: ADPPlayer): number {
  const trendAdjustment = player.adpTrend != null ? player.adpTrend * 0.35 : 0
  const valueAdjustment = player.value != null ? clampMetric((50 - player.value) / 18, -3, 3) : 0
  const adjusted = Number((player.adp + trendAdjustment + valueAdjustment).toFixed(1))
  return Math.max(1, adjusted)
}

function getManagerTintStyle(managerName: string, alpha = 0.12): { backgroundColor: string; borderColor: string } {
  const color = getManagerColorBySeed(managerName || 'manager').tintHex
  return {
    backgroundColor: withAlpha(color, alpha),
    borderColor: withAlpha(color, Math.min(0.55, alpha + 0.25)),
  }
}

function VolatilityBadge({ v }: { v: VolatilityMeter }) {
  const chaosColors: Record<string, { bg: string; text: string; ring: string; glow: string }> = {
    low: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', ring: 'ring-emerald-500/30', glow: 'shadow-emerald-500/10' },
    medium: { bg: 'bg-amber-500/15', text: 'text-amber-400', ring: 'ring-amber-500/30', glow: 'shadow-amber-500/10' },
    high: { bg: 'bg-red-500/15', text: 'text-red-400', ring: 'ring-red-500/30', glow: 'shadow-red-500/10' },
  }
  const tierColors: Record<string, { bg: string; text: string }> = {
    stable: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
    fragile: { bg: 'bg-orange-500/10', text: 'text-orange-400' },
  }
  const c = chaosColors[v.chaosLevel]
  const t = tierColors[v.tierStability]
  return (
    <div className={`rounded-lg p-2.5 ${c.bg} ring-1 ${c.ring} shadow-sm ${c.glow} space-y-2`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-bold uppercase tracking-wider ${c.text}`}>{v.chaosLevel} chaos</span>
          <span className="text-[9px] text-gray-500">({v.chaosScore}%)</span>
        </div>
        <div className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${t.bg} ${t.text}`}>
          {v.tierStability} tier
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-gray-500 w-12 shrink-0">Top pick</span>
          <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-cyan-500/70" style={{ width: `${v.confidenceBands.high}%` }} />
          </div>
          <span className="text-[9px] text-cyan-400 w-7 text-right tabular-nums">{v.confidenceBands.high}%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-gray-500 w-12 shrink-0">Top 3</span>
          <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-blue-500/60" style={{ width: `${v.confidenceBands.mid}%` }} />
          </div>
          <span className="text-[9px] text-blue-400 w-7 text-right tabular-nums">{v.confidenceBands.mid}%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-gray-500 w-12 shrink-0">Top 6</span>
          <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-indigo-500/50" style={{ width: `${v.confidenceBands.low}%` }} />
          </div>
          <span className="text-[9px] text-indigo-400 w-7 text-right tabular-nums">{v.confidenceBands.low}%</span>
        </div>
      </div>
    </div>
  )
}

export default function MockDraftSimulatorClient({
  leagues,
  initialLeagueId = '',
  initialConfig,
  initialDraftId = null,
  onDraftComplete,
  showAIAssistantPanel = false,
  onBack,
  onChatSuggestionChange,
}: {
  leagues: LeagueOption[]
  initialLeagueId?: string
  initialConfig?: InitialMockConfig
  initialDraftId?: string | null
  onDraftComplete?: (results: DraftPick[], draftId: string | null) => void
  showAIAssistantPanel?: boolean
  onBack?: () => void
  onChatSuggestionChange?: (message: string | null) => void
}) {
  const { callAI, loading } = useAI<{ draftResults: DraftPick[]; updatedDraft?: DraftPick[] }>()
  const [selectedLeagueId, setSelectedLeagueId] = useState(initialLeagueId)
  const [draftResults, setDraftResults] = useState<DraftPick[]>([])
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(initialDraftId ?? null)
  const [isSimulating, setIsSimulating] = useState(false)
  const [customRounds, setCustomRounds] = useState(initialConfig?.rounds ?? 18)
  const [customScoring, setCustomScoring] = useState(initialConfig?.scoring ?? 'default')
  const [draftType, setDraftType] = useState<'snake' | 'linear' | 'auction'>(initialConfig?.draftType ?? 'snake')
  const [hasFiredComplete, setHasFiredComplete] = useState(false)
  const [autopickMode, setAutopickMode] = useState<'queue-first' | 'bpa' | 'need-based'>('queue-first')
  const [draftPool, setDraftPool] = useState<'rookie' | 'vet' | 'combined'>('combined')
  const [casualMode, setCasualMode] = useState(false)
  const [onClockPick, setOnClockPick] = useState<number | null>(null)
  const [tradeResult, setTradeResult] = useState<any>(null)
  const [isTrading, setIsTrading] = useState(false)
  const [adpData, setAdpData] = useState<ADPPlayer[]>([])
  const [bestAvailableTop, setBestAvailableTop] = useState<ADPPlayer[]>([])
  const [tradeProposals, setTradeProposals] = useState<Record<number, any>>({})
  const [dismissedProposals, setDismissedProposals] = useState<Set<number>>(new Set())
  const [comparisonOpen, setComparisonOpen] = useState(false)
  const [comparePlayer, setComparePlayer] = useState<any>(null)
  const [selectedFilter, setSelectedFilter] = useState('All')
  const [predictingBoard, setPredictingBoard] = useState(false)
  const [forecastOpen, setForecastOpen] = useState(false)
  const [boardForecasts, setBoardForecasts] = useState<BoardForecast[]>([])
  const [forecastMeta, setForecastMeta] = useState<{ simulations: number; rounds: number } | null>(null)
  const [forecastMovers, setForecastMovers] = useState<AdpMover[]>([])
  const [pickPathOpen, setPickPathOpen] = useState(false)
  const [pickPathLoading, setPickPathLoading] = useState(false)
  const [pickPathData, setPickPathData] = useState<any[]>([])
  const [pickPathTarget, setPickPathTarget] = useState('')
  const [snipeRadarOpen, setSnipeRadarOpen] = useState(false)
  const [snipeRadarLoading, setSnipeRadarLoading] = useState(false)
  const [snipeRadarData, setSnipeRadarData] = useState<SnipeRadarEntry[]>([])
  const [tradeOptimizerOpen, setTradeOptimizerOpen] = useState(false)
  const [tradeOptimizerLoading, setTradeOptimizerLoading] = useState(false)
  const [tradeUpOffers, setTradeUpOffers] = useState<TradeOffer[]>([])
  const [tradeDownOffers, setTradeDownOffers] = useState<TradeOffer[]>([])
  const [boardDriftOpen, setBoardDriftOpen] = useState(false)
  const [boardDriftLoading, setBoardDriftLoading] = useState(false)
  const [boardDriftReport, setBoardDriftReport] = useState<any>(null)
  const [scenarioLabOpen, setScenarioLabOpen] = useState(false)
  const [scenarioLabLoading, setScenarioLabLoading] = useState(false)
  const [activeScenarios, setActiveScenarios] = useState<Set<string>>(new Set())
  const [scenarioBaseline, setScenarioBaseline] = useState<BoardForecast[]>([])
  const [scenarioResults, setScenarioResults] = useState<BoardForecast[]>([])
  const [scenarioLabels, setScenarioLabels] = useState<string[]>([])
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantLoading, setAssistantLoading] = useState(false)
  const [assistantData, setAssistantData] = useState<any>(null)
  const [useAiBoardAdp, setUseAiBoardAdp] = useState(true)
  const [retroOpen, setRetroOpen] = useState(false)
  const [retroLoading, setRetroLoading] = useState(false)
  const [retroData, setRetroData] = useState<any>(null)
  const [retroCalibration, setRetroCalibration] = useState<any>(null)
  const [livePlayback, setLivePlayback] = useState(true)
  const [isLivePlaying, setIsLivePlaying] = useState(false)
  const [secondsPerPick, setSecondsPerPick] = useState(10)
  const [clockSecondsLeft, setClockSecondsLeft] = useState(10)
  const [completedPicks, setCompletedPicks] = useState(0)
  const [replaceAbsentWithAi, setReplaceAbsentWithAi] = useState(true)
  const [absentManagers, setAbsentManagers] = useState<Set<string>>(new Set())
  const [livePredictions, setLivePredictions] = useState<Array<{ manager: string; predictedPlayer: string; position: string; probability: number; reason: string }>>([])
  const [liveSuggestion, setLiveSuggestion] = useState<any>(null)
  const [liveIntelLoading, setLiveIntelLoading] = useState(false)
  /** When a real league is selected and `/roster-config` returns labels — keeps mock aligned with draft room; sandbox uses sport defaults only. */
  const [leagueBackedRosterSlots, setLeagueBackedRosterSlots] = useState<string[] | null>(null)
  /** True while `/roster-config` fetch is in flight for the current league (success/fail clears this). */
  const [rosterConfigPending, setRosterConfigPending] = useState(false)
  const [showDelayedLeagueRosterHint, setShowDelayedLeagueRosterHint] = useState(false)
  const selectedLeague = leagues.find(l => l.id === selectedLeagueId)
  const selectedSport = useMemo(() => normalizeMockSport(selectedLeague?.sport), [selectedLeague?.sport])
  const selectedSportAccent = useMemo(() => {
    const map: Record<string, string> = {
      NFL: '34, 211, 238',
      NHL: '129, 140, 248',
      NBA: '251, 146, 60',
      MLB: '52, 211, 153',
      NCAAB: '244, 114, 182',
      NCAAF: '167, 139, 250',
      SOCCER: '56, 189, 248',
    }
    return map[selectedSport] ?? map.NFL
  }, [selectedSport])
  const getDisplayedAdp = useCallback(
    (player: ADPPlayer): number => (useAiBoardAdp ? getMockAiAdp(player) : player.adp),
    [useAiBoardAdp],
  )
  const sportFallbackRosterSlots = useMemo(
    () => getDefaultRosterSlotsForSport(selectedLeague?.sport, selectedLeague?.isDynasty),
    [selectedLeague?.sport, selectedLeague?.isDynasty],
  )
  const defaultRosterSlots = useMemo(() => {
    if (
      selectedLeagueId &&
      leagueBackedRosterSlots &&
      leagueBackedRosterSlots.length > 0
    ) {
      return leagueBackedRosterSlots
    }
    return sportFallbackRosterSlots
  }, [selectedLeagueId, leagueBackedRosterSlots, sportFallbackRosterSlots])
  const analyticsPositions = useMemo(
    () => buildAnalyticsPositions({
      sport: selectedSport,
      rosterSlots: defaultRosterSlots,
      adpData,
      draftResults,
    }),
    [selectedSport, defaultRosterSlots, adpData, draftResults],
  )
  const starterTargets = useMemo(
    () => buildStarterTargets({
      sport: selectedSport,
      rosterSlots: defaultRosterSlots,
      positions: analyticsPositions,
    }),
    [selectedSport, defaultRosterSlots, analyticsPositions],
  )
  const availableFilterOptions = useMemo(
    () => ['All', ...analyticsPositions],
    [analyticsPositions],
  )
  const requireNflAdvancedTool = useCallback(() => {
    if (selectedSport === 'NFL') return true
    toast.error('This advanced AI tool is currently available for NFL mock drafts only.')
    return false
  }, [selectedSport])
  const managerNames = useMemo(() => Array.from(new Set(draftResults.map((p) => p.manager))).filter(Boolean), [draftResults])

  useEffect(() => {
    if (initialLeagueId && selectedLeagueId !== initialLeagueId) setSelectedLeagueId(initialLeagueId)
  }, [initialLeagueId])

  useEffect(() => {
    if (!selectedLeagueId?.trim()) {
      setLeagueBackedRosterSlots(null)
      setRosterConfigPending(false)
      return
    }
    const ac = new AbortController()
    setLeagueBackedRosterSlots(null)
    setRosterConfigPending(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(selectedLeagueId)}/roster-config`, {
          cache: 'no-store',
          signal: ac.signal,
        })
        const json = (await res.json().catch(() => null)) as { orderedSlotLabels?: unknown } | null
        if (ac.signal.aborted) return
        if (
          res.ok &&
          json &&
          typeof json === 'object' &&
          Array.isArray(json.orderedSlotLabels) &&
          json.orderedSlotLabels.length > 0 &&
          json.orderedSlotLabels.every((x) => typeof x === 'string')
        ) {
          setLeagueBackedRosterSlots(json.orderedSlotLabels as string[])
        } else {
          setLeagueBackedRosterSlots(null)
        }
      } catch {
        if (!ac.signal.aborted) setLeagueBackedRosterSlots(null)
      } finally {
        if (!ac.signal.aborted) setRosterConfigPending(false)
      }
    })()
    return () => ac.abort()
  }, [selectedLeagueId])

  useEffect(() => {
    if (!selectedLeagueId?.trim() || !rosterConfigPending) {
      setShowDelayedLeagueRosterHint(false)
      return
    }
    const t = window.setTimeout(() => setShowDelayedLeagueRosterHint(true), MOCK_DRAFT_ROSTER_HINT_DELAY_MS)
    return () => {
      window.clearTimeout(t)
      setShowDelayedLeagueRosterHint(false)
    }
  }, [selectedLeagueId, rosterConfigPending])
  useEffect(() => {
    if (initialConfig?.rounds != null) setCustomRounds(initialConfig.rounds)
    if (initialConfig?.scoring != null) setCustomScoring(initialConfig.scoring)
    if (initialConfig?.draftType != null) setDraftType(initialConfig.draftType)
  }, [initialConfig?.rounds, initialConfig?.scoring, initialConfig?.draftType])
  useEffect(() => {
    if (selectedFilter !== 'All' && !availableFilterOptions.includes(selectedFilter)) {
      setSelectedFilter('All')
    }
  }, [availableFilterOptions, selectedFilter])

  useEffect(() => {
    if (draftResults.length === 0) setHasFiredComplete(false)
  }, [draftResults.length])
  useEffect(() => {
    if (
      onDraftComplete &&
      draftResults.length > 0 &&
      completedPicks >= draftResults.length &&
      !hasFiredComplete
    ) {
      setHasFiredComplete(true)
      onDraftComplete(draftResults, currentDraftId)
    }
  }, [onDraftComplete, draftResults, completedPicks, currentDraftId, hasFiredComplete])

  const onClockOverall = useMemo(
    () => (livePlayback ? (completedPicks < draftResults.length ? completedPicks + 1 : null) : null),
    [livePlayback, completedPicks, draftResults.length],
  )
  const currentOnClockPick = useMemo(
    () => (onClockOverall ? draftResults.find((p) => p.overall === onClockOverall) || null : null),
    [draftResults, onClockOverall],
  )
  const draftedSoFar = useMemo(
    () => (livePlayback ? draftResults.filter((p) => p.overall <= completedPicks) : draftResults),
    [livePlayback, draftResults, completedPicks],
  )

  const normalizeName = useCallback((name: string) => {
    return name.toLowerCase().replace(/[.\-']/g, '').replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '').trim()
  }, [])

  const aiAssistantParams = useMemo(() => {
    if (!showAIAssistantPanel || adpData.length === 0 || !selectedLeague || draftResults.length === 0) return null
    const pick = currentOnClockPick ?? (draftedSoFar.length < draftResults.length ? draftResults[draftedSoFar.length] : null)
    const round = pick?.round ?? Math.ceil((draftedSoFar.length + 1) / (selectedLeague.leagueSize || 12))
    const pickNum = pick?.pick ?? ((draftedSoFar.length % (selectedLeague.leagueSize || 12)) + 1)
    const managerName = pick?.manager ?? draftResults.find((p) => p.overall === draftedSoFar.length + 1)?.manager ?? 'You'
    const userRoster = draftedSoFar.filter((p) => p.manager === managerName).map((p) => ({ position: p.position }))
    const draftedNames = new Set(draftedSoFar.map((p) => normalizeName(p.playerName)))
    const available = adpData
      .filter((p) => !draftedNames.has(normalizeName(p.name)))
      .slice(0, 80)
      .map((p) => ({
        name: p.name,
        position: p.position,
        team: p.team,
        adp: p.adp,
        value: p.value ?? undefined,
        isRookie: /rookie|devy/i.test(String(draftPool)),
      }))
    const recentPicks = draftedSoFar.slice(-5).map((p) => ({ position: p.position }))
    return {
      available,
      teamRoster: userRoster,
      rosterSlots: defaultRosterSlots,
      round,
      pick: pickNum,
      totalTeams: selectedLeague.leagueSize || 12,
      managerName,
      sport: selectedSport,
      isDynasty: !!selectedLeague.isDynasty,
      isSF: selectedSport === 'NFL',
      isRookieDraft: draftPool === 'rookie',
      mode: (autopickMode === 'bpa' ? 'bpa' : 'needs') as 'bpa' | 'needs',
      leagueId: selectedLeagueId,
      leagueName: selectedLeague.name,
      recentPicks,
    }
  }, [
    showAIAssistantPanel,
    adpData,
    selectedLeague,
    currentOnClockPick,
    draftedSoFar,
    draftResults,
    normalizeName,
    draftPool,
    autopickMode,
    defaultRosterSlots,
    selectedSport,
  ])

  const adpMap = useMemo(() => {
    const map = new Map<string, ADPPlayer>()
    for (const p of adpData) {
      map.set(normalizeName(p.name), p)
    }
    return map
  }, [adpData, normalizeName])

  const perRoundRosters = useMemo(() => {
    if (draftedSoFar.length === 0) return {}
    const maxRound = Math.max(...draftedSoFar.map(p => p.round))
    const managers = Array.from(new Set(draftResults.map(p => p.manager)))
    const result: Record<number, { manager: string; counts: Record<string, number>; isUser: boolean }[]> = {}
    for (let r = 1; r <= maxRound; r++) {
      result[r] = managers.map(mgr => {
        const counts = Object.fromEntries(analyticsPositions.map((position) => [position, 0])) as Record<string, number>
        for (const p of draftedSoFar) {
          if (p.round <= r && p.manager === mgr) {
            const position = normalizeAnalyticsPosition(p.position, selectedSport)
            if (counts[position] !== undefined) counts[position]++
          }
        }
        return { manager: mgr, counts, isUser: draftedSoFar.some(p => p.round <= r && p.manager === mgr && p.isUser) }
      })
    }
    return result
  }, [draftResults, draftedSoFar, analyticsPositions, selectedSport])

  const managerAvatars = useMemo(() => {
    const map: Record<string, string> = {}
    for (const p of draftResults) {
      if (p.manager && p.managerAvatar && !map[p.manager]) {
        map[p.manager] = p.managerAvatar
      }
    }
    return map
  }, [draftResults])

  const calculateTeamNeeds = useCallback((teamData: { manager: string; counts: Record<string, number> }, round: number) => {
    const positions = analyticsPositions.length > 0 ? analyticsPositions : Object.keys(teamData.counts || {})
    const earlyWindow = Math.max(2, Math.ceil(customRounds * 0.4))
    return positions.reduce<Record<string, number>>((needs, position) => {
      const target = Math.max(1, starterTargets[position] || 1)
      const current = teamData.counts[position] || 0
      let need = 12
      if (current === 0) {
        need = round <= earlyWindow ? 86 : 72
      } else if (current < target) {
        need = 55 + (target - current) * 16
      } else {
        need = Math.max(5, 24 - (current - target) * 6)
      }
      needs[position] = clampMetric(Math.round(need), 0, 100)
      return needs
    }, {})
  }, [analyticsPositions, customRounds, starterTargets])

  const calculateTeamGrade = useCallback((manager: string, picks: DraftPick[]) => {
    const drafted = picks.filter(p => p.manager === manager)
    if (drafted.length === 0) return { letter: 'N/A', color: '#6b7280', title: 'No picks', strengths: [] as string[], weaknesses: [] as string[], valueAdded: '+$0' }

    const counts = Object.fromEntries(analyticsPositions.map((position) => [position, 0])) as Record<string, number>
    for (const pick of drafted) {
      const position = normalizeAnalyticsPosition(pick.position, selectedSport)
      counts[position] = (counts[position] || 0) + 1
    }

    let score = 65
    let totalAdpDelta = 0
    let adpHits = 0

    const coverageRatios = analyticsPositions.map((position) => {
      const target = Math.max(1, starterTargets[position] || 1)
      return Math.min(1, (counts[position] || 0) / target)
    })
    const coverageScore = coverageRatios.length
      ? coverageRatios.reduce((sum, ratio) => sum + ratio, 0) / coverageRatios.length
      : 0.5
    score += coverageScore * 20
    if (coverageScore >= 0.95) score += 8
    else if (coverageScore >= 0.8) score += 4

    for (const pick of drafted) {
      const adp = adpMap.get(normalizeName(pick.playerName))
      if (adp) {
        const delta = adp.adp - pick.overall
        totalAdpDelta += delta
        adpHits++
        if (delta > 10) score += 3
        if (delta < -10) score -= 3
      }
      score += Math.min((pick.value || 0) / 30, 4)
    }

    score = Math.max(40, Math.min(100, score))

    const strengths: string[] = []
    const weaknesses: string[] = []

    if (coverageScore >= 0.95) strengths.push('Covered every core starting slot')
    else if (coverageScore >= 0.8) strengths.push('Strong positional balance')
    if (adpHits > 0 && totalAdpDelta / adpHits > 5) strengths.push('Strong value picks')

    const biggestSurplus = analyticsPositions
      .map((position) => ({
        position,
        surplus: (counts[position] || 0) - (starterTargets[position] || 1),
      }))
      .sort((a, b) => b.surplus - a.surplus)[0]
    if (biggestSurplus && biggestSurplus.surplus > 0) {
      strengths.push(`Built extra ${biggestSurplus.position} depth`)
    }

    const biggestNeed = analyticsPositions
      .map((position) => ({
        position,
        deficit: Math.max(0, (starterTargets[position] || 1) - (counts[position] || 0)),
      }))
      .sort((a, b) => b.deficit - a.deficit)[0]
    if (biggestNeed && biggestNeed.deficit > 0) weaknesses.push(`${biggestNeed.position} depth still needs work`)
    if (coverageScore < 0.65) weaknesses.push('Too many core roster spots are still thin')
    if (adpHits > 0 && totalAdpDelta / adpHits < -5) weaknesses.push('Too many reaches')

    if (strengths.length === 0) strengths.push('Stable draft foundation')
    if (weaknesses.length === 0) weaknesses.push('No major structural issues')

    let letter: string
    let color: string
    let title: string
    if (score >= 95) { letter = 'A+'; color = '#00ff88'; title = 'Elite Draft' }
    else if (score >= 90) { letter = 'A'; color = '#22c55e'; title = 'Excellent Draft' }
    else if (score >= 85) { letter = 'A-'; color = '#4ade80'; title = 'Great Draft' }
    else if (score >= 80) { letter = 'B+'; color = '#84cc16'; title = 'Strong Class' }
    else if (score >= 75) { letter = 'B'; color = '#eab308'; title = 'Above Average' }
    else if (score >= 70) { letter = 'B-'; color = '#f59e0b'; title = 'Solid Foundation' }
    else if (score >= 65) { letter = 'C+'; color = '#f97316'; title = 'Average Draft' }
    else if (score >= 55) { letter = 'C'; color = '#ef4444'; title = 'Below Average' }
    else { letter = 'D'; color = '#dc2626'; title = 'Needs Work' }

    const totalValue = drafted.reduce((sum, p) => sum + (p.value || 0), 0)
    const valueAdded = `+$${totalValue.toLocaleString()}`

    return { letter, color, title, strengths: strengths.slice(0, 3), weaknesses: weaknesses.slice(0, 3), valueAdded }
  }, [adpMap, normalizeName, analyticsPositions, selectedSport, starterTargets])

  const [bestAvailable, setBestAvailable] = useState<ADPPlayer[]>([])

  useEffect(() => {
    if (!adpData.length) return

    const drafted = new Set(draftedSoFar.map(p => p.playerName))
    let remaining = adpData.filter(p => !drafted.has(p.name))

    if (selectedFilter !== 'All') {
      remaining = remaining.filter(
        p => normalizeAnalyticsPosition(p.position, selectedSport) === selectedFilter
      )
    }

    setBestAvailable(remaining.slice(0, 15))
  }, [draftedSoFar, adpData, selectedFilter, selectedSport])

  const openComparison = useCallback((pick: any) => {
    const bap = adpData.find(p => !draftedSoFar.some(d => d.playerName === p.name))
    setComparePlayer({ drafted: pick, bap })
    setComparisonOpen(true)
  }, [draftedSoFar, adpData])

  useEffect(() => {
    if (!selectedLeagueId || !selectedLeague) return
    const fetchADP = async () => {
      try {
        const type = selectedLeague.isDynasty ? 'dynasty' : 'redraft'
        const pool = selectedLeague.isDynasty ? draftPool : 'vet'
        const res = await fetch(`/api/mock-draft/adp?type=${type}&pool=${pool}&limit=300&sport=${selectedSport.toLowerCase()}`)
        if (res.ok) {
          const data = await res.json()
          setAdpData(data.entries || [])
        }
      } catch (err) {
        console.error('[adp-fetch]', err)
      }
    }
    fetchADP()
  }, [selectedLeagueId, selectedLeague, draftPool, selectedSport])

  useEffect(() => {
    if (adpData.length > 0 || draftResults.length === 0 || !selectedLeagueId || selectedSport !== 'NFL') return
    const fetchADP = async () => {
      try {
        const res = await fetch(`/api/mock-draft/adp?type=redraft&pool=vet&limit=300&sport=nfl`)
        if (res.ok) {
          const data = await res.json()
          setAdpData(data.entries || [])
        }
      } catch {}
    }
    fetchADP()
  }, [draftResults, adpData.length, selectedLeagueId, selectedSport])

  useEffect(() => {
    if (draftResults.length === 0 || adpData.length === 0) {
      setBestAvailableTop([])
      return
    }
    const draftedNames = new Set(draftedSoFar.map(p => normalizeName(p.playerName)))
    const remaining = adpData
      .filter(p => !draftedNames.has(normalizeName(p.name)))
      .sort((a, b) => getDisplayedAdp(a) - getDisplayedAdp(b))
      .slice(0, 3)
    setBestAvailableTop(remaining)
  }, [draftedSoFar, adpData, normalizeName, getDisplayedAdp])

  useEffect(() => {
    if (!livePlayback || !isLivePlaying || draftResults.length === 0) return
    if (completedPicks >= draftResults.length) {
      setIsLivePlaying(false)
      setOnClockPick(null)
      return
    }

    const timer = setInterval(() => {
      setClockSecondsLeft((prev) => {
        if (prev <= 1) {
          setCompletedPicks((count) => {
            const next = Math.min(count + 1, draftResults.length)
            if (next >= draftResults.length) {
              setIsLivePlaying(false)
              setOnClockPick(null)
            }
            return next
          })
          return secondsPerPick
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [livePlayback, isLivePlaying, draftResults, completedPicks, secondsPerPick])

  useEffect(() => {
    setOnClockPick(onClockOverall)
  }, [onClockOverall])

  useEffect(() => {
    if (!livePlayback || !selectedLeagueId || !currentOnClockPick || adpData.length === 0) {
      setLivePredictions([])
      setLiveSuggestion(null)
      return
    }

    let active = true

    const runLiveIntel = async () => {
      try {
        setLiveIntelLoading(true)
        const draftedNames = new Set(draftedSoFar.map((p) => normalizeName(p.playerName)))
        const availableBoard = adpData
          .filter((p) => !draftedNames.has(normalizeName(p.name)))
          .slice(0, 80)
          .map((p) => ({
            name: p.name,
            position: p.position,
            team: p.team,
            adp: p.adp,
            value: p.value,
            isRookie: /rookie|devy/i.test(String(draftPool)) || /rookie|devy/i.test(String((p as any).source || '')),
          }))

        const managerRoster = draftedSoFar
          .filter((p) => p.manager === currentOnClockPick.manager)
          .map((p) => ({ position: p.position }))

        const nextManagers = draftResults
          .filter((p) => p.overall > (currentOnClockPick.overall || 0))
          .slice(0, 4)
          .map((p) => p.manager)

        const basePayload = {
          available: availableBoard,
          teamRoster: managerRoster,
          rosterSlots: defaultRosterSlots,
          round: currentOnClockPick.round,
          pick: currentOnClockPick.pick,
          totalTeams: selectedLeague?.leagueSize || 12,
          managerName: currentOnClockPick.manager,
          sport: selectedSport,
          isDynasty: !!selectedLeague?.isDynasty,
          isSF: selectedSport === 'NFL',
          isRookieDraft: draftPool === 'rookie',
          mode: autopickMode === 'bpa' ? 'bpa' : 'needs',
          leagueContext: {
            rosterPositions: defaultRosterSlots,
            scoringSettings: {},
          },
        }

        const [predictRes, suggestRes] = await Promise.all([
          fetch('/api/mock-draft/ai-pick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'predict-next', ...basePayload, nextManagers }),
          }),
          currentOnClockPick.isUser
            ? fetch('/api/mock-draft/ai-pick', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'dm-suggestion', ...basePayload }),
              })
            : Promise.resolve(null as Response | null),
        ])

        if (!active) return

        if (predictRes.ok) {
          const data = await predictRes.json().catch(() => ({}))
          setLivePredictions(Array.isArray(data.predictions) ? data.predictions.slice(0, 4) : [])
        } else {
          setLivePredictions([])
        }

        if (suggestRes && suggestRes.ok) {
          const data = await suggestRes.json().catch(() => ({}))
          setLiveSuggestion(data)
        } else {
          setLiveSuggestion(null)
        }
      } catch {
        if (!active) return
        setLivePredictions([])
        setLiveSuggestion(null)
      } finally {
        if (active) setLiveIntelLoading(false)
      }
    }

    runLiveIntel()
    return () => {
      active = false
    }
  }, [livePlayback, selectedLeagueId, currentOnClockPick, adpData, draftedSoFar, normalizeName, draftPool, autopickMode, selectedLeague, draftResults, defaultRosterSlots, selectedSport])

  useEffect(() => {
    if (!onChatSuggestionChange) return
    if (!currentOnClockPick?.isUser || !liveSuggestion) {
      onChatSuggestionChange(null)
      return
    }
    const top = liveSuggestion?.suggestions?.[0]
    const aiMessage = top?.player
      ? `Chimmy: On the clock at #${currentOnClockPick.overall}. Top suggestion is ${top.player}${top.position ? ` (${top.position})` : ''}. ${top.reason || 'Best fit by ADP and roster context.'}`
      : liveSuggestion?.aiInsight
        ? `Chimmy: ${liveSuggestion.aiInsight}`
        : null
    onChatSuggestionChange(aiMessage ?? null)
  }, [currentOnClockPick?.isUser, currentOnClockPick?.overall, liveSuggestion, onChatSuggestionChange])

  const stepLiveDraft = useCallback(() => {
    if (draftResults.length === 0) return
    setCompletedPicks((count) => {
      const next = Math.min(count + 1, draftResults.length)
      if (next >= draftResults.length) {
        setIsLivePlaying(false)
        setOnClockPick(null)
      }
      return next
    })
    setClockSecondsLeft(secondsPerPick)
  }, [draftResults.length, secondsPerPick])

  const toggleAbsentManager = useCallback((manager: string) => {
    setAbsentManagers((prev) => {
      const next = new Set(prev)
      if (next.has(manager)) next.delete(manager)
      else next.add(manager)
      return next
    })
  }, [])
  const startMockDraft = async () => {
    if (!selectedLeagueId) return toast.error('Select a league first')
    setIsSimulating(true)
    setDraftResults([])
    const { data } = await callAI('/api/mock-draft/simulate', {
      leagueId: selectedLeagueId,
      rounds: customRounds,
      scoringTweak: customScoring,
      draftType,
      autopickMode,
      draftPool,
      casualMode,
      useLiveADP: true,
      replaceAbsentWithAi,
      absentManagers: Array.from(absentManagers),
    })
    if (data?.draftResults) {
      setDraftResults(data.draftResults)
      setCurrentDraftId((data as any).draftId || null)
      setClockSecondsLeft(secondsPerPick)
      if (livePlayback) {
        setCompletedPicks(0)
        setIsLivePlaying(true)
      } else {
        setCompletedPicks((data.draftResults || []).length)
        setIsLivePlaying(false)
      }

      const inlineProposals = (data as any).proposals || []
      if (inlineProposals.length > 0) {
        const proposalMap: Record<number, any> = {}
        for (const p of inlineProposals) {
          proposalMap[p.pickOverall] = p
        }
        setTradeProposals(proposalMap)
        setDismissedProposals(new Set())
        toast.success(`Mock draft complete! ${inlineProposals.length} trade offer${inlineProposals.length > 1 ? 's' : ''} from other managers.`)
      } else {
        setTradeProposals({})
        toast.success(livePlayback ? 'Live room started. AI bots are drafting for absent managers.' : 'Mock draft complete! AI drafted for all managers.')
      }
    }
    setIsSimulating(false)
  }

  const updateWeekly = async () => {
    if (!selectedLeagueId) return
    if (!requireNflAdvancedTool()) return
    setIsSimulating(true)
    const { data } = await callAI('/api/mock-draft/update-weekly', {
      leagueId: selectedLeagueId,
    })
    if (data?.draftResults) {
      setDraftResults(data.draftResults)
      toast.success('Mock draft updated with latest injuries, news & performance data!')
    }
    setIsSimulating(false)
  }

  const predictDraftBoard = async () => {
    if (!selectedLeagueId) return toast.error('Select a league first')
    setPredictingBoard(true)
    try {
      const res = await fetch('/api/mock-draft/predict-board', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId: selectedLeagueId, rounds: 2, simulations: 300 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to predict board')
      setBoardForecasts(data.forecasts || [])
      setForecastMeta({ simulations: data.simulations || 0, rounds: data.rounds || 2 })
      setForecastMovers(data.adpAdjustments || [])
      setForecastOpen(true)
      toast.success('Predicted draft board generated.')
    } catch (err: any) {
      toast.error(err?.message || 'Failed to predict board')
    } finally {
      setPredictingBoard(false)
    }
  }

  const generatePickPath = async () => {
    if (!selectedLeagueId) return toast.error('Select a league first')
    if (!requireNflAdvancedTool()) return
    setPickPathLoading(true)
    try {
      const target = bestAvailableTop[0]?.name || ''
      const res = await fetch('/api/mock-draft/pick-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId: selectedLeagueId, rounds: 3, simulations: 200, targetPlayer: target }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to generate pick path')
      setPickPathData(data.pickPaths || [])
      setPickPathTarget(data.targetPlayer || target)
      setPickPathOpen(true)
      toast.success('Pick Path generated with contingency strategies.')
    } catch (err: any) {
      toast.error(err?.message || 'Failed to generate pick path')
    } finally {
      setPickPathLoading(false)
    }
  }

  const loadSnipeRadar = async () => {
    if (!selectedLeagueId) return toast.error('Select a league first')
    if (!requireNflAdvancedTool()) return
    setSnipeRadarLoading(true)
    try {
      const res = await fetch('/api/mock-draft/snipe-radar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId: selectedLeagueId, rounds: 3, simulations: 300 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to load Snipe Radar')
      setSnipeRadarData(data.snipeRadar || [])
      setSnipeRadarOpen(true)
      toast.success(`Snipe Radar active - ${(data.snipeRadar || []).reduce((s: number, r: any) => s + (r.alerts?.length || 0), 0)} threats detected.`)
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load Snipe Radar')
    } finally {
      setSnipeRadarLoading(false)
    }
  }

  const loadTradeOptimizer = async () => {
    if (!selectedLeagueId) return toast.error('Select a league first')
    if (!requireNflAdvancedTool()) return
    setTradeOptimizerLoading(true)
    try {
      const res = await fetch('/api/mock-draft/trade-optimizer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId: selectedLeagueId, rounds: 3, simulations: 200 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to load Trade Optimizer')
      setTradeUpOffers(data.tradeUpOffers || [])
      setTradeDownOffers(data.tradeDownOffers || [])
      setTradeOptimizerOpen(true)
      toast.success(`Trade Optimizer ready - ${(data.tradeUpOffers?.length || 0) + (data.tradeDownOffers?.length || 0)} offers evaluated.`)
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load Trade Optimizer')
    } finally {
      setTradeOptimizerLoading(false)
    }
  }

  const loadBoardDrift = async () => {
    if (!selectedLeagueId) return toast.error('Select a league first')
    if (!requireNflAdvancedTool()) return
    setBoardDriftLoading(true)
    try {
      const res = await fetch('/api/mock-draft/board-drift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId: selectedLeagueId, userSlot: 1 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to load Board Drift')
      setBoardDriftReport(data)
      setBoardDriftOpen(true)
      const movers = (data.topRisers?.length || 0) + (data.topFallers?.length || 0)
      toast.success(movers > 0 ? `Board Drift: ${movers} players moved this week.` : 'Baseline snapshot saved - check back next week!')
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load Board Drift')
    } finally {
      setBoardDriftLoading(false)
    }
  }

  const toggleScenario = (id: string) => {
    setActiveScenarios(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const runScenarioLab = async () => {
    if (!selectedLeagueId) return toast.error('Select a league first')
    if (!requireNflAdvancedTool()) return
    if (activeScenarios.size === 0) return toast.error('Toggle at least one scenario')
    setScenarioLabLoading(true)
    try {
      const [baseRes, scenRes] = await Promise.all([
        fetch('/api/mock-draft/predict-board', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leagueId: selectedLeagueId, rounds: 2, simulations: 200 }),
        }),
        fetch('/api/mock-draft/predict-board', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leagueId: selectedLeagueId, rounds: 2, simulations: 200, scenarios: Array.from(activeScenarios) }),
        }),
      ])
      const baseData = await baseRes.json().catch(() => ({}))
      const scenData = await scenRes.json().catch(() => ({}))
      if (!baseRes.ok) throw new Error(baseData.error || 'Failed baseline')
      if (!scenRes.ok) throw new Error(scenData.error || 'Failed scenario')
      setScenarioBaseline(baseData.forecasts || [])
      setScenarioResults(scenData.forecasts || [])
      setScenarioLabels(scenData.scenarioLabels || Array.from(activeScenarios))
      setScenarioLabOpen(true)
      toast.success('Scenario comparison ready!')
    } catch (err: any) {
      toast.error(err?.message || 'Failed to run scenarios')
    } finally {
      setScenarioLabLoading(false)
    }
  }

  const loadAssistant = async (pickOverall: number) => {
    if (!selectedLeagueId) return toast.error('Select a league first')
    setAssistantLoading(true)
    try {
      const userManager = draftedSoFar.find(p => p.isUser)?.manager || draftResults.find(p => p.isUser)?.manager
      const userRoster = draftedSoFar
        .filter(p => p.manager === userManager && p.playerName)
        .map(p => ({ position: p.position }))
      const drafted = new Set(draftedSoFar.map(p => normalizeName(p.playerName)))
      const availableBoard = adpData
        .filter(p => !drafted.has(normalizeName(p.name)))
        .slice(0, 80)
        .map(p => ({
          name: p.name,
          position: p.position,
          team: p.team,
          adp: p.adp,
          value: p.value,
          isRookie: /rookie|devy/i.test(String(draftPool)) || /rookie|devy/i.test(String((p as any).source || '')),
        }))
      const scoutRes = await fetch('/api/mock-draft/ai-pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'dm-suggestion',
          available: availableBoard,
          teamRoster: userRoster,
          rosterSlots: defaultRosterSlots,
          round: Math.ceil(pickOverall / Math.max(1, selectedLeague?.leagueSize || 12)),
          pick: ((pickOverall - 1) % Math.max(1, selectedLeague?.leagueSize || 12)) + 1,
          totalTeams: selectedLeague?.leagueSize || 12,
          managerName: userManager || 'You',
          sport: selectedSport,
          isDynasty: !!selectedLeague?.isDynasty,
          isSF: selectedSport === 'NFL',
          isRookieDraft: draftPool === 'rookie',
          mode: autopickMode === 'bpa' ? 'bpa' : 'needs',
          leagueContext: {
            rosterPositions: defaultRosterSlots,
            scoringSettings: {},
          },
        }),
      })
      if (scoutRes.ok) {
        const scoutData = await scoutRes.json().catch(() => ({}))
        const top3 = (scoutData.suggestions || []).slice(0, 3).map((s: any, idx: number) => ({
          player: s.player,
          position: s.position,
          probability: Math.max(30, (s.confidence || 70) - idx * 8),
          why: s.reason,
          scorecard: {
            adpWeight: 30,
            teamNeedWeight: 35,
            managerTendencyWeight: 10,
            newsImpactWeight: 15,
            rookieRankBoostWeight: 10,
            total: s.confidence || 70,
          },
        }))
        setAssistantData({
          focusPick: pickOverall,
          top3,
          fallback: top3[2] || null,
          waitAdvice: {
            canWait: false,
            availabilityAt4: Math.max(10, 60 - (top3[0]?.probability || 50)),
            reason: scoutData.aiInsight || 'Take your top fit now if this tier is thinning.',
          },
          queue: top3,
          volatility: {
            chaosLevel: 'medium',
            chaosScore: 52,
            confidenceBands: { high: top3[0]?.probability || 45, mid: 70, low: 88 },
            tierStability: 'fragile',
            tierSpread: 16,
            topConcentration: top3[0]?.probability || 45,
          },
        })
        setAssistantOpen(true)
        toast.success('Scout recommendation loaded.')
        return
      }
      const res = await fetch('/api/mock-draft/predict-board', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId: selectedLeagueId,
          rounds: 2,
          simulations: 100,
          assistantMode: true,
          focusPickOverall: pickOverall,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to load assistant')
      setAssistantData(data.assistant || null)
      setAssistantOpen(true)
      toast.success('Draft-Day Assistant ready!')
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load assistant')
    } finally {
      setAssistantLoading(false)
    }
  }

  const loadRetrospective = async () => {
    if (!selectedLeagueId) return
    if (!requireNflAdvancedTool()) return
    setRetroLoading(true)
    try {
      const checkRes = await fetch(`/api/mock-draft/retrospective?leagueId=${selectedLeagueId}`)
      const checkData = await checkRes.json().catch(() => ({}))

      if (checkData.hasRetrospective) {
        setRetroData(checkData.retrospective)
        setRetroCalibration(checkData.calibration)
        setRetroOpen(true)
        return
      }

      const res = await fetch('/api/mock-draft/retrospective', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId: selectedLeagueId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to run retrospective')

      setRetroData(data.retrospective)
      setRetroCalibration(data.calibration)
      setRetroOpen(true)
      toast.success('Post-Draft Retrospective complete!')
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load retrospective')
    } finally {
      setRetroLoading(false)
    }
  }

  const exportImage = async () => {
    const element = document.getElementById('draft-board')
    if (!element) return
    const canvas = await html2canvas(element, { scale: 2, backgroundColor: '#0a0a0f' })
    const link = document.createElement('a')
    link.download = `AllFantasy-Mock-Draft-${new Date().toISOString().slice(0, 10)}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
    toast.success('Draft board saved as image!')
  }

  const exportPDF = async () => {
    const element = document.getElementById('draft-board')
    if (!element) return
    const canvas = await html2canvas(element, { scale: 2 })
    const pdf = new jsPDF('landscape')
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 10, 10, 280, 190)
    pdf.save(`AllFantasy-Mock-Draft-${new Date().toISOString().slice(0, 10)}.pdf`)
    toast.success('Draft board saved as PDF!')
  }



  const simulateTrade = async (direction: 'up' | 'down', pickNumber: number) => {
    if (draftResults.length === 0 || !selectedLeagueId) return
    if (!requireNflAdvancedTool()) return
    setIsTrading(true)
    setTradeResult(null)
    toast.info(`Simulating ${direction === 'up' ? 'trade up' : 'trade down'}...`)

    try {
      const { data } = await callAI('/api/mock-draft/trade-simulate', {
        leagueId: selectedLeagueId,
        currentPick: pickNumber,
        direction,
        rounds: customRounds,
      })

      if (data?.updatedDraft) {
        setDraftResults(data.updatedDraft)
        setOnClockPick(null)
        setTradeResult({
          direction,
          pickNumber,
          tradeDescription: (data as any).tradeDescription,
          tradedPicks: (data as any).tradedPicks,
        })
        toast.success(`${direction === 'up' ? 'Traded up' : 'Traded down'}! New picks reflected on the board.`)
      }
    } catch (err: any) {
      console.error('[trade-simulate]', err)
      toast.error(err.message || 'Failed to simulate trade')
    }
    setIsTrading(false)
  }


  const handleTradeAction = async (pickNumber: number, action: 'accept' | 'reject') => {
    if (!requireNflAdvancedTool()) return
    const { data } = await callAI('/api/mock-draft/trade-action', {
      leagueId: selectedLeagueId,
      pickNumber,
      action,
    })

    if (data?.updatedDraft) {
      setDraftResults(data.updatedDraft)
      toast.success(action === 'accept' ? 'Trade accepted - board updated!' : 'Trade rejected - draft continues.')
    }
  }

  const copyShareLink = async () => {
    if (draftResults.length === 0 || !selectedLeagueId) return
    try {
      const res = await fetch('/api/mock-draft/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId: selectedLeagueId, results: draftResults, draftId: currentDraftId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create share link')
      const url = `${window.location.origin}/mock-draft/share/${data.shareId}`
      await navigator.clipboard.writeText(url)
      toast.success('Shareable link copied to clipboard!')
    } catch (err: any) {
      console.error('[share]', err)
      toast.error(err.message || 'Failed to generate share link')
    }
  }

  return (
    <div className="space-y-8" data-testid="mock-draft-simulator">
      <div className="flex items-center justify-between gap-3">
        {onBack ? (
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            data-testid="mock-draft-back-button"
            className="border-white/20 text-white/80 hover:text-white"
          >
            Back to setup
          </Button>
        ) : (
          <NextLink
            href="/mock-draft"
            data-testid="mock-draft-back-button"
            className="inline-flex min-h-[40px] items-center rounded-lg border border-white/20 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
          >
            Back to mock lobby
          </NextLink>
        )}
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {showDelayedLeagueRosterHint && (
            <span
              className="text-[11px] text-white/45"
              aria-live="polite"
              data-testid="mock-draft-league-roster-loading-hint"
            >
              Loading league roster…
            </span>
          )}
          <span className="text-xs text-white/50">
            Sport: {selectedSport}
          </span>
        </div>
      </div>
      <div className="bg-black/60 border border-purple-900/50 rounded-2xl p-6">
        <h3 className="text-lg font-medium mb-4">Customize Simulation</h3>
        <div className="grid md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm text-gray-400 mb-2">Rounds</label>
            <Select value={customRounds.toString()} onValueChange={(v) => setCustomRounds(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[12, 15, 18, 20].map(r => <SelectItem key={r} value={r.toString()}>{r} Rounds</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">Scoring Tweak</label>
            <Select value={customScoring} onValueChange={setCustomScoring}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default</SelectItem>
                <SelectItem value="sf">Superflex</SelectItem>
                <SelectItem value="tep">TE Premium</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">Draft Type</label>
            <Select value={draftType} onValueChange={(v: 'snake' | 'linear' | 'auction') => setDraftType(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="snake">Snake</SelectItem>
                <SelectItem value="linear">Linear</SelectItem>
                <SelectItem value="auction">Auction</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">Autopick Mode</label>
            <Select value={autopickMode} onValueChange={(v: 'queue-first' | 'bpa' | 'need-based') => setAutopickMode(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="queue-first">Queue-first</SelectItem>
                <SelectItem value="bpa">Best Player Available</SelectItem>
                <SelectItem value="need-based">Need-based</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">Player Pool</label>
            <Select value={draftPool} onValueChange={(v: 'rookie' | 'vet' | 'combined') => setDraftPool(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rookie">Rookie / Devy</SelectItem>
                <SelectItem value="vet">Veterans</SelectItem>
                <SelectItem value="combined">Combined Board</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">Validation Mode</label>
            <Button type="button" variant={casualMode ? 'default' : 'outline'} className={casualMode ? 'w-full bg-amber-500 hover:bg-amber-400 text-black' : 'w-full'} onClick={() => setCasualMode(prev => !prev)}>
              {casualMode ? 'Casual (warn only)' : 'Strict (enforce constraints)'}
            </Button>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">Board ADP Mode</label>
            <Button
              type="button"
              variant={useAiBoardAdp ? 'default' : 'outline'}
              className={useAiBoardAdp ? 'w-full bg-cyan-500 hover:bg-cyan-400 text-black' : 'w-full'}
              onClick={() => setUseAiBoardAdp((prev) => !prev)}
              data-testid="mock-draft-ai-adp-toggle"
            >
              {useAiBoardAdp ? 'AI ADP On' : 'AI ADP Off'}
            </Button>
          </div>
          <div className="md:col-span-3">
            <label className="block text-sm text-gray-400 mb-2">Scenario Assumptions</label>
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'heavy_rookie_hype', label: 'Heavy Rookie Hype', color: 'violet' },
                { id: 'rb_scarcity_spike', label: 'RB Scarcity Spike', color: 'cyan' },
                { id: 'injury_risk_conservative', label: 'Injury Risk Conservative', color: 'amber' },
                { id: 'league_overvalues_qbs', label: 'League Overvalues QBs', color: 'red' },
              ].map(s => {
                const isActive = activeScenarios.has(s.id)
                const toggleBg: Record<string, string> = {
                  violet: 'bg-violet-500/20 border-violet-500/40 text-violet-300',
                  cyan: 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300',
                  amber: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
                  red: 'bg-red-500/20 border-red-500/40 text-red-300',
                }
                const inactiveBg = 'bg-white/5 border-gray-700 text-gray-400 hover:border-gray-600'
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleScenario(s.id)}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${isActive ? toggleBg[s.color] : inactiveBg}`}
                  >
                    {isActive && <Check className="inline h-3 w-3 mr-1" />}
                    {s.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex items-end gap-3">
            <Button onClick={startMockDraft} data-testid="mock-draft-run-button" disabled={isSimulating || loading || !selectedLeagueId} className="flex-1 h-10 bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-600 hover:to-purple-700">
              {isSimulating || loading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Simulating...</>
              ) : (
                <><Play className="mr-2 h-4 w-4" /> Run Mock Draft</>
              )}
            </Button>
            <Button onClick={predictDraftBoard} disabled={predictingBoard || !selectedLeagueId} variant="outline" className="h-10 border-cyan-700/40 text-cyan-300 hover:text-cyan-200">
              {predictingBoard ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Predicting</> : 'Predict Board'}
            </Button>
            <Button onClick={generatePickPath} disabled={pickPathLoading || !selectedLeagueId} variant="outline" className="h-10 border-purple-700/40 text-purple-300 hover:text-purple-200">
              {pickPathLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Mapping</> : 'Pick Path'}
            </Button>
            <Button onClick={loadSnipeRadar} disabled={snipeRadarLoading || !selectedLeagueId} variant="outline" className="h-10 border-red-700/40 text-red-300 hover:text-red-200">
              {snipeRadarLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Scanning</> : <><TrendingDown className="mr-2 h-4 w-4" /> Snipe Radar</>}
            </Button>
            <Button onClick={loadTradeOptimizer} disabled={tradeOptimizerLoading || !selectedLeagueId} variant="outline" className="h-10 border-green-700/40 text-green-300 hover:text-green-200">
              {tradeOptimizerLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Optimizing</> : <><Handshake className="mr-2 h-4 w-4" /> Trade Optimizer</>}
            </Button>
            <Button onClick={loadBoardDrift} disabled={boardDriftLoading || !selectedLeagueId} variant="outline" className="h-10 border-sky-700/40 text-sky-300 hover:text-sky-200">
              {boardDriftLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading</> : <><Newspaper className="mr-2 h-4 w-4" /> Board Drift</>}
            </Button>
            <Button onClick={runScenarioLab} disabled={scenarioLabLoading || !selectedLeagueId} variant="outline" className="h-10 border-violet-700/40 text-violet-300 hover:text-violet-200">
              {scenarioLabLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running</> : <><Beaker className="mr-2 h-4 w-4" /> Scenario Lab</>}
            </Button>
            <Button onClick={loadRetrospective} disabled={retroLoading || !selectedLeagueId} variant="outline" className="h-10 border-amber-700/40 text-amber-300 hover:text-amber-200">
              {retroLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyzing</> : <><Check className="mr-2 h-4 w-4" /> Post-Draft Review</>}
            </Button>
          </div>
        </div>
      </div>

      {!selectedLeagueId && (
        <div className="bg-black/60 border border-cyan-900/50 rounded-2xl p-6">
          <label className="block text-sm text-gray-400 mb-2">Select League</label>
          <Select value={selectedLeagueId} onValueChange={setSelectedLeagueId}>
            <SelectTrigger className="bg-gray-950 border-cyan-800" data-testid="mock-draft-league-select">
              <SelectValue placeholder="Choose your league" />
            </SelectTrigger>
            <SelectContent>
              {leagues.map(l => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name} ({l.platform} &middot; {l.leagueSize}-team{l.isDynasty ? ' Dynasty' : ''})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {(isSimulating || loading) && draftResults.length === 0 && (
        <div className="text-center py-20">
          <div className="inline-flex items-center gap-3 glass-card rounded-2xl px-8 py-6">
            <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
            <div className="text-left">
              <p className="text-lg font-semibold text-white">AI is drafting...</p>
              <p className="text-sm text-gray-400">
                Analyzing {selectedSport === 'NFL' ? 'live ADP' : `the imported ${selectedSport} player pool`}, team needs &amp; real draft tendencies
              </p>
            </div>
          </div>
        </div>
      )}

      {draftResults.length > 0 && (
        <div
          id="draft-board"
          data-testid="mock-draft-board"
          className="bg-black/80 border border-cyan-900/50 rounded-3xl p-8"
          style={{
            backgroundImage: `linear-gradient(180deg, rgba(${selectedSportAccent},0.1), rgba(10,10,16,0.82)), url('/branding/allfantasy-ai-for-fantasy-sports-logo.png')`,
            backgroundSize: 'cover, 340px',
            backgroundPosition: 'center, right -30px bottom -20px',
            backgroundRepeat: 'no-repeat, no-repeat',
          }}
        >
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold">Live Mock Draft Board</h2>
              {Object.keys(tradeProposals).length > 0 && (
                <span className="flex items-center gap-1 text-xs text-purple-400 bg-purple-500/10 border border-purple-500/20 rounded-full px-2.5 py-1">
                  <Handshake className="h-3 w-3" /> {Object.keys(tradeProposals).length - dismissedProposals.size} offer{Object.keys(tradeProposals).length - dismissedProposals.size !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <div className="flex gap-1.5 border border-gray-800 rounded-lg p-1">
                <Button onClick={exportImage} variant="ghost" size="sm" className="h-7 text-xs text-gray-400 hover:text-white"><Download className="mr-1.5 h-3.5 w-3.5" /> Image</Button>
                <Button onClick={exportPDF} variant="ghost" size="sm" className="h-7 text-xs text-gray-400 hover:text-white"><Download className="mr-1.5 h-3.5 w-3.5" /> PDF</Button>
                <Button onClick={copyShareLink} variant="ghost" size="sm" className="h-7 text-xs text-gray-400 hover:text-white"><Link className="mr-1.5 h-3.5 w-3.5" /> Share</Button>
              </div>
              {selectedSport === 'NFL' && (
                <Button onClick={updateWeekly} variant="outline" size="sm" className="h-7 text-xs" disabled={isSimulating || loading}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Update Weekly
                </Button>
              )}
              <Button onClick={() => { setDraftResults([]); setCurrentDraftId(null); setIsSimulating(false); setBestAvailableTop([]); setTradeProposals({}); setDismissedProposals(new Set()); setCompletedPicks(0); setIsLivePlaying(false); setClockSecondsLeft(secondsPerPick); setLivePredictions([]); setLiveSuggestion(null) }} variant="outline" size="sm" className="h-7 text-xs border-red-900/40 text-red-400 hover:text-red-300 hover:bg-red-950/30">
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
              </Button>
            </div>
          </div>

          {livePlayback && (
            <div className="mb-6 rounded-2xl border border-cyan-700/40 bg-cyan-950/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-cyan-300">Live Room</div>
                  <div className="text-sm text-gray-200">
                    {currentOnClockPick ? (
                      <>
                        <span className="font-semibold text-cyan-200">{currentOnClockPick.manager}</span> on the clock at #{currentOnClockPick.overall}
                      </>
                    ) : 'Draft complete'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-black/40 px-3 py-1 text-xs text-cyan-300">
                    <Clock3 className="h-3 w-3" /> {clockSecondsLeft}s
                  </span>
                  <Button size="sm" variant="outline" onClick={() => setIsLivePlaying((prev) => !prev)} disabled={completedPicks >= draftResults.length}>
                    {isLivePlaying ? <><Pause className="mr-1 h-3.5 w-3.5" /> Pause</> : <><Play className="mr-1 h-3.5 w-3.5" /> Play</>}
                  </Button>
                  <Button size="sm" variant="outline" onClick={stepLiveDraft} disabled={completedPicks >= draftResults.length}>
                    <SkipForward className="mr-1 h-3.5 w-3.5" /> Step
                  </Button>
                  <span className="text-xs text-gray-400">{completedPicks}/{draftResults.length} picks</span>
                </div>
              </div>
              {(liveSuggestion?.suggestions?.length > 0 || livePredictions.length > 0 || liveIntelLoading) && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-yellow-700/30 bg-yellow-950/15 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wider text-yellow-300 mb-1">Scout Recommendation</div>
                    {liveIntelLoading ? <div className="text-xs text-gray-400">Updating AI scout...</div> : (
                      <>
                        <div className="text-sm text-gray-200">{liveSuggestion?.suggestions?.[0]?.player || 'Waiting for user pick context'}</div>
                        <div className="text-xs text-gray-400">{liveSuggestion?.suggestions?.[0]?.reason || liveSuggestion?.aiInsight || 'AI will suggest a pick when your slot is on the clock.'}</div>
                      </>
                    )}
                  </div>
                  <div className="rounded-xl border border-indigo-700/30 bg-indigo-950/15 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wider text-indigo-300 mb-1">Next Pick Predictions</div>
                    {livePredictions.length === 0 ? <div className="text-xs text-gray-400">No prediction yet.</div> : (
                      <div className="space-y-1">
                        {livePredictions.slice(0, 3).map((pred) => (
                          <div key={pred.manager + '-' + pred.predictedPlayer} className="text-xs text-gray-300">
                            <span className="text-indigo-300 font-medium">{pred.manager}</span>: {pred.predictedPlayer} ({pred.position}) - {pred.probability}%
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <AnimatePresence>
            {bestAvailableTop.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="bg-gradient-to-r from-purple-950/80 to-black/80 border border-purple-500/40 rounded-2xl p-6 mb-8"
              >
                <h3 className="text-lg font-bold text-purple-300 mb-4 flex items-center gap-2">
                  <Star className="h-4 w-4" />
                  <span>Best Available Right Now</span>
                  <span className="text-xs bg-purple-600/50 px-3 py-1 rounded-full">Live</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {bestAvailableTop.map((player, i) => {
                    const posColor = POSITION_COLORS[player.position]?.split(' ')[0] || 'text-gray-400'
                    return (
                      <div key={player.name} className={`flex items-center gap-4 bg-black/50 p-4 rounded-xl border ${i === 0 ? 'border-yellow-500/40 ring-1 ring-yellow-500/20' : 'border-gray-800/50'}`}>
                        <div className={`w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold shrink-0 ${i === 0 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-800 text-gray-400'}`}>
                          {i === 0 ? <Star className="h-6 w-6" /> : `#${i + 1}`}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold truncate">{player.name}</p>
                          <p className="text-sm text-gray-400">
                            <span className={posColor}>{player.position}</span>
                            {' '}&middot;{' '}{player.team || 'FA'}
                          </p>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs text-cyan-400">
                              {useAiBoardAdp ? 'AI ADP' : 'ADP'}: {getDisplayedAdp(player).toFixed(1)}
                            </span>
                            {player.value != null && (
                              <span className="text-xs text-emerald-400">Value: {player.value.toFixed(0)}</span>
                            )}
                            {player.adpTrend != null && player.adpTrend !== 0 && (
                              <span className={`text-[10px] flex items-center gap-0.5 ${player.adpTrend < 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                                {player.adpTrend < 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                {player.adpTrend < 0 ? 'Rising' : 'Falling'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-12">
            {Array.from({ length: Math.max(...draftResults.map(p => p.round)) }).map((_, round) => {
              const roundPicks = draftResults.filter(p => p.round === round + 1)
              if (roundPicks.length === 0) return null
              return (
                <div key={round}>
                  <div className="text-cyan-400 text-sm font-mono mb-4 pl-4">ROUND {round + 1}</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-12 gap-4">
                    <AnimatePresence>
                      {roundPicks.map((pick, i) => {
                        const isFuturePick = livePlayback && pick.overall > completedPicks
                        const isOnClockPick = livePlayback && pick.overall === completedPicks + 1
                        const isOnClockUserPick = isOnClockPick && pick.isUser
                        const isRevealedPick = !isFuturePick
                        const managerColor = getManagerColorBySeed(pick.manager || `manager-${pick.overall}`)
                        const managerTint = getManagerTintStyle(pick.manager || `manager-${pick.overall}`, 0.1)
                        return (
                        <motion.div
                          key={pick.overall}
                          initial={{ opacity: 0, y: 34, scale: 0.84, rotateX: 10 }}
                          animate={{
                            opacity: 1,
                            y: 0,
                            scale: [0.84, 1.06, 1],
                            rotateX: 0,
                            boxShadow: [
                              '0 0 0px rgba(34,211,238,0)',
                              '0 0 24px rgba(147,51,234,0.28)',
                              isOnClockUserPick ? '0 0 28px rgba(234,179,8,0.38)' : '0 0 0px rgba(34,211,238,0)',
                            ],
                          }}
                          transition={{ delay: (round * 12 + i) * 0.18, duration: 0.58, type: 'spring', stiffness: 210, damping: 20 }}
                          className={`rounded-2xl p-5 group transition-all relative ${
                            isOnClockPick
                              ? 'border-2 border-yellow-500/70 bg-gradient-to-br from-yellow-950/30 to-black mock-on-clock-pulse'
                              : !isRevealedPick
                                ? 'bg-gray-950/70 border border-gray-800/60'
                                : pick.isUser
                                  ? 'bg-cyan-950/30 border-2 border-cyan-500/40 hover:border-cyan-400/60'
                                  : 'bg-gray-950 border border-gray-800 hover:border-purple-500/60'
                          }`}
                          style={!isOnClockPick && isRevealedPick ? managerTint : undefined}
                          onClick={() => {
                            if (!isRevealedPick) return
                            if (pick.playerName) openComparison(pick)
                          }}
                        >
                          {isOnClockPick && (
                            <div className="absolute -top-2 -right-2 bg-yellow-500 text-black text-[9px] px-2 py-0.5 rounded-full font-bold">
                              ON THE CLOCK
                            </div>
                          )}
                          <div className="flex items-center gap-3 mb-3">
                            <div className="w-9 h-9 rounded-full overflow-hidden border border-gray-700">
                              <img
                                src={pick.managerAvatar || '/default-avatar.png'}
                                alt={pick.manager}
                                className="w-full h-full object-cover"
                                onError={(e) => { (e.target as HTMLImageElement).src = '/default-avatar.png' }}
                              />
                            </div>
                            <div>
                              <div className={`font-medium text-sm ${managerColor.textClass}`}>{pick.manager}</div>
                              <div className="text-xs text-gray-500">Pick {pick.overall}</div>
                            </div>
                          </div>

                          <div className="font-bold text-lg mb-1 group-hover:text-purple-400 transition-colors">
                            {isRevealedPick ? pick.playerName : (isOnClockPick ? 'On the Clock' : 'Pending Pick')}
                          </div>
                          {isRevealedPick ? (
                            <div className="flex items-center gap-2 mb-2">
                              <Badge className={`${POSITION_COLORS[pick.position] || ''} border text-[10px] px-1.5 py-0`}>
                                {pick.position}
                              </Badge>
                              <span className="text-sm text-gray-400">{pick.team}</span>
                              {pick.isBotPick && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">AI BOT</span>
                              )}
                            </div>
                          ) : (
                            <div className="text-xs text-gray-500 mb-2">{isOnClockPick ? 'Selecting...' : 'Awaiting board'}</div>
                          )}

                          {isRevealedPick ? (() => {
                            const adpInfo = adpMap.get(normalizeName(pick.playerName))
                            if (!adpInfo) return <div className="text-xs text-emerald-400">Confidence: {pick.confidence}%</div>
                            const displayedAdp = getDisplayedAdp(adpInfo)
                            const diff = pick.overall - displayedAdp
                            const isSteal = diff > 3
                            const isReach = diff < -3
                            return (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-gray-500">{useAiBoardAdp ? 'AI ADP' : 'ADP'} {displayedAdp.toFixed(1)}</span>
                                  <span className={`font-bold flex items-center gap-0.5 ${
                                    isSteal ? 'text-emerald-400' : isReach ? 'text-orange-400' : 'text-gray-400'
                                  }`}>
                                    {isSteal ? <><TrendingUp className="h-3 w-3" /> STEAL</> :
                                     isReach ? <><TrendingDown className="h-3 w-3" /> REACH</> :
                                     <><Minus className="h-3 w-3" /> FAIR</>}
                                  </span>
                                </div>
                                <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${
                                      isSteal ? 'bg-emerald-500' : isReach ? 'bg-orange-500' : 'bg-gray-500'
                                    }`}
                                    style={{ width: `${Math.min(100, Math.max(10, 50 + diff * 3))}%` }}
                                  />
                                </div>
                                {adpInfo.adpTrend != null && adpInfo.adpTrend !== 0 && (
                                  <div className={`text-[9px] ${adpInfo.adpTrend < 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                                    {adpInfo.adpTrend < 0 ? 'Rising' : 'Falling'} in drafts
                                  </div>
                                )}
                              </div>
                            )
                          })() : <div className="text-xs text-gray-500">No player selected yet.</div>}

                          {isRevealedPick && pick.notes && (
                            <p className="text-[10px] text-gray-600 mt-2 line-clamp-2">{pick.notes}</p>
                          )}

                          {isOnClockUserPick && (
                            <div className="flex gap-2 mt-4 justify-center">
                              {selectedSport === 'NFL' && (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={(e) => { e.stopPropagation(); simulateTrade('up', pick.overall) }}
                                    disabled={isTrading}
                                    className="border-green-500/50 text-green-400 hover:bg-green-950/40 text-xs"
                                  >
                                    {isTrading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ArrowUp className="mr-1 h-3 w-3" />}
                                    Trade Up
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={(e) => { e.stopPropagation(); simulateTrade('down', pick.overall) }}
                                    disabled={isTrading}
                                    className="border-red-500/50 text-red-400 hover:bg-red-950/40 text-xs"
                                  >
                                    {isTrading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ArrowDown className="mr-1 h-3 w-3" />}
                                    Trade Down
                                  </Button>
                                </>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => { e.stopPropagation(); loadAssistant(pick.overall) }}
                                disabled={assistantLoading}
                                className="border-yellow-500/50 text-yellow-400 hover:bg-yellow-950/40 text-xs"
                              >
                                {assistantLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Zap className="mr-1 h-3 w-3" />}
                                Assistant
                              </Button>
                            </div>
                          )}

                          {selectedSport === 'NFL' && pick.isUser && tradeProposals[pick.overall] && !dismissedProposals.has(pick.overall) && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              className="mt-4 p-5 bg-gradient-to-br from-purple-950/70 to-black/70 border border-purple-500/50 rounded-xl overflow-hidden"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="text-sm font-medium text-purple-300 mb-3">
                                Trade Proposal from {tradeProposals[pick.overall].fromTeam}
                              </div>
                              <div className="text-sm text-gray-300 mb-4">
                                They offer: <span className="font-medium text-green-300">{tradeProposals[pick.overall].theyGive}</span>
                                <br />
                                For your: <span className="font-medium text-red-300">{tradeProposals[pick.overall].youGive}</span>
                              </div>
                              <div className="flex gap-3">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleTradeAction(pick.overall, 'reject')}
                                  disabled={isTrading}
                                  className="flex-1 border-red-500/50 text-red-400 hover:bg-red-950/40"
                                >
                                  Reject
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => handleTradeAction(pick.overall, 'accept')}
                                  disabled={isTrading}
                                  className="flex-1 bg-green-600 hover:bg-green-700"
                                >
                                  Accept Trade
                                </Button>
                              </div>
                            </motion.div>
                          )}
                        </motion.div>
                        )
                      })}
                    </AnimatePresence>
                  </div>

                  <div className="mt-6">
                    {(() => {
                      const rNum = round + 1
                      const quickNeeds = perRoundRosters[rNum] || []
                      const userTeam = quickNeeds.find(t => t.isUser)
                      const summaryPositions = analyticsPositions.slice(0, 6)

                      return (
                        <>
                          {userTeam && (
                            <div className="bg-cyan-950/20 border border-cyan-500/20 rounded-xl p-4 mb-3">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-bold text-cyan-400">Your Roster After Round {rNum}</span>
                                {(() => {
                                  const needs = calculateTeamNeeds(userTeam, rNum)
                                  const vals = Object.values(needs)
                                  const avgNeed = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
                                  const topPos = Object.entries(needs).sort(([,a], [,b]) => b - a)[0]
                                  if (avgNeed <= 0) return null
                                  return (
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                      avgNeed >= 70 ? 'bg-red-500/20 text-red-400' :
                                      avgNeed >= 45 ? 'bg-orange-500/20 text-orange-400' :
                                      'bg-emerald-500/20 text-emerald-400'
                                    }`}>
                                      Need: {avgNeed}/100{topPos ? ` (${topPos[0]})` : ''}
                                    </span>
                                  )
                                })()}
                              </div>
                              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
                                {summaryPositions.map(pos => {
                                  const count = userTeam.counts[pos] || 0
                                  const target = starterTargets[pos] || 1
                                  const pct = Math.min(100, (count / target) * 100)
                                  const posColor = getPositionBarColor(pos)
                                  return (
                                    <div key={pos} className="text-center">
                                      <div className="text-[10px] text-gray-500 mb-1">{pos}</div>
                                      <div className="text-lg font-bold">{count}<span className="text-gray-600 text-xs">/{target}</span></div>
                                      <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden mt-1">
                                        <div className={`h-full rounded-full ${posColor} transition-all`} style={{ width: `${pct}%` }} />
                                      </div>
                                      {count < target && (
                                        <div className="text-[9px] text-orange-400 mt-0.5 font-bold">NEED</div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}

                          {quickNeeds.length > 0 && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              className="mt-4 bg-black/60 border border-gray-800 rounded-2xl p-6 overflow-hidden"
                            >
                              <h4 className="text-sm font-medium text-gray-300 mb-4 flex items-center gap-2">
                                Team Needs After Round {rNum}
                                <span className="text-xs bg-cyan-900/50 px-2 py-1 rounded-full">Updated</span>
                              </h4>

                              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                                {quickNeeds.map(team => {
                                  const needs = calculateTeamNeeds(team, rNum)
                                  return (
                                    <div key={team.manager} className={`p-4 rounded-xl ${team.isUser ? 'bg-cyan-950/30 border border-cyan-500/30' : 'bg-gray-950/50'}`}>
                                      <div className="flex items-center gap-3 mb-3">
                                        <img
                                          src={managerAvatars[team.manager] || '/default-avatar.png'}
                                          alt={team.manager}
                                          className="w-10 h-10 rounded-full border border-gray-700 object-cover"
                                          onError={(e) => { (e.target as HTMLImageElement).src = '/default-avatar.png' }}
                                        />
                                        <span className="font-medium truncate text-sm">{team.manager}{team.isUser ? ' (You)' : ''}</span>
                                      </div>

                                      <div className="space-y-2">
                                        {(['QB', 'RB', 'WR', 'TE'] as const).map(pos => (
                                          <div key={pos} className="flex items-center gap-2">
                                            <div className="w-8 text-xs font-mono text-gray-400">{pos}</div>
                                            <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                                              <div
                                                className="h-full rounded-full transition-all duration-1000"
                                                style={{
                                                  width: `${needs[pos] || 0}%`,
                                                  background: (needs[pos] || 0) > 70 ? '#ef4444' : (needs[pos] || 0) > 40 ? '#f59e0b' : '#10b981',
                                                }}
                                              />
                                            </div>
                                            <div className="text-xs w-10 text-right">{needs[pos] || 0}%</div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </motion.div>
                          )}
                        </>
                      )
                    })()}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tradeResult && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-black/90 border border-yellow-500/40 rounded-2xl p-6 relative"
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTradeResult(null)}
            className="absolute top-3 right-3 text-gray-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </Button>
          <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
            {tradeResult.direction === 'up' ? (
              <><ArrowUp className="h-5 w-5 text-green-400" /> Traded Up</>
            ) : (
              <><ArrowDown className="h-5 w-5 text-red-400" /> Traded Down</>
            )}
            <span className="text-xs text-gray-500 font-normal ml-2">from Pick #{tradeResult.pickNumber}</span>
          </h3>

          {tradeResult.tradeDescription && (
            <p className="text-sm text-gray-300 bg-gray-950 rounded-xl p-4 mb-4">{tradeResult.tradeDescription}</p>
          )}

          {tradeResult.tradedPicks && (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-green-950/20 border border-green-500/20 rounded-xl p-4 text-center">
                <div className="text-xs text-gray-500 mb-1">Your New Pick</div>
                <div className="text-2xl font-bold text-green-400">#{tradeResult.tradedPicks.userNewPick}</div>
              </div>
              <div className="bg-gray-950 border border-gray-700 rounded-xl p-4 text-center">
                <div className="text-xs text-gray-500 mb-1">Traded With</div>
                <div className="text-sm font-bold text-purple-400">{tradeResult.tradedPicks.partnerManager}</div>
                <div className="text-xs text-gray-600">gets Pick #{tradeResult.tradedPicks.partnerNewPick}</div>
              </div>
            </div>
          )}

          <p className="text-xs text-gray-600 mt-3 text-center">The draft board above has been updated to reflect this trade.</p>
        </motion.div>
      )}

      {!isSimulating && !loading && draftResults.length === 0 && selectedLeagueId && (
        <div className="h-64 flex items-center justify-center border border-dashed border-gray-700 rounded-2xl text-gray-500 text-center px-4">
          <div>
            <Users className="h-12 w-12 mx-auto mb-4 text-gray-700" />
            <p className="text-lg mb-1">Ready to draft</p>
            <p className="text-sm text-gray-600">
              AI will draft for all managers based on {selectedSport === 'NFL' ? 'live ADP data' : `the imported ${selectedSport} player pool`} and real tendencies
            </p>
          </div>
        </div>
      )}

      <AnimatePresence>
        {draftResults.length > 0 && draftResults.every(p => p.round <= customRounds) && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="mt-16 bg-gradient-to-br from-purple-950/80 via-black/90 to-gray-950/80 border border-purple-500/40 rounded-3xl p-10 text-center shadow-2xl shadow-purple-950/50"
          >
            <h2 className="text-4xl font-bold bg-gradient-to-r from-cyan-400 via-purple-500 to-pink-500 bg-clip-text text-transparent mb-8">
              Draft Recap & Team Grades
            </h2>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
              {Array.from(new Set(draftResults.map(p => p.manager))).map((manager) => {
                const grade = calculateTeamGrade(manager, draftResults)
                return (
                  <motion.div
                    key={manager}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: Math.random() * 0.3 }}
                    className="bg-black/60 border border-cyan-900/40 p-6 rounded-2xl hover:border-cyan-500/60 transition-all group"
                  >
                    <div className="flex items-center gap-4 mb-4">
                      <img
                        src={managerAvatars[manager] || '/default-team.png'}
                        className="w-16 h-16 rounded-full border-2 border-purple-500/30"
                        onError={(e) => { (e.target as HTMLImageElement).src = '/default-team.png' }}
                      />
                      <div className="text-left">
                        <h3 className="text-xl font-bold">{manager}</h3>
                        <p className="text-sm text-gray-400">{draftResults.filter(p => p.manager === manager).length} picks</p>
                      </div>
                    </div>

                    <div className="text-5xl font-extrabold mb-2" style={{ color: grade.color }}>
                      {grade.letter}
                    </div>
                    <div className="text-sm text-gray-300 mb-4">{grade.title}</div>

                    <div className="space-y-2 text-left text-sm">
                      {grade.strengths.map((s, i) => (
                        <p key={`s-${i}`} className="text-green-300 flex items-center gap-2">
                          <span className="text-green-400">&#10004;</span> {s}
                        </p>
                      ))}
                      {grade.weaknesses.map((w, i) => (
                        <p key={`w-${i}`} className="text-red-300 flex items-center gap-2">
                          <span className="text-red-400">&#10008;</span> {w}
                        </p>
                      ))}
                    </div>

                    <div className="mt-6 pt-4 border-t border-gray-800 text-xs text-gray-400">
                      Total value added: <span className="text-cyan-400 font-medium">{grade.valueAdded}</span>
                    </div>
                  </motion.div>
                )
              })}
            </div>

            <div className="mt-12 text-gray-300 max-w-3xl mx-auto">
              <p className="text-lg italic">
                &ldquo;This mock draft saw aggressive moves early &mdash; future contenders loaded up on youth while rebuilders stockpiled picks. The 2026 class looks deep at WR and RB.&rdquo;
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {draftResults.length > 0 && adpData.length > 0 && (
        <div className="fixed top-24 right-8 w-80 space-y-4 z-20 hidden lg:block">
          {showAIAssistantPanel && (
            <div className="rounded-2xl overflow-hidden">
              <AIDraftAssistantPanel params={aiAssistantParams} autoFetch={true} compact />
            </div>
          )}
          <div className="bg-black/80 border border-cyan-900/50 rounded-2xl p-6 shadow-2xl shadow-cyan-950/50">
          <h3 className="text-lg font-bold text-cyan-300 mb-4 flex items-center gap-2">
            Best Available
            <span className="text-xs bg-cyan-900/50 px-2 py-1 rounded-full">Live</span>
          </h3>

          <div className="flex gap-2 mb-4 flex-wrap">
            {availableFilterOptions.map(pos => (
              <Button
                key={pos}
                variant={selectedFilter === pos ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedFilter(pos)}
                className="text-xs h-7 px-2.5"
              >
                {pos}
              </Button>
            ))}
          </div>

          <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
            <AnimatePresence>
              {bestAvailable.map((player, i) => (
                <motion.div
                  key={player.name}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center gap-4 bg-gray-950/50 p-3 rounded-xl hover:bg-gray-900/70 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{player.name}</p>
                    <p className="text-xs text-gray-400">{player.position} &middot; {player.team || 'FA'}</p>
                  </div>
                  <div className="text-right text-xs shrink-0">
                    <div className="text-cyan-400">ADP {player.adp?.toFixed(1) || 'N/A'}</div>
                    {player.value && <div className="text-purple-400">Value ${player.value}</div>}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {bestAvailable.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">No players available</p>
            )}
          </div>
          </div>
        </div>
      )}

      <Dialog open={forecastOpen} onOpenChange={setForecastOpen}>
        <DialogContent className="max-w-4xl bg-black/95 border-cyan-900/40">
          <DialogHeader>
            <DialogTitle>AI Predicted Draft Board ({forecastMeta?.rounds || 2} rounds  -  {forecastMeta?.simulations || 0} sims)</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto space-y-3 pr-1">
            {boardForecasts.length > 0 && (() => {
              const vols = boardForecasts.filter(f => f.volatility).map(f => f.volatility)
              const lowCount = vols.filter(v => v.chaosLevel === 'low').length
              const medCount = vols.filter(v => v.chaosLevel === 'medium').length
              const highCount = vols.filter(v => v.chaosLevel === 'high').length
              const fragileCount = vols.filter(v => v.tierStability === 'fragile').length
              const total = vols.length || 1
              const avgChaos = Math.round(vols.reduce((s, v) => s + v.chaosScore, 0) / total)
              return (
                <div className="rounded-xl border border-white/10 bg-gradient-to-r from-emerald-500/5 via-amber-500/5 to-red-500/5 p-3">
                  <div className="text-xs font-semibold text-white mb-2">Board Volatility Overview</div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden flex">
                      <div className="h-full bg-emerald-500/70" style={{ width: `${(lowCount / total) * 100}%` }} />
                      <div className="h-full bg-amber-500/70" style={{ width: `${(medCount / total) * 100}%` }} />
                      <div className="h-full bg-red-500/70" style={{ width: `${(highCount / total) * 100}%` }} />
                    </div>
                    <span className="text-[10px] text-gray-400 tabular-nums shrink-0">avg {avgChaos}%</span>
                  </div>
                  <div className="flex gap-4 text-[10px]">
                    <span className="text-emerald-400">{lowCount} low</span>
                    <span className="text-amber-400">{medCount} medium</span>
                    <span className="text-red-400">{highCount} high</span>
                    <span className="text-orange-400">{fragileCount} fragile tiers</span>
                  </div>
                </div>
              )
            })()}
            {forecastMovers.length > 0 && (
              <div className="rounded-xl border border-cyan-900/40 bg-cyan-500/5 p-3">
                <div className="text-xs font-semibold text-cyan-300 mb-2">Real-time ADP Movers (rookies/news/ESPN updates)</div>
                <div className="grid gap-1">
                  {forecastMovers.slice(0, 8).map((m) => (
                    <div key={m.name} className="text-xs text-gray-300 flex items-center justify-between gap-3">
                      <span className="truncate">{m.name}  -  {m.delta < 0 ? 'UP' : 'DOWN'} {Math.abs(m.delta)} ({m.reasons?.[0] || 'signal update'})</span>
                      <span className="text-cyan-300">ADP {m.adjustedAdp.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {boardForecasts.slice(0, 36).map((f) => (
              <div key={`${f.overall}-${f.manager}`} className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
                <div className="text-xs text-gray-400 mb-1">Round {f.round}  -  Pick {f.pick} (#{f.overall})  -  {f.manager}</div>
                {f.volatility && <VolatilityBadge v={f.volatility} />}
                <div className="space-y-1.5">
                  {f.topTargets.length === 0 ? (
                    <div className="text-sm text-gray-500">No projection available</div>
                  ) : f.topTargets.map((t, idx) => {
                    const sc = t.scorecard
                    const barColors: Record<string, string> = {
                      'ADP Position': 'bg-cyan-500/70',
                      'Team Need': 'bg-emerald-500/70',
                      'Manager Style': 'bg-amber-500/70',
                      'News Impact': 'bg-red-500/70',
                      'Rookie Boost': 'bg-purple-500/70',
                    }
                    const dotColors: Record<string, string> = {
                      'ADP Position': 'bg-cyan-500/70',
                      'Team Need': 'bg-emerald-500/70',
                      'Manager Style': 'bg-amber-500/70',
                      'News Impact': 'bg-red-500/70',
                      'Rookie Boost': 'bg-purple-500/70',
                    }
                    const factors = sc ? [
                      { label: 'ADP Position', pct: sc.adpWeight },
                      { label: 'Team Need', pct: sc.teamNeedWeight },
                      { label: 'Manager Style', pct: sc.managerTendencyWeight },
                      { label: 'News Impact', pct: sc.newsImpactWeight },
                      { label: 'Rookie Boost', pct: sc.rookieRankBoostWeight },
                    ] : []
                    return (
                      <div key={`${t.player}-${idx}`} className="rounded-lg bg-white/[0.03] border border-white/5 p-2.5 space-y-2">
                        <div className="flex items-start justify-between gap-3 text-sm">
                          <div>
                            <span className="font-semibold text-white">{t.player}</span>
                            <span className="text-gray-400">  -  {t.position}</span>
                            <div className="text-xs text-gray-500">{t.why}</div>
                          </div>
                          <div className="text-cyan-300 font-semibold tabular-nums">{t.probability}%</div>
                        </div>
                        {sc && (
                          <div className="space-y-1">
                            <div className="flex items-center h-2.5 rounded-full overflow-hidden bg-white/5">
                              {factors.filter(fct => fct.pct > 0).map((fct) => (
                                <div key={fct.label} className={`h-full ${barColors[fct.label]}`} style={{ width: `${fct.pct}%` }} title={`${fct.label}: ${fct.pct}%`} />
                              ))}
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                              {factors.map((fct) => (
                                <div key={fct.label} className="flex items-center gap-1 text-[10px]">
                                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColors[fct.label]}`} />
                                  <span className="text-gray-500">{fct.label}</span>
                                  <span className="text-gray-400 font-semibold tabular-nums">{fct.pct}%</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pickPathOpen} onOpenChange={setPickPathOpen}>
        <DialogContent className="max-w-4xl bg-black/95 border-purple-900/40">
          <DialogHeader>
            <DialogTitle>Pick Path - Contingency Tree{pickPathTarget ? ` (targeting ${pickPathTarget})` : ''}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto space-y-5 pr-1">
            {pickPathData.length === 0 && <p className="text-sm text-gray-500 text-center py-4">No pick paths available</p>}
            {pickPathData.map((pp: any) => (
              <div key={pp.overall} className="rounded-xl border border-purple-900/30 bg-purple-500/5 p-4 space-y-3">
                <div className="text-sm font-semibold text-purple-300">Round {pp.round}  -  Pick {pp.pick} (#{pp.overall})</div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-cyan-300">Baseline Projection</div>
                  {pp.baseline?.map((t: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span><span className="font-medium text-white">{t.player}</span> <span className="text-gray-400"> -  {t.position}</span></span>
                      <span className="text-cyan-400 tabular-nums">{t.probability}%</span>
                    </div>
                  ))}
                </div>

                {pp.playerGone && (
                  <div className="space-y-2 border-t border-white/10 pt-2">
                    <div className="text-xs font-semibold text-red-400">If {pp.playerGone.removedPlayer} is gone</div>
                    {pp.playerGone.fallbacks?.map((t: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span><span className="font-medium text-white">{t.player}</span> <span className="text-gray-400"> -  {t.position}</span></span>
                        <span className="text-amber-400 tabular-nums">{t.probability}%</span>
                      </div>
                    ))}
                    {(!pp.playerGone.fallbacks || pp.playerGone.fallbacks.length === 0) && (
                      <div className="text-xs text-gray-500">No fallback data</div>
                    )}
                  </div>
                )}

                <div className="space-y-2 border-t border-white/10 pt-2">
                  <div className="text-xs font-semibold text-green-400">If 2+ RBs run before your pick</div>
                  <div className="text-xs text-gray-400 italic">{pp.rbRun?.narrative}</div>
                  {pp.rbRun?.pivot?.map((t: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span><span className="font-medium text-white">{t.player}</span> <span className="text-gray-400"> -  {t.position}</span></span>
                      <span className="text-green-400 tabular-nums">{t.probability}%</span>
                    </div>
                  ))}
                </div>

                <div className="space-y-2 border-t border-white/10 pt-2">
                  <div className="text-xs font-semibold text-yellow-400">If QB run starts</div>
                  <div className="text-xs text-gray-400 italic">{pp.qbRun?.narrative}</div>
                  {pp.qbRun?.recommendation?.map((t: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span><span className="font-medium text-white">{t.player}</span> <span className="text-gray-400"> -  {t.position}</span></span>
                      <span className="text-yellow-400 tabular-nums">{t.probability}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={snipeRadarOpen} onOpenChange={setSnipeRadarOpen}>
        <DialogContent className="max-w-4xl bg-black/95 border-red-900/40">
          <DialogHeader>
            <DialogTitle className="text-red-300">Snipe Radar - Threat Detection</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto space-y-4 pr-1">
            {snipeRadarData.length === 0 && <p className="text-sm text-gray-500 text-center py-4">No snipe radar data available</p>}
            {snipeRadarData.map((entry) => (
              <div key={entry.userPickOverall} className="rounded-xl border border-red-900/30 bg-red-500/[0.03] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-white">
                    Your Pick: Round {entry.round}  -  Pick {entry.pick} (#{entry.userPickOverall})
                  </div>
                  <span className="text-[10px] text-gray-500">{entry.picksBefore} picks before yours</span>
                </div>

                {entry.alerts.length === 0 ? (
                  <div className="text-sm text-emerald-400 bg-emerald-500/10 rounded-lg p-2">No major snipe threats detected - your targets look safe.</div>
                ) : (
                  <div className="space-y-2">
                    {entry.alerts.map((alert) => {
                      const urgencyStyles: Record<string, { border: string; bg: string; text: string; icon: string }> = {
                        critical: { border: 'border-red-500/40', bg: 'bg-red-500/10', text: 'text-red-400', icon: '!!' },
                        warning: { border: 'border-amber-500/30', bg: 'bg-amber-500/10', text: 'text-amber-400', icon: '!' },
                        watch: { border: 'border-blue-500/20', bg: 'bg-blue-500/5', text: 'text-blue-400', icon: '~' },
                      }
                      const s = urgencyStyles[alert.urgencyLevel]
                      return (
                        <div key={alert.player} className={`rounded-lg border ${s.border} ${s.bg} p-3`}>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-bold uppercase px-1.5 py-0.5 rounded ${s.bg} ${s.text}`}>{alert.urgencyLevel}</span>
                              <span className="font-semibold text-white text-sm">{alert.player}</span>
                              <span className="text-xs text-gray-400">{alert.position}  -  ADP {alert.adp.toFixed(1)}</span>
                            </div>
                            <span className={`text-sm font-bold tabular-nums ${s.text}`}>{alert.snipeProbability}%</span>
                          </div>
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-[10px] text-gray-500">Snipe probability</span>
                            <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${alert.urgencyLevel === 'critical' ? 'bg-red-500/70' : alert.urgencyLevel === 'warning' ? 'bg-amber-500/70' : 'bg-blue-500/60'}`} style={{ width: `${alert.snipeProbability}%` }} />
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-gray-500">
                              Likely sniped by: {alert.snipedByManagers.slice(0, 2).map(m => `${m.manager} (${m.probability}%)`).join(', ')}
                            </span>
                            <span className="text-red-400 font-semibold">EV lost if sniped: {alert.expectedValueLost > 0 ? `-${alert.expectedValueLost}` : '0'}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {entry.topAvailableIfNoSnipe.length > 0 && (
                  <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-2">
                    <div className="text-[10px] font-semibold text-emerald-400 mb-1">Most likely available at your pick</div>
                    <div className="flex flex-wrap gap-2">
                      {entry.topAvailableIfNoSnipe.map((p) => (
                        <span key={p.player} className="text-xs text-gray-300 bg-white/5 rounded px-2 py-0.5">
                          {p.player} <span className="text-gray-500">{p.position}</span> <span className="text-emerald-400">{p.probability}%</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={tradeOptimizerOpen} onOpenChange={setTradeOptimizerOpen}>
        <DialogContent className="max-w-4xl bg-black/95 border-green-900/40">
          <DialogHeader>
            <DialogTitle className="text-green-300">Trade-Window Optimizer - Best Offers by EV</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto space-y-4 pr-1">
            {tradeUpOffers.length === 0 && tradeDownOffers.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">No trade opportunities found</p>
            )}

            {tradeUpOffers.length > 0 && (
              <div className="space-y-3">
                <div className="text-xs font-semibold text-green-400 uppercase tracking-wider">Trade Up Opportunities</div>
                {tradeUpOffers.map((offer, idx) => (
                  <div key={`up-${idx}`} className="rounded-xl border border-green-500/20 bg-green-500/[0.03] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-green-400 bg-green-500/15 px-2 py-0.5 rounded">#{offer.rank}</span>
                        <ArrowUp className="h-3.5 w-3.5 text-green-400" />
                        <span className="font-semibold text-white text-sm">Trade with {offer.partnerManager}</span>
                      </div>
                      <span className={`text-sm font-bold tabular-nums ${offer.riskAdjustedEV > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {offer.riskAdjustedEV > 0 ? '+' : ''}{offer.riskAdjustedEV} risk-adj EV
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-red-500/5 border border-red-500/15 p-2">
                        <div className="text-[10px] text-red-400 font-semibold mb-1">YOU GIVE</div>
                        {offer.userGives.map(g => (
                          <div key={g.pickOverall} className="text-xs text-gray-300">
                            Pick #{g.pickOverall} <span className="text-gray-500">(R{g.round}P{g.pick}  -  val {g.value})</span>
                          </div>
                        ))}
                      </div>
                      <div className="rounded-lg bg-green-500/5 border border-green-500/15 p-2">
                        <div className="text-[10px] text-green-400 font-semibold mb-1">YOU GET</div>
                        {offer.userGets.map(g => (
                          <div key={g.pickOverall} className="text-xs text-gray-300">
                            Pick #{g.pickOverall} <span className="text-gray-500">(R{g.round}P{g.pick}  -  val {g.value})</span>
                          </div>
                        ))}
                        {offer.topPlayerGain && (
                          <div className="text-[10px] text-cyan-400 mt-1">Top target: {offer.topPlayerGain}</div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-lg bg-white/5 p-2 text-center">
                        <div className="text-[10px] text-gray-500">Acceptance Odds</div>
                        <div className={`text-sm font-bold tabular-nums ${offer.acceptanceOdds >= 50 ? 'text-green-400' : offer.acceptanceOdds >= 30 ? 'text-amber-400' : 'text-red-400'}`}>{offer.acceptanceOdds}%</div>
                      </div>
                      <div className="rounded-lg bg-white/5 p-2 text-center">
                        <div className="text-[10px] text-gray-500">Minimum Ask</div>
                        <div className="text-sm font-semibold text-gray-300">R{offer.minimumAsk.round} (val {offer.minimumAsk.value})</div>
                      </div>
                      <div className="rounded-lg bg-white/5 p-2 text-center">
                        <div className="text-[10px] text-gray-500">Walk Away If</div>
                        <div className="text-sm font-semibold text-orange-400">{'>'}{offer.walkAwayThreshold} cost</div>
                      </div>
                    </div>

                    <div className="text-xs text-gray-400 italic">{offer.verdict}</div>
                  </div>
                ))}
              </div>
            )}

            {tradeDownOffers.length > 0 && (
              <div className="space-y-3">
                <div className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Trade Down Opportunities</div>
                {tradeDownOffers.map((offer, idx) => (
                  <div key={`down-${idx}`} className="rounded-xl border border-blue-500/20 bg-blue-500/[0.03] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-blue-400 bg-blue-500/15 px-2 py-0.5 rounded">#{offer.rank}</span>
                        <ArrowDown className="h-3.5 w-3.5 text-blue-400" />
                        <span className="font-semibold text-white text-sm">Trade with {offer.partnerManager}</span>
                      </div>
                      <span className={`text-sm font-bold tabular-nums ${offer.riskAdjustedEV > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {offer.riskAdjustedEV > 0 ? '+' : ''}{offer.riskAdjustedEV} risk-adj EV
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-red-500/5 border border-red-500/15 p-2">
                        <div className="text-[10px] text-red-400 font-semibold mb-1">YOU GIVE</div>
                        {offer.userGives.map(g => (
                          <div key={g.pickOverall} className="text-xs text-gray-300">
                            Pick #{g.pickOverall} <span className="text-gray-500">(R{g.round}P{g.pick}  -  val {g.value})</span>
                          </div>
                        ))}
                      </div>
                      <div className="rounded-lg bg-blue-500/5 border border-blue-500/15 p-2">
                        <div className="text-[10px] text-blue-400 font-semibold mb-1">YOU GET</div>
                        {offer.userGets.map(g => (
                          <div key={g.pickOverall} className="text-xs text-gray-300">
                            Pick #{g.pickOverall} <span className="text-gray-500">(R{g.round}P{g.pick}  -  val {g.value})</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-lg bg-white/5 p-2 text-center">
                        <div className="text-[10px] text-gray-500">Acceptance Odds</div>
                        <div className={`text-sm font-bold tabular-nums ${offer.acceptanceOdds >= 50 ? 'text-green-400' : offer.acceptanceOdds >= 30 ? 'text-amber-400' : 'text-red-400'}`}>{offer.acceptanceOdds}%</div>
                      </div>
                      <div className="rounded-lg bg-white/5 p-2 text-center">
                        <div className="text-[10px] text-gray-500">Minimum Ask</div>
                        <div className="text-sm font-semibold text-gray-300">R{offer.minimumAsk.round} (val {offer.minimumAsk.value})</div>
                      </div>
                      <div className="rounded-lg bg-white/5 p-2 text-center">
                        <div className="text-[10px] text-gray-500">Walk Away If</div>
                        <div className="text-sm font-semibold text-orange-400">{'>'}{offer.walkAwayThreshold} cost</div>
                      </div>
                    </div>

                    <div className="text-xs text-gray-400 italic">{offer.verdict}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={boardDriftOpen} onOpenChange={setBoardDriftOpen}>
        <DialogContent className="max-w-4xl bg-black/95 border-sky-900/40">
          <DialogHeader>
            <DialogTitle className="text-sky-300">Weekly Board Drift Report</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto space-y-5 pr-1">
            {!boardDriftReport ? (
              <p className="text-sm text-gray-500 text-center py-4">No report data available</p>
            ) : boardDriftReport.topRisers?.length === 0 && boardDriftReport.topFallers?.length === 0 ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-6 text-center space-y-2">
                  <Newspaper className="h-8 w-8 text-sky-400 mx-auto" />
                  <div className="text-sm text-sky-300 font-semibold">Baseline Snapshot Saved</div>
                  <p className="text-xs text-gray-400">Your current board has been recorded. Come back next week to see who moved, why, and what it means for your draft.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
                  <div className="text-sm text-sky-300 font-semibold mb-1">{boardDriftReport.weekLabel} vs {boardDriftReport.previousWeekLabel}</div>
                  <p className="text-sm text-gray-300">{boardDriftReport.headline}</p>
                  <div className="flex gap-4 mt-2 text-[10px] text-gray-500">
                    <span>{boardDriftReport.totalPlayersTracked} players tracked</span>
                    <span>Avg drift: {boardDriftReport.averageDrift} spots</span>
                  </div>
                </div>

                {boardDriftReport.topRisers?.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                      <TrendingUp className="h-3.5 w-3.5" /> Biggest Risers (ADP Down = More Valuable)
                    </div>
                    {boardDriftReport.topRisers.map((p: any) => {
                      const magStyles: Record<string, string> = {
                        major: 'border-emerald-500/30 bg-emerald-500/10',
                        moderate: 'border-emerald-500/20 bg-emerald-500/5',
                        minor: 'border-emerald-500/10 bg-emerald-500/[0.02]',
                      }
                      return (
                        <div key={p.name} className={`rounded-lg border p-3 ${magStyles[p.driftMagnitude] || magStyles.minor}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-white text-sm">{p.name}</span>
                              <span className="text-xs text-gray-400">{p.position}  -  {p.team || '-'}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-gray-500">ADP {p.previousAdp} -&gt; {p.currentAdp}</span>
                              <span className="text-sm font-bold text-emerald-400 tabular-nums">{p.drift > 0 ? '' : '+'}{Math.abs(p.drift)}</span>
                              <ArrowUp className="h-3.5 w-3.5 text-emerald-400" />
                            </div>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {p.reasons.map((r: string, i: number) => (
                              <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300">{r}</span>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {boardDriftReport.topFallers?.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-red-400 uppercase tracking-wider flex items-center gap-1.5">
                      <TrendingDown className="h-3.5 w-3.5" /> Biggest Fallers (ADP Up = Less Valuable)
                    </div>
                    {boardDriftReport.topFallers.map((p: any) => {
                      const magStyles: Record<string, string> = {
                        major: 'border-red-500/30 bg-red-500/10',
                        moderate: 'border-red-500/20 bg-red-500/5',
                        minor: 'border-red-500/10 bg-red-500/[0.02]',
                      }
                      return (
                        <div key={p.name} className={`rounded-lg border p-3 ${magStyles[p.driftMagnitude] || magStyles.minor}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-white text-sm">{p.name}</span>
                              <span className="text-xs text-gray-400">{p.position}  -  {p.team || '-'}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-gray-500">ADP {p.previousAdp} -&gt; {p.currentAdp}</span>
                              <span className="text-sm font-bold text-red-400 tabular-nums">-{Math.abs(p.drift)}</span>
                              <ArrowDown className="h-3.5 w-3.5 text-red-400" />
                            </div>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {p.reasons.map((r: string, i: number) => (
                              <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-red-500/10 text-red-300">{r}</span>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {boardDriftReport.managerChanges?.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" /> Manager Tendency Shifts
                    </div>
                    {boardDriftReport.managerChanges.map((mc: any) => (
                      <div key={mc.manager} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-semibold text-white text-sm">{mc.manager}</span>
                          <div className="flex items-center gap-1.5 text-xs">
                            {mc.previousArchetype && mc.previousArchetype !== mc.archetype ? (
                              <>
                                <span className="text-gray-500">{mc.previousArchetype}</span>
                                <span className="text-gray-600">-&gt;</span>
                                <span className="text-amber-300 font-semibold">{mc.archetype}</span>
                              </>
                            ) : (
                              <span className="text-amber-300">{mc.archetype}</span>
                            )}
                          </div>
                        </div>
                        {mc.changedSignals.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {mc.changedSignals.map((cs: any, i: number) => (
                              <span key={i} className={`text-[10px] px-2 py-0.5 rounded ${cs.direction === 'up' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
                                {cs.signal}: {cs.previous} -&gt; {cs.current} {cs.direction === 'up' ? 'up' : 'down'}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {boardDriftReport.nextRoundsImpact?.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">What This Means For Your Next Rounds</div>
                    {boardDriftReport.nextRoundsImpact.map((nri: any) => (
                      <div key={nri.round} className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-white">Round {nri.round}</span>
                          <span className="text-[10px] text-gray-500">{nri.summary}</span>
                        </div>

                        {nri.risersInWindow.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            <span className="text-[10px] text-emerald-400 font-semibold">Rising in:</span>
                            {nri.risersInWindow.map((p: any) => (
                              <span key={p.name} className="text-[10px] bg-emerald-500/10 text-emerald-300 px-1.5 py-0.5 rounded">
                                {p.name} <span className="text-emerald-400">+{Math.abs(p.drift)}</span>
                              </span>
                            ))}
                          </div>
                        )}

                        {nri.fallersInWindow.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            <span className="text-[10px] text-red-400 font-semibold">Falling in:</span>
                            {nri.fallersInWindow.map((p: any) => (
                              <span key={p.name} className="text-[10px] bg-red-500/10 text-red-300 px-1.5 py-0.5 rounded">
                                {p.name} <span className="text-red-400">-{Math.abs(p.drift)}</span>
                              </span>
                            ))}
                          </div>
                        )}

                        {nri.newEntrants.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            <span className="text-[10px] text-sky-400 font-semibold">New to window:</span>
                            {nri.newEntrants.map((p: any) => (
                              <span key={p.name} className="text-[10px] bg-sky-500/10 text-sky-300 px-1.5 py-0.5 rounded">
                                {p.name} ({p.position}, ADP {p.adp})
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={assistantOpen} onOpenChange={setAssistantOpen}>
        <DialogContent className="max-w-2xl bg-black/95 border-yellow-900/40">
          <DialogHeader>
            <DialogTitle className="text-yellow-300 flex items-center gap-2">
              <Zap className="h-5 w-5" /> Draft-Day Assistant - Pick #{assistantData?.focusPick || '?'}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto space-y-5 pr-1">
            {!assistantData ? (
              <p className="text-sm text-gray-500 text-center py-4">No data available</p>
            ) : (
              <>
                <div className="space-y-3">
                  <div className="text-xs font-semibold text-yellow-400 uppercase tracking-wider">Top 3 Recommendations</div>
                  {(assistantData.top3 || []).map((pick: any) => {
                    const confColor: Record<string, string> = {
                      high: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30',
                      mid: 'text-amber-400 bg-amber-500/15 border-amber-500/30',
                      low: 'text-red-400 bg-red-500/15 border-red-500/30',
                    }
                    const tier = pick.confidence >= 40 ? 'high' : pick.confidence >= 20 ? 'mid' : 'low'
                    const posBg: Record<string, string> = { QB: 'text-red-400', RB: 'text-cyan-400', WR: 'text-green-400', TE: 'text-purple-400' }
                    const rankBg: Record<string, string> = { '1': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', '2': 'bg-gray-500/20 text-gray-300 border-gray-500/30', '3': 'bg-amber-800/20 text-amber-600 border-amber-700/30' }
                    return (
                      <div key={pick.rank} className={`rounded-xl border p-4 ${pick.rank === 1 ? 'border-yellow-500/30 bg-yellow-500/[0.03] ring-1 ring-yellow-500/10' : 'border-gray-800 bg-white/[0.02]'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border ${rankBg[String(pick.rank)] || 'bg-gray-800 text-gray-400 border-gray-700'}`}>{pick.rank}</span>
                            <div>
                              <span className="text-sm font-semibold text-white">{pick.player}</span>
                              <span className={`text-xs ml-2 ${posBg[pick.position] || 'text-gray-400'}`}>{pick.position}</span>
                            </div>
                          </div>
                          <div className={`px-2 py-1 rounded-lg border text-xs font-bold tabular-nums ${confColor[tier]}`}>
                            {pick.confidence}% conf
                          </div>
                        </div>
                        {pick.why && <p className="text-[11px] text-gray-400 mt-2">{pick.why}</p>}
                      </div>
                    )
                  })}

                  {assistantData.fallback && (
                    <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-500 font-semibold uppercase">Fallback</span>
                          <span className="text-sm text-gray-300">{assistantData.fallback.player}</span>
                          <span className="text-[10px] text-gray-500">{assistantData.fallback.position}</span>
                        </div>
                        <span className="text-[10px] text-gray-500 tabular-nums">{assistantData.fallback.probability}%</span>
                      </div>
                    </div>
                  )}
                </div>

                {assistantData.waitAdvice && (
                  <div className={`rounded-xl border p-4 ${assistantData.waitAdvice.canWait ? 'border-emerald-500/30 bg-emerald-500/[0.03]' : 'border-red-500/30 bg-red-500/[0.03]'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-sm font-bold ${assistantData.waitAdvice.canWait ? 'text-emerald-400' : 'text-red-400'}`}>
                        {assistantData.waitAdvice.canWait ? 'SAFE TO WAIT' : 'TAKE NOW'}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${assistantData.waitAdvice.canWait ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>
                        {assistantData.waitAdvice.availabilityAt4}% availability at +4
                      </span>
                    </div>
                    <p className="text-xs text-gray-400">{assistantData.waitAdvice.reason}</p>
                  </div>
                )}

                {assistantData.queue?.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Your Queue - Next 6 Targets</div>
                    <div className="grid grid-cols-2 gap-2">
                      {assistantData.queue.map((q: any, i: number) => {
                        const posBg: Record<string, string> = { QB: 'bg-red-500/10 text-red-400 border-red-500/20', RB: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20', WR: 'bg-green-500/10 text-green-400 border-green-500/20', TE: 'bg-purple-500/10 text-purple-400 border-purple-500/20' }
                        return (
                          <div key={i} className="rounded-lg border border-gray-800 bg-white/[0.02] p-3 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-gray-500">{i + 1}.</span>
                              <span className="text-sm text-white">{q.player}</span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded border ${posBg[q.position] || 'bg-gray-800 text-gray-400 border-gray-700'}`}>{q.position}</span>
                            </div>
                            <div className="text-right">
                              <div className="text-[10px] text-gray-400 tabular-nums">{q.probability}%</div>
                              <div className="text-[9px] text-gray-600">Pick {q.pickOverall}</div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {assistantData.volatility && (
                  <VolatilityBadge v={assistantData.volatility} />
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={scenarioLabOpen} onOpenChange={setScenarioLabOpen}>
        <DialogContent className="max-w-6xl bg-black/95 border-violet-900/40">
          <DialogHeader>
            <DialogTitle className="text-violet-300 flex items-center gap-2">
              <Beaker className="h-5 w-5" /> Scenario Lab - Side-by-Side Comparison
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {scenarioLabels.map(l => (
              <span key={l} className="text-[10px] px-2 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/20">{l}</span>
            ))}
          </div>
          <div className="max-h-[65vh] overflow-y-auto space-y-4 pr-1">
            {scenarioBaseline.slice(0, 24).map((base, idx) => {
              const scen = scenarioResults[idx]
              if (!scen) return null
              const baseTop = base.topTargets[0]
              const scenTop = scen.topTargets[0]
              const changed = baseTop?.player !== scenTop?.player
              const probDelta = (scenTop?.probability || 0) - (baseTop?.probability || 0)
              const borderStyle: Record<string, string> = {
                yes: 'border-violet-500/30 bg-violet-500/[0.03]',
                no: 'border-gray-800 bg-white/[0.01]',
              }
              return (
                <div key={idx} className={`rounded-xl border p-4 ${borderStyle[changed ? 'yes' : 'no']}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-400">Pick {base.overall}</span>
                      <span className="text-xs text-gray-500">R{base.round}P{base.pick}</span>
                      <span className="text-xs text-gray-500">{base.manager}</span>
                    </div>
                    {changed && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-violet-500/15 text-violet-300 font-semibold">SHIFTED</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider mb-2">Baseline</div>
                      {base.topTargets.slice(0, 3).map((t, i) => {
                        const posBg: Record<string, string> = { QB: 'text-red-400', RB: 'text-cyan-400', WR: 'text-green-400', TE: 'text-purple-400' }
                        return (
                          <div key={i} className="flex items-center justify-between py-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-gray-500 w-4">{i + 1}.</span>
                              <span className="text-sm text-white">{t.player}</span>
                              <span className={`text-[10px] ${posBg[t.position] || 'text-gray-400'}`}>{t.position}</span>
                            </div>
                            <span className="text-xs text-gray-400 tabular-nums">{t.probability}%</span>
                          </div>
                        )
                      })}
                    </div>
                    <div>
                      <div className="text-[10px] text-violet-400 font-semibold uppercase tracking-wider mb-2">Scenario</div>
                      {scen.topTargets.slice(0, 3).map((t, i) => {
                        const baseMatch = base.topTargets.find(b => b.player === t.player)
                        const delta = baseMatch ? t.probability - baseMatch.probability : t.probability
                        const posBg: Record<string, string> = { QB: 'text-red-400', RB: 'text-cyan-400', WR: 'text-green-400', TE: 'text-purple-400' }
                        const deltaColor: Record<string, string> = { up: 'text-emerald-400', down: 'text-red-400', same: 'text-gray-500' }
                        const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'same'
                        return (
                          <div key={i} className="flex items-center justify-between py-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-gray-500 w-4">{i + 1}.</span>
                              <span className={`text-sm ${!baseMatch ? 'text-violet-300 font-semibold' : 'text-white'}`}>{t.player}</span>
                              <span className={`text-[10px] ${posBg[t.position] || 'text-gray-400'}`}>{t.position}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-gray-400 tabular-nums">{t.probability}%</span>
                              {delta !== 0 && (
                                <span className={`text-[10px] font-bold tabular-nums ${deltaColor[dir]}`}>
                                  {delta > 0 ? '+' : ''}{delta}
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={comparisonOpen} onOpenChange={setComparisonOpen}>
        <DialogContent className="bg-black/90 border-purple-900/50 text-white max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-2xl text-center">Pick Comparison</DialogTitle>
          </DialogHeader>
          <div className="grid md:grid-cols-2 gap-8 mt-6">
            <div className="text-center">
              <h3 className="text-xl font-bold text-green-400 mb-4">Selected</h3>
              <img
                src={comparePlayer?.drafted?.imageUrl || '/default-headshot.png'}
                alt={comparePlayer?.drafted?.playerName}
                className="w-32 h-32 rounded-full mx-auto mb-4 border-2 border-green-500/30 object-cover"
                onError={(e) => { (e.target as HTMLImageElement).src = '/default-headshot.png' }}
              />
              <p className="text-lg font-semibold">{comparePlayer?.drafted?.playerName}</p>
              <p className="text-sm text-gray-400">{comparePlayer?.drafted?.position} &middot; {comparePlayer?.drafted?.team}</p>
              <p className="text-sm mt-2">ADP: {(() => {
                const adp = adpMap.get(normalizeName(comparePlayer?.drafted?.playerName || ''))
                return adp ? adp.adp.toFixed(1) : 'N/A'
              })()}</p>
              <p className="text-xs text-gray-500 mt-1">Pick #{comparePlayer?.drafted?.overall}</p>
            </div>

            <div className="text-center">
              <h3 className="text-xl font-bold text-yellow-400 mb-4">Best Available</h3>
              {comparePlayer?.bap ? (
                <>
                  <img
                    src={comparePlayer.bap.imageUrl || '/default-headshot.png'}
                    alt={comparePlayer.bap.name}
                    className="w-32 h-32 rounded-full mx-auto mb-4 border-2 border-yellow-500/30 object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).src = '/default-headshot.png' }}
                  />
                  <p className="text-lg font-semibold">{comparePlayer.bap.name}</p>
                  <p className="text-sm text-gray-400">{comparePlayer.bap.position} &middot; {comparePlayer.bap.team || 'FA'}</p>
                  <p className="text-sm mt-2">ADP: {comparePlayer.bap.adp?.toFixed(1) || 'N/A'}</p>
                </>
              ) : (
                <p className="text-sm text-gray-500 mt-8">No ADP data available</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={retroOpen} onOpenChange={setRetroOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto bg-gray-950 border-amber-800/50">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl text-amber-300">
              <Check className="h-5 w-5" /> Post-Draft Retrospective - AI vs Reality
            </DialogTitle>
          </DialogHeader>

          {retroData ? (
            <div className="space-y-6">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-black/40 rounded-xl p-4 border border-amber-900/40 text-center">
                  <p className="text-3xl font-bold text-amber-300">{retroData.overallAccuracy}%</p>
                  <p className="text-xs text-gray-400 mt-1">Exact Hit Rate</p>
                </div>
                <div className="bg-black/40 rounded-xl p-4 border border-cyan-900/40 text-center">
                  <p className="text-3xl font-bold text-cyan-300">{retroData.top3HitRate}%</p>
                  <p className="text-xs text-gray-400 mt-1">Top-3 Hit Rate</p>
                </div>
                <div className="bg-black/40 rounded-xl p-4 border border-gray-800 text-center">
                  <p className="text-3xl font-bold text-white">{retroData.totalPicks}</p>
                  <p className="text-xs text-gray-400 mt-1">Total Picks Analyzed</p>
                </div>
              </div>

              {retroCalibration && (
                <div className="bg-black/40 rounded-xl p-4 border border-violet-900/40">
                  <h3 className="text-sm font-semibold text-violet-300 mb-3">League Calibration Weights (Auto-Learned)</h3>
                  <div className="grid grid-cols-5 gap-2">
                    {[
                      { label: 'ADP', value: retroCalibration.adp, color: 'text-blue-300' },
                      { label: 'Need', value: retroCalibration.need, color: 'text-green-300' },
                      { label: 'Tendency', value: retroCalibration.tendency, color: 'text-orange-300' },
                      { label: 'News', value: retroCalibration.news, color: 'text-pink-300' },
                      { label: 'Rookie', value: retroCalibration.rookie, color: 'text-yellow-300' },
                    ].map(w => (
                      <div key={w.label} className="text-center">
                        <p className={`text-lg font-bold ${w.color}`}>{(w.value || 1).toFixed(2)}x</p>
                        <p className="text-xs text-gray-500">{w.label}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-2 text-center">
                    Based on {retroCalibration.sampleSize || 0} draft picks - future predictions will use these weights
                  </p>
                </div>
              )}

              <div>
                <h3 className="text-sm font-semibold text-cyan-300 mb-3">Manager Prediction Accuracy</h3>
                <div className="space-y-2">
                  {(retroData.managerAccuracy || []).map((m: any) => {
                    const hitColor: Record<string, string> = {
                      high: 'bg-green-500',
                      medium: 'bg-yellow-500',
                      low: 'bg-red-500',
                    }
                    const tier = m.exactHitRate >= 40 ? 'high' : m.exactHitRate >= 20 ? 'medium' : 'low'
                    return (
                      <div key={m.manager} className="bg-black/30 rounded-lg p-3 border border-gray-800">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-white">{m.manager}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-gray-400">{m.exactHits}/{m.totalPicks} exact</span>
                            <span className="text-xs text-cyan-400">{m.top3Hits}/{m.totalPicks} top-3</span>
                          </div>
                        </div>
                        <div className="w-full bg-gray-800 rounded-full h-2">
                          <div
                            className={`${hitColor[tier]} h-2 rounded-full transition-all`}
                            style={{ width: `${Math.min(100, m.top3HitRate)}%` }}
                          />
                        </div>
                        <div className="flex justify-between mt-1">
                          <span className="text-xs text-gray-500">Exact: {m.exactHitRate}%</span>
                          <span className="text-xs text-gray-500">Top-3: {m.top3HitRate}%</span>
                        </div>
                        {m.bestPrediction && (
                          <p className="text-xs text-green-400 mt-1">
                            Best: Pick #{m.bestPrediction.overall} - {m.bestPrediction.player} ({m.bestPrediction.probability}% confidence)
                          </p>
                        )}
                        {m.worstMiss && (
                          <p className="text-xs text-red-400 mt-1">
                            Worst: Pick #{m.worstMiss.overall} - predicted {m.worstMiss.predicted} ({m.worstMiss.predictedProb}%), actual: {m.worstMiss.actual}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {(retroData.biggestMisses || []).length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-red-300 mb-3">Biggest Misses & Why</h3>
                  <div className="space-y-2">
                    {(retroData.biggestMisses || []).map((miss: any, idx: number) => (
                      <div key={idx} className="bg-black/30 rounded-lg p-3 border border-red-900/30">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-white">
                            Pick #{miss.overall} ({miss.manager})
                          </span>
                          <Badge variant="outline" className="text-xs border-red-800 text-red-300">
                            {miss.predictedProb}% miss
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs mb-2">
                          <span className="text-red-400">Predicted: {miss.predicted} ({miss.predictedPosition})</span>
                          <span className="text-gray-500">&rarr;</span>
                          <span className="text-green-400">Actual: {miss.actual} ({miss.actualPosition})</span>
                        </div>
                        <p className="text-xs text-yellow-300">{miss.reason}</p>
                        <p className="text-xs text-gray-500 mt-1">{miss.scorecardInsight}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <p>No retrospective data available yet.</p>
              <p className="text-xs mt-2">Run Predict Board first, then import the real draft to compare.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
