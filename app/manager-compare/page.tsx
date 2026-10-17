'use client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import HomeTopNav from '@/components/navigation/HomeTopNav'
import SeoLandingFooter from '@/components/landing/SeoLandingFooter'
import { LandingToolVisitTracker } from '@/components/landing/LandingToolVisitTracker'
import { ManagerRoleBadge } from '@/components/ManagerRoleBadge'

type CompareFormat = 'redraft' | 'dynasty' | 'specialty'
type CompareWinner = 'A' | 'B' | 'TIE' | 'INCOMPARABLE'
type FormatWinner = 'A' | 'B' | 'TIE' | 'N/A'
type LoadingPhaseKey = 'history' | 'records' | 'ai' | 'verdict'

type FormatSelection = Record<CompareFormat, boolean>

type FormatGrade = {
  grade: string
  record: string
  championships: number
  leagues_played: number
  note: string
}

type ComparisonManager = {
  username: string
  role?: string | null
  overall_grade: string
  grades_by_type: Record<CompareFormat, FormatGrade>
  specialty_formats_note: string
  strengths: string[]
  weaknesses: string[]
}

type HeadToHeadBreakdown = {
  redraft_winner: FormatWinner
  dynasty_winner: FormatWinner
  specialty_winner: FormatWinner
}

type ComparisonPayload = {
  manager_a: ComparisonManager
  manager_b: ComparisonManager
  fair_comparison_possible: boolean
  comparable_formats: CompareFormat[]
  winner: CompareWinner
  winner_username: string
  margin: 'DOMINANT' | 'CLEAR' | 'SLIGHT' | 'TIE' | 'INCOMPARABLE'
  verdict: string
  edge?: string
  confidence?: string
  head_to_head_breakdown: HeadToHeadBreakdown
  trash_talk?: string
}

type ManagerSnapshot = {
  username: string
  grading_note: string
  total_standard_leagues: number
  total_specialty_leagues: number
  total_leagues_all: number
  total_seasons: number
  overall_record: string
  win_percentage: number
  championships: number
  championship_rate: number
  playoffs: number
  playoff_rate: number
}

type CompareSuccessPayload = {
  ok: true
  comparison: ComparisonPayload
  snapshots: {
    a: ManagerSnapshot
    b: ManagerSnapshot
  }
  remaining: number
}

type CompareErrorPayload = {
  error?: string
  retryAfterSec?: number
  message?: string
}

type RecentComparison = {
  id: string
  a: string
  b: string
  formats: CompareFormat[]
  savedAt: number
}

type AggregatedStats = {
  wins: number
  losses: number
  ties: number
  leagues: number
  championships: number
  winRate: number
  championshipRate: number
}

const RECENT_KEY = 'manager-compare-recent'
const FORMAT_ORDER: CompareFormat[] = ['redraft', 'dynasty', 'specialty']
const DEFAULT_FORMAT_SELECTION: FormatSelection = {
  redraft: true,
  dynasty: true,
  specialty: true,
}
const LOADING_PHASES: Array<{ key: LoadingPhaseKey; icon: string; label: string }> = [
  { key: 'history', icon: '📋', label: 'Fetching league history...' },
  { key: 'records', icon: '🏆', label: 'Analyzing records & championships...' },
  { key: 'ai', icon: '🧠', label: 'Chimmy evaluating both managers...' },
  { key: 'verdict', icon: '✅', label: 'Generating verdict...' },
]
const FORMAT_LABELS: Record<CompareFormat, string> = {
  redraft: 'Redraft',
  dynasty: 'Dynasty',
  specialty: 'Specialty',
}

function normalizeUsernameInput(value: string) {
  return value.trim().replace(/^@+/, '')
}

function timeAgo(timestamp: number) {
  const diffMs = Math.max(0, Date.now() - timestamp)
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

function parseRecord(record: string) {
  const parts = record
    .split('-')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value))
  return {
    wins: parts[0] ?? 0,
    losses: parts[1] ?? 0,
    ties: parts[2] ?? 0,
  }
}

function createEmptyStats(): AggregatedStats {
  return {
    wins: 0,
    losses: 0,
    ties: 0,
    leagues: 0,
    championships: 0,
    winRate: 0,
    championshipRate: 0,
  }
}

function aggregateManagerStats(manager: ComparisonManager, formats: FormatSelection): AggregatedStats {
  const stats = createEmptyStats()
  for (const format of FORMAT_ORDER) {
    if (!formats[format]) continue
    const grade = manager.grades_by_type[format]
    if (!grade || grade.grade === 'N/A') continue
    const record = parseRecord(grade.record)
    stats.wins += record.wins
    stats.losses += record.losses
    stats.ties += record.ties
    stats.leagues += grade.leagues_played || 0
    stats.championships += grade.championships || 0
  }
  const totalGames = stats.wins + stats.losses + stats.ties
  stats.winRate = totalGames > 0 ? Math.round((stats.wins / totalGames) * 100) : 0
  stats.championshipRate = stats.leagues > 0 ? Math.round((stats.championships / stats.leagues) * 100) : 0
  return stats
}

function formatRecordLabel(stats: AggregatedStats) {
  if (stats.ties > 0) return `${stats.wins}-${stats.losses}-${stats.ties}`
  return `${stats.wins}-${stats.losses}`
}

function gradeTone(grade: string) {
  if (grade === 'A+' || grade === 'A' || grade === 'A-') {
    return {
      pill: 'text-green-400 bg-green-500/15 border-green-500/30',
      accent: '#4ade80',
      glow: 'rgba(34,197,94,0.18)',
    }
  }
  if (grade === 'B+' || grade === 'B') {
    return {
      pill: 'text-cyan-400 bg-cyan-500/15 border-cyan-500/30',
      accent: '#22d3ee',
      glow: 'rgba(34,211,238,0.18)',
    }
  }
  if (grade === 'B-' || grade === 'C+') {
    return {
      pill: 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30',
      accent: '#facc15',
      glow: 'rgba(250,204,21,0.18)',
    }
  }
  if (grade === 'N/A') {
    return {
      pill: 'text-white/30 bg-white/5 border-white/10',
      accent: '#94a3b8',
      glow: 'rgba(148,163,184,0.14)',
    }
  }
  return {
    pill: 'text-red-400 bg-red-500/15 border-red-500/30',
    accent: '#f87171',
    glow: 'rgba(248,113,113,0.18)',
  }
}

function buildShareUrl(a: string, b: string) {
  const params = new URLSearchParams()
  params.set('a', a)
  params.set('b', b)
  return `/manager-compare?${params.toString()}`
}

function saveRecentComparisons(list: RecentComparison[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5)))
}

function loadRecentComparisons(): RecentComparison[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null
        const candidate = entry as Partial<RecentComparison>
        if (!candidate.a || !candidate.b || !candidate.id || typeof candidate.savedAt !== 'number') return null
        const formats = Array.isArray(candidate.formats)
          ? candidate.formats.filter((format): format is CompareFormat => FORMAT_ORDER.includes(format as CompareFormat))
          : []
        return {
          id: String(candidate.id),
          a: String(candidate.a),
          b: String(candidate.b),
          formats: formats.length > 0 ? formats : [...FORMAT_ORDER],
          savedAt: candidate.savedAt,
        }
      })
      .filter((entry): entry is RecentComparison => entry != null)
      .slice(0, 5)
  } catch {
    return []
  }
}

function upsertRecentComparison(entry: RecentComparison) {
  const current = loadRecentComparisons()
  const next = [entry, ...current.filter((item) => item.id !== entry.id && !(item.a.toLowerCase() === entry.a.toLowerCase() && item.b.toLowerCase() === entry.b.toLowerCase()))]
    .slice(0, 5)
  saveRecentComparisons(next)
  return next
}

function formatWinnerLabel(value: FormatWinner, managerA: string, managerB: string) {
  if (value === 'A') return managerA
  if (value === 'B') return managerB
  if (value === 'TIE') return 'Tie'
  return 'N/A'
}

function getActiveComparableFormats(comparison: ComparisonPayload, formats: FormatSelection) {
  return comparison.comparable_formats.filter((format) => formats[format])
}

function deriveEdgeText(comparison: ComparisonPayload, formats: FormatSelection) {
  if (comparison.edge && comparison.edge.trim()) return comparison.edge.trim()
  const winners = [
    { format: 'redraft' as const, winner: comparison.head_to_head_breakdown.redraft_winner },
    { format: 'dynasty' as const, winner: comparison.head_to_head_breakdown.dynasty_winner },
    { format: 'specialty' as const, winner: comparison.head_to_head_breakdown.specialty_winner },
  ].filter((item) => formats[item.format])
  const wonByA = winners.filter((item) => item.winner === 'A').map((item) => FORMAT_LABELS[item.format])
  const wonByB = winners.filter((item) => item.winner === 'B').map((item) => FORMAT_LABELS[item.format])
  if (wonByA.length > wonByB.length) return `${wonByA.join(' + ')} edge`
  if (wonByB.length > wonByA.length) return `${wonByB.join(' + ')} edge`
  if (winners.some((item) => item.winner === 'TIE')) return 'Split format edge'
  return 'Different format mix'
}

function deriveConfidenceText(
  comparison: ComparisonPayload,
  formats: FormatSelection,
  statsA: AggregatedStats,
  statsB: AggregatedStats
) {
  if (comparison.confidence && comparison.confidence.trim()) return comparison.confidence.trim()
  const comparable = getActiveComparableFormats(comparison, formats)
  const sampleSize = statsA.leagues + statsB.leagues
  if (!comparison.fair_comparison_possible || comparable.length === 0) return 'Low'
  if (comparable.length >= 2 && sampleSize >= 10) return 'High'
  if (sampleSize >= 4) return 'Medium'
  return 'Low'
}

function renderTrophies(count: number) {
  if (count <= 0) return <span className="text-white/30">No titles</span>
  if (count <= 5) return '🏆'.repeat(count)
  return `${'🏆'.repeat(5)} +${count - 5}`
}

function PlatformBadge() {
  return (
    <span className="inline-flex w-fit items-center rounded-full border border-violet-400/20 bg-violet-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-200">
      Sleeper
    </span>
  )
}

function LoadingState({ phase }: { phase: LoadingPhaseKey }) {
  const activeIndex = LOADING_PHASES.findIndex((item) => item.key === phase)
  return (
    <div className="rounded-[28px] border border-white/8 bg-[#0c0c1e] p-6 sm:p-8">
      <div className="text-center">
        <div className="text-lg text-white/80">Fetching Sleeper history for both managers...</div>
      </div>
      <div className="mt-6 space-y-3">
        {LOADING_PHASES.map((item, index) => {
          const isActive = index === activeIndex
          const isDone = index < activeIndex
          return (
            <div
              key={item.key}
              className={`flex items-center gap-3 rounded-2xl border px-4 py-3 transition-all ${
                isActive
                  ? 'border-violet-400/30 bg-violet-500/10'
                  : isDone
                    ? 'border-emerald-400/20 bg-emerald-500/10'
                    : 'border-white/8 bg-white/[0.03] opacity-60'
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              <span className="flex-1 text-sm text-white/80">{item.label}</span>
              {isDone ? <span className="text-xs font-semibold text-emerald-300">Done</span> : null}
              {isActive ? <div className="h-3 w-3 rounded-full border border-violet-300 border-t-transparent animate-spin" /> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[28px] border border-dashed border-white/10 bg-white/[0.02] p-8 text-center">
      <h2 className="text-lg font-bold text-white">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-white/45">{body}</p>
    </div>
  )
}

function StatBarRow({
  label,
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
  leftDisplay,
  rightDisplay,
  animate,
}: {
  label: string
  leftLabel: string
  leftValue: number
  rightLabel: string
  rightValue: number
  leftDisplay: string
  rightDisplay: string
  animate: boolean
}) {
  const max = Math.max(leftValue, rightValue, 1)
  const leftIsWinner = leftValue > rightValue
  const rightIsWinner = rightValue > leftValue

  return (
    <div className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-5">
      <div className="text-sm font-semibold text-white">{label}</div>
      <div className="mt-4 space-y-4">
        {[
          {
            name: leftLabel,
            value: leftValue,
            display: leftDisplay,
            winner: leftIsWinner,
          },
          {
            name: rightLabel,
            value: rightValue,
            display: rightDisplay,
            winner: rightIsWinner,
          },
        ].map((item) => (
          <div key={item.name} className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-sm text-white/75">
              <span>{item.name}</span>
              <span>{item.display}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-white/8">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  item.winner ? 'bg-gradient-to-r from-cyan-400 to-teal-300' : 'bg-white/20'
                }`}
                style={{ width: `${animate ? Math.round((item.value / max) * 100) : 0}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ManagerSummaryCard({
  title,
  manager,
  snapshot,
  activeStats,
  formats,
}: {
  title: string
  manager: ComparisonManager
  snapshot: ManagerSnapshot
  activeStats: AggregatedStats
  formats: FormatSelection
}) {
  const tone = gradeTone(manager.overall_grade)

  return (
    <div
      className="overflow-hidden rounded-[28px] border border-white/8 bg-[#0c0c1e]"
      style={{ boxShadow: `inset 0 1px 0 ${tone.glow}` }}
    >
      <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${tone.accent}, transparent)` }} />
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">{title}</div>
            <div className="mt-2 flex items-center gap-2">
              <h3 className="text-2xl font-black text-white">{manager.username}</h3>
              <ManagerRoleBadge role={manager.role ?? 'member'} />
            </div>
            <div className="mt-2 text-sm text-white/45">
              Active sample: {activeStats.leagues} leagues · {formatRecordLabel(activeStats)}
            </div>
          </div>
          <span className={`rounded-full border px-3 py-1 text-sm font-black ${tone.pill}`}>{manager.overall_grade}</span>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">Win Rate</div>
            <div className="mt-2 text-2xl font-black text-white">{activeStats.winRate}%</div>
          </div>
          <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">Championship Rate</div>
            <div className="mt-2 text-2xl font-black text-white">{activeStats.championshipRate}%</div>
          </div>
          <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">League Footprint</div>
            <div className="mt-2 text-2xl font-black text-white">{snapshot.total_leagues_all}</div>
          </div>
          <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">Titles</div>
            <div className="mt-2 text-xl">{renderTrophies(activeStats.championships)}</div>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {FORMAT_ORDER.filter((format) => formats[format]).map((format) => {
            const grade = manager.grades_by_type[format]
            const gradeStyle = gradeTone(grade.grade)
            return (
              <div key={format} className="rounded-2xl border border-white/8 bg-[#07071a] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-white">{FORMAT_LABELS[format]}</div>
                    <div className="mt-1 text-xs text-white/40">{grade.record || 'No comparable record'}</div>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${gradeStyle.pill}`}>{grade.grade}</span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">Leagues</div>
                    <div className="mt-1 text-sm font-semibold text-white">{grade.leagues_played}</div>
                  </div>
                  <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">Championships</div>
                    <div className="mt-1 text-sm font-semibold text-white">{renderTrophies(grade.championships)}</div>
                  </div>
                  <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">Sample Note</div>
                    <div className="mt-1 text-sm font-semibold text-white">{grade.note || 'No note provided'}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-200">Strengths</div>
            <ul className="mt-3 space-y-2 text-sm text-emerald-100/90">
              {manager.strengths.map((item, index) => (
                <li key={`${item}-${index}`} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-emerald-300" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-red-200">Weaknesses</div>
            <ul className="mt-3 space-y-2 text-sm text-red-100/90">
              {manager.weaknesses.map((item, index) => (
                <li key={`${item}-${index}`} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-red-300" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm leading-6 text-white/55">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">Method Note</div>
          <p className="mt-3">{snapshot.grading_note}</p>
          <p className="mt-3">{manager.specialty_formats_note}</p>
        </div>
      </div>
    </div>
  )
}

export default function ManagerComparePage() {
  const { status } = useSession()
  const autoRunRef = useRef(false)

  const [usernameA, setUsernameA] = useState('')
  const [usernameB, setUsernameB] = useState('')
  const [selectedFormats, setSelectedFormats] = useState<FormatSelection>(DEFAULT_FORMAT_SELECTION)
  const [loading, setLoading] = useState(false)
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhaseKey>('history')
  const [error, setError] = useState<string | null>(null)
  const [retryAfterSec, setRetryAfterSec] = useState<number | null>(null)
  const [copiedShare, setCopiedShare] = useState(false)
  const [result, setResult] = useState<CompareSuccessPayload | null>(null)
  const [recentComparisons, setRecentComparisons] = useState<RecentComparison[]>([])
  const [lastRunPair, setLastRunPair] = useState<{ a: string; b: string } | null>(null)
  const [animateBars, setAnimateBars] = useState(false)

  const enabledFormats = useMemo(() => FORMAT_ORDER.filter((format) => selectedFormats[format]), [selectedFormats])
  const canCompare = useMemo(() => {
    const trimmedA = normalizeUsernameInput(usernameA)
    const trimmedB = normalizeUsernameInput(usernameB)
    return trimmedA.length > 0 && trimmedB.length > 0 && enabledFormats.length > 0 && !loading
  }, [enabledFormats.length, loading, usernameA, usernameB])

  const currentComparison = result?.comparison ?? null
  const statsA = useMemo(
    () => (currentComparison ? aggregateManagerStats(currentComparison.manager_a, selectedFormats) : createEmptyStats()),
    [currentComparison, selectedFormats]
  )
  const statsB = useMemo(
    () => (currentComparison ? aggregateManagerStats(currentComparison.manager_b, selectedFormats) : createEmptyStats()),
    [currentComparison, selectedFormats]
  )
  const edgeText = useMemo(
    () => (currentComparison ? deriveEdgeText(currentComparison, selectedFormats) : ''),
    [currentComparison, selectedFormats]
  )
  const confidenceText = useMemo(
    () => (currentComparison ? deriveConfidenceText(currentComparison, selectedFormats, statsA, statsB) : 'Low'),
    [currentComparison, selectedFormats, statsA, statsB]
  )

  const handleCompare = useCallback(
    async (options?: {
      managerA?: string
      managerB?: string
      formats?: CompareFormat[]
      saveRecent?: boolean
    }) => {
      const nextA = normalizeUsernameInput(options?.managerA ?? usernameA)
      const nextB = normalizeUsernameInput(options?.managerB ?? usernameB)
      const formats = options?.formats ?? enabledFormats

      if (status === 'loading') return

      if (status !== 'authenticated') {
        setError('401 Unauthorized. Sign in to compare managers.')
        setResult(null)
        return
      }

      if (!nextA || !nextB) {
        setError('Enter both Sleeper usernames.')
        return
      }

      if (nextA.toLowerCase() === nextB.toLowerCase()) {
        setError('Choose two different managers.')
        return
      }

      if (formats.length === 0) {
        setError('Select at least one format to compare.')
        return
      }

      setLoading(true)
      setLoadingPhase('history')
      setError(null)
      setRetryAfterSec(null)
      setCopiedShare(false)
      setResult(null)
      setAnimateBars(false)

      const phaseTimers = [
        window.setTimeout(() => setLoadingPhase('records'), 650),
        window.setTimeout(() => setLoadingPhase('ai'), 1800),
        window.setTimeout(() => setLoadingPhase('verdict'), 3400),
      ]

      try {
        const response = await fetch('/api/legacy/compare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username_a: nextA,
            username_b: nextB,
          }),
        })

        const payload = (await response.json().catch(() => ({}))) as CompareSuccessPayload & CompareErrorPayload
        if (!response.ok) {
          setError(payload.error ?? payload.message ?? 'Manager comparison failed.')
          setRetryAfterSec(typeof payload.retryAfterSec === 'number' ? payload.retryAfterSec : null)
          return
        }

        setResult(payload)
        setLastRunPair({ a: nextA, b: nextB })
        if (typeof window !== 'undefined') {
          window.history.replaceState(null, '', buildShareUrl(nextA, nextB))
        }

        if (options?.saveRecent !== false) {
          const recentEntry: RecentComparison = {
            id: `${nextA.toLowerCase()}::${nextB.toLowerCase()}`,
            a: nextA,
            b: nextB,
            formats,
            savedAt: Date.now(),
          }
          setRecentComparisons(upsertRecentComparison(recentEntry))
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Manager comparison failed.')
      } finally {
        phaseTimers.forEach((timer) => window.clearTimeout(timer))
        setLoading(false)
      }
    },
    [enabledFormats, status, usernameA, usernameB]
  )

  useEffect(() => {
    setRecentComparisons(loadRecentComparisons())
  }, [])

  useEffect(() => {
    if (!retryAfterSec || retryAfterSec <= 0) return
    const timer = window.setTimeout(() => setRetryAfterSec((current) => (current && current > 0 ? current - 1 : null)), 1000)
    return () => window.clearTimeout(timer)
  }, [retryAfterSec])

  useEffect(() => {
    if (!result) return
    const timer = window.setTimeout(() => setAnimateBars(true), 80)
    return () => window.clearTimeout(timer)
  }, [result])

  useEffect(() => {
    if (copiedShare === false) return
    const timer = window.setTimeout(() => setCopiedShare(false), 1800)
    return () => window.clearTimeout(timer)
  }, [copiedShare])

  useEffect(() => {
    if (autoRunRef.current || status === 'loading') return
    autoRunRef.current = true
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const a = normalizeUsernameInput(params.get('a') ?? '')
    const b = normalizeUsernameInput(params.get('b') ?? '')
    if (!a || !b) return
    setUsernameA(a)
    setUsernameB(b)
    void handleCompare({
      managerA: a,
      managerB: b,
      saveRecent: false,
    })
  }, [handleCompare, status])

  const handleFormatToggle = (format: CompareFormat) => {
    setSelectedFormats((current) => ({
      ...current,
      [format]: !current[format],
    }))
  }

  const handleShare = async () => {
    if (!lastRunPair) return
    const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}${buildShareUrl(lastRunPair.a, lastRunPair.b)}` : buildShareUrl(lastRunPair.a, lastRunPair.b)
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopiedShare(true)
    } catch {
      setError('Could not copy the share URL on this device.')
    }
  }

  const handleRecentRun = (entry: RecentComparison) => {
    const nextFormats: FormatSelection = {
      redraft: entry.formats.includes('redraft'),
      dynasty: entry.formats.includes('dynasty'),
      specialty: entry.formats.includes('specialty'),
    }
    setUsernameA(entry.a)
    setUsernameB(entry.b)
    setSelectedFormats(nextFormats)
    void handleCompare({
      managerA: entry.a,
      managerB: entry.b,
      formats: entry.formats,
    })
  }

  const handleRecentRemove = (id: string) => {
    const next = recentComparisons.filter((entry) => entry.id !== id)
    setRecentComparisons(next)
    saveRecentComparisons(next)
  }

  return (
    <>
      <LandingToolVisitTracker path="/manager-compare" toolName="Manager Comparison" />

      <main className="min-h-screen bg-[#07071a] text-white">
        <HomeTopNav />

        <div className="sticky top-0 z-20 border-b border-white/6 bg-[#07071a]/90 backdrop-blur-xl">
          <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-violet-200">
                  ⚔️ Manager Comparison
                </div>
                <h1 className="mt-2 text-2xl font-black sm:text-3xl">Cross-league Sleeper manager research</h1>
              </div>
              <Link href="/tools-hub" className="text-sm text-white/45 hover:text-white/75">
                Back to Tools Hub
              </Link>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <section className="rounded-[28px] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(124,58,237,0.24),transparent_45%),#0c0c1e] p-5 sm:p-6">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
              <div className="rounded-[24px] border border-white/8 bg-[#07071a] p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">Manager A</div>
                <input
                  value={usernameA}
                  onChange={(event) => setUsernameA(event.target.value)}
                  placeholder="Sleeper username"
                  className="mt-3 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-violet-400/40 focus:outline-none"
                />
                <div className="mt-3">
                  <PlatformBadge />
                </div>
              </div>

              <div className="flex items-center justify-center text-center">
                <div className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-bold uppercase tracking-[0.3em] text-white/45">
                  ⚔️ vs
                </div>
              </div>

              <div className="rounded-[24px] border border-white/8 bg-[#07071a] p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">Manager B</div>
                <input
                  value={usernameB}
                  onChange={(event) => setUsernameB(event.target.value)}
                  placeholder="Sleeper username"
                  className="mt-3 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-violet-400/40 focus:outline-none"
                />
                <div className="mt-3">
                  <PlatformBadge />
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-[24px] border border-white/8 bg-[#07071a] p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">Formats to include</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {FORMAT_ORDER.map((format) => (
                  <button
                    key={format}
                    type="button"
                    onClick={() => handleFormatToggle(format)}
                    className={`rounded-full border px-3 py-2 text-sm font-semibold transition-all ${
                      selectedFormats[format]
                        ? 'border-cyan-400/30 bg-cyan-500/12 text-cyan-100'
                        : 'border-white/10 bg-white/[0.03] text-white/45'
                    }`}
                  >
                    {selectedFormats[format] ? '✓ ' : ''}
                    {FORMAT_LABELS[format]}
                  </button>
                ))}
              </div>

              {/* The season range and the DNA / trade-style / tendency tabs went with the retired
                  profile routes (410): the range only scoped those lookups, never the grading. */}
              <div className="mt-3 text-xs leading-6 text-white/40">
                Grades cover the compare engine&apos;s current five-season window.
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleCompare()}
              disabled={!canCompare}
              className="mt-5 w-full rounded-2xl px-5 py-4 text-base font-black text-white transition-all disabled:cursor-not-allowed disabled:opacity-35"
              style={{
                background: canCompare ? 'linear-gradient(135deg, #7c3aed, #8b5cf6, #06b6d4)' : 'rgba(255,255,255,0.05)',
                boxShadow: canCompare ? '0 16px 40px rgba(124,58,237,0.28)' : 'none',
              }}
            >
              {loading ? 'Comparing Managers...' : '⚔️ Compare Managers'}
            </button>

            <div className="mt-6">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">Recent Comparisons</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {recentComparisons.length === 0 ? (
                  <span className="text-sm text-white/35">No recent comparisons yet.</span>
                ) : (
                  recentComparisons.map((entry) => (
                    <div key={entry.id} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
                      <button type="button" onClick={() => handleRecentRun(entry)} className="text-left text-white/80 hover:text-white">
                        {entry.a} vs {entry.b} ({timeAgo(entry.savedAt)})
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRecentRemove(entry.id)}
                        className="rounded-full text-white/35 hover:text-red-300"
                        aria-label={`Remove recent comparison ${entry.a} versus ${entry.b}`}
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          {error ? (
            <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
              {error}
              {retryAfterSec != null ? ` Try again in ${retryAfterSec}s.` : ''}
              {status !== 'authenticated' ? (
                <div className="mt-3">
                  <Link href="/login?callbackUrl=%2Fmanager-compare" className="font-semibold text-red-100 underline underline-offset-4">
                    Sign in
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}

          {loading ? (
            <div className="mt-6">
              <LoadingState phase={loadingPhase} />
            </div>
          ) : null}

          {!loading && result && currentComparison ? (
            <div className="mt-6 space-y-6">
              <section
                className={`rounded-[32px] border p-5 sm:p-6 ${
                  currentComparison.winner === 'TIE'
                    ? 'border-cyan-400/20 bg-[linear-gradient(135deg,rgba(124,58,237,0.18),rgba(34,211,238,0.10))]'
                    : 'border-white/8 bg-[#0c0c1e]'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                      {[
                        {
                          key: 'a',
                          winner: currentComparison.winner === 'A',
                          loser: currentComparison.winner === 'B',
                          name: currentComparison.manager_a.username,
                          role: currentComparison.manager_a.role ?? 'member',
                          grade: currentComparison.manager_a.overall_grade,
                        },
                        {
                          key: 'b',
                          winner: currentComparison.winner === 'B',
                          loser: currentComparison.winner === 'A',
                          name: currentComparison.manager_b.username,
                          role: currentComparison.manager_b.role ?? 'member',
                          grade: currentComparison.manager_b.overall_grade,
                        },
                      ].map((item, index) => {
                        const tone = gradeTone(item.grade)
                        return (
                          <div
                            key={item.key}
                            className={`rounded-[24px] border px-4 py-5 transition-all ${
                              item.winner
                                ? 'border-green-500/30 bg-green-500/10'
                                : item.loser
                                  ? 'border-white/10 bg-white/[0.03] opacity-60'
                                  : 'border-white/10 bg-white/[0.03]'
                            }`}
                            style={item.winner ? { boxShadow: '0 0 0 1px rgba(34,197,94,0.12), 0 18px 40px rgba(34,197,94,0.18)' } : undefined}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">{index === 0 ? 'Manager A' : 'Manager B'}</div>
                                <div className="mt-2 flex items-center gap-2">
                                  <div className="text-2xl font-black text-white">{item.name}</div>
                                  <ManagerRoleBadge role={item.role} />
                                </div>
                              </div>
                              <span className={`rounded-full border px-3 py-1 text-sm font-black ${tone.pill}`}>{item.grade}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    <div className="my-4 flex items-center justify-center text-center text-lg font-black uppercase tracking-[0.3em] text-white/55">
                      {currentComparison.winner === 'A'
                        ? `${currentComparison.manager_a.username} beats ${currentComparison.manager_b.username}`
                        : currentComparison.winner === 'B'
                          ? `${currentComparison.manager_b.username} beats ${currentComparison.manager_a.username}`
                          : currentComparison.winner === 'TIE'
                            ? 'Dead even'
                            : 'Individually graded'}
                    </div>

                    <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-5">
                      <p className="text-base leading-7 text-white/85">"{currentComparison.verdict}"</p>
                      <div className="mt-4 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-white/75">Edge: {edgeText}</span>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-white/75">Confidence: {confidenceText}</span>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-white/75">{currentComparison.margin}</span>
                      </div>
                      {confidenceText.toLowerCase() === 'low' ? (
                        <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                          ⚠️ Not enough data for a definitive verdict
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="shrink-0">
                    <button
                      type="button"
                      onClick={handleShare}
                      className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/80 hover:border-white/20 hover:text-white"
                    >
                      {copiedShare ? 'Copied' : 'Share this comparison'}
                    </button>
                  </div>
                </div>
              </section>

              <>
                  <section className="grid gap-6 xl:grid-cols-2">
                    <ManagerSummaryCard
                      title="Manager A"
                      manager={currentComparison.manager_a}
                      snapshot={result.snapshots.a}
                      activeStats={statsA}
                      formats={selectedFormats}
                    />
                    <ManagerSummaryCard
                      title="Manager B"
                      manager={currentComparison.manager_b}
                      snapshot={result.snapshots.b}
                      activeStats={statsB}
                      formats={selectedFormats}
                    />
                  </section>

                  <section className="rounded-[28px] border border-white/8 bg-[#0c0c1e] p-5 sm:p-6">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">Format winners</div>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      {FORMAT_ORDER.filter((format) => selectedFormats[format]).map((format) => {
                        const winner = currentComparison.head_to_head_breakdown[`${format}_winner` as keyof HeadToHeadBreakdown]
                        return (
                          <div key={format} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                            <div className="text-sm font-semibold text-white">{FORMAT_LABELS[format]}</div>
                            <div className="mt-3 rounded-full border border-white/10 bg-[#07071a] px-3 py-2 text-xs font-bold uppercase tracking-[0.2em] text-white/75">
                              {formatWinnerLabel(winner, currentComparison.manager_a.username, currentComparison.manager_b.username)}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </section>

                  <section className="grid gap-4 xl:grid-cols-3">
                    <StatBarRow
                      label="Overall Win Rate"
                      leftLabel={currentComparison.manager_a.username}
                      leftValue={statsA.winRate}
                      rightLabel={currentComparison.manager_b.username}
                      rightValue={statsB.winRate}
                      leftDisplay={`${statsA.winRate}%`}
                      rightDisplay={`${statsB.winRate}%`}
                      animate={animateBars}
                    />
                    <StatBarRow
                      label="Championship Rate"
                      leftLabel={currentComparison.manager_a.username}
                      leftValue={statsA.championshipRate}
                      rightLabel={currentComparison.manager_b.username}
                      rightValue={statsB.championshipRate}
                      leftDisplay={`${statsA.championshipRate}%`}
                      rightDisplay={`${statsB.championshipRate}%`}
                      animate={animateBars}
                    />
                    <StatBarRow
                      label="Leagues Played"
                      leftLabel={currentComparison.manager_a.username}
                      leftValue={statsA.leagues}
                      rightLabel={currentComparison.manager_b.username}
                      rightValue={statsB.leagues}
                      leftDisplay={`${statsA.leagues} leagues`}
                      rightDisplay={`${statsB.leagues} leagues`}
                      animate={animateBars}
                    />
                  </section>

                  {currentComparison.trash_talk ? (
                    <section className="rounded-[28px] border border-amber-500/20 bg-amber-500/10 p-5 sm:p-6">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-200">Trash Talk</div>
                      <p className="mt-3 text-sm leading-6 text-amber-100/90">{currentComparison.trash_talk}</p>
                    </section>
                  ) : null}
              </>
            </div>
          ) : null}

          {!loading && !result ? (
            <div className="mt-6">
              <EmptyPanel
                title="Ready to compare two managers"
                body="Enter two Sleeper usernames, choose the formats you care about, and run a head-to-head comparison of their records, titles and grades by format."
              />
            </div>
          ) : null}
        </div>

        <SeoLandingFooter />
      </main>
    </>
  )
}
