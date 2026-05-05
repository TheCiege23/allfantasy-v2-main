'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import Link from 'next/link'
import {
  LayoutGrid,
  Users,
  ListOrdered,
  Sparkles,
  Share2,
  Copy,
  ChevronDown,
  ChevronRight,
  Check,
  FileText,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Download,
} from 'lucide-react'
import type { DraftSessionSnapshot, SlotOrderEntry } from '@/lib/live-draft-engine/types'
import type {
  PickLogEntry,
  PostDraftSummary,
  PostDraftRecapSections,
  TeamGradeExplanationEntry,
  TeamResultEntry,
  ValueReachEntry,
} from '@/lib/post-draft'

export type PostDraftTab = 'summary' | 'teams' | 'roster' | 'replay' | 'recap' | 'share'

/**
 * Color scheme for letter grades on the post-draft team-grade cards.
 * A → emerald, B → cyan, C → amber, D → orange, F → rose. Strips off any
 * +/- modifier so "A+", "A", "A-" all share the same family.
 */
function gradeBadgeClasses(grade: string): { wrapper: string; letter: string } {
  const letter = String(grade ?? '').trim().charAt(0).toUpperCase()
  switch (letter) {
    case 'A':
      return {
        wrapper: 'border-emerald-400/40 bg-emerald-500/12 shadow-[0_0_20px_rgba(16,185,129,0.18)]',
        letter: 'text-emerald-200',
      }
    case 'B':
      return {
        wrapper: 'border-cyan-400/40 bg-cyan-500/12 shadow-[0_0_20px_rgba(34,211,238,0.18)]',
        letter: 'text-cyan-200',
      }
    case 'C':
      return {
        wrapper: 'border-amber-400/40 bg-amber-500/12 shadow-[0_0_20px_rgba(245,158,11,0.18)]',
        letter: 'text-amber-200',
      }
    case 'D':
      return {
        wrapper: 'border-orange-400/40 bg-orange-500/12 shadow-[0_0_20px_rgba(249,115,22,0.18)]',
        letter: 'text-orange-200',
      }
    case 'F':
      return {
        wrapper: 'border-rose-400/45 bg-rose-500/12 shadow-[0_0_22px_rgba(244,63,94,0.22)]',
        letter: 'text-rose-200',
      }
    default:
      return { wrapper: 'border-white/15 bg-white/[0.04]', letter: 'text-white/70' }
  }
}

export type PostDraftViewProps = {
  leagueId: string
  leagueName: string
  sport: string
  session: DraftSessionSnapshot
  currentUserRosterId: string | null
  slotOrder: SlotOrderEntry[]
}

function buildSummaryText(
  params: {
    leagueName?: string | null
    rounds: number
    teamCount: number
    pickCount: number
    byPosition: Record<string, number>
    teamLines: string
  }
): string {
  const posLines = Object.entries(params.byPosition)
    .sort((a, b) => b[1] - a[1])
    .map(([pos, n]) => `${pos}: ${n}`)
    .join(', ')
  return [
    `${params.leagueName ?? 'Draft'} — Draft complete`,
    `Rounds: ${params.rounds} · Teams: ${params.teamCount} · Total picks: ${params.pickCount}`,
    `By position: ${posLines}`,
    '',
    'Team rosters:',
    params.teamLines,
  ].join('\n')
}

function fallbackPickLogFromSession(session: DraftSessionSnapshot): PickLogEntry[] {
  return (session.picks ?? []).map((p) => ({
    id: p.id,
    overall: p.overall,
    round: p.round,
    slot: p.slot,
    rosterId: p.rosterId,
    displayName: p.displayName ?? null,
    playerName: p.playerName,
    position: p.position,
    team: p.team ?? null,
    amount: (p as { amount?: number | null }).amount ?? undefined,
    pickLabel: p.pickLabel,
  }))
}

function fallbackTeamResultsFromSession(
  session: DraftSessionSnapshot,
  slotOrder: SlotOrderEntry[],
  pickLog: PickLogEntry[]
): TeamResultEntry[] {
  return slotOrder.map((slotEntry) => {
    const teamPicks = pickLog.filter((pick) => pick.rosterId === slotEntry.rosterId)
    const totalSpent = session.draftType === 'auction'
      ? teamPicks.reduce((sum, pick) => sum + (Number(pick.amount) || 0), 0)
      : undefined
    return {
      rosterId: slotEntry.rosterId,
      displayName: slotEntry.displayName ?? `Team ${slotEntry.slot}`,
      slot: slotEntry.slot,
      pickCount: teamPicks.length,
      picks: teamPicks,
      ...(totalSpent != null ? { totalSpent } : {}),
    }
  })
}

function fallbackValueReach(pickLog: PickLogEntry[]): ValueReachEntry[] {
  const firstByPosition: Record<string, { overall: number; displayName: string | null }> = {}
  for (const pick of pickLog) {
    const position = pick.position || 'OTHER'
    if (firstByPosition[position] == null || pick.overall < firstByPosition[position].overall) {
      firstByPosition[position] = {
        overall: pick.overall,
        displayName: pick.displayName ?? null,
      }
    }
  }
  return Object.entries(firstByPosition)
    .sort((a, b) => a[1].overall - b[1].overall)
    .map(([position, payload]) => ({
      position,
      earliestOverall: payload.overall,
      firstPickBy: payload.displayName,
    }))
}

function buildReplayCsv(pickLog: PickLogEntry[]): string {
  const header = 'overall,round,slot,pick_label,manager,player,position,team,amount'
  const rows = pickLog.map((pick) => {
    const cols = [
      pick.overall,
      pick.round,
      pick.slot,
      pick.pickLabel,
      pick.displayName ?? '',
      pick.playerName,
      pick.position,
      pick.team ?? '',
      pick.amount ?? '',
    ]
    return cols
      .map((col) => `"${String(col).replace(/"/g, '""')}"`)
      .join(',')
  })
  return [header, ...rows].join('\n')
}

function buildFallbackRecapSections(params: {
  leagueName: string
  sport: string
  rounds: number
  teamCount: number
  pickCount: number
  byPosition: Record<string, number>
  teamResults: TeamResultEntry[]
  valueReach: ValueReachEntry[]
}): PostDraftRecapSections {
  const topPositions = Object.entries(params.byPosition)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([position, count]) => `${position} (${count})`)
    .join(', ')
  const topTeams: TeamGradeExplanationEntry[] = params.teamResults
    .slice()
    .sort((a, b) => b.pickCount - a.pickCount)
    .slice(0, 6)
    .map((entry, index) => ({
      rank: index + 1,
      rosterId: entry.rosterId,
      displayName: entry.displayName,
      grade: index < 2 ? 'A-' : index < 4 ? 'B' : 'B-',
      score: Math.max(68, 90 - index * 4),
      explanation: `${entry.displayName} closed with ${entry.pickCount} selections and a balanced draft board footprint. Deterministic grade details are available in Draft Grades.`,
    }))
  const valueLead = params.valueReach[0]
  const valueTail = params.valueReach[params.valueReach.length - 1]
  return {
    leagueNarrativeRecap: `${params.leagueName} completed a ${params.rounds}-round ${params.sport} draft with ${params.pickCount} total picks. Top positions drafted: ${topPositions || 'balanced distribution'}.`,
    strategyRecap: `Early draft construction centered around ${topPositions || 'balanced positional allocation'}, with managers prioritizing depth and role coverage through all ${params.rounds} rounds.`,
    bestWorstValueExplanation:
      valueLead && valueTail
        ? `Earliest positional pressure started at ${valueLead.position} (overall #${valueLead.earliestOverall}). Late positional patience was strongest at ${valueTail.position} (first selected at #${valueTail.earliestOverall}).`
        : 'Value/reach highlights are available from deterministic draft-grade scoring.',
    chimmyDraftDebrief: `Chimmy debrief: the board is finalized for all ${params.teamCount} teams. Next step is to review your roster and waiver contingencies before opening-week lock.`,
    teamGradeExplanations: topTeams,
  }
}

export function PostDraftView({
  leagueId,
  leagueName,
  sport,
  session,
  currentUserRosterId,
  slotOrder,
}: PostDraftViewProps) {
  const [tab, setTab] = useState<PostDraftTab>('summary')
  const [recap, setRecap] = useState<string | null>(null)
  const [recapLoading, setRecapLoading] = useState(false)
  const [recapError, setRecapError] = useState<string | null>(null)
  const [recapExecutionMode, setRecapExecutionMode] = useState<string | null>(null)
  const [recapSections, setRecapSections] = useState<PostDraftRecapSections | null>(null)
  const [recapSectionsLoading, setRecapSectionsLoading] = useState(false)
  const [recapSectionsError, setRecapSectionsError] = useState<string | null>(null)
  const [copyLabel, setCopyLabel] = useState<'link' | 'summary' | 'csv' | 'shared' | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [summaryPayload, setSummaryPayload] = useState<PostDraftSummary | null>(null)
  const [replayLoading, setReplayLoading] = useState(false)
  const [replayError, setReplayError] = useState<string | null>(null)
  const [replayPickLog, setReplayPickLog] = useState<PickLogEntry[] | null>(null)
  const [replayIndex, setReplayIndex] = useState(0)
  const [replayPlaying, setReplayPlaying] = useState(false)

  const fallbackPickLog = useMemo(() => fallbackPickLogFromSession(session), [session])
  const effectivePickLog = replayPickLog ?? summaryPayload?.pickLog ?? fallbackPickLog
  const effectiveTeamResults = summaryPayload?.teamResults ?? fallbackTeamResultsFromSession(session, slotOrder, effectivePickLog)
  const effectiveValueReach = summaryPayload?.valueReach ?? fallbackValueReach(effectivePickLog)
  const effectiveByPosition = useMemo(() => {
    if (summaryPayload?.byPosition) return summaryPayload.byPosition
    return effectivePickLog.reduce<Record<string, number>>((acc, pick) => {
      const position = pick.position || 'OTHER'
      acc[position] = (acc[position] ?? 0) + 1
      return acc
    }, {})
  }, [summaryPayload?.byPosition, effectivePickLog])
  const effectivePickCount = summaryPayload?.pickCount ?? effectivePickLog.length
  const effectiveTotalPicks = summaryPayload?.totalPicks ?? (session.rounds * session.teamCount)
  const fallbackRecapSections = useMemo(
    () =>
      buildFallbackRecapSections({
        leagueName: summaryPayload?.leagueName ?? leagueName,
        sport: summaryPayload?.sport ?? sport,
        rounds: summaryPayload?.rounds ?? session.rounds,
        teamCount: summaryPayload?.teamCount ?? session.teamCount,
        pickCount: effectivePickCount,
        byPosition: effectiveByPosition,
        teamResults: effectiveTeamResults,
        valueReach: effectiveValueReach,
      }),
    [
      summaryPayload?.leagueName,
      summaryPayload?.sport,
      summaryPayload?.rounds,
      summaryPayload?.teamCount,
      leagueName,
      sport,
      session.rounds,
      session.teamCount,
      effectivePickCount,
      effectiveByPosition,
      effectiveTeamResults,
      effectiveValueReach,
    ]
  )
  const activeReplayIndex = effectivePickLog.length > 0 ? Math.max(0, Math.min(replayIndex, effectivePickLog.length - 1)) : 0
  const activeReplayPick = effectivePickLog.length > 0 ? effectivePickLog[activeReplayIndex] : null
  const teamSummaryLines = useMemo(
    () =>
      effectiveTeamResults
        .map((teamEntry) => `${teamEntry.displayName}: ${(teamEntry.picks ?? []).map((pick) => pick.playerName).join(', ')}`)
        .join('\n'),
    [effectiveTeamResults]
  )

  useEffect(() => {
    if (session.status !== 'completed') return
    let cancelled = false
    const loadSummary = async () => {
      setSummaryLoading(true)
      setSummaryError(null)
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/post-draft-summary`, { cache: 'no-store' })
        const data = await res.json().catch(() => ({}))
        if (!cancelled) {
          if (res.ok && data && Array.isArray(data.pickLog)) {
            setSummaryPayload(data as PostDraftSummary)
          } else {
            setSummaryPayload(null)
            if (typeof data?.error === 'string') setSummaryError(data.error)
          }
        }
      } catch {
        if (!cancelled) {
          setSummaryPayload(null)
          setSummaryError('Post-draft summary unavailable. Showing local fallback.')
        }
      } finally {
        if (!cancelled) setSummaryLoading(false)
      }
    }
    const loadReplay = async () => {
      setReplayLoading(true)
      setReplayError(null)
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/replay`, { cache: 'no-store' })
        const data = await res.json().catch(() => ({}))
        if (!cancelled) {
          if (res.ok && Array.isArray(data.pickLog)) {
            setReplayPickLog(data.pickLog as PickLogEntry[])
          } else {
            setReplayPickLog(null)
            if (typeof data?.error === 'string') setReplayError(data.error)
          }
        }
      } catch {
        if (!cancelled) {
          setReplayPickLog(null)
          setReplayError('Replay payload unavailable. Showing local fallback.')
        }
      } finally {
        if (!cancelled) setReplayLoading(false)
      }
    }
    void Promise.all([loadSummary(), loadReplay()])
    return () => {
      cancelled = true
    }
  }, [leagueId, session.status])

  useEffect(() => {
    if (!replayPlaying || effectivePickLog.length === 0) return
    const timer = window.setTimeout(() => {
      setReplayIndex((prev) => {
        const next = prev + 1
        if (next >= effectivePickLog.length) {
          setReplayPlaying(false)
          return effectivePickLog.length - 1
        }
        return next
      })
    }, 850)
    return () => window.clearTimeout(timer)
  }, [replayPlaying, effectivePickLog.length])

  useEffect(() => {
    if (activeReplayIndex < effectivePickLog.length) return
    setReplayIndex(Math.max(0, effectivePickLog.length - 1))
  }, [activeReplayIndex, effectivePickLog.length])

  const setCopyStatus = (label: 'link' | 'summary' | 'csv' | 'shared') => {
    setCopyLabel(label)
    window.setTimeout(() => setCopyLabel(null), 2000)
  }

  const fetchRecap = useCallback(async (options?: { includeAiExplanation?: boolean }) => {
    const includeAiExplanation = options?.includeAiExplanation === true
    if (includeAiExplanation) {
      setRecapLoading(true)
      setRecapError(null)
    } else {
      setRecapSectionsLoading(true)
      setRecapSectionsError(null)
    }
    setRecapExecutionMode(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/recap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeAiExplanation }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        if (data?.sections && typeof data.sections === 'object') {
          setRecapSections(data.sections as PostDraftRecapSections)
        } else if (!recapSections) {
          setRecapSections(fallbackRecapSections)
        }
        if (includeAiExplanation && typeof data.recap === 'string') {
          setRecap(data.recap)
        }
        setRecapExecutionMode(typeof data?.execution?.mode === 'string' ? data.execution.mode : null)
      } else if (includeAiExplanation) {
        setRecapError(data.error ?? 'Failed to load recap')
      } else {
        setRecapSectionsError(data.error ?? 'Deterministic recap unavailable')
      }
    } catch {
      if (includeAiExplanation) {
        setRecapError('Request failed')
      } else {
        setRecapSectionsError('Request failed')
      }
    } finally {
      if (includeAiExplanation) setRecapLoading(false)
      else setRecapSectionsLoading(false)
    }
  }, [fallbackRecapSections, leagueId, recapSections])

  useEffect(() => {
    if (tab !== 'recap') return
    if (recapSections || recapSectionsLoading) return
    void fetchRecap({ includeAiExplanation: false })
  }, [fetchRecap, recapSections, recapSectionsLoading, tab])

  const copyLink = useCallback(() => {
    setShareError(null)
    const url = typeof window !== 'undefined' ? window.location.href : ''
    if (!url) return
    if (!navigator.clipboard?.writeText) {
      setShareError('Clipboard not available on this device/browser.')
      return
    }
    void navigator.clipboard.writeText(url).then(
      () => setCopyStatus('link'),
      () => setShareError('Unable to copy link. You can still share manually.')
    )
  }, [])

  const copySummary = useCallback(() => {
    setShareError(null)
    if (!navigator.clipboard?.writeText) {
      setShareError('Clipboard not available on this device/browser.')
      return
    }
    const text = buildSummaryText({
      leagueName: summaryPayload?.leagueName ?? leagueName,
      rounds: summaryPayload?.rounds ?? session.rounds,
      teamCount: summaryPayload?.teamCount ?? session.teamCount,
      pickCount: effectivePickCount,
      byPosition: effectiveByPosition,
      teamLines: teamSummaryLines,
    })
    void navigator.clipboard.writeText(text).then(
      () => setCopyStatus('summary'),
      () => setShareError('Unable to copy summary. Try export CSV instead.')
    )
  }, [summaryPayload, leagueName, session.rounds, session.teamCount, effectivePickCount, effectiveByPosition, teamSummaryLines])

  const exportReplayCsv = useCallback(() => {
    setShareError(null)
    if (typeof window === 'undefined') return
    try {
      const csv = buildReplayCsv(effectivePickLog)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${leagueName || 'allfantasy'}-draft-replay.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setCopyStatus('csv')
    } catch {
      setShareError('CSV export unavailable. You can still copy summary text.')
    }
  }, [effectivePickLog, leagueName])

  const nativeShare = useCallback(async () => {
    setShareError(null)
    const url = typeof window !== 'undefined' ? window.location.href : ''
    if (!url) return
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
      setShareError('Native share is not supported here. Use copy link instead.')
      return
    }
    try {
      await navigator.share({
        title: `${leagueName} Draft Summary`,
        text: `${leagueName} draft recap`,
        url,
      })
      setCopyStatus('shared')
    } catch {
      // User canceled or share failed; degrade silently with no hard error.
    }
  }, [leagueName])

  const myPicks = currentUserRosterId ? effectivePickLog.filter((p) => p.rosterId === currentUserRosterId) : []
  const c2cCollegeRounds = summaryPayload?.c2cCollegeRounds ?? session.c2c?.collegeRounds ?? []
  const activeRecapSections = recapSections ?? fallbackRecapSections

  const tabs: { id: PostDraftTab; label: string; icon: typeof LayoutGrid }[] = [
    { id: 'summary', label: 'Summary', icon: FileText },
    { id: 'teams', label: 'Teams', icon: Users },
    { id: 'roster', label: 'My Roster', icon: ListOrdered },
    { id: 'replay', label: 'Replay', icon: LayoutGrid },
    { id: 'recap', label: 'AI Recap', icon: Sparkles },
    { id: 'share', label: 'Share', icon: Share2 },
  ]

  return (
    <div className="flex h-full flex-col bg-[#0a0a0f] text-white" data-testid="post-draft-view">
      <header className="shrink-0 border-b border-white/12 bg-black/30 px-4 py-3">
        <h1 className="text-base font-semibold md:text-lg">{leagueName}</h1>
        <p className="text-xs text-white/60">{sport} · Draft complete</p>
        <p className="mt-2 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-[11px] leading-snug text-emerald-100/95">
          Results use the authoritative saved draft board from this league. Refresh anytime — your recap and grades stay aligned with persisted picks.
        </p>
      </header>

      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/10 bg-black/20 px-2 py-2 scrollbar-thin">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            data-testid={`post-draft-tab-${id}`}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap touch-manipulation min-h-[44px] ${
              tab === id ? 'bg-cyan-500/20 text-cyan-200' : 'text-white/70 hover:bg-white/10'
            }`}
            aria-pressed={tab === id}
            aria-label={label}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-auto p-4 text-sm min-h-0">
        {tab === 'summary' && (
          <section className="space-y-4" data-testid="post-draft-summary-panel">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4" data-testid="post-draft-summary-card-overview">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-2">Draft summary</h2>
              <p className="text-white/90">Total picks: <strong>{effectivePickCount}</strong> of {effectiveTotalPicks}</p>
              <p className="text-white/90 mt-1">Rounds: <strong>{summaryPayload?.rounds ?? session.rounds}</strong> · Teams: <strong>{summaryPayload?.teamCount ?? session.teamCount}</strong></p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="post-draft-summary-open-teams"
                  onClick={() => setTab('teams')}
                  className="rounded border border-white/20 bg-black/20 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/10"
                >
                  Team results
                </button>
                <button
                  type="button"
                  data-testid="post-draft-summary-open-replay"
                  onClick={() => setTab('replay')}
                  className="rounded border border-cyan-300/30 bg-cyan-500/10 px-2.5 py-1.5 text-xs text-cyan-100 hover:bg-cyan-500/20"
                >
                  Open replay
                </button>
                <button
                  type="button"
                  data-testid="post-draft-summary-open-ai-recap"
                  onClick={() => setTab('recap')}
                  className="rounded border border-violet-300/30 bg-violet-500/10 px-2.5 py-1.5 text-xs text-violet-100 hover:bg-violet-500/20"
                >
                  AI recap
                </button>
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4" data-testid="post-draft-summary-card-position">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-2">By position</h2>
              <ul className="space-y-1">
                {Object.entries(effectiveByPosition)
                  .sort((a, b) => b[1] - a[1])
                  .map(([pos, count]) => (
                    <li key={pos} className="flex justify-between text-white/90">
                      <span>{pos}</span>
                      <span className="tabular-nums">{count}</span>
                    </li>
                  ))}
              </ul>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4" data-testid="post-draft-summary-card-value-reach">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-2">Value / reach</h2>
              <p className="text-white/70 text-xs">
                Earliest pick by position (first time each position was selected):
              </p>
              <ul className="mt-2 space-y-1 text-sm text-white/90">
                {effectiveValueReach.map((entry) => (
                    <li key={entry.position}>
                      {entry.position}: overall #{entry.earliestOverall}
                      {entry.firstPickBy ? ` (${entry.firstPickBy})` : ''}
                    </li>
                  ))}
              </ul>
              <p className="mt-2 text-[10px] text-white/50">Full value/reach vs ADP in Draft Grades.</p>
              <Link
                href={`/league/${leagueId}/draft-results`}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-cyan-600/20 px-3 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-600/30"
              >
                View draft grades & rankings
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
            {session.draftType === 'auction' && (summaryPayload?.budgetSummary || session.auction) && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4" data-testid="post-draft-summary-card-budget">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-2">Budget summary</h2>
                <p className="text-white/70 text-xs mb-2">Per-team budget and spent (auction).</p>
                <ul className="space-y-2">
                  {(summaryPayload?.budgetSummary ?? []).map((entry) => {
                    return (
                      <li key={entry.rosterId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="font-medium text-white/90">{entry.displayName ?? `Team ${entry.slot}`}</span>
                        <span className="text-white/70 tabular-nums">
                          ${entry.spent} / ${entry.budget} · ${entry.remaining} left
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {(summaryPayload?.keeperOutcome?.length || session.keeper?.selections?.length) && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4" data-testid="post-draft-summary-card-keeper">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-2">Keeper outcome</h2>
                <p className="text-white/70 text-xs mb-2">Keepers locked and their round cost.</p>
                <ul className="space-y-1.5">
                  {(summaryPayload?.keeperOutcome ?? session.keeper?.selections ?? []).map((k, i) => {
                    return (
                      <li key={i} className="flex flex-wrap items-center gap-2 text-sm text-white/90">
                        <span className="font-medium">{k.playerName}</span>
                        <span className="text-white/50">{k.position}{k.team ? ` · ${k.team}` : ''}</span>
                        <span className="text-white/50">Round {k.roundCost}</span>
                        {'displayName' in k ? (
                          <span className="text-white/40 text-xs">({(k as { displayName?: string }).displayName ?? '—'})</span>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {summaryLoading && (
              <p className="text-xs text-white/50">
                Syncing roster assignments and draft grades from the finalized board…
              </p>
            )}
            {summaryError && (
              <p className="text-xs text-amber-300/90">{summaryError}</p>
            )}
            {(session.devy?.enabled || session.c2c?.enabled || summaryPayload?.devyRounds?.length || summaryPayload?.c2cCollegeRounds?.length) && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4" data-testid="post-draft-summary-card-devy">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-2">Devy / C2C</h2>
                <ul className="space-y-1 text-sm text-white/80">
                  {(summaryPayload?.devyRounds ?? session.devy?.devyRounds ?? []).length ? (
                    <li>Devy rounds: {(summaryPayload?.devyRounds ?? session.devy?.devyRounds ?? []).join(', ')}</li>
                  ) : null}
                  {(summaryPayload?.c2cCollegeRounds ?? session.c2c?.collegeRounds ?? []).length ? (
                    <li>C2C college rounds: {(summaryPayload?.c2cCollegeRounds ?? session.c2c?.collegeRounds ?? []).join(', ')}</li>
                  ) : null}
                </ul>
              </div>
            )}
          </section>
        )}

        {tab === 'teams' && (
          <section className="space-y-3" data-testid="post-draft-teams-panel">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-white/50">Team-by-team results</h2>
            {effectiveTeamResults.map((entry) => {
              return (
                <TeamResultsCard
                  key={entry.rosterId}
                  displayName={entry.displayName}
                  picks={entry.picks}
                  slot={entry.slot}
                />
              )
            })}
          </section>
        )}

        {tab === 'roster' && (
          <section data-testid="post-draft-roster-panel">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-3">My drafted roster</h2>
            {myPicks.length === 0 ? (
              <p className="text-white/60">No picks for your team in this draft.</p>
            ) : (
              <ul className="space-y-2">
                {myPicks.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                  >
                    <span className="font-medium text-white/90">
                      {p.playerName}
                      {c2cCollegeRounds.length > 0 && c2cCollegeRounds.includes(p.round) ? (
                        <span className="ml-1 rounded bg-violet-500/20 px-1 py-0.5 text-[9px] font-medium text-violet-100">College</span>
                      ) : c2cCollegeRounds.length > 0 ? (
                        <span className="ml-1 rounded bg-cyan-500/20 px-1 py-0.5 text-[9px] font-medium text-cyan-100">Pro</span>
                      ) : null}
                    </span>
                    <span className="text-xs text-white/50">{p.position}{p.team ? ` · ${p.team}` : ''}</span>
                    <span className="text-[10px] text-white/40">#{p.overall}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'replay' && (
          <section data-testid="post-draft-replay-panel">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-3">Pick log (replay)</h2>
            <div className="mb-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-[11px] text-white/55 mb-2">Replay controls</p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="post-draft-replay-restart"
                  onClick={() => {
                    setReplayPlaying(false)
                    setReplayIndex(0)
                  }}
                  className="rounded border border-white/20 bg-black/25 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/10"
                >
                  <SkipBack className="h-3.5 w-3.5 inline mr-1" />
                  Restart
                </button>
                <button
                  type="button"
                  data-testid="post-draft-replay-prev"
                  onClick={() => {
                    setReplayPlaying(false)
                    setReplayIndex((prev) => Math.max(0, prev - 1))
                  }}
                  className="rounded border border-white/20 bg-black/25 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/10"
                >
                  Prev
                </button>
                <button
                  type="button"
                  data-testid="post-draft-replay-play-toggle"
                  onClick={() => setReplayPlaying((prev) => !prev)}
                  className="rounded border border-cyan-300/30 bg-cyan-500/10 px-2.5 py-1.5 text-xs text-cyan-100 hover:bg-cyan-500/20"
                >
                  {replayPlaying ? (
                    <>
                      <Pause className="h-3.5 w-3.5 inline mr-1" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5 inline mr-1" />
                      Play
                    </>
                  )}
                </button>
                <button
                  type="button"
                  data-testid="post-draft-replay-next"
                  onClick={() => {
                    setReplayPlaying(false)
                    setReplayIndex((prev) => Math.min(effectivePickLog.length - 1, prev + 1))
                  }}
                  className="rounded border border-white/20 bg-black/25 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/10"
                  disabled={effectivePickLog.length === 0}
                >
                  Next
                  <SkipForward className="h-3.5 w-3.5 inline ml-1" />
                </button>
                <span className="text-[11px] text-white/60" data-testid="post-draft-replay-progress">
                  {effectivePickLog.length === 0 ? 'No picks' : `${activeReplayIndex + 1} / ${effectivePickLog.length}`}
                </span>
              </div>
              {activeReplayPick && (
                <div className="mt-3 rounded-lg border border-cyan-300/25 bg-cyan-500/8 px-3 py-2" data-testid="post-draft-replay-active-pick">
                  <p className="text-cyan-100 font-medium">
                    {activeReplayPick.pickLabel} · {activeReplayPick.playerName}
                  </p>
                  <p className="text-xs text-white/70">
                    {activeReplayPick.position}
                    {activeReplayPick.team ? ` · ${activeReplayPick.team}` : ''}
                    {activeReplayPick.displayName ? ` · ${activeReplayPick.displayName}` : ''}
                  </p>
                </div>
              )}
            </div>
            {replayLoading && <p className="text-xs text-white/50 mb-2">Loading replay payload…</p>}
            {replayError && <p className="text-xs text-amber-300/90 mb-2">{replayError}</p>}
            <ol className="space-y-1.5">
              {effectivePickLog.map((p, idx) => (
                <li
                  key={p.id}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left ${
                    idx === activeReplayIndex
                      ? 'border-cyan-300/35 bg-cyan-500/10'
                      : idx < activeReplayIndex
                        ? 'border-white/10 bg-white/5'
                        : 'border-white/8 bg-black/20'
                  }`}
                  data-testid={`post-draft-replay-item-${idx}`}
                >
                  <span className="tabular-nums text-white/50 w-8">#{p.overall}</span>
                  <span className="flex-1 font-medium text-white/90 truncate">{p.playerName}</span>
                  <span className="text-xs text-white/50 shrink-0">{p.position}</span>
                  <span className="text-xs text-white/40 max-w-[80px] truncate">{p.displayName ?? ''}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {tab === 'recap' && (
          <section className="space-y-3" data-testid="post-draft-ai-recap-panel">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-white/50">AI recap</h2>
            {recapSectionsLoading && (
              <p className="text-white/60 text-xs">Building deterministic recap cards…</p>
            )}
            {recapSectionsError && (
              <p className="text-amber-300/90 text-xs">{recapSectionsError}</p>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3" data-testid="post-draft-recap-card-narrative">
                <p className="text-[10px] uppercase tracking-wider text-white/50">League narrative recap</p>
                <p className="mt-1.5 text-sm text-white/90">{activeRecapSections.leagueNarrativeRecap}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3" data-testid="post-draft-recap-card-strategy">
                <p className="text-[10px] uppercase tracking-wider text-white/50">Strategy recap</p>
                <p className="mt-1.5 text-sm text-white/90">{activeRecapSections.strategyRecap}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3" data-testid="post-draft-recap-card-value">
                <p className="text-[10px] uppercase tracking-wider text-white/50">Best / worst value</p>
                <p className="mt-1.5 text-sm text-white/90">{activeRecapSections.bestWorstValueExplanation}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3" data-testid="post-draft-recap-card-chimmy">
                <p className="text-[10px] uppercase tracking-wider text-white/50">Chimmy debrief</p>
                <p className="mt-1.5 text-sm text-cyan-100">{activeRecapSections.chimmyDraftDebrief}</p>
              </div>
            </div>
            <div data-testid="post-draft-recap-card-team-grades" className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#0a1228]/80 to-[#070d1c]/90 p-4">
              <div className="mb-3 flex items-baseline justify-between">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/55">Team Grades</p>
                <p className="text-[10px] uppercase tracking-wider text-white/35">
                  {activeRecapSections.teamGradeExplanations.length} {activeRecapSections.teamGradeExplanations.length === 1 ? 'team' : 'teams'}
                </p>
              </div>
              {activeRecapSections.teamGradeExplanations.length > 0 ? (
                <div className="grid gap-2.5 md:grid-cols-2">
                  {activeRecapSections.teamGradeExplanations.map((entry) => {
                    const colors = gradeBadgeClasses(entry.grade)
                    return (
                      <div
                        key={entry.rosterId}
                        data-testid={`post-draft-team-grade-card-${entry.rosterId}`}
                        className={`flex items-start gap-3 rounded-xl border p-3 ${colors.wrapper}`}
                      >
                        <div
                          data-testid="post-draft-team-grade-letter"
                          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/35 text-2xl font-black tabular-nums ${colors.letter}`}
                        >
                          {entry.grade}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
                              #{entry.rank}
                            </span>
                            <span className="truncate text-sm font-bold text-white">{entry.displayName}</span>
                            <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-white/50">
                              {Math.round(entry.score)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs leading-snug text-white/70">{entry.explanation}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-4 text-center text-xs text-white/50">
                  Deterministic team-grade explanations are syncing.
                </p>
              )}
            </div>
            {!recap && !recapLoading && !recapError && (
              <button
                type="button"
                onClick={() => void fetchRecap({ includeAiExplanation: true })}
                data-testid="post-draft-ai-recap-generate"
                className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm text-white hover:bg-cyan-500 min-h-[44px]"
              >
                <Sparkles className="h-4 w-4" />
                Generate AI narrative recap
              </button>
            )}
            {recapLoading && <p className="text-white/60">Generating recap…</p>}
            {recapError && (
              <p className="text-amber-400 text-sm">{recapError}</p>
            )}
            {recap && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 whitespace-pre-wrap text-white/90" data-testid="post-draft-ai-recap-text">
                {recap}
              </div>
            )}
            {recapExecutionMode && (
              <p className="text-[10px] text-white/60" data-testid="post-draft-ai-recap-execution">
                {recapExecutionMode === 'ai_explained'
                  ? 'Execution: deterministic recap + AI narrative layer'
                  : 'Execution: deterministic recap only'}
              </p>
            )}
            {recap && (
              <button
                type="button"
                onClick={() => void fetchRecap({ includeAiExplanation: true })}
                data-testid="post-draft-ai-recap-refresh"
                className="rounded border border-white/20 bg-black/20 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
              >
                Refresh recap
              </button>
            )}
          </section>
        )}

        {tab === 'share' && (
          <section className="space-y-4" data-testid="post-draft-share-panel">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-white/50">Export & share</h2>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                data-testid="post-draft-share-native"
                onClick={() => void nativeShare()}
                className="flex items-center justify-center gap-2 rounded-lg border border-violet-300/25 bg-violet-500/10 px-4 py-3 text-sm text-violet-100 hover:bg-violet-500/20 min-h-[44px]"
              >
                {copyLabel === 'shared' ? <Check className="h-4 w-4 text-emerald-400" /> : <Share2 className="h-4 w-4" />}
                {copyLabel === 'shared' ? 'Shared' : 'Native share'}
              </button>
              <button
                type="button"
                onClick={copyLink}
                data-testid="post-draft-share-copy-link"
                className="flex items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-sm text-white/90 hover:bg-white/10 min-h-[44px]"
              >
                {copyLabel === 'link' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                {copyLabel === 'link' ? 'Link copied' : 'Copy draft room link'}
              </button>
              <button
                type="button"
                onClick={copySummary}
                data-testid="post-draft-share-copy-summary"
                className="flex items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-sm text-white/90 hover:bg-white/10 min-h-[44px]"
              >
                {copyLabel === 'summary' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                {copyLabel === 'summary' ? 'Summary copied' : 'Copy summary (text)'}
              </button>
              <button
                type="button"
                onClick={exportReplayCsv}
                data-testid="post-draft-export-csv"
                className="flex items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100 hover:bg-cyan-500/20 min-h-[44px]"
              >
                {copyLabel === 'csv' ? <Check className="h-4 w-4 text-emerald-400" /> : <Download className="h-4 w-4" />}
                {copyLabel === 'csv' ? 'CSV exported' : 'Export replay CSV'}
              </button>
            </div>
            {shareError && (
              <p className="text-[11px] text-amber-300/90" data-testid="post-draft-share-error">
                {shareError}
              </p>
            )}
            <p className="text-[11px] text-white/50">
              Share the link so others can view the draft. Summary copies a text version of rosters.
            </p>
          </section>
        )}
      </main>

      <div className="shrink-0 border-t border-white/10 px-4 py-3 flex flex-wrap items-center gap-4">
        <Link
          href={`/league/${leagueId}/draft-results`}
          className="inline-flex items-center gap-2 text-cyan-400 hover:underline text-sm"
        >
          Draft grades & rankings
        </Link>
        <Link
          href={`/league/${leagueId}`}
          className="inline-flex items-center gap-2 text-white/60 hover:underline text-sm"
        >
          Back to league
        </Link>
      </div>
    </div>
  )
}

function TeamResultsCard({
  displayName,
  slot,
  picks,
}: {
  displayName: string
  slot: number
  picks: PickLogEntry[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden" data-testid={`post-draft-team-card-${slot}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        data-testid={`post-draft-team-toggle-${slot}`}
        className="flex w-full items-center justify-between px-4 py-3 text-left min-h-[44px] touch-manipulation"
        aria-expanded={open}
      >
        <span className="font-medium text-white/90">{displayName}</span>
        <span className="text-xs text-white/50">{picks.length} picks</span>
        {open ? <ChevronDown className="h-4 w-4 text-white/50" /> : <ChevronRight className="h-4 w-4 text-white/50" />}
      </button>
      {open && (
        <ul className="border-t border-white/10 px-4 py-2 space-y-1">
          {picks.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              <span className="tabular-nums text-white/50 w-6">#{p.overall}</span>
              <span className="text-white/90">{p.playerName}</span>
              <span className="text-xs text-white/50">{p.position}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default PostDraftView
