'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react'
import { LandingToolVisitTracker } from '@/components/landing/LandingToolVisitTracker'
import EngagementEventTracker from '@/components/engagement/EngagementEventTracker'
import { DEFAULT_SPORT, normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import { isTournamentHubRow, type LeagueRecordPolicyInput } from '@/lib/dashboard/league-card-fetch-policy'

type LeagueFormat = 'redraft' | 'dynasty' | 'keeper'
type PhaseKey = 'roster' | 'enriching' | 'news' | 'opponents' | 'ai' | 'done'
type WinWindowClass = 'CONTENDER' | 'FRINGE_CONTENDER' | 'REBUILDER' | 'TRANSITION'

interface UserLeague {
  id: string
  platformLeagueId: string | null
  name: string
  platform: string
  sport: SupportedSport
  format: LeagueFormat
  scoring: string
  teamCount: number
  season: string
  avatarUrl: string | null
  synced: boolean
}

interface WinWindow {
  classification: WinWindowClass
  confidence: number
  rationale: string
  timeframe: string
}

interface RosterGrade {
  overall: string
  byPosition: Record<string, { grade: string; depth: string; note: string }>
  strengths: string[]
  weaknesses: string[]
}

interface TradeTarget {
  playerName: string
  position: string
  currentOwner: string
  askPrice: string
  urgency: 'high' | 'medium' | 'low'
  why: string
}

interface SellCandidate {
  playerName: string
  sellReason: string
  targetManagers: string[]
  valueWindow: string
}

interface StashTarget {
  type: 'handcuff' | 'breakout_candidate' | 'injured_starter'
  playerDescription: string
  reason: string
}

interface WeeklyAction {
  timeframe: string
  focus: string
  actions: string[]
  watchList: string[]
}

interface OpponentIntel {
  managerName: string
  threat: 'high' | 'medium' | 'low'
  theirStrategy: string
  howToExploit: string
  tradeOpportunity: string
}

interface SeasonPlan {
  winWindow: WinWindow
  rosterGrade: RosterGrade
  seasonGoal: { primary: string; secondary?: string; keyMilestone: string }
  tradeStrategy: {
    priority: string
    immediateTargets: TradeTarget[]
    sellCandidates: SellCandidate[]
    holdList: string[]
    tradeDeadlineAdvice: string
  }
  waiverStrategy: {
    streamingPositions: string[]
    stashTargets: StashTarget[]
    faabPhilosophy: string
    faabAdvice: string
  }
  scheduleAnalysis: { playoffWeeks: string; peakWeeks: string; riskWeeks: string; advice: string }
  weeklyActionPlan: WeeklyAction[]
  opponentIntelligence: OpponentIntel[]
  draftPickStrategy: { currentCapital: string; recommendation: string; advice: string }
  confidenceScore: number
  topInsight: string
  generatedAt: string
}

interface StrategyMeta {
  username: string
  leagueId: string
  leagueName: string
  sport: SupportedSport
  isDynasty: boolean
  isSuperFlex: boolean
  totalTeams: number
  rosterValue: number
  avgAge: number | null
  playerCount: number
  currentRecord: string
  pointsFor: number
  playoffWeeks: string
  scheduleSnapshot: string[]
  contextCompleteness: 'FULL' | 'PARTIAL' | string
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
  espn: { emoji: '🔴', label: 'ESPN', color: '#f97316' },
  fantrax: { emoji: '📊', label: 'Fantrax', color: '#34d399' },
  mfl: { emoji: '🏆', label: 'MFL', color: '#fbbf24' },
}

const PHASES: Array<{ key: PhaseKey; label: string; icon: string }> = [
  { key: 'roster', label: 'Loading roster data...', icon: '📋' },
  { key: 'enriching', label: 'Pricing all players...', icon: '💰' },
  { key: 'news', label: 'Fetching live player news...', icon: '📡' },
  { key: 'opponents', label: 'Scouting opponent rosters...', icon: '🔍' },
  { key: 'ai', label: 'AI building season blueprint...', icon: '🧠' },
  { key: 'done', label: 'Strategy ready', icon: '✅' },
]

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

function inferLeagueFormat(raw: Record<string, unknown>): LeagueFormat {
  const format = stringFromUnknown(raw.format)?.toLowerCase()
  const variant = stringFromUnknown(raw.league_variant)?.toLowerCase()
  if (format === 'redraft' || format === 'dynasty' || format === 'keeper') return format
  if (raw.isDynasty === true) return 'dynasty'
  if (variant?.includes('keeper')) return 'keeper'
  return 'redraft'
}

function normalizeLeagueFromList(rawLeague: unknown): UserLeague | null {
  const raw = recordFromUnknown(rawLeague)
  if (!raw) return null

  const id = stringFromUnknown(raw.id)
  const name = stringFromUnknown(raw.name)
  if (!id || !name) return null

  /*
   * ⚠ A tournament hub is not a league this tool can answer for. Its `id` is a
   * `LegacyTournament` key, so every league-scoped call downstream resolves to nothing — and it
   * cannot be spotted by `hasUnifiedRecord`, which these rows set TRUE. Dropped from the picker
   * rather than listed as a dead entry; tournaments live at `/tournament/[id]`.
   */
  if (isTournamentHubRow(raw as LeagueRecordPolicyInput)) return null

  const platform = (stringFromUnknown(raw.platform) ?? 'sleeper').toLowerCase()
  const platformLeagueId =
    stringFromUnknown(raw.platformLeagueId) ??
    stringFromUnknown(raw.sleeperLeagueId) ??
    (platform === 'sleeper' ? id : null)

  return {
    id,
    platformLeagueId,
    name,
    platform,
    sport: normalizeToSupportedSport(stringFromUnknown(raw.sport_type) ?? stringFromUnknown(raw.sport) ?? DEFAULT_SPORT),
    format: inferLeagueFormat(raw),
    scoring: stringFromUnknown(raw.scoring) ?? stringFromUnknown(raw.scoringType) ?? 'standard',
    teamCount: numberFromUnknown(raw.leagueSize) ?? numberFromUnknown(raw.totalTeams) ?? 0,
    season: String(numberFromUnknown(raw.season) ?? stringFromUnknown(raw.season) ?? new Date().getFullYear()),
    avatarUrl: stringFromUnknown(raw.avatarUrl) ?? stringFromUnknown(raw.avatar),
    synced: raw.hasUnifiedRecord !== false,
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
    platformLeagueId: sleeperLeagueId,
    name,
    platform: 'sleeper',
    sport: normalizeToSupportedSport(stringFromUnknown(raw.sport) ?? DEFAULT_SPORT),
    format: raw.isDynasty === true ? 'dynasty' : 'redraft',
    scoring: stringFromUnknown(raw.scoringType) ?? 'standard',
    teamCount: numberFromUnknown(raw.totalTeams) ?? 0,
    season: stringFromUnknown(raw.season) ?? String(new Date().getFullYear()),
    avatarUrl: stringFromUnknown(raw.avatar),
    synced: raw.alreadySynced === true,
  }
}

function LoadingCard() {
  return <div className="h-28 animate-pulse rounded-2xl border border-white/8 bg-[#0c0c1e]" />
}

function LoginRequiredState() {
  return (
    <div className="min-h-screen bg-[#07071a] text-white">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <div className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-8 text-center">
          <div className="text-xs font-bold uppercase tracking-[0.3em] text-violet-300">Season Strategy</div>
          <h1 className="mt-4 text-3xl font-black">Sign in to build your season blueprint</h1>
          <p className="mt-3 text-sm leading-6 text-white/55">
            Load a Sleeper league, attach your username, and generate a full AI GM roadmap for the season.
          </p>
          <Link
            href="/login?callbackUrl=%2Fseason-strategy"
            className="mt-6 inline-flex rounded-2xl border border-violet-500/30 bg-violet-500/10 px-5 py-3 text-sm font-bold text-violet-200 hover:bg-violet-500/20"
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
          <span className="inline-flex rounded-full border border-violet-500/20 bg-violet-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.24em] text-violet-300">
            Season Strategy
          </span>
          <h1 className="mt-3 text-3xl font-black">Select a Sleeper League</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/45">
            This planner analyzes your specific roster and your full league. Start by picking a Sleeper league, then confirm the username you want the AI to plan around.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
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
            <div className="text-5xl">🧠</div>
            <h2 className="mt-4 text-2xl font-black text-white">No Sleeper leagues found yet</h2>
            <p className="mt-3 text-sm leading-6 text-white/50">
              Season Strategy currently needs a Sleeper league so it can inspect your exact roster, the rest of the league, and current standings.
            </p>
            <Link
              href="/af-legacy"
              className="mt-6 inline-flex rounded-2xl border border-violet-500/30 bg-violet-500/10 px-5 py-3 text-sm font-bold text-violet-200 hover:bg-violet-500/20"
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
                  key={`${league.platform}-${league.id}`}
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
                    <span>{league.synced ? 'Unified record ready' : 'Fallback Sleeper record'}</span>
                    <span className="text-violet-300">Open planner</span>
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

function PhaseAnimation({ phase }: { phase: PhaseKey }) {
  const phaseIndex = PHASES.findIndex((item) => item.key === phase)

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
      <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-8 text-center">
        <div className="mb-8 flex justify-center gap-1.5">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="h-2 w-2 rounded-full bg-cyan-500 animate-bounce"
              style={{ animationDelay: `${index * 150}ms` }}
            />
          ))}
        </div>
        <div className="mx-auto max-w-xs space-y-2">
          {PHASES.map((item, index) => {
            const isDone = index < phaseIndex
            const isActive = index === phaseIndex

            return (
              <div
                key={item.key}
                className={`flex items-center gap-3 rounded-xl px-4 py-2.5 transition-all ${
                  isActive
                    ? 'border border-cyan-500/20 bg-cyan-500/10'
                    : isDone
                      ? 'opacity-40'
                      : 'opacity-20'
                }`}
              >
                <span>{item.icon}</span>
                <span className="flex-1 text-left text-sm text-white/80">{item.label}</span>
                {isDone ? <span className="text-xs text-green-400">✓</span> : null}
                {isActive ? <div className="h-3 w-3 rounded-full border border-cyan-500 border-t-transparent animate-spin" /> : null}
              </div>
            )
          })}
        </div>
        <p className="mt-6 text-[11px] text-white/30">
          This takes 20-30 seconds. The planner is pricing every roster, checking league context, and building one cohesive blueprint.
        </p>
      </div>
    </div>
  )
}

function Section({
  id,
  title,
  icon,
  expanded,
  onToggle,
  children,
}: {
  id: string
  title: string
  icon: string
  expanded: Set<string>
  onToggle: (id: string) => void
  children: React.ReactNode
}) {
  const isOpen = expanded.has(id)

  return (
    <div className="overflow-hidden rounded-2xl border border-white/8 bg-[#0c0c1e]">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="flex w-full items-center justify-between px-5 py-4 transition-colors hover:bg-white/[0.03]"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">{icon}</span>
          <span className="text-sm font-black text-white">{title}</span>
        </div>
        {isOpen ? <ChevronUp className="h-4 w-4 text-white/35" /> : <ChevronDown className="h-4 w-4 text-white/35" />}
      </button>
      {isOpen ? <div className="border-t border-white/6 px-5 pb-5 pt-4">{children}</div> : null}
    </div>
  )
}

function winWindowBadgeClass(value: WinWindowClass) {
  switch (value) {
    case 'CONTENDER':
      return 'bg-green-500/20 border-green-500/30 text-green-300'
    case 'FRINGE_CONTENDER':
      return 'bg-amber-500/20 border-amber-500/30 text-amber-300'
    case 'REBUILDER':
      return 'bg-blue-500/20 border-blue-500/30 text-blue-300'
    default:
      return 'bg-white/10 border-white/20 text-white/70'
  }
}

function urgencyClass(value: string) {
  switch (value) {
    case 'high':
      return 'bg-red-500/15 border-red-500/30 text-red-200'
    case 'medium':
      return 'bg-amber-500/15 border-amber-500/30 text-amber-200'
    default:
      return 'bg-sky-500/15 border-sky-500/30 text-sky-200'
  }
}

function threatClass(value: OpponentIntel['threat']) {
  switch (value) {
    case 'high':
      return 'bg-red-500/15 border-red-500/30 text-red-200'
    case 'medium':
      return 'bg-amber-500/15 border-amber-500/30 text-amber-200'
    default:
      return 'bg-white/10 border-white/15 text-white/65'
  }
}

function formatRecommendation(value: string) {
  return value.replace(/_/g, ' ')
}

export default function SeasonStrategyPage() {
  const { data: session, status } = useSession()
  const [leagues, setLeagues] = useState<UserLeague[]>([])
  const [leagueLoading, setLeagueLoading] = useState(false)
  const [leagueError, setLeagueError] = useState<string | null>(null)
  const [league, setLeague] = useState<UserLeague | null>(null)
  const [username, setUsername] = useState('')
  const [week, setWeek] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [phase, setPhase] = useState<PhaseKey>('roster')
  const [plan, setPlan] = useState<SeasonPlan | null>(null)
  const [meta, setMeta] = useState<StrategyMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['winWindow']))

  const phaseTimersRef = useRef<number[]>([])
  const resultsRef = useRef<HTMLDivElement | null>(null)

  const activeSport = league?.sport ?? DEFAULT_SPORT

  const clearPhaseTimers = useCallback(() => {
    phaseTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    phaseTimersRef.current = []
  }, [])

  useEffect(() => clearPhaseTimers, [clearPhaseTimers])

  useEffect(() => {
    if (session?.user?.name && username.trim().length === 0) {
      setUsername(session.user.name)
    }
  }, [session, username])

  useEffect(() => {
    if (status !== 'authenticated') return
    let cancelled = false

    async function loadLeagues() {
      setLeagueLoading(true)
      setLeagueError(null)
      try {
        const listResponse = await fetch('/api/league/list')
        if (listResponse.ok) {
          const payload = (await listResponse.json().catch(() => ({}))) as { leagues?: unknown[] }
          const mapped = (payload.leagues ?? [])
            .map((entry) => normalizeLeagueFromList(entry))
            .filter((entry): entry is UserLeague => entry != null)
            .filter((entry) => entry.platform === 'sleeper')
          if (!cancelled) {
            setLeagues(mapped)
          }
          return
        }

        const sleeperResponse = await fetch('/api/league/sleeper-user-leagues')
        if (!sleeperResponse.ok) {
          const payload = (await sleeperResponse.json().catch(() => ({}))) as { error?: string }
          throw new Error(payload.error ?? 'Could not load leagues.')
        }

        const payload = (await sleeperResponse.json().catch(() => ({}))) as { leagues?: unknown[] }
        const mapped = (payload.leagues ?? [])
          .map((entry) => normalizeLeagueFromSleeperFallback(entry))
          .filter((entry): entry is UserLeague => entry != null)
        if (!cancelled) {
          setLeagues(mapped)
        }
      } catch (loadError: unknown) {
        if (!cancelled) {
          setLeagueError(loadError instanceof Error ? loadError.message : 'Could not load leagues.')
        }
      } finally {
        if (!cancelled) {
          setLeagueLoading(false)
        }
      }
    }

    void loadLeagues()
    return () => {
      cancelled = true
    }
  }, [status])

  useEffect(() => {
    if (plan && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [plan])

  const generate = useCallback(async () => {
    if (!league || !username.trim() || loading) return

    clearPhaseTimers()
    setLoading(true)
    setError(null)
    setPlan(null)
    setMeta(null)
    setExpanded(new Set(['winWindow']))
    setPhase('roster')

    phaseTimersRef.current = [
      window.setTimeout(() => setPhase('enriching'), 1500),
      window.setTimeout(() => setPhase('news'), 4000),
      window.setTimeout(() => setPhase('opponents'), 7000),
      window.setTimeout(() => setPhase('ai'), 10000),
    ]

    try {
      const response = await fetch('/api/season-strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          leagueId: league.platformLeagueId ?? league.id,
          sport: league.sport.toLowerCase(),
          week,
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as {
        success?: boolean
        error?: string
        retryAfterSec?: number
        plan?: SeasonPlan
        meta?: StrategyMeta
      }

      if (!response.ok || !payload.plan || !payload.meta) {
        const baseMessage = payload.error ?? `Request failed with ${response.status}`
        const rateLimitMessage =
          typeof payload.retryAfterSec === 'number' ? `${baseMessage} Try again in ${payload.retryAfterSec}s.` : baseMessage
        throw new Error(rateLimitMessage)
      }

      setPhase('done')
      setPlan(payload.plan)
      setMeta(payload.meta)
    } catch (generateError: unknown) {
      setError(generateError instanceof Error ? generateError.message : 'Strategy failed. Try again.')
    } finally {
      clearPhaseTimers()
      setLoading(false)
    }
  }, [clearPhaseTimers, league, loading, username, week])

  const toggleSection = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const positionGrades = useMemo(
    () => (plan ? Object.entries(plan.rosterGrade.byPosition) : []),
    [plan],
  )

  if (status === 'loading') {
    return <div className="min-h-screen bg-[#07071a]" />
  }

  if (status === 'unauthenticated') {
    return <LoginRequiredState />
  }

  return (
    <>
      <LandingToolVisitTracker path="/season-strategy" toolName="Season Strategy Planner" />
      <EngagementEventTracker
        eventType="ai_used"
        oncePerDayKey={`tool_season_strategy:${activeSport}`}
        meta={{ product: 'legacy', sport: activeSport }}
      />

      {!league ? (
        <LeagueGate leagues={leagues} loading={leagueLoading} error={leagueError} onSelect={setLeague} />
      ) : (
        <div className="min-h-screen bg-[#07071a] text-white">
          <div className="sticky top-0 z-20 border-b border-white/6 bg-[#07071a]/90 backdrop-blur-xl">
            <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.24em] text-violet-300">
                      Season Strategy
                    </span>
                  </div>
                  <h1 className="mt-2 text-2xl font-black">Season Strategy Planner</h1>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                  <div className="text-xs font-bold text-white">{league.name}</div>
                  <div className="text-[11px] text-white/40">
                    {SPORT_LABELS[league.sport]} · {league.format} · {league.scoring}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">Season</div>
                  <div className="text-sm font-bold text-white">{league.season}</div>
                </div>

                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void generate()}
                    disabled={loading || !username.trim()}
                    className="rounded-xl px-3 py-2 text-xs font-bold text-black transition-all disabled:cursor-not-allowed disabled:opacity-35"
                    style={{
                      background: 'linear-gradient(135deg, #7c3aed, #0891b2)',
                      boxShadow: '0 10px 28px rgba(124,58,237,0.24)',
                    }}
                  >
                    Regenerate
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLeague(null)
                      setPlan(null)
                      setMeta(null)
                      setError(null)
                    }}
                    className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/45 hover:border-white/20 hover:text-white"
                  >
                    Change League
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
            <div className="mb-6 rounded-3xl border border-white/8 bg-[radial-gradient(circle_at_top,rgba(124,58,237,0.18),transparent_45%),#0a0d1a] p-6">
              <div className="max-w-3xl">
                <div className="text-xs font-bold uppercase tracking-[0.3em] text-violet-300/80">Full-League Blueprint</div>
                <h2 className="mt-3 text-3xl font-black leading-tight">
                  One AI GM pass across your roster, the rest of the league, trade context, picks, and current momentum.
                </h2>
                <p className="mt-3 text-sm leading-6 text-white/55">
                  The planner classifies your win window, spots trade paths, flags roster pressure points, and maps the most important actions for the rest of the season.
                </p>
              </div>
            </div>

            <div className="max-w-2xl mx-auto px-0 py-0 space-y-5">
              <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-5">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-white/40">Sleeper Username</p>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Enter your Sleeper username"
                  className="w-full rounded-2xl border border-white/10 bg-[#07071a] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-violet-500/30 focus:outline-none"
                />
                <p className="mt-2 text-[11px] text-white/35">
                  The planner uses this to identify your exact roster inside the selected league.
                </p>
              </div>

              <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-5">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-white/40">Current Week (optional)</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setWeek(undefined)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-bold ${!week ? 'bg-cyan-500 text-black' : 'bg-white/[0.06] text-white/50 hover:bg-white/[0.10]'}`}
                  >
                    Pre-Season
                  </button>
                  {Array.from({ length: 18 }, (_, index) => index + 1).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setWeek(value)}
                      className={`rounded-xl px-3 py-1.5 text-xs font-bold ${week === value ? 'bg-cyan-500 text-black' : 'bg-white/[0.06] text-white/50 hover:bg-white/[0.10]'}`}
                    >
                      Wk {value}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => void generate()}
                disabled={!username.trim() || loading || !league}
                className="w-full rounded-2xl py-4 text-base font-black transition-all disabled:opacity-30"
                style={{
                  background: 'linear-gradient(135deg, #7c3aed, #0891b2)',
                  boxShadow: '0 8px 32px rgba(124,58,237,0.35)',
                }}
              >
                🧠 Generate Season Strategy
              </button>

              {error ? <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</div> : null}
            </div>

            {loading ? <PhaseAnimation phase={phase} /> : null}

            {plan && meta ? (
              <div ref={resultsRef} className="max-w-4xl mx-auto px-0 py-5 space-y-4">
                <div className="overflow-hidden rounded-3xl border border-white/8 bg-[#0c0c1e]">
                  <div className="h-0.5 w-full bg-gradient-to-r from-violet-500 via-cyan-500 to-violet-500" />
                  <div className="p-6">
                    <div className="flex items-start gap-4">
                      <div className={`shrink-0 rounded-2xl border px-4 py-3 text-center ${winWindowBadgeClass(plan.winWindow.classification)}`}>
                        <div className="text-xs font-black uppercase tracking-wide">
                          {plan.winWindow.classification.replace(/_/g, ' ')}
                        </div>
                        <div className="mt-1 text-2xl font-black">{plan.rosterGrade.overall}</div>
                        <div className="mt-0.5 text-[10px] opacity-60">Overall Grade</div>
                      </div>

                      <div className="flex-1">
                        <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-violet-400">🧠 Key Insight</div>
                        <p className="mb-2 text-lg font-bold leading-snug text-white">{plan.topInsight}</p>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-white/40">
                          <span>🎯 {plan.seasonGoal.primary}</span>
                          <span>·</span>
                          <span>⏱ {plan.winWindow.timeframe}</span>
                          <span>·</span>
                          <span>Confidence: {plan.confidenceScore}/100</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="sticky top-[84px] z-10 rounded-2xl border border-white/8 bg-[#0c0c1e]/95 p-4 backdrop-blur-xl">
                  <div className="flex flex-wrap items-center gap-3 text-xs text-white/45">
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-white">{meta.leagueName}</span>
                    <span>{meta.currentRecord}</span>
                    <span>Roster value: {meta.rosterValue.toLocaleString()}</span>
                    <span>Avg age: {meta.avgAge != null ? meta.avgAge.toFixed(1) : 'N/A'}</span>
                    <span>{meta.playerCount} priced players</span>
                    <span>{meta.totalTeams} teams</span>
                    <span>{meta.contextCompleteness} context</span>
                  </div>
                </div>

                <Section id="winWindow" title="Win Window + Roster Grades" icon="🏆" expanded={expanded} onToggle={toggleSection}>
                  <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Win Window</div>
                        <div className="mt-2 text-base font-bold text-white">
                          {plan.winWindow.classification.replace(/_/g, ' ')} · {plan.winWindow.confidence}/100
                        </div>
                        <p className="mt-2 text-sm leading-6 text-white/65">{plan.winWindow.rationale}</p>
                      </div>

                      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Strengths</div>
                        <div className="mt-3 space-y-2">
                          {plan.rosterGrade.strengths.length > 0 ? (
                            plan.rosterGrade.strengths.map((item) => (
                              <div key={item} className="flex gap-2 text-sm text-white/70">
                                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-green-400" />
                                <span>{item}</span>
                              </div>
                            ))
                          ) : (
                            <div className="text-sm text-white/40">No clear strengths were returned.</div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Weaknesses</div>
                        <div className="mt-3 space-y-2">
                          {plan.rosterGrade.weaknesses.length > 0 ? (
                            plan.rosterGrade.weaknesses.map((item) => (
                              <div key={item} className="flex gap-2 text-sm text-white/70">
                                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-red-400" />
                                <span>{item}</span>
                              </div>
                            ))
                          ) : (
                            <div className="text-sm text-white/40">No major weaknesses were returned.</div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {positionGrades.length > 0 ? (
                        positionGrades.map(([position, details]) => (
                          <div key={position} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-black text-white">{position}</div>
                              <div className="flex items-center gap-2">
                                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/45">
                                  {details.depth}
                                </span>
                                <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
                                  {details.grade}
                                </span>
                              </div>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-white/60">{details.note}</p>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm text-white/45">
                          Position grades were not returned for this run.
                        </div>
                      )}
                    </div>
                  </div>
                </Section>

                <Section id="seasonGoal" title="Season Goal" icon="🎯" expanded={expanded} onToggle={toggleSection}>
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-violet-500/20 bg-violet-500/10 p-5">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-violet-200/70">Primary Goal</div>
                      <div className="mt-2 text-2xl font-black text-white">{plan.seasonGoal.primary}</div>
                      {plan.seasonGoal.secondary ? (
                        <p className="mt-2 text-sm text-white/65">Secondary goal: {plan.seasonGoal.secondary}</p>
                      ) : null}
                    </div>

                    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-5">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Key Milestone</div>
                      <p className="mt-3 text-sm leading-6 text-white/70">{plan.seasonGoal.keyMilestone}</p>
                    </div>
                  </div>
                </Section>

                <Section id="tradeStrategy" title="Trade Strategy" icon="⚔️" expanded={expanded} onToggle={toggleSection}>
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-3 py-1 text-[11px] font-bold uppercase ${urgencyClass(plan.tradeStrategy.priority.toLowerCase())}`}>
                        {formatRecommendation(plan.tradeStrategy.priority)}
                      </span>
                      <span className="text-xs text-white/40">Trade deadline advice is included below.</span>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      {plan.tradeStrategy.immediateTargets.length > 0 ? (
                        plan.tradeStrategy.immediateTargets.map((target) => (
                          <div key={`${target.playerName}-${target.currentOwner}`} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-black text-white">{target.playerName}</div>
                                <div className="mt-1 text-[11px] text-white/40">
                                  {target.position} · {target.currentOwner}
                                </div>
                              </div>
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${urgencyClass(target.urgency)}`}>
                                {target.urgency}
                              </span>
                            </div>
                            <div className="mt-3 rounded-xl border border-white/6 bg-[#07071a] p-3 text-xs text-white/60">
                              Offer idea: {target.askPrice}
                            </div>
                            <p className="mt-3 text-sm leading-6 text-white/65">{target.why}</p>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm text-white/45 md:col-span-2">
                          No immediate trade targets were returned for this roster.
                        </div>
                      )}
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      {plan.tradeStrategy.sellCandidates.length > 0 ? (
                        plan.tradeStrategy.sellCandidates.map((candidate) => (
                          <div key={candidate.playerName} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-black text-white">{candidate.playerName}</div>
                              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-200">
                                {candidate.valueWindow}
                              </span>
                            </div>
                            <p className="mt-3 text-sm leading-6 text-white/65">{candidate.sellReason}</p>
                            {candidate.targetManagers.length > 0 ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {candidate.targetManagers.map((manager) => (
                                  <span key={manager} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/55">
                                    {manager}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm text-white/45 md:col-span-2">
                          No sell candidates were returned for this run.
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Hold List</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {plan.tradeStrategy.holdList.length > 0 ? (
                          plan.tradeStrategy.holdList.map((player) => (
                            <span key={player} className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] text-cyan-200">
                              {player}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-white/40">No hold list returned.</span>
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Trade Deadline Advice</div>
                      <p className="mt-3 text-sm leading-6 text-white/65">{plan.tradeStrategy.tradeDeadlineAdvice}</p>
                    </div>

                    <div className="rounded-2xl border border-violet-500/20 bg-violet-500/10 p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-violet-100/70">Draft Pick Strategy</div>
                      <div className="mt-2 text-sm font-bold text-white">{formatRecommendation(plan.draftPickStrategy.recommendation)}</div>
                      <p className="mt-2 text-sm leading-6 text-white/70">{plan.draftPickStrategy.currentCapital}</p>
                      <p className="mt-2 text-sm leading-6 text-white/70">{plan.draftPickStrategy.advice}</p>
                    </div>
                  </div>
                </Section>

                <Section id="waiverStrategy" title="Waiver + FAAB Strategy" icon="💧" expanded={expanded} onToggle={toggleSection}>
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Streaming Positions</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {plan.waiverStrategy.streamingPositions.length > 0 ? (
                          plan.waiverStrategy.streamingPositions.map((position) => (
                            <span key={position} className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] text-cyan-200">
                              {position}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-white/40">No streaming positions were returned.</span>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      {plan.waiverStrategy.stashTargets.length > 0 ? (
                        plan.waiverStrategy.stashTargets.map((target) => (
                          <div key={`${target.type}-${target.playerDescription}`} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                            <div className="flex items-center gap-2">
                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-bold uppercase text-white/55">
                                {target.type.replace(/_/g, ' ')}
                              </span>
                              <span className="text-sm font-bold text-white">{target.playerDescription}</span>
                            </div>
                            <p className="mt-3 text-sm leading-6 text-white/65">{target.reason}</p>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm text-white/45 md:col-span-2">
                          No stash targets were returned for this run.
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-200">
                          {plan.waiverStrategy.faabPhilosophy}
                        </span>
                        <span className="text-sm font-bold text-white">FAAB Philosophy</span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-white/70">{plan.waiverStrategy.faabAdvice}</p>
                    </div>
                  </div>
                </Section>

                <Section id="scheduleAnalysis" title="Schedule Analysis" icon="📅" expanded={expanded} onToggle={toggleSection}>
                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Playoff Weeks</div>
                        <p className="mt-2 text-sm leading-6 text-white/65">{plan.scheduleAnalysis.playoffWeeks}</p>
                      </div>
                      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Peak Weeks</div>
                        <p className="mt-2 text-sm leading-6 text-white/65">{plan.scheduleAnalysis.peakWeeks}</p>
                      </div>
                      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Risk Weeks</div>
                        <p className="mt-2 text-sm leading-6 text-white/65">{plan.scheduleAnalysis.riskWeeks}</p>
                      </div>
                    </div>

                    {meta.scheduleSnapshot.length > 0 ? (
                      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Upcoming Snapshot</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {meta.scheduleSnapshot.map((item) => (
                            <span key={item} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/60">
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100/70">Planner Advice</div>
                      <p className="mt-3 text-sm leading-6 text-white/70">{plan.scheduleAnalysis.advice}</p>
                    </div>
                  </div>
                </Section>

                <Section id="weeklyActionPlan" title="Weekly Action Plan" icon="📋" expanded={expanded} onToggle={toggleSection}>
                  <div className="space-y-3">
                    {plan.weeklyActionPlan.length > 0 ? (
                      plan.weeklyActionPlan.map((action) => (
                        <div key={action.timeframe} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-black text-white">{action.timeframe}</div>
                              <div className="mt-1 text-[11px] uppercase tracking-[0.24em] text-violet-300/80">{action.focus}</div>
                            </div>
                            <Sparkles className="h-4 w-4 text-cyan-300" />
                          </div>

                          <div className="mt-4 space-y-2">
                            {action.actions.map((item) => (
                              <div key={item} className="flex gap-2 text-sm text-white/70">
                                <span className="mt-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-300">
                                  ✓
                                </span>
                                <span>{item}</span>
                              </div>
                            ))}
                          </div>

                          {action.watchList.length > 0 ? (
                            <div className="mt-4 flex flex-wrap gap-2">
                              {action.watchList.map((item) => (
                                <span key={item} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/55">
                                  {item}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm text-white/45">
                        No weekly action phases were returned.
                      </div>
                    )}
                  </div>
                </Section>

                <Section id="opponentIntelligence" title="Opponent Intelligence" icon="🕵️" expanded={expanded} onToggle={toggleSection}>
                  <div className="grid gap-3 md:grid-cols-2">
                    {plan.opponentIntelligence.length > 0 ? (
                      plan.opponentIntelligence.map((manager) => (
                        <div key={manager.managerName} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-black text-white">{manager.managerName}</div>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${threatClass(manager.threat)}`}>
                              {manager.threat}
                            </span>
                          </div>
                          <div className="mt-3 space-y-3 text-sm leading-6 text-white/65">
                            <div>
                              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">Their Strategy</div>
                              <p className="mt-1">{manager.theirStrategy}</p>
                            </div>
                            <div>
                              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">How To Exploit</div>
                              <p className="mt-1">{manager.howToExploit}</p>
                            </div>
                            <div>
                              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">Trade Opportunity</div>
                              <p className="mt-1">{manager.tradeOpportunity}</p>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm text-white/45 md:col-span-2">
                        Opponent intelligence was not returned for this run.
                      </div>
                    )}
                  </div>
                </Section>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  )
}
