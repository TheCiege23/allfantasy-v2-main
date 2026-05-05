'use client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { LandingToolVisitTracker } from '@/components/landing/LandingToolVisitTracker'
import EngagementEventTracker from '@/components/engagement/EngagementEventTracker'
import { DEFAULT_SPORT, SUPPORTED_SPORTS, normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import { isWeatherSensitiveSport } from '@/lib/weather/outdoorSportMetadata'
import { ProjectionDisplay } from '@/components/weather/ProjectionDisplay'
import { placeholderBaselineProjection } from '@/components/weather/placeholderBaseline'

type WaiverType = 'FAAB' | 'ROLLING' | 'PRIORITY'
type LeagueFormat = 'redraft' | 'dynasty' | 'keeper'
type InjuryStatus = string | null
type PhaseKey = 'plan' | 'pricing' | 'engine' | 'ai' | 'check'

type LegacyPlayerIndex = Record<string, { name: string; position: string; team: string | null }>

interface UserLeague {
  id: string
  rosterLeagueId: string | null
  name: string
  platform: string
  sport: SupportedSport
  format: LeagueFormat
  scoring: string
  teamCount: number
  season: string
  waiverType: WaiverType
  totalFaab: number
  averageFaabRemaining: number
  myFaab: number
  myWaiverPriority: number | null
  week: number
  avatarUrl: string | null
  synced: boolean
  fallbackRosterData: unknown | null
}

interface RosterPlayer {
  id: string
  name: string
  position: string
  team: string
  projectedPts: number | null
  injuryStatus: InjuryStatus
  isStarter: boolean
}

interface WirePlayer {
  id: string
  name: string
  position: string
  team: string
  ownership: number | null
  projectedPts: number | null
  aiScore: number
  reason: string
  faabLow: number | null
  faabHigh: number | null
}

interface ClaimQueueItem {
  pickup: WirePlayer
  dropId: string | null
}

interface WaiverTopAdd {
  player_name: string
  position: string
  team: string | null
  priority_rank: number
  faab_bid_recommendation: number | null
  drop_candidate: string | null
  reasoning: string
  player_id?: string
  tier?: string
  ai?: {
    confidence?: 'high' | 'medium' | 'low'
    narrative?: string[]
    tags?: string[]
  }
  confidence_pct?: number
  expected_value_add?: number
  trend_signal?: string
}

interface WaiverAnalysisResult {
  summary: string
  team_id: string
  league_id: string
  waiver_type: WaiverType
  top_adds: WaiverTopAdd[]
  strategy_notes: {
    faab_strategy: string | null
    priority_strategy: string | null
    timing_notes: string
  }
  bench_optimization_tips: string[]
  risk_flags: string[]
  providers?: {
    deepseek?: string
    grok?: string
    openai?: string
  }
  pecrIterations?: number
}

const SPORT_LABELS: Record<SupportedSport, string> = {
  NFL: 'NFL',
  NHL: 'NHL',
  NBA: 'NBA',
  MLB: 'MLB',
  NCAAF: 'NCAA Football',
  NCAAB: 'NCAA Basketball',
  SOCCER: 'Soccer',
}

const PLATFORM_LABELS: Record<string, { emoji: string; label: string; color: string }> = {
  sleeper: { emoji: '🌙', label: 'Sleeper', color: '#818cf8' },
  yahoo: { emoji: '🟣', label: 'Yahoo', color: '#7c3aed' },
  mfl: { emoji: '🏆', label: 'MFL', color: '#fbbf24' },
  fantrax: { emoji: '📊', label: 'Fantrax', color: '#34d399' },
  espn: { emoji: '🔴', label: 'ESPN', color: '#f97316' },
}

const FILTER_POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'FLEX'] as const
const PHASES: Array<{ key: PhaseKey; label: string; icon: string }> = [
  { key: 'plan', label: 'Planning', icon: '📋' },
  { key: 'pricing', label: 'Pricing', icon: '💰' },
  { key: 'engine', label: 'Engine', icon: '⚙️' },
  { key: 'ai', label: 'AI', icon: '🧠' },
  { key: 'check', label: 'Check', icon: '✅' },
]

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringFromUnknown(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function numberFromUnknown(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(numeric) ? numeric : null
}

function arrayFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function inferLeagueFormat(raw: Record<string, unknown>): LeagueFormat {
  const format = stringFromUnknown(raw.format)?.toLowerCase()
  const variant = stringFromUnknown(raw.league_variant)?.toLowerCase()
  if (format === 'redraft' || format === 'dynasty' || format === 'keeper') return format
  if (raw.isDynasty === true) return 'dynasty'
  if (variant?.includes('keeper')) return 'keeper'
  return 'redraft'
}

function inferWaiverType(faabRemaining: number | null, waiverPriority: number | null): WaiverType {
  if (faabRemaining != null) return 'FAAB'
  if (waiverPriority != null) return 'PRIORITY'
  return 'ROLLING'
}

function currentFantasyWeekFallback() {
  return Math.max(1, Math.min(18, Math.ceil((Date.now() - new Date(new Date().getFullYear(), 7, 25).getTime()) / (1000 * 60 * 60 * 24 * 7))))
}

function aiScoreColor(score: number) {
  if (score >= 8) return '#10b981'
  if (score >= 5) return '#fbbf24'
  return '#ef4444'
}

function positionBadgeClass(position: string) {
  switch (position.toUpperCase()) {
    case 'QB':
      return 'border-red-500/30 bg-red-500/15 text-red-200'
    case 'RB':
      return 'border-green-500/30 bg-green-500/15 text-green-200'
    case 'WR':
      return 'border-blue-500/30 bg-blue-500/15 text-blue-200'
    case 'TE':
      return 'border-orange-500/30 bg-orange-500/15 text-orange-200'
    case 'K':
      return 'border-gray-500/30 bg-gray-500/15 text-gray-200'
    case 'DEF':
    case 'DST':
      return 'border-purple-500/30 bg-purple-500/15 text-purple-200'
    default:
      return 'border-white/10 bg-white/[0.04] text-white/70'
  }
}

function injuryBadgeClass(status: string) {
  switch (status.toUpperCase()) {
    case 'OUT':
      return 'bg-red-500 text-white'
    case 'Q':
      return 'bg-yellow-400 text-black'
    case 'D':
      return 'bg-orange-500 text-white'
    case 'IR':
      return 'bg-gray-600 text-white'
    default:
      return 'bg-white/10 text-white/70'
  }
}

function shouldTreatAsFlex(position: string) {
  return ['RB', 'WR', 'TE'].includes(position.toUpperCase())
}

function deriveRosterWeakness(players: RosterPlayer[]) {
  const counts = new Map<string, number>()
  for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) counts.set(position, 0)
  for (const player of players) {
    const normalized = player.position.toUpperCase()
    if (counts.has(normalized)) counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }

  let lowest = 'WR'
  let lowestCount = Number.POSITIVE_INFINITY
  for (const [position, count] of counts.entries()) {
    if (count < lowestCount) {
      lowest = position
      lowestCount = count
    }
  }

  return lowest
}

function normalizeWireSuggestion(rawSuggestion: unknown): WirePlayer | null {
  const raw = recordFromUnknown(rawSuggestion)
  if (!raw) return null

  const name = stringFromUnknown(raw.playerName) ?? stringFromUnknown(raw.name)
  if (!name) return null

  const priority = Math.max(1, Math.min(10, Math.round(numberFromUnknown(raw.priority) ?? 5)))

  return {
    id: stringFromUnknown(raw.playerId) ?? stringFromUnknown(raw.id) ?? name,
    name,
    position: stringFromUnknown(raw.position) ?? 'WR',
    team: stringFromUnknown(raw.team) ?? '',
    ownership: null,
    projectedPts: null,
    aiScore: priority,
    reason: stringFromUnknown(raw.reason) ?? 'AI shortlisted this player as a relevant waiver target for your current roster.',
    faabLow: null,
    faabHigh: null,
  }
}

function normalizeRosterEntry(entry: unknown, playerIndex: LegacyPlayerIndex): RosterPlayer | null {
  if (typeof entry === 'string') {
    const lookup = playerIndex[entry]
    return {
      id: entry,
      name: lookup?.name ?? entry,
      position: lookup?.position ?? 'BN',
      team: lookup?.team ?? '',
      projectedPts: null,
      injuryStatus: null,
      isStarter: false,
    }
  }

  const raw = recordFromUnknown(entry)
  if (!raw) return null

  const rawId =
    stringFromUnknown(raw.id) ??
    stringFromUnknown(raw.playerId) ??
    stringFromUnknown(raw.player_id) ??
    stringFromUnknown(raw.sleeperId) ??
    stringFromUnknown(raw.sleeper_id)

  const lookup = rawId ? playerIndex[rawId] : undefined
  const name =
    stringFromUnknown(raw.name) ??
    stringFromUnknown(raw.player_name) ??
    stringFromUnknown(raw.full_name) ??
    lookup?.name ??
    rawId
  if (!name) return null

  return {
    id: rawId ?? name,
    name,
    position: stringFromUnknown(raw.position) ?? stringFromUnknown(raw.pos) ?? lookup?.position ?? 'BN',
    team: stringFromUnknown(raw.team) ?? stringFromUnknown(raw.teamAbbr) ?? stringFromUnknown(raw.nflTeam) ?? lookup?.team ?? '',
    projectedPts:
      numberFromUnknown(raw.projectedPts) ??
      numberFromUnknown(raw.projected) ??
      numberFromUnknown(raw.projected_points) ??
      null,
    injuryStatus:
      stringFromUnknown(raw.injuryStatus) ??
      stringFromUnknown(raw.injury_status) ??
      stringFromUnknown(raw.status),
    isStarter: false,
  }
}

function normalizeRosterFromPlayerData(playerData: unknown, playerIndex: LegacyPlayerIndex): RosterPlayer[] {
  const raw = recordFromUnknown(playerData)
  if (!raw) return []

  const lineupSections = recordFromUnknown(raw.lineup_sections)
  if (lineupSections) {
    const starters = arrayFromUnknown(lineupSections.starters)
      .map((entry) => {
        const normalized = normalizeRosterEntry(entry, playerIndex)
        return normalized ? { ...normalized, isStarter: true } : null
      })
      .filter((entry): entry is RosterPlayer => entry != null)

    const bench = arrayFromUnknown(lineupSections.bench)
      .map((entry) => normalizeRosterEntry(entry, playerIndex))
      .filter((entry): entry is RosterPlayer => entry != null)

    const ir = arrayFromUnknown(lineupSections.ir)
      .map((entry) => normalizeRosterEntry(entry, playerIndex))
      .filter((entry): entry is RosterPlayer => entry != null)

    const taxi = arrayFromUnknown(lineupSections.taxi)
      .map((entry) => normalizeRosterEntry(entry, playerIndex))
      .filter((entry): entry is RosterPlayer => entry != null)

    return [...starters, ...bench, ...ir, ...taxi]
  }

  const starterIds = new Set(arrayFromUnknown(raw.starters).map((entry) => stringFromUnknown(typeof entry === 'string' ? entry : recordFromUnknown(entry)?.id)).filter((entry): entry is string => Boolean(entry)))
  const reserveIds = new Set(arrayFromUnknown(raw.reserve).map((entry) => stringFromUnknown(typeof entry === 'string' ? entry : recordFromUnknown(entry)?.id)).filter((entry): entry is string => Boolean(entry)))
  const taxiIds = new Set(arrayFromUnknown(raw.taxi).map((entry) => stringFromUnknown(typeof entry === 'string' ? entry : recordFromUnknown(entry)?.id)).filter((entry): entry is string => Boolean(entry)))

  const rawById = new Map<string, unknown>()
  const orderedIds: string[] = []

  for (const bucket of [raw.players, raw.starters, raw.reserve, raw.taxi]) {
    for (const entry of arrayFromUnknown(bucket)) {
      const normalized = normalizeRosterEntry(entry, playerIndex)
      if (!normalized) continue
      if (!rawById.has(normalized.id)) orderedIds.push(normalized.id)
      rawById.set(normalized.id, entry)
    }
  }

  const roster: RosterPlayer[] = []
  for (const id of orderedIds) {
    const normalized = normalizeRosterEntry(rawById.get(id) ?? id, playerIndex)
    if (!normalized) continue
    roster.push({
      ...normalized,
      isStarter: starterIds.has(id),
      injuryStatus: reserveIds.has(id) ? 'IR' : normalized.injuryStatus,
    })
  }

  for (const id of taxiIds) {
    if (roster.some((player) => player.id === id)) continue
    const normalized = normalizeRosterEntry(id, playerIndex)
    if (!normalized) continue
    roster.push(normalized)
  }

  return roster
}

function normalizeLeagueFromList(rawLeague: unknown, userId: string | undefined): UserLeague | null {
  const raw = recordFromUnknown(rawLeague)
  if (!raw) return null

  const rosters = arrayFromUnknown(raw.rosters)
  const ownRoster =
    rosters.find((entry) => {
      const roster = recordFromUnknown(entry)
      return userId != null && roster?.platformUserId === userId
    }) ?? rosters[0]

  const ownRosterRecord = recordFromUnknown(ownRoster)
  const ownFaab = numberFromUnknown(ownRosterRecord?.faabRemaining)
  const ownWaiverPriority = numberFromUnknown(ownRosterRecord?.waiverPriority)
  const averageFaabRemaining =
    rosters.length > 0
      ? Math.round(
          rosters
            .map((entry) => numberFromUnknown(recordFromUnknown(entry)?.faabRemaining) ?? 0)
            .reduce((total, value) => total + value, 0) / Math.max(1, rosters.length)
        )
      : 60

  const id = stringFromUnknown(raw.id)
  const name = stringFromUnknown(raw.name)
  if (!id || !name) return null

  const rosterLeagueId =
    stringFromUnknown(raw.navigationLeagueId) ??
    stringFromUnknown(raw.unifiedLeagueId) ??
    (raw.hasUnifiedRecord === false ? null : id)

  return {
    id,
    rosterLeagueId,
    name,
    platform: stringFromUnknown(raw.platform) ?? 'sleeper',
    sport: normalizeToSupportedSport(stringFromUnknown(raw.sport_type) ?? stringFromUnknown(raw.sport) ?? DEFAULT_SPORT),
    format: inferLeagueFormat(raw),
    scoring: stringFromUnknown(raw.scoring) ?? stringFromUnknown(raw.scoringType) ?? 'standard',
    teamCount: numberFromUnknown(raw.leagueSize) ?? numberFromUnknown(raw.totalTeams) ?? 0,
    season: String(numberFromUnknown(raw.season) ?? stringFromUnknown(raw.season) ?? new Date().getFullYear()),
    waiverType: inferWaiverType(ownFaab, ownWaiverPriority),
    totalFaab: 100,
    averageFaabRemaining,
    myFaab: ownFaab ?? 0,
    myWaiverPriority: ownWaiverPriority,
    week: currentFantasyWeekFallback(),
    avatarUrl: stringFromUnknown(raw.avatarUrl) ?? stringFromUnknown(raw.avatar),
    synced: raw.hasUnifiedRecord !== false,
    fallbackRosterData:
      ownRosterRecord?.playerData ??
      (ownRosterRecord
        ? {
            players: ownRosterRecord.players,
            starters: ownRosterRecord.starters,
            reserve: ownRosterRecord.bench,
          }
        : null),
  }
}

function normalizeLeagueFromSleeperFallback(rawLeague: unknown): UserLeague | null {
  const raw = recordFromUnknown(rawLeague)
  if (!raw) return null

  const sleeperLeagueId = stringFromUnknown(raw.sleeperLeagueId)
  const name = stringFromUnknown(raw.name)
  if (!sleeperLeagueId || !name) return null

  return {
    id: sleeperLeagueId,
    rosterLeagueId: null,
    name,
    platform: 'sleeper',
    sport: DEFAULT_SPORT,
    format: raw.isDynasty === true ? 'dynasty' : 'redraft',
    scoring: stringFromUnknown(raw.scoringType) ?? 'standard',
    teamCount: numberFromUnknown(raw.totalTeams) ?? 0,
    season: stringFromUnknown(raw.season) ?? String(new Date().getFullYear()),
    waiverType: 'FAAB',
    totalFaab: 100,
    averageFaabRemaining: 60,
    myFaab: 0,
    myWaiverPriority: null,
    week: currentFantasyWeekFallback(),
    avatarUrl: stringFromUnknown(raw.avatar),
    synced: raw.alreadySynced === true,
    fallbackRosterData: null,
  }
}

function PosBadge({ position }: { position: string }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${positionBadgeClass(position)}`}>{position || 'BN'}</span>
}

function InjuryBadge({ status }: { status: InjuryStatus }) {
  if (!status) return null
  return <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${injuryBadgeClass(status)}`}>{status}</span>
}

function ScoreRing({ score }: { score: number }) {
  const color = aiScoreColor(score)
  const pct = Math.max(0, Math.min(100, (score / 10) * 100))
  const radius = 14
  const circumference = 2 * Math.PI * radius
  return (
    <div className="relative flex h-10 w-10 items-center justify-center shrink-0">
      <svg className="absolute inset-0 -rotate-90" width="40" height="40">
        <circle cx="20" cy="20" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
          strokeLinecap="round"
        />
      </svg>
      <span className="text-[11px] font-black" style={{ color }}>
        {score.toFixed(1)}
      </span>
    </div>
  )
}

function LoadingCard() {
  return <div className="h-28 animate-pulse rounded-2xl border border-white/8 bg-[#0c0c1e]" />
}

function PhaseAnimation({ phase }: { phase: PhaseKey }) {
  const activeIndex = PHASES.findIndex((item) => item.key === phase)
  return (
    <div className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-6">
      <div className="mb-6 flex items-center justify-center gap-1.5">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-2.5 w-2.5 rounded-full bg-green-400"
            style={{ animation: 'pulse 1s ease-in-out infinite', animationDelay: `${index * 0.2}s` }}
          />
        ))}
      </div>
      <div className="space-y-3">
        {PHASES.map((item, index) => (
          <div
            key={item.key}
            className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${
              index === activeIndex
                ? 'border-green-500/30 bg-green-500/10'
                : index < activeIndex
                  ? 'border-white/10 bg-white/[0.04] opacity-60'
                  : 'border-white/8 bg-white/[0.02] opacity-30'
            }`}
          >
            <span className="text-lg">{item.icon}</span>
            <span className="flex-1 text-sm text-white/80">{item.label}</span>
            {index < activeIndex ? <span className="text-xs text-green-300">Done</span> : null}
            {index === activeIndex ? <div className="h-3 w-3 rounded-full border border-green-400 border-t-transparent animate-spin" /> : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function LoginRequiredState() {
  return (
    <div className="min-h-screen bg-[#07071a] text-white">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <div className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-8 text-center">
          <div className="text-xs font-bold uppercase tracking-[0.3em] text-green-300">Waiver AI</div>
          <h1 className="mt-4 text-3xl font-black">Sign in to analyze your leagues</h1>
          <p className="mt-3 text-sm leading-6 text-white/55">
            League selection, roster loading, and waiver analysis require an authenticated account.
          </p>
          <Link
            href="/login?callbackUrl=%2Fwaiver-ai"
            className="mt-6 inline-flex rounded-2xl border border-green-500/30 bg-green-500/10 px-5 py-3 text-sm font-bold text-green-200 hover:bg-green-500/20"
          >
            Go to Login
          </Link>
        </div>
      </div>
    </div>
  )
}

function LeagueGate({
  leagues,
  loading,
  error,
  onSelect,
}: {
  leagues: UserLeague[]
  loading: boolean
  error: string | null
  onSelect: (league: UserLeague) => void
}) {
  return (
    <div className="min-h-screen bg-[#07071a] text-white">
      <div className="border-b border-white/6 bg-[#07071a]/90 backdrop-blur-xl">
        <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-green-500/20 bg-green-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.24em] text-green-300">
              Waiver AI
            </span>
          </div>
          <h1 className="mt-2 text-3xl font-black">Select a League</h1>
          <p className="mt-2 text-sm text-white/45">
            Choose a synced league first. The app will load your roster, build a waiver short list, and then analyze your queued claims.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 pb-24 pt-10 sm:px-6 lg:pb-10">
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[1, 2, 3, 4].map((item) => (
              <LoadingCard key={item} />
            ))}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
        ) : null}

        {!loading && !error && leagues.length === 0 ? (
          <div className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-8 text-center">
            <div className="text-5xl">🏈</div>
            <h2 className="mt-4 text-2xl font-black text-white">No leagues connected yet</h2>
            <p className="mt-3 text-sm leading-6 text-white/50">
              Import a league first so Waiver AI can read your roster and league settings.
            </p>
            <Link
              href="/af-legacy"
              className="mt-6 inline-flex rounded-2xl border border-green-500/30 bg-green-500/10 px-5 py-3 text-sm font-bold text-green-200 hover:bg-green-500/20"
            >
              Import a League
            </Link>
          </div>
        ) : null}

        {!loading && leagues.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {leagues.map((league) => {
              const platform = PLATFORM_LABELS[league.platform] ?? PLATFORM_LABELS.sleeper
              return (
                <button
                  key={league.id}
                  type="button"
                  onClick={() => onSelect(league)}
                  className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-5 text-left transition-all hover:border-white/15 hover:bg-white/[0.03]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{platform.emoji}</span>
                      <span className="text-xs font-bold uppercase tracking-[0.24em]" style={{ color: platform.color }}>
                        {platform.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/50">
                        {SPORT_LABELS[league.sport]}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/50">
                        {league.format}
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 text-lg font-bold text-white">{league.name}</div>
                  <div className="mt-2 text-sm text-white/45">
                    {league.teamCount} teams · {league.scoring} · Season {league.season}
                  </div>
                  <div className="mt-4 flex items-center justify-between text-xs text-white/40">
                    <span>
                      {league.waiverType === 'FAAB'
                        ? `$${league.myFaab} FAAB remaining`
                        : league.myWaiverPriority != null
                          ? `Priority ${league.myWaiverPriority}`
                          : 'Rolling waivers'}
                    </span>
                    <span className={league.synced ? 'text-green-300' : 'text-amber-300'}>
                      {league.synced ? 'Ready' : 'Needs sync'}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function RosterPanel({
  players,
  myFaab,
  waiverType,
  onFaabChange,
}: {
  players: RosterPlayer[]
  myFaab: number
  waiverType: WaiverType
  onFaabChange: (value: number) => void
}) {
  const starters = players.filter((player) => player.isStarter)
  const bench = players.filter((player) => !player.isStarter)

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-white/8 bg-[#0c0c1e]">
      <div className="border-b border-white/6 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">My Roster</div>
        {waiverType === 'FAAB' ? (
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2">
            <span className="text-xs text-white/45">FAAB Remaining</span>
            <input
              type="number"
              min={0}
              value={myFaab}
              onChange={(event) => onFaabChange(Math.max(0, Number(event.target.value) || 0))}
              className="w-20 bg-transparent text-sm font-bold text-green-300 focus:outline-none"
            />
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {starters.length > 0 ? <div className="px-2 pb-2 text-[10px] font-bold uppercase tracking-[0.24em] text-white/30">Starters</div> : null}
        <div className="space-y-2">
          {starters.map((player) => (
            <div key={player.id} className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3">
              <PosBadge position={player.position} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">{player.name}</div>
                <div className="text-[11px] text-white/35">{player.team || 'Team N/A'}</div>
              </div>
              <InjuryBadge status={player.injuryStatus} />
            </div>
          ))}
        </div>

        {bench.length > 0 ? <div className="px-2 pb-2 pt-5 text-[10px] font-bold uppercase tracking-[0.24em] text-white/30">Bench</div> : null}
        <div className="space-y-2">
          {bench.map((player) => (
            <div key={player.id} className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3">
              <PosBadge position={player.position} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">{player.name}</div>
                <div className="text-[11px] text-white/35">{player.team || 'Team N/A'}</div>
              </div>
              <InjuryBadge status={player.injuryStatus} />
            </div>
          ))}
        </div>

        {players.length === 0 ? <div className="py-10 text-center text-sm text-white/30">No roster data loaded for this league.</div> : null}
      </div>
    </div>
  )
}

function WirePanel({
  players,
  loading,
  error,
  filter,
  queue,
  onFilter,
  onQueue,
  onRefresh,
  sport,
}: {
  players: WirePlayer[]
  loading: boolean
  error: string | null
  filter: string
  queue: ClaimQueueItem[]
  onFilter: (value: string) => void
  onQueue: (player: WirePlayer) => void
  onRefresh: () => void
  sport: SupportedSport
}) {
  const filteredPlayers =
    filter === 'ALL'
      ? players
      : players.filter((player) => (filter === 'FLEX' ? shouldTreatAsFlex(player.position) : player.position.toUpperCase() === filter))

  const queuedIds = new Set(queue.map((item) => item.pickup.id))
  const showCrest = isWeatherSensitiveSport(sport)
  const seasonY = new Date().getFullYear()

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1">
        {FILTER_POSITIONS.map((position) => (
          <button
            key={position}
            type="button"
            onClick={() => onFilter(position)}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
              filter === position ? 'bg-green-500 text-black' : 'bg-white/[0.05] text-white/50 hover:bg-white/[0.08] hover:text-white'
            }`}
          >
            {position}
          </button>
        ))}
        <button
          type="button"
          onClick={onRefresh}
          className="ml-auto rounded-xl border border-white/10 px-3 py-1.5 text-xs text-white/45 hover:border-white/20 hover:text-white"
        >
          ⟳ Refresh Wire
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {loading ? [1, 2, 3, 4].map((item) => <LoadingCard key={item} />) : null}

        {error ? <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</div> : null}

        {!loading && !error && filteredPlayers.length === 0 ? (
          <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-8 text-center text-sm text-white/35">
            No waiver targets available for this filter.
          </div>
        ) : null}

        {!loading &&
          filteredPlayers.map((player) => {
            const queued = queuedIds.has(player.id)
            const scoreColor = aiScoreColor(player.aiScore)
            return (
              <div key={player.id} className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-4">
                <div className="flex items-start gap-3">
                  <ScoreRing score={player.aiScore} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <PosBadge position={player.position} />
                      <div className="truncate text-sm font-bold text-white">{player.name}</div>
                      <div className="text-xs text-white/35">{player.team || 'FA'}</div>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-white/55">{player.reason}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-white/35">
                      <span className="inline-flex items-center gap-1">
                        Projection:{' '}
                        {player.projectedPts != null ? (
                          <ProjectionDisplay
                            projection={player.projectedPts}
                            suffix=""
                            showAFCrest={showCrest}
                            pointsClassName="text-[11px] text-white/35"
                            afCrestProps={
                              showCrest
                                ? {
                                    playerId: player.id,
                                    playerName: player.name,
                                    sport,
                                    position: player.position,
                                    week: 1,
                                    season: seasonY,
                                    size: 'sm',
                                  }
                                : undefined
                            }
                          />
                        ) : (
                          '--'
                        )}
                      </span>
                      <span>Ownership: {player.ownership != null ? `${player.ownership}%` : 'n/a'}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <div
                    className="rounded-full border px-2.5 py-1 text-[11px] font-bold"
                    style={{ color: scoreColor, borderColor: `${scoreColor}40`, background: `${scoreColor}15` }}
                  >
                    {player.faabLow != null && player.faabHigh != null ? `FAAB ${player.faabLow}-${player.faabHigh}` : `Priority ${player.aiScore}/10`}
                  </div>
                  <button
                    type="button"
                    disabled={queued}
                    onClick={() => onQueue(player)}
                    className={`ml-auto rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                      queued
                        ? 'border border-green-500/30 bg-green-500/10 text-green-300'
                        : 'bg-green-500 text-black hover:bg-green-400'
                    }`}
                  >
                    {queued ? '✓ Queued' : '+ Queue'}
                  </button>
                </div>
              </div>
            )
          })}
      </div>
    </div>
  )
}

function AnalysisPanel({
  queue,
  benchPlayers,
  waiverType,
  league,
  analyzing,
  phase,
  analysis,
  error,
  onAnalyze,
  onDropChange,
  onRemove,
}: {
  queue: ClaimQueueItem[]
  benchPlayers: RosterPlayer[]
  waiverType: WaiverType
  league: UserLeague
  analyzing: boolean
  phase: PhaseKey
  analysis: WaiverAnalysisResult | null
  error: string | null
  onAnalyze: () => void
  onDropChange: (pickupId: string, dropId: string) => void
  onRemove: (pickupId: string) => void
}) {
  if (analyzing) return <PhaseAnimation phase={phase} />

  return (
    <div className="overflow-hidden rounded-3xl border border-white/8 bg-[#0c0c1e]">
      <div className="border-b border-white/6 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">AI Analysis Panel</div>
        <div className="mt-2 text-xs text-white/45">
          {league.name} · {SPORT_LABELS[league.sport]} · {league.format}
        </div>
      </div>

      <div className="border-b border-white/6 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-[0.24em] text-white/35">Claim Queue</div>
          <div className="text-xs text-white/35">{queue.length} queued</div>
        </div>

        {queue.length === 0 ? <div className="text-sm text-white/30">Queue at least one player from the wire to analyze.</div> : null}

        <div className="space-y-3">
          {queue.map((item) => (
            <div key={item.pickup.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
              <div className="flex items-center gap-2">
                <PosBadge position={item.pickup.position} />
                <div className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{item.pickup.name}</div>
                <button
                  type="button"
                  onClick={() => onRemove(item.pickup.id)}
                  className="rounded-lg px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                >
                  ✕
                </button>
              </div>
              <div className="mt-3">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.2em] text-white/30">Drop Target</label>
                <select
                  value={item.dropId ?? ''}
                  onChange={(event) => onDropChange(item.pickup.id, event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#07071a] px-3 py-2 text-sm text-white focus:border-red-500/30 focus:outline-none"
                >
                  <option value="">No drop selected</option>
                  {benchPlayers.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name} ({player.position})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          disabled={queue.length === 0}
          onClick={onAnalyze}
          className="mt-4 w-full rounded-2xl px-4 py-3 text-sm font-black transition-all disabled:cursor-not-allowed disabled:opacity-35"
          style={{
            background: queue.length > 0 ? 'linear-gradient(135deg, #059669, #0891b2)' : 'rgba(255,255,255,0.05)',
            boxShadow: queue.length > 0 ? '0 10px 32px rgba(16,185,129,0.2)' : 'none',
          }}
        >
          ⚡ Analyze My Waivers
        </button>

        {waiverType !== 'FAAB' ? (
          <div className="mt-2 text-[11px] text-white/35">
            This league uses {waiverType === 'PRIORITY' ? 'waiver priority' : 'rolling waivers'}.
          </div>
        ) : null}
      </div>

      {error ? <div className="border-b border-white/6 bg-red-500/10 p-4 text-sm text-red-200">{error}</div> : null}

      <div className="max-h-[55vh] overflow-y-auto p-4">
        {!analysis ? (
          <div className="py-8 text-center">
            <div className="text-5xl">🌿</div>
            <div className="mt-4 text-lg font-bold text-white">No analysis yet</div>
            <div className="mt-2 text-sm text-white/45">Queue one or more claims to generate a waiver plan.</div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-green-300">
                  AI Summary
                </span>
                {typeof analysis.pecrIterations === 'number' && analysis.pecrIterations > 1 ? (
                  <span className="ml-auto text-[10px] uppercase tracking-[0.2em] text-white/35">{analysis.pecrIterations} iterations</span>
                ) : null}
              </div>
              <p className="mt-3 text-sm leading-6 text-white/75">{analysis.summary}</p>
            </div>

            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Top Adds</div>
              <div className="mt-4 space-y-3">
                {analysis.top_adds.map((add) => (
                  <div key={`${add.player_id ?? add.player_name}-${add.priority_rank}`} className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500/15 text-[11px] font-bold text-green-300">
                        {add.priority_rank}
                      </div>
                      <PosBadge position={add.position} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold text-white">{add.player_name}</div>
                        <div className="text-[11px] text-white/35">{add.team ?? 'FA'}</div>
                      </div>
                      {add.faab_bid_recommendation != null ? (
                        <div className="rounded-full border border-green-500/20 bg-green-500/10 px-2 py-1 text-[10px] font-bold text-green-300">
                          ${add.faab_bid_recommendation}
                        </div>
                      ) : null}
                    </div>
                    <p className="mt-3 text-xs leading-5 text-white/60">{add.reasoning}</p>
                    {add.drop_candidate ? <div className="mt-2 text-[11px] text-red-300">Drop: {add.drop_candidate}</div> : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Strategy Notes</div>
              <div className="mt-3 space-y-3 text-sm text-white/65">
                {analysis.strategy_notes.faab_strategy ? <p>{analysis.strategy_notes.faab_strategy}</p> : null}
                {analysis.strategy_notes.priority_strategy ? <p>{analysis.strategy_notes.priority_strategy}</p> : null}
                <p>{analysis.strategy_notes.timing_notes}</p>
              </div>
            </div>

            {analysis.bench_optimization_tips.length > 0 ? (
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Bench Optimization</div>
                <ul className="mt-3 space-y-2 text-sm text-white/65">
                  {analysis.bench_optimization_tips.map((tip, index) => (
                    <li key={`${tip}-${index}`} className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-cyan-400" />
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {analysis.risk_flags.length > 0 ? (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-red-200">Risk Flags</div>
                <ul className="mt-3 space-y-2 text-sm text-red-100/85">
                  {analysis.risk_flags.map((flag, index) => (
                    <li key={`${flag}-${index}`} className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-red-300" />
                      <span>{flag}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

export default function WaiverAIPage() {
  const { data: session, status } = useSession()
  const searchParams = useSearchParams()
  const leagueIdFromUrl = searchParams?.get('leagueId') ?? null
  const [leagues, setLeagues] = useState<UserLeague[]>([])
  const [leagueError, setLeagueError] = useState<string | null>(null)
  const [leagueLoading, setLeagueLoading] = useState(false)
  const [selectedLeague, setSelectedLeague] = useState<UserLeague | null>(null)

  const [playerIndex, setPlayerIndex] = useState<LegacyPlayerIndex | null>(null)
  const [roster, setRoster] = useState<RosterPlayer[]>([])
  const [wirePlayers, setWirePlayers] = useState<WirePlayer[]>([])
  const [rosterLoading, setRosterLoading] = useState(false)
  const [wireLoading, setWireLoading] = useState(false)
  const [wireError, setWireError] = useState<string | null>(null)

  const [week, setWeek] = useState(currentFantasyWeekFallback())
  const [myFaab, setMyFaab] = useState(0)
  const [waiverPriority, setWaiverPriority] = useState<number | null>(null)
  const [positionFilter, setPositionFilter] = useState<string>('ALL')
  const [queue, setQueue] = useState<ClaimQueueItem[]>([])
  const [analysis, setAnalysis] = useState<WaiverAnalysisResult | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [phase, setPhase] = useState<PhaseKey>('plan')
  const analysisRef = useRef<HTMLDivElement | null>(null)

  const activeSport = selectedLeague?.sport ?? DEFAULT_SPORT

  const ensurePlayerIndex = useCallback(async () => {
    if (playerIndex) return playerIndex
    const response = await fetch('/api/legacy/players')
    const payload = (await response.json().catch(() => ({}))) as { players?: LegacyPlayerIndex }
    const nextIndex = payload.players ?? {}
    setPlayerIndex(nextIndex)
    return nextIndex
  }, [playerIndex])

  useEffect(() => {
    if (status !== 'authenticated') return
    let cancelled = false

    async function loadLeagues() {
      setLeagueLoading(true)
      setLeagueError(null)
      try {
        const listResponse = await fetch('/api/league/list')
        if (listResponse.ok) {
          const listPayload = (await listResponse.json().catch(() => ({}))) as { leagues?: unknown[] }
          const mapped = arrayFromUnknown(listPayload.leagues).map((entry) => normalizeLeagueFromList(entry, session?.user && 'id' in session.user ? String(session.user.id ?? '') : undefined)).filter((entry): entry is UserLeague => entry != null)
          if (!cancelled) setLeagues(mapped)
          return
        }

        const sleeperResponse = await fetch('/api/league/sleeper-user-leagues')
        if (!sleeperResponse.ok) {
          const payload = (await sleeperResponse.json().catch(() => ({}))) as { error?: string }
          throw new Error(payload.error ?? 'Could not load leagues.')
        }

        const sleeperPayload = (await sleeperResponse.json().catch(() => ({}))) as { leagues?: unknown[]; error?: string }
        const mapped = arrayFromUnknown(sleeperPayload.leagues).map((entry) => normalizeLeagueFromSleeperFallback(entry)).filter((entry): entry is UserLeague => entry != null)
        if (!cancelled) setLeagues(mapped)
      } catch (error: unknown) {
        if (!cancelled) setLeagueError(error instanceof Error ? error.message : 'Could not load leagues.')
      } finally {
        if (!cancelled) setLeagueLoading(false)
      }
    }

    void loadLeagues()
    return () => {
      cancelled = true
    }
  }, [session, status])

  useEffect(() => {
    if (!leagueIdFromUrl || leagues.length === 0 || selectedLeague) return
    const hit = leagues.find(
      (l) => l.id === leagueIdFromUrl || l.rosterLeagueId === leagueIdFromUrl,
    )
    if (hit) setSelectedLeague(hit)
  }, [leagueIdFromUrl, leagues, selectedLeague])

  const refreshWire = useCallback(
    async (league: UserLeague, weakness?: string) => {
      setWireLoading(true)
      setWireError(null)
      try {
        const response = await fetch('/api/waiver-ai-suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leagueId: league.rosterLeagueId ?? league.id,
            rosterWeakness: weakness,
          }),
        })

        const payload = (await response.json().catch(() => ({}))) as { suggestions?: unknown[]; error?: string }
        if (!response.ok) {
          throw new Error(payload.error ?? 'Failed to load waiver suggestions.')
        }

        const mapped = arrayFromUnknown(payload.suggestions).map(normalizeWireSuggestion).filter((entry): entry is WirePlayer => entry != null)
        setWirePlayers(mapped)
      } catch (error: unknown) {
        setWireError(error instanceof Error ? error.message : 'Failed to load waiver suggestions.')
        setWirePlayers([])
      } finally {
        setWireLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    if (!selectedLeague) return
    const league = selectedLeague
    let cancelled = false

    async function hydrateLeague() {
      setRosterLoading(true)
      setWireLoading(true)
      setWireError(null)
      setAnalysis(null)
      setAnalysisError(null)
      setQueue([])
      setPositionFilter('ALL')
      setWeek(league.week)
      setMyFaab(league.myFaab)
      setWaiverPriority(league.myWaiverPriority)

      try {
        const nextPlayerIndex = await ensurePlayerIndex()
        let normalizedRoster: RosterPlayer[] = []
        let nextFaab = league.myFaab
        let nextWaiverPriority = league.myWaiverPriority

        if (league.rosterLeagueId) {
          const response = await fetch(`/api/league/roster?leagueId=${encodeURIComponent(league.rosterLeagueId)}`)
          const payload = (await response.json().catch(() => ({}))) as {
            roster?: unknown
            faabRemaining?: number | null
            waiverPriority?: number | null
            error?: string
          }

          if (!response.ok) {
            if (league.fallbackRosterData) {
              normalizedRoster = normalizeRosterFromPlayerData(league.fallbackRosterData, nextPlayerIndex)
            } else {
              throw new Error(payload.error ?? 'Failed to load roster.')
            }
          } else {
            normalizedRoster = normalizeRosterFromPlayerData(payload.roster, nextPlayerIndex)
            if (typeof payload.faabRemaining === 'number') nextFaab = payload.faabRemaining
            if (typeof payload.waiverPriority === 'number') nextWaiverPriority = payload.waiverPriority
          }
        } else if (league.fallbackRosterData) {
          normalizedRoster = normalizeRosterFromPlayerData(league.fallbackRosterData, nextPlayerIndex)
        }

        if (cancelled) return

        setRoster(normalizedRoster)
        setMyFaab(nextFaab)
        setWaiverPriority(nextWaiverPriority)

        const weakness = deriveRosterWeakness(normalizedRoster)
        await refreshWire(
          {
            ...league,
            myFaab: nextFaab,
            myWaiverPriority: nextWaiverPriority,
          },
          weakness
        )
      } catch (error: unknown) {
        if (!cancelled) {
          setRoster([])
          setWirePlayers([])
          setWireError(error instanceof Error ? error.message : 'Failed to load league data.')
        }
      } finally {
        if (!cancelled) {
          setRosterLoading(false)
          setWireLoading(false)
        }
      }
    }

    void hydrateLeague()
    return () => {
      cancelled = true
    }
  }, [ensurePlayerIndex, refreshWire, selectedLeague])

  const benchPlayers = useMemo(() => roster.filter((player) => !player.isStarter), [roster])

  const queuePlayer = useCallback((player: WirePlayer) => {
    setQueue((current) => {
      if (current.some((item) => item.pickup.id === player.id)) return current
      return [...current, { pickup: player, dropId: null }]
    })
  }, [])

  const removeQueuedPlayer = useCallback((pickupId: string) => {
    setQueue((current) => current.filter((item) => item.pickup.id !== pickupId))
  }, [])

  const updateDropTarget = useCallback((pickupId: string, dropId: string) => {
    setQueue((current) =>
      current.map((item) => (item.pickup.id === pickupId ? { ...item, dropId: dropId || null } : item))
    )
  }, [])

  const resetToLeagueGate = useCallback(() => {
    setSelectedLeague(null)
    setRoster([])
    setWirePlayers([])
    setWireError(null)
    setQueue([])
    setAnalysis(null)
    setAnalysisError(null)
    setPositionFilter('ALL')
  }, [])

  const analyzeWaivers = useCallback(async () => {
    if (!selectedLeague || queue.length === 0 || analyzing) return
    const league = selectedLeague

    setAnalyzing(true)
    setPhase('plan')
    setAnalysis(null)
    setAnalysisError(null)

    const timers = [
      window.setTimeout(() => setPhase('pricing'), 700),
      window.setTimeout(() => setPhase('engine'), 1800),
      window.setTimeout(() => setPhase('ai'), 3300),
      window.setTimeout(() => setPhase('check'), 5200),
    ]

    try {
      const starters = roster.filter((player) => player.isStarter)
      const bench = roster.filter((player) => !player.isStarter)

      const response = await fetch('/api/waiver-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          league: {
            league_id: league.rosterLeagueId ?? league.id,
            format: league.format,
            sport: league.sport,
            scoring_summary: league.scoring,
            waiver_type: league.waiverType,
            current_week: week,
            total_faab: league.waiverType === 'FAAB' ? league.totalFaab : undefined,
            average_faab_remaining: league.waiverType === 'FAAB' ? league.averageFaabRemaining : undefined,
          },
          team: {
            team_id:
              (session?.user && 'id' in session.user ? String(session.user.id ?? '') : '') ||
              league.rosterLeagueId ||
              league.id,
            roster: starters.map((player) => ({
              name: player.name,
              position: player.position,
              team: player.team || null,
            })),
            bench: bench.map((player) => ({
              name: player.name,
              position: player.position,
              team: player.team || null,
            })),
            faab_remaining: league.waiverType === 'FAAB' ? myFaab : undefined,
            waiver_priority: league.waiverType !== 'FAAB' ? waiverPriority ?? undefined : undefined,
          },
          waiver_pool: queue.map((item) => ({
            name: item.pickup.name,
            position: item.pickup.position,
            team: item.pickup.team || null,
            projected_points: item.pickup.projectedPts ?? undefined,
            ownership_percentage: item.pickup.ownership ?? undefined,
          })),
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as {
        success?: boolean
        error?: string
        data?: {
          summary?: string
          team_id?: string
          league_id?: string
          waiver_type?: WaiverType
          top_adds?: WaiverTopAdd[]
          strategy_notes?: {
            faab_strategy?: string | null
            priority_strategy?: string | null
            timing_notes?: string
          }
          bench_optimization_tips?: string[]
          risk_flags?: string[]
        }
        providers?: {
          deepseek?: string
          grok?: string
          openai?: string
        }
      }

      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? 'Failed to analyze waivers.')
      }

      setAnalysis({
        summary: payload.data.summary ?? 'Waiver analysis complete.',
        team_id: payload.data.team_id ?? '',
        league_id: payload.data.league_id ?? '',
        waiver_type: payload.data.waiver_type ?? league.waiverType,
        top_adds: payload.data.top_adds ?? [],
        strategy_notes: {
          faab_strategy: payload.data.strategy_notes?.faab_strategy ?? null,
          priority_strategy: payload.data.strategy_notes?.priority_strategy ?? null,
          timing_notes: payload.data.strategy_notes?.timing_notes ?? '',
        },
        bench_optimization_tips: payload.data.bench_optimization_tips ?? [],
        risk_flags: payload.data.risk_flags ?? [],
        providers: payload.providers,
        pecrIterations: undefined,
      })
    } catch (error: unknown) {
      setAnalysisError(error instanceof Error ? error.message : 'Waiver analysis failed.')
    } finally {
      timers.forEach((timer) => window.clearTimeout(timer))
      setAnalyzing(false)
    }
  }, [analyzing, myFaab, queue, roster, selectedLeague, session, waiverPriority, week])

  useEffect(() => {
    if (analysis && analysisRef.current) {
      analysisRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [analysis])

  if (status === 'loading') {
    return <div className="min-h-screen bg-[#07071a]" />
  }

  if (status === 'unauthenticated') {
    return <LoginRequiredState />
  }

  return (
    <>
      <LandingToolVisitTracker path="/waiver-ai" toolName="Waiver AI" />
      <EngagementEventTracker
        eventType="waiver_ai"
        oncePerDayKey={`tool_waiver_ai:${activeSport}`}
        meta={{ product: 'legacy', sport: activeSport }}
      />

      {!selectedLeague ? (
        <LeagueGate leagues={leagues} loading={leagueLoading} error={leagueError} onSelect={setSelectedLeague} />
      ) : (
        <div className="min-h-screen bg-[#07071a] text-white">
          <div className="sticky top-0 z-20 border-b border-white/6 bg-[#07071a]/90 backdrop-blur-xl pt-[max(0.25rem,env(safe-area-inset-top))]">
            <div className="mx-auto max-w-[1480px] px-4 py-3 sm:px-6 sm:py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-green-500/20 bg-green-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.24em] text-green-300">
                      Waiver AI
                    </span>
                  </div>
                  <h1 className="mt-2 text-2xl font-black">Waiver Hub</h1>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                  <div className="text-xs font-bold text-white">{selectedLeague.name}</div>
                  <div className="text-[11px] text-white/40">
                    {SPORT_LABELS[selectedLeague.sport]} · {selectedLeague.format} · {selectedLeague.scoring}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">Week</div>
                  <select
                    value={week}
                    onChange={(event) => setWeek(Number(event.target.value))}
                    className="bg-transparent text-sm font-bold text-white focus:outline-none"
                  >
                    {Array.from({ length: 18 }, (_, index) => index + 1).map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-stretch gap-2 sm:ml-auto sm:items-center">
                  <button
                    type="button"
                    onClick={() => void refreshWire(selectedLeague, deriveRosterWeakness(roster))}
                    className="touch-manipulation min-h-[44px] flex-1 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/45 hover:border-white/20 hover:text-white sm:min-h-0 sm:flex-none"
                  >
                    ⟳ Refresh Wire
                  </button>
                  <button
                    type="button"
                    onClick={resetToLeagueGate}
                    className="touch-manipulation min-h-[44px] flex-1 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/45 hover:border-white/20 hover:text-white sm:min-h-0 sm:flex-none"
                  >
                    Change League
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-[1480px] px-4 pb-24 pt-6 sm:px-6 lg:pb-8">
            <div className="mb-6 rounded-3xl border border-white/8 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.18),transparent_45%),#0a0d1a] p-4 sm:p-6">
              <div className="max-w-3xl">
                <div className="text-xs font-bold uppercase tracking-[0.3em] text-green-300/80">League-Gated Analysis</div>
                <h2 className="mt-3 text-2xl font-black leading-tight sm:text-3xl">Queue claims, assign drop targets, and run one focused waiver plan.</h2>
                <p className="mt-3 text-sm leading-6 text-white/55">
                  The selected league auto-loads your roster on the left and a waiver shortlist in the center. Queue targets on the right and run the main waiver AI against that selected claim set.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_minmax(0,1fr)_360px]">
              <div className="min-h-0 lg:min-h-[70vh]">
                {rosterLoading ? <LoadingCard /> : <RosterPanel players={roster} myFaab={myFaab} waiverType={selectedLeague.waiverType} onFaabChange={setMyFaab} />}
              </div>

              <div className="min-h-[70vh]">
                <WirePanel
                  players={wirePlayers}
                  loading={wireLoading}
                  error={wireError}
                  filter={positionFilter}
                  queue={queue}
                  onFilter={setPositionFilter}
                  onQueue={queuePlayer}
                  onRefresh={() => void refreshWire(selectedLeague, deriveRosterWeakness(roster))}
                  sport={selectedLeague.sport}
                />
              </div>

              <div ref={analysisRef} className="min-h-0 lg:min-h-[70vh]">
                <AnalysisPanel
                  queue={queue}
                  benchPlayers={benchPlayers}
                  waiverType={selectedLeague.waiverType}
                  league={selectedLeague}
                  analyzing={analyzing}
                  phase={phase}
                  analysis={analysis}
                  error={analysisError}
                  onAnalyze={() => void analyzeWaivers()}
                  onDropChange={updateDropTarget}
                  onRemove={removeQueuedPlayer}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
