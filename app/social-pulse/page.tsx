'use client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { LandingToolVisitTracker } from '@/components/landing/LandingToolVisitTracker'
import EngagementEventTracker from '@/components/engagement/EngagementEventTracker'
import { SOCIAL_PULSE_SIGNAL_VALUES, type SocialPulseResponse, type SocialPulseSignal } from '@/lib/social-pulse-schema'

type SocialPulseSport = 'NFL' | 'NBA'
type SocialPulseFormat = 'dynasty' | 'redraft'
type MarketEntry = NonNullable<SocialPulseResponse['market']>[number]
type MarketSignal = SocialPulseSignal

type RecentSearch = {
  id: string
  query: string
  players: string[]
  sport: SocialPulseSport
  format: SocialPulseFormat
  idpEnabled: boolean
  savedAt: number
}

type SocialPulseResult = SocialPulseResponse & {
  market: MarketEntry[]
  bullets: string[]
  connections: string[]
  sources: string[]
}

const RECENT_SEARCHES_KEY = 'social-pulse-recent'
const FORMAT_STORAGE_KEY = 'social-pulse-format'
const SPORT_STORAGE_KEY = 'social-pulse-sport'
const MAX_PLAYERS = 20

const QUICK_PICKS: Record<SocialPulseSport, string[]> = {
  NFL: [
    'Josh Allen',
    "Ja'Marr Chase",
    'Christian McCaffrey',
    'Bijan Robinson',
    'Breece Hall',
    'Jordan Love',
    'Buffalo Bills offense',
    'Injury report',
  ],
  NBA: [
    'Nikola Jokic',
    'Victor Wembanyama',
    'Luka Doncic',
    'Anthony Edwards',
    'Jalen Brunson',
    'Paolo Banchero',
    'Lakers rotation',
    'Injury report',
  ],
}

const MARKET_SIGNAL_SET = new Set<SocialPulseSignal>(SOCIAL_PULSE_SIGNAL_VALUES)

const SIGNAL_META: Record<
  MarketSignal,
  {
    label: string
    badgeClass: string
    accent: string
    bar: string
  }
> = {
  up: {
    label: '📈 RISING',
    badgeClass: 'border-green-500/30 bg-green-500/20 text-green-300',
    accent: '#22c55e',
    bar: 'linear-gradient(90deg, rgba(34,197,94,0.95), rgba(74,222,128,0.8))',
  },
  down: {
    label: '📉 FALLING',
    badgeClass: 'border-red-500/30 bg-red-500/20 text-red-300',
    accent: '#ef4444',
    bar: 'linear-gradient(90deg, rgba(239,68,68,0.95), rgba(248,113,113,0.8))',
  },
  mixed: {
    label: '⚡ MIXED',
    badgeClass: 'border-yellow-500/30 bg-yellow-500/20 text-yellow-300',
    accent: '#facc15',
    bar: 'linear-gradient(90deg, rgba(250,204,21,0.95), rgba(253,224,71,0.8))',
  },
  injury: {
    label: '🚑 INJURY ALERT',
    badgeClass: 'border-red-600/40 bg-red-600/30 text-red-200',
    accent: '#dc2626',
    bar: 'linear-gradient(90deg, rgba(220,38,38,0.95), rgba(248,113,113,0.8))',
  },
  hype: {
    label: '🔥 HYPE',
    badgeClass: 'border-cyan-500/30 bg-cyan-500/20 text-cyan-300',
    accent: '#22d3ee',
    bar: 'linear-gradient(90deg, rgba(34,211,238,0.95), rgba(103,232,249,0.8))',
  },
  buy_low: {
    label: '💎 BUY LOW',
    badgeClass: 'border-teal-500/30 bg-teal-500/20 text-teal-300',
    accent: '#14b8a6',
    bar: 'linear-gradient(90deg, rgba(20,184,166,0.95), rgba(45,212,191,0.8))',
  },
  sell_high: {
    label: '💰 SELL HIGH',
    badgeClass: 'border-orange-500/30 bg-orange-500/20 text-orange-300',
    accent: '#f97316',
    bar: 'linear-gradient(90deg, rgba(249,115,22,0.95), rgba(251,191,36,0.8))',
  },
  released: {
    label: '✂️ RELEASED',
    badgeClass: 'border-gray-500/30 bg-gray-500/20 text-gray-300',
    accent: '#9ca3af',
    bar: 'linear-gradient(90deg, rgba(156,163,175,0.95), rgba(209,213,219,0.7))',
  },
  traded: {
    label: '🔄 TRADED',
    badgeClass: 'border-blue-500/30 bg-blue-500/20 text-blue-300',
    accent: '#3b82f6',
    bar: 'linear-gradient(90deg, rgba(59,130,246,0.95), rgba(96,165,250,0.8))',
  },
  idp_scarcity: {
    label: '🛡️ IDP SCARCITY',
    badgeClass: 'border-violet-500/30 bg-violet-500/20 text-violet-300',
    accent: '#8b5cf6',
    bar: 'linear-gradient(90deg, rgba(139,92,246,0.95), rgba(167,139,250,0.8))',
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isMarketSignal(value: unknown): value is MarketSignal {
  return typeof value === 'string' && MARKET_SIGNAL_SET.has(value as MarketSignal)
}

function parseSearchInput(input: string): string[] {
  const seen = new Set<string>()
  const parsed: string[] = []

  for (const rawPart of input.split(/[\n,]+/)) {
    const value = rawPart.trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    parsed.push(value)
  }

  return parsed
}

function safeReadStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function safeReadStorageString(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  try {
    return window.localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function safeWriteStorage(key: string, value: unknown) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // localStorage is optional for this public tool.
  }
}

function safeWriteStorageString(key: string, value: string) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // localStorage is optional for this public tool.
  }
}

function formatRelativeTime(timestamp: number): string {
  const deltaMs = Date.now() - timestamp
  const deltaSec = Math.max(0, Math.floor(deltaMs / 1000))
  if (deltaSec < 60) return `${deltaSec}s ago`
  const deltaMin = Math.floor(deltaSec / 60)
  if (deltaMin < 60) return `${deltaMin}m ago`
  const deltaHours = Math.floor(deltaMin / 60)
  if (deltaHours < 24) return `${deltaHours}h ago`
  const deltaDays = Math.floor(deltaHours / 24)
  return `${deltaDays}d ago`
}

function formatRecency(hours: number | undefined): string {
  const safeHours = Math.max(0, Math.round(hours ?? 24))
  if (safeHours < 24) return `${safeHours} hour${safeHours === 1 ? '' : 's'} ago`
  const days = Math.max(1, Math.round(safeHours / 24))
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function recencyChipClass(hours: number | undefined): string {
  const safeHours = hours ?? 24
  if (safeHours < 6) return 'bg-green-500/15 text-green-400'
  if (safeHours < 24) return 'bg-yellow-500/15 text-yellow-400'
  return 'bg-white/8 text-white/40'
}

function confidenceColor(score: number): string {
  if (score >= 80) return '#22c55e'
  if (score >= 50) return '#facc15'
  return '#ef4444'
}

function pulseScoreMeta(score: number) {
  if (score >= 80) {
    return {
      label: 'HIGH HEAT',
      textClass: 'text-red-200',
      bar: 'linear-gradient(90deg, #ef4444, #fb923c)',
      chipClass: 'border-red-500/30 bg-red-500/15 text-red-200',
    }
  }
  if (score >= 60) {
    return {
      label: 'ELEVATED',
      textClass: 'text-orange-200',
      bar: 'linear-gradient(90deg, #f97316, #facc15)',
      chipClass: 'border-orange-500/30 bg-orange-500/15 text-orange-200',
    }
  }
  if (score >= 40) {
    return {
      label: 'MODERATE',
      textClass: 'text-yellow-200',
      bar: 'linear-gradient(90deg, #eab308, #fde047)',
      chipClass: 'border-yellow-500/30 bg-yellow-500/15 text-yellow-200',
    }
  }
  return {
    label: 'QUIET',
    textClass: 'text-gray-200',
    bar: 'linear-gradient(90deg, #4b5563, #9ca3af)',
    chipClass: 'border-gray-500/30 bg-gray-500/15 text-gray-200',
  }
}

function normalizeSources(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const sources: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    sources.push(trimmed)
  }
  return sources.slice(0, 20)
}

function extractErrorMessage(value: unknown): string | null {
  const record = isRecord(value) ? value : null
  if (!record) return null

  if (typeof record.message === 'string' && record.message.trim().length > 0) return record.message
  if (typeof record.error === 'string' && record.error.trim().length > 0) return record.error
  if (typeof record.details === 'string' && record.details.trim().length > 0) return record.details

  return null
}

function normalizeSocialPulseResult(payload: unknown): SocialPulseResult | null {
  const record = isRecord(payload) ? payload : null
  const candidate = isRecord(record?.data)
    ? record.data
    : isRecord(record?.result)
      ? record.result
      : record

  if (!candidate) return null
  if (typeof candidate.summary !== 'string') return null

  const bullets = Array.isArray(candidate.bullets)
    ? candidate.bullets.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []

  const connections = Array.isArray(candidate.connections)
    ? candidate.connections.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []

  const market = Array.isArray(candidate.market)
    ? candidate.market.filter((item): item is MarketEntry => {
        return isRecord(item) && typeof item.player === 'string' && isMarketSignal(item.signal)
      })
    : []

  return {
    summary: candidate.summary,
    bullets,
    market,
    connections,
    lastUpdated: typeof candidate.lastUpdated === 'string' ? candidate.lastUpdated : undefined,
    pulseScore: typeof candidate.pulseScore === 'number' ? candidate.pulseScore : undefined,
    sources: normalizeSources(candidate.sources),
  }
}

function LoadingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden="true">
      <span className="h-2 w-2 rounded-full bg-current animate-pulse" />
      <span className="h-2 w-2 rounded-full bg-current animate-pulse [animation-delay:150ms]" />
      <span className="h-2 w-2 rounded-full bg-current animate-pulse [animation-delay:300ms]" />
    </span>
  )
}

function buildTradeAnalyzerHref(players: string[]): string {
  const params = new URLSearchParams()
  if (players.length === 0) return '/trade-evaluator'

  const midpoint = Math.ceil(players.length / 2)
  const sender = players.slice(0, midpoint).join(', ')
  const receiver = players.slice(midpoint).join(', ')

  if (sender) params.set('previewSender', sender)
  if (receiver) params.set('previewReceiver', receiver)

  const query = params.toString()
  return query ? `/trade-evaluator?${query}` : '/trade-evaluator'
}

function ConfidenceRing({ score }: { score: number }) {
  const safeScore = Math.max(0, Math.min(100, Math.round(score)))
  const color = confidenceColor(safeScore)
  const radius = 14
  const circumference = 2 * Math.PI * radius

  return (
    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" width="40" height="40">
        <circle cx="20" cy="20" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={`${(safeScore / 100) * circumference} ${circumference}`}
          strokeLinecap="round"
        />
      </svg>
      <span className="text-[11px] font-black" style={{ color }}>
        {safeScore}
      </span>
    </div>
  )
}

function MarketSignalCard({
  entry,
  index,
  mounted,
}: {
  entry: MarketEntry
  index: number
  mounted: boolean
}) {
  const meta = SIGNAL_META[entry.signal]
  const impact = Math.max(0, Math.min(100, Math.round(entry.impactScore ?? 50)))
  const confidence = Math.max(0, Math.min(100, Math.round(entry.confidence ?? 50)))

  return (
    <div
      className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-5 transition-all duration-500 hover:border-white/20"
      style={{
        borderLeftWidth: 4,
        borderLeftColor: meta.accent,
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0px)' : 'translateY(12px)',
        transitionDelay: `${index * 100}ms`,
      }}
    >
      <div className="flex items-start gap-4">
        <ConfidenceRing score={confidence} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-lg font-black text-white">{entry.player}</div>
              <div className="mt-1 text-[11px] uppercase tracking-[0.24em] text-white/35">Market signal</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] ${meta.badgeClass}`}>
                {meta.label}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold text-white/65">
                {confidence} confidence
              </span>
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-white/40">
              <span>Impact</span>
              <span>{impact}/100</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{
                  width: mounted ? `${impact}%` : '0%',
                  transitionDelay: `${index * 100 + 120}ms`,
                  background: meta.bar,
                }}
              />
            </div>
          </div>

          <div className="mt-4">
            <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${recencyChipClass(entry.recencyHours)}`}>
              {formatRecency(entry.recencyHours)}
            </span>
          </div>

          <p className="mt-4 text-sm leading-6 text-white/72">{entry.reason ?? 'No additional rationale returned for this signal.'}</p>
        </div>
      </div>
    </div>
  )
}

export default function SocialPulsePage() {
  const { status } = useSession()
  const [query, setQuery] = useState('')
  const [sport, setSport] = useState<SocialPulseSport>('NFL')
  const [format, setFormat] = useState<SocialPulseFormat>('dynasty')
  const [idpEnabled, setIdpEnabled] = useState(false)
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SocialPulseResult | null>(null)
  const [submittedPlayers, setSubmittedPlayers] = useState<string[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [retryAfterSec, setRetryAfterSec] = useState<number | null>(null)
  const [resultsMounted, setResultsMounted] = useState(false)
  const [lastRunAt, setLastRunAt] = useState<number | null>(null)

  const parsedPlayers = useMemo(() => parseSearchInput(query), [query])
  const playerCount = parsedPlayers.length
  const canSubmit = playerCount > 0 && playerCount <= MAX_PLAYERS && !loading
  const quickPicks = QUICK_PICKS[sport]

  useEffect(() => {
    const storedRecent = safeReadStorage<RecentSearch[]>(RECENT_SEARCHES_KEY, [])
    setRecentSearches(Array.isArray(storedRecent) ? storedRecent.slice(0, 5) : [])

    const storedFormat = safeReadStorageString(FORMAT_STORAGE_KEY, 'dynasty')
    if (storedFormat === 'dynasty' || storedFormat === 'redraft') setFormat(storedFormat)

    const storedSport = safeReadStorageString(SPORT_STORAGE_KEY, 'NFL')
    if (storedSport === 'NFL' || storedSport === 'NBA') setSport(storedSport)
  }, [])

  useEffect(() => {
    safeWriteStorageString(FORMAT_STORAGE_KEY, format)
  }, [format])

  useEffect(() => {
    safeWriteStorageString(SPORT_STORAGE_KEY, sport)
  }, [sport])

  useEffect(() => {
    if (sport !== 'NFL') {
      setIdpEnabled(false)
    }
  }, [sport])

  useEffect(() => {
    if (!result) {
      setResultsMounted(false)
      return
    }

    setResultsMounted(false)
    const frame = window.requestAnimationFrame(() => setResultsMounted(true))
    return () => window.cancelAnimationFrame(frame)
  }, [result])

  useEffect(() => {
    if (retryAfterSec == null || retryAfterSec <= 0) return

    const interval = window.setInterval(() => {
      setRetryAfterSec((current) => {
        if (current == null) return null
        if (current <= 1) {
          window.clearInterval(interval)
          return 0
        }
        return current - 1
      })
    }, 1000)

    return () => window.clearInterval(interval)
  }, [retryAfterSec])

  const persistRecentSearch = useCallback((entry: RecentSearch) => {
    setRecentSearches((current) => {
      const next = [entry, ...current.filter((item) => item.id !== entry.id && item.query !== entry.query)].slice(0, 5)
      safeWriteStorage(RECENT_SEARCHES_KEY, next)
      return next
    })
  }, [])

  const removeRecentSearch = useCallback((id: string) => {
    setRecentSearches((current) => {
      const next = current.filter((item) => item.id !== id)
      safeWriteStorage(RECENT_SEARCHES_KEY, next)
      return next
    })
  }, [])

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([])
    safeWriteStorage(RECENT_SEARCHES_KEY, [])
  }, [])

  const runSearch = useCallback(
    async (nextState?: {
      query: string
      sport: SocialPulseSport
      format: SocialPulseFormat
      idpEnabled: boolean
    }) => {
      const activeQuery = nextState?.query ?? query
      const activeSport = nextState?.sport ?? sport
      const activeFormat = nextState?.format ?? format
      const activeIdp = nextState?.idpEnabled ?? idpEnabled
      const players = parseSearchInput(activeQuery)

      if (players.length === 0) {
        setErrorStatus(400)
        setErrorMessage('Add at least one player, team, or coach.')
        return
      }

      if (players.length > MAX_PLAYERS) {
        setErrorStatus(400)
        setErrorMessage(`You can search up to ${MAX_PLAYERS} names at once.`)
        return
      }

      setLoading(true)
      setResult(null)
      setSubmittedPlayers(players)
      setErrorMessage(null)
      setErrorStatus(null)
      setRetryAfterSec(null)

      try {
        const response = await fetch('/api/legacy/social-pulse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sport: activeSport,
            format: activeFormat,
            idpEnabled: activeSport === 'NFL' ? activeIdp : false,
            players,
          }),
        })

        const payload = (await response.json().catch(() => null)) as unknown
        const normalized = normalizeSocialPulseResult(payload)
        const payloadRecord = isRecord(payload) ? payload : null
        const rateLimitRecord = isRecord(payloadRecord?.rate_limit) ? payloadRecord.rate_limit : null
        const payloadErrorMessage = extractErrorMessage(payload)
        const retryValue = rateLimitRecord?.retryAfterSec
        const topLevelRetry = payloadRecord?.retryAfterSec
        const parsedRetry =
          typeof retryValue === 'number'
            ? retryValue
            : typeof topLevelRetry === 'number'
              ? topLevelRetry
              : null

        if (response.status === 401) {
          setErrorStatus(401)
          setErrorMessage(payloadErrorMessage ?? 'Sign in to use Social Pulse')
          return
        }

        if (response.status === 429) {
          setErrorStatus(429)
          setRetryAfterSec(parsedRetry ?? 60)
          setErrorMessage(payloadErrorMessage ?? 'Rate limit reached.')
          return
        }

        if (!response.ok) {
          setErrorStatus(response.status)
          setErrorMessage(payloadErrorMessage ?? 'Grok search failed. Try again.')
          return
        }

        if (!normalized) {
          setErrorStatus(500)
          setErrorMessage(payloadErrorMessage ?? 'Grok search failed. Try again.')
          return
        }

        const recentEntry: RecentSearch = {
          id: `${Date.now()}-${players.join('|').toLowerCase()}`,
          query: activeQuery,
          players,
          sport: activeSport,
          format: activeFormat,
          idpEnabled: activeIdp,
          savedAt: Date.now(),
        }

        persistRecentSearch(recentEntry)
        setResult(normalized)
        setLastRunAt(Date.now())
      } catch {
        setErrorStatus(0)
        setErrorMessage('Connection error — check your internet')
      } finally {
        setLoading(false)
      }
    },
    [format, idpEnabled, persistRecentSearch, query, sport]
  )

  const handleRecentSearch = useCallback(
    (entry: RecentSearch) => {
      setQuery(entry.query)
      setSport(entry.sport)
      setFormat(entry.format)
      setIdpEnabled(entry.idpEnabled)
      void runSearch({
        query: entry.query,
        sport: entry.sport,
        format: entry.format,
        idpEnabled: entry.idpEnabled,
      })
    },
    [runSearch]
  )

  const handleQuickPick = useCallback(
    (pick: string) => {
      const current = parseSearchInput(query)
      if (current.some((item) => item.toLowerCase() === pick.toLowerCase())) return
      const next = [...current, pick]
      if (next.length > MAX_PLAYERS) {
        setErrorStatus(400)
        setErrorMessage(`You can search up to ${MAX_PLAYERS} names at once.`)
        return
      }
      setErrorMessage(null)
      setErrorStatus(null)
      setQuery(next.join(', '))
    },
    [query]
  )

  const pulseScore = Math.max(0, Math.min(100, Math.round(result?.pulseScore ?? 50)))
  const pulseMeta = pulseScoreMeta(pulseScore)
  const tradeAnalyzerHref = useMemo(() => buildTradeAnalyzerHref(submittedPlayers), [submittedPlayers])
  const sourceSummary =
    result && result.sources.length > 0
      ? `${result.sources.length} source${result.sources.length === 1 ? '' : 's'}`
      : 'X + Web'

  return (
    <>
      <LandingToolVisitTracker path="/social-pulse" toolName="Social Pulse" />
      <EngagementEventTracker
        eventType="ai_used"
        oncePerDayKey={`tool_social_pulse:${sport}`}
        meta={{ product: 'legacy', sport, authStatus: status, surface: 'social_pulse' }}
      />

      <div className="min-h-screen bg-[#07071a] text-white">
        <div className="sticky top-0 z-20 border-b border-white/8 bg-[#07071a]/92 backdrop-blur-xl">
          <div className="mx-auto max-w-[1480px] px-4 py-4 sm:px-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-cyan-300">
                  <span>📡</span>
                  <span>Social Pulse</span>
                </div>
                <h1 className="mt-2 text-2xl font-black sm:text-3xl">Live market narrative research</h1>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={sport}
                  onChange={(event) => setSport(event.target.value as SocialPulseSport)}
                  className="rounded-xl border border-white/10 bg-[#0c0c1e] px-3 py-2 text-sm font-semibold text-white focus:border-cyan-500/40 focus:outline-none"
                  data-testid="social-pulse-header-sport"
                >
                  <option value="NFL">NFL</option>
                  <option value="NBA">NBA</option>
                </select>

                <select
                  value={format}
                  onChange={(event) => setFormat(event.target.value as SocialPulseFormat)}
                  className="rounded-xl border border-white/10 bg-[#0c0c1e] px-3 py-2 text-sm font-semibold text-white focus:border-cyan-500/40 focus:outline-none"
                  data-testid="social-pulse-header-format"
                >
                  <option value="dynasty">Dynasty</option>
                  <option value="redraft">Redraft</option>
                </select>

                {sport === 'NFL' ? (
                  <label className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-[#0c0c1e] px-3 py-2 text-sm font-semibold text-white/80">
                    <input
                      type="checkbox"
                      checked={idpEnabled}
                      onChange={(event) => setIdpEnabled(event.target.checked)}
                      className="h-4 w-4 rounded border-white/20 bg-transparent"
                      data-testid="social-pulse-header-idp"
                    />
                    IDP
                  </label>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-6">
          <section className="rounded-3xl border border-white/8 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_45%),#0a0d1a] p-6 sm:p-8">
            <div className="max-w-3xl">
              <div className="text-xs font-bold uppercase tracking-[0.3em] text-cyan-300/80">Powered by Grok AI</div>
              <h2 className="mt-3 text-3xl font-black leading-tight sm:text-4xl">
                Understand player narratives before the market shifts.
              </h2>
              <p className="mt-4 text-sm leading-6 text-white/60 sm:text-base">
                Run live X and web search against player, team, and coach narratives. Social Pulse surfaces current signals,
                confidence, impact, and cross-player connections in one workspace.
              </p>
            </div>
          </section>

          <div className="mt-6 grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-5 lg:sticky lg:top-[104px] lg:self-start">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.28em] text-cyan-300/80">Social Pulse</div>
                <p className="mt-2 text-sm leading-6 text-white/55">
                  Live X and web search for real-time player, team, and coach sentiment.
                </p>
              </div>

              <div className="mt-5">
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">
                  Players, Teams, or Coaches
                </label>
                <textarea
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      if (canSubmit) {
                        void runSearch()
                      }
                    }
                  }}
                  rows={2}
                  placeholder="e.g. Josh Allen, Keon Coleman, Buffalo Bills"
                  className="w-full resize-none rounded-2xl border border-white/10 bg-[#07071a] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-cyan-500/40 focus:outline-none"
                  data-testid="social-pulse-query"
                />
                <div className="mt-2 flex items-center justify-between">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      playerCount > MAX_PLAYERS ? 'bg-red-500/15 text-red-300' : 'bg-white/[0.05] text-white/55'
                    }`}
                  >
                    {playerCount} player{playerCount === 1 ? '' : 's'}
                  </span>
                  <span className="text-[11px] text-white/35">Max {MAX_PLAYERS}</span>
                </div>
              </div>

              <div className="mt-5">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Format</div>
                <div className="grid grid-cols-2 gap-2">
                  {(['dynasty', 'redraft'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setFormat(option)}
                      className={`rounded-xl px-3 py-2 text-sm font-bold transition-all ${
                        format === option
                          ? 'bg-gradient-to-r from-purple-500/90 to-fuchsia-500/90 text-white'
                          : 'border border-white/10 bg-white/[0.04] text-white/55 hover:bg-white/[0.08] hover:text-white'
                      }`}
                      data-testid={`social-pulse-format-${option}`}
                    >
                      {option === 'dynasty' ? 'Dynasty' : 'Redraft'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-5">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Sport</div>
                <div className="grid grid-cols-2 gap-2">
                  {(['NFL', 'NBA'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setSport(option)}
                      className={`rounded-xl px-3 py-2 text-sm font-bold transition-all ${
                        sport === option
                          ? 'bg-gradient-to-r from-cyan-500/90 to-sky-500/90 text-black'
                          : 'border border-white/10 bg-white/[0.04] text-white/55 hover:bg-white/[0.08] hover:text-white'
                      }`}
                      data-testid={`social-pulse-sport-${option.toLowerCase()}`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              {sport === 'NFL' ? (
                <label className="mt-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/75">
                  <input
                    type="checkbox"
                    checked={idpEnabled}
                    onChange={(event) => setIdpEnabled(event.target.checked)}
                    className="h-4 w-4 rounded border-white/20 bg-transparent"
                    data-testid="social-pulse-idp-toggle"
                  />
                  <span>IDP leagues</span>
                </label>
              ) : null}

              <div className="mt-6">
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Trending searches</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {quickPicks.map((pick) => (
                    <button
                      key={pick}
                      type="button"
                      onClick={() => handleQuickPick(pick)}
                      className="rounded-full border border-white/8 bg-white/[0.06] px-3 py-1 text-xs font-semibold text-white/50 transition-all hover:bg-white/[0.1] hover:text-white"
                      data-testid={`social-pulse-quick-pick-${pick.replace(/\s+/g, '-').toLowerCase()}`}
                    >
                      {pick}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => void runSearch()}
                disabled={!canSubmit}
                className="mt-6 w-full rounded-2xl px-4 py-3 text-sm font-black text-white transition-all disabled:cursor-not-allowed disabled:opacity-35"
                style={{
                  background: canSubmit ? 'linear-gradient(135deg, #7c3aed, #d946ef)' : 'rgba(255,255,255,0.05)',
                  boxShadow: canSubmit ? '0 14px 38px rgba(124,58,237,0.28)' : 'none',
                }}
                data-testid="social-pulse-submit"
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <span>Searching X and the web</span>
                    <LoadingDots />
                  </span>
                ) : (
                  'Get Social Pulse'
                )}
              </button>

              <div className="mt-6">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Recent</div>
                  {recentSearches.length > 0 ? (
                    <button
                      type="button"
                      onClick={clearRecentSearches}
                      className="text-[11px] font-semibold text-white/40 hover:text-white/70"
                      data-testid="social-pulse-clear-recent"
                    >
                      Clear all
                    </button>
                  ) : null}
                </div>

                {recentSearches.length === 0 ? (
                  <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4 text-sm text-white/35">
                    Recent searches will appear here after your first run.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {recentSearches.map((entry) => (
                      <div key={entry.id} className="flex items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                        <button
                          type="button"
                          onClick={() => handleRecentSearch(entry)}
                          className="min-w-0 flex-1 text-left"
                          data-testid={`social-pulse-recent-${entry.id}`}
                        >
                          <div className="truncate text-sm font-semibold text-white">{entry.players.join(', ')}</div>
                          <div className="mt-1 text-[11px] text-white/35">{formatRelativeTime(entry.savedAt)}</div>
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            removeRecentSearch(entry.id)
                          }}
                          className="rounded-lg px-2 py-1 text-xs text-white/35 hover:bg-white/[0.08] hover:text-white/70"
                          data-testid={`social-pulse-remove-recent-${entry.id}`}
                          aria-label="Remove recent search"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </aside>

            <section className="min-h-[70vh]">
              {errorMessage ? (
                <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
                  <div className="text-sm font-semibold text-red-100">
                    {errorStatus === 429 && retryAfterSec != null
                      ? `Rate limit reached. Try again in ${retryAfterSec}s`
                      : errorMessage}
                  </div>
                  {errorStatus === 401 ? (
                    <Link
                      href="/login?callbackUrl=%2Fsocial-pulse"
                      className="mt-3 inline-flex rounded-xl border border-red-300/20 bg-white/10 px-4 py-2 text-sm font-bold text-white hover:bg-white/15"
                    >
                      Go to Login
                    </Link>
                  ) : null}
                </div>
              ) : null}

              {loading ? (
                <div className="flex min-h-[70vh] items-center justify-center rounded-3xl border border-white/8 bg-[#0c0c1e] p-8">
                  <div className="max-w-md text-center">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-500/10 text-3xl text-cyan-300 animate-pulse">
                      📡
                    </div>
                    <h3 className="mt-5 text-2xl font-black">Searching X and the web...</h3>
                    <div className="mt-3 inline-flex items-center text-sm text-white/55">
                      <LoadingDots />
                    </div>
                    <p className="mt-4 text-sm leading-6 text-white/50">Using Grok AI with live X search and web search.</p>
                  </div>
                </div>
              ) : !result ? (
                <div className="flex min-h-[70vh] items-center justify-center rounded-3xl border border-dashed border-white/12 bg-white/[0.02] p-8 text-center">
                  <div className="max-w-xl">
                    <div className="text-6xl">📡</div>
                    <h3 className="mt-5 text-2xl font-black text-white">Enter names to get the latest real-time sentiment</h3>
                    <p className="mt-3 text-sm leading-6 text-white/50">
                      Search for multiple names to find connections between them and track how narratives are moving before the market catches up.
                    </p>
                    <div className="mt-6 rounded-3xl border border-white/8 bg-[#0c0c1e] p-5 text-left">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">What you&apos;ll get</div>
                      <ul className="mt-4 space-y-3 text-sm text-white/65">
                        <li>📊 Market signal cards with impact and confidence</li>
                        <li>🔍 Live X posts from the last 7 days</li>
                        <li>🌐 Web news and beat reporter updates</li>
                        <li>🔗 Cross-player connections and trade implications</li>
                      </ul>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-5 sm:p-6">
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Market Pulse Score</div>
                        <div className="mt-2 text-3xl font-black text-white">{pulseScore}/100</div>
                      </div>
                      <span className={`inline-flex w-fit rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] ${pulseMeta.chipClass}`}>
                        {pulseMeta.label}
                      </span>
                    </div>

                    <div className="mt-5 h-4 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full transition-[width] duration-700 ease-out"
                        style={{
                          width: resultsMounted ? `${pulseScore}%` : '0%',
                          background: pulseMeta.bar,
                        }}
                      />
                    </div>

                    <div className={`mt-3 text-sm ${pulseMeta.textClass}`}>
                      Last updated: {result.lastUpdated ?? (lastRunAt ? 'just now' : 'just now')} • Sources: {sourceSummary} • 7-day window
                    </div>
                  </div>

                  <div className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-5 sm:p-6">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-cyan-300">
                        Grok
                      </span>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">AI Narrative Summary</span>
                    </div>
                    <p className="mt-4 text-base leading-7 text-white/80">{result.summary}</p>
                  </div>

                  <div className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-5 sm:p-6">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">📌 Key Signals</div>
                    <ul className="mt-4 space-y-3">
                      {result.bullets.map((bullet, index) => (
                        <li key={`${bullet}-${index}`} className="flex gap-3 text-sm leading-6 text-white/70">
                          <span className="mt-2 h-1.5 w-1.5 rounded-full bg-cyan-400" />
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {result.sources.length > 0 ? (
                    <div className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-5 sm:p-6">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">Verified sources</div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {result.sources.map((source) => {
                          const isUrl = source.startsWith('http://') || source.startsWith('https://')
                          return isUrl ? (
                            <a
                              key={source}
                              href={source}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-cyan-200 hover:border-cyan-400/30 hover:bg-cyan-500/10"
                            >
                              {source}
                            </a>
                          ) : (
                            <span
                              key={source}
                              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/65"
                            >
                              {source}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}

                  {result.market.length > 0 ? (
                    <div className="space-y-4">
                      {result.market.map((entry, index) => (
                        <MarketSignalCard key={`${entry.player}-${entry.signal}-${index}`} entry={entry} index={index} mounted={resultsMounted} />
                      ))}
                    </div>
                  ) : null}

                  {result.connections.length > 0 ? (
                    <div className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-5 sm:p-6">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">🔗 Cross-player connections</div>
                      <ul className="mt-4 space-y-3">
                        {result.connections.map((connection, index) => (
                          <li key={`${connection}-${index}`} className="flex gap-3 text-sm leading-6 text-white/70">
                            <span className="mt-2 h-1.5 w-1.5 rounded-full bg-violet-400" />
                            <span>{connection}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <Link
                    href={tradeAnalyzerHref}
                    className="inline-flex w-full items-center justify-center rounded-2xl border border-cyan-400/25 bg-cyan-500/10 px-4 py-3 text-sm font-black text-cyan-100 transition-all hover:bg-cyan-500/20"
                    data-testid="social-pulse-send-to-trade-analyzer"
                  >
                    ⇄ Analyze a trade involving these players →
                  </Link>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </>
  )
}
