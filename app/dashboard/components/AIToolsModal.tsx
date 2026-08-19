'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { UserLeague } from '@/app/dashboard/types'
import { getChimmyChatHrefWithPrompt } from '@/lib/ai-product-layer/UnifiedChimmyEntryResolver'
import { SUPPORTED_SPORTS, isSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import type { MatchupPrepDashboardResult } from '@/lib/matchup-prep-dashboard/types'
import type { LongTermCoachingAnalysis } from '@/lib/long-term-coaching/types'
type LineupIssue = { type: string; message: string; severity: string }
type LineupCheckLeague = {
  leagueId: string
  leagueName: string
  issues: LineupIssue[]
  chimmyAdvice: string
}
type LineupCheckResult = { leagues: LineupCheckLeague[] }

export type DashboardAIToolId =
  | 'startSit'
  | 'trade'
  | 'waiver'
  | 'trending'
  | 'power'
  | 'injury'
  | 'warRoom'
  | 'matchupPrep'
  | 'longTermCoach'

type SportFilter = 'ALL' | SupportedSport

type AIToolsModalProps = {
  toolId: DashboardAIToolId | null
  open: boolean
  onClose: () => void
  leagues: UserLeague[]
  toolTitle: string
}

function filterLeagues(leagues: UserLeague[], sport: SportFilter): UserLeague[] {
  if (sport === 'ALL') return leagues
  return leagues.filter((l) => l.sport === sport)
}

export function AIToolsModal({ toolId, open, onClose, leagues, toolTitle }: AIToolsModalProps) {
  const [sport, setSport] = useState<SportFilter>('ALL')
  const [leagueId, setLeagueId] = useState<string>('')
  /** Bumped by the header refresh control so tool bodies refetch. */
  const [refreshTick, setRefreshTick] = useState(0)

  const filteredLeagues = useMemo(() => filterLeagues(leagues, sport), [leagues, sport])

  useEffect(() => {
    if (!open) return
    const first = filteredLeagues[0]?.id ?? ''
    if (!leagueId || !filteredLeagues.some((l) => l.id === leagueId)) {
      setLeagueId(first)
    }
  }, [open, filteredLeagues, leagueId])

  useEffect(() => {
    setRefreshTick(0)
  }, [toolId])

  const selectedLeague = useMemo(
    () => filteredLeagues.find((l) => l.id === leagueId) ?? filteredLeagues[0] ?? null,
    [filteredLeagues, leagueId],
  )

  const chimmyContext = useMemo(
    () => ({
      leagueId: selectedLeague?.id,
      leagueName: selectedLeague?.name,
      sport: sport === 'ALL' ? undefined : sport,
      source: 'dashboard' as const,
    }),
    [selectedLeague, sport],
  )

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[min(90vh,720px)] max-w-lg overflow-y-auto border border-white/10 bg-[#0a1220] text-white sm:max-w-xl">
        <DialogHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pr-8">
          <DialogTitle className="text-left text-lg font-bold text-white">{toolTitle}</DialogTitle>
          <button
            type="button"
            onClick={() => setRefreshTick((n) => n + 1)}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] font-semibold text-cyan-200/90 transition hover:bg-white/[0.08]"
            aria-label="Refresh"
            title="Refresh"
            data-testid="ai-tools-modal-refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-white/45">
              Sport
              <select
                value={sport}
                onChange={(e) => {
                  const v = e.target.value as SportFilter
                  setSport(v)
                  setLeagueId('')
                }}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-[13px] text-white"
                data-testid="ai-tools-modal-sport"
              >
                <option value="ALL">All sports</option>
                {SUPPORTED_SPORTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            {(toolId === 'startSit' ||
              toolId === 'trade' ||
              toolId === 'waiver' ||
              toolId === 'power' ||
              toolId === 'matchupPrep' ||
              toolId === 'longTermCoach') && (
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-white/45">
                League
                <select
                  value={selectedLeague?.id ?? ''}
                  onChange={(e) => setLeagueId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-[13px] text-white"
                  data-testid="ai-tools-modal-league"
                >
                  {filteredLeagues.length === 0 ? (
                    <option value="">No leagues for this sport</option>
                  ) : (
                    filteredLeagues.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
            )}
          </div>

          {toolId ? (
            <ToolBody
              toolId={toolId}
              sport={sport}
              leagueId={selectedLeague?.id ?? ''}
              leagueName={selectedLeague?.name ?? 'my league'}
              hasLeague={Boolean(selectedLeague)}
              refreshTick={refreshTick}
            />
          ) : null}
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="outline" onClick={onClose} className="border-white/15 text-white/80">
            Close
          </Button>
          <div className="flex flex-wrap gap-2">
            {toolId === 'trade' ? (
              <Link
                href={selectedLeague ? `/trade-evaluator?leagueId=${encodeURIComponent(selectedLeague.id)}` : '/trade-evaluator'}
                className="inline-flex items-center justify-center rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-[13px] font-semibold text-cyan-200 hover:bg-cyan-500/20"
              >
                Open AI Trade Analyzer
              </Link>
            ) : null}
            {toolId === 'warRoom' ? (
              <Link
                href="/war-room"
                className="inline-flex items-center justify-center rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[13px] font-semibold text-amber-100 hover:bg-amber-500/20"
              >
                AF Legacy details
              </Link>
            ) : null}
            {toolId === 'matchupPrep' ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('af-open-ai-tool', { detail: { tool: 'matchupPrep' } }))
                    onClose()
                  }}
                  className="inline-flex items-center justify-center rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-[13px] font-semibold text-sky-100 hover:bg-sky-500/20"
                  data-testid="ai-tools-modal-open-matchup-prep-full"
                >
                  Open full Matchup Prep
                </button>
                <Link
                  href={sport !== 'ALL' ? `/matchup-simulator?sport=${sport}` : '/matchup-simulator'}
                  className="inline-flex items-center justify-center rounded-lg border border-violet-500/35 bg-violet-500/10 px-3 py-2 text-[13px] font-semibold text-violet-100 hover:bg-violet-500/20"
                >
                  Matchup simulator
                </Link>
              </>
            ) : null}
            {toolId === 'longTermCoach' ? (
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent('af-open-ai-tool', {
                      detail: {
                        tool: 'longTermCoach',
                        ...(selectedLeague?.id ? { focusLeagueId: selectedLeague.id } : {}),
                      },
                    }),
                  )
                  onClose()
                }}
                className="inline-flex items-center justify-center rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-[13px] font-semibold text-violet-100 hover:bg-violet-500/20"
                data-testid="ai-tools-modal-open-long-term-coach-full"
              >
                Open full Long-Term Coach
              </button>
            ) : null}
            <Link
              href={getChimmyChatHrefWithPrompt(buildAskPrompt(toolId, selectedLeague?.name ?? 'my league', sport), chimmyContext)}
              className="inline-flex items-center justify-center rounded-lg bg-cyan-500/90 px-4 py-2 text-[13px] font-bold text-black hover:bg-cyan-400"
              data-testid="ai-tools-modal-ask-chimmy"
            >
              Ask Chimmy
            </Link>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function buildAskPrompt(
  toolId: DashboardAIToolId | null,
  leagueLabel: string,
  sport: SportFilter,
): string {
  const sportBit = sport === 'ALL' ? 'across my sports' : `for ${sport}`
  switch (toolId) {
    case 'startSit':
      return `Help me with start/sit ${sportBit} in ${leagueLabel}. Use my league scoring and this week's matchups.`
    case 'trade':
      return `Evaluate trade value and fairness ${sportBit} for ${leagueLabel}. Walk through both sides and rest-of-season outlook.`
    case 'waiver':
      return `Waiver wire: who should I target ${sportBit} in ${leagueLabel}? Prioritize realistic adds and FAAB sense.`
    case 'trending':
      return `Summarize the top trending players ${sportBit} and who is rising or falling in value.`
    case 'power':
      return `Power rankings breakdown for ${leagueLabel} ${sportBit}: strength scores, schedule, and biggest movers.`
    case 'injury':
      return `Injury impact ${sportBit}: summarize the most important injuries for fantasy lineups and waivers this week.`
    case 'warRoom':
      return `Draft prep and multi-year roster planning (AF Legacy): what should I prioritize ${sportBit} in ${leagueLabel}?`
    case 'matchupPrep':
      return `Matchup prep for ${leagueLabel} ${sportBit}: use only my synced league rosters, projections, and opponent data — projected edge, win chance, start/sit pivots, and risks before lineup lock.`
    case 'longTermCoach':
      return `Long-term dynasty / devy / C2C coaching for ${leagueLabel} ${sportBit}: classify my team, title window, pick capital, and a grounded multi-year plan using my real roster and league scoring — no invented timelines.`
    default:
      return `Fantasy strategy help ${sportBit} for ${leagueLabel}.`
  }
}

function ToolBody({
  toolId,
  sport,
  leagueId,
  leagueName,
  hasLeague,
  refreshTick,
}: {
  toolId: DashboardAIToolId
  sport: SportFilter
  leagueId: string
  leagueName: string
  hasLeague: boolean
  refreshTick: number
}) {
  switch (toolId) {
    case 'startSit':
      return (
        <StartSitBody leagueId={leagueId} leagueName={leagueName} hasLeague={hasLeague} refreshTick={refreshTick} />
      )
    case 'trade':
      return <TradeValueBody leagueId={leagueId} hasLeague={hasLeague} refreshTick={refreshTick} />
    case 'waiver':
      return <WaiverBody leagueId={leagueId} hasLeague={hasLeague} refreshTick={refreshTick} />
    case 'trending':
      return <TrendingBody sport={sport} refreshTick={refreshTick} />
    case 'power':
      return <PowerBody leagueId={leagueId} leagueName={leagueName} hasLeague={hasLeague} refreshTick={refreshTick} />
    case 'injury':
      return <InjuryBody sport={sport} refreshTick={refreshTick} />
    case 'warRoom':
      return <WarRoomBody leagueName={leagueName} />
    case 'matchupPrep':
      return (
        <MatchupPrepBody
          leagueId={leagueId}
          leagueName={leagueName}
          hasLeague={hasLeague}
          sport={sport}
          refreshTick={refreshTick}
        />
      )
    case 'longTermCoach':
      return (
        <LongTermCoachingBody leagueId={leagueId} leagueName={leagueName} hasLeague={hasLeague} refreshTick={refreshTick} />
      )
    default:
      return null
  }
}

function StartSitBody({
  leagueId,
  leagueName,
  hasLeague,
  refreshTick,
}: {
  leagueId: string
  leagueName: string
  hasLeague: boolean
  refreshTick: number
}) {
  const [data, setData] = useState<LineupCheckResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setErr(null)
    void fetch('/api/lineup-check', { cache: 'no-store', credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('lineup'))))
      .then((j: LineupCheckResult) => setData(j))
      .catch(() => setErr('Could not load lineup check.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load, leagueId, refreshTick])

  const row: LineupCheckLeague | undefined = data?.leagues?.find((l) => l.leagueId === leagueId)

  if (!hasLeague) {
    return <p className="text-[13px] text-white/55">Connect or select a league to analyze lineups.</p>
  }
  if (loading && !data) {
    return <p className="text-[13px] text-white/50">Loading lineup analysis…</p>
  }
  if (err) {
    return <p className="text-[13px] text-red-300/90">{err}</p>
  }

  return (
    <div className="space-y-2 rounded-xl border border-white/8 bg-black/30 p-3 text-[13px] text-white/80">
      <p className="font-semibold text-white">{leagueName}</p>
      {loading && data ? <p className="text-[11px] text-cyan-200/60">Refreshing…</p> : null}
      {row ? (
        <>
          <p className="text-white/55">
            {row.issues.length === 0 ? 'No lineup issues flagged.' : `${row.issues.length} issue(s)`}
          </p>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-[12px] text-white/65">
            {row.issues.slice(0, 8).map((i, idx) => (
              <li key={idx}>
                [{i.severity}] {i.message}
              </li>
            ))}
          </ul>
          {row.chimmyAdvice ? (
            <p className="border-t border-white/10 pt-2 text-[12px] leading-snug text-cyan-100/95">{row.chimmyAdvice}</p>
          ) : null}
        </>
      ) : (
        <p className="text-white/50">No scan data for this league yet. Try again after sync.</p>
      )}
    </div>
  )
}

function TradeValueBody({
  leagueId,
  hasLeague,
  refreshTick,
}: {
  leagueId: string
  hasLeague: boolean
  refreshTick: number
}) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [insights, setInsights] = useState<{ title: string; description: string; score: number }[]>([])

  useEffect(() => {
    if (!hasLeague || !leagueId) {
      setInsights([])
      return
    }
    setLoading(true)
    setErr(null)
    void fetch('/api/roster/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ leagueId }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('roster'))))
      .then((j: { insights?: typeof insights }) => setInsights(j.insights ?? []))
      .catch(() => setErr('Could not load trade value / roster insights. Sync your league first.'))
      .finally(() => setLoading(false))
  }, [hasLeague, leagueId, refreshTick])

  if (!hasLeague) {
    return <p className="text-[13px] text-white/55">Select a league for roster value analysis (Sports API / FantasyCalc).</p>
  }
  if (loading && insights.length === 0) {
    return <p className="text-[13px] text-white/50">Loading roster value…</p>
  }
  if (err && insights.length === 0) {
    return <p className="text-[13px] text-red-300/90">{err}</p>
  }

  return (
    <div className="space-y-2">
      {loading ? <p className="text-[11px] text-cyan-200/60">Refreshing…</p> : null}
      <ul className="max-h-64 space-y-2 overflow-y-auto text-[12px] text-white/75">
        {insights.length === 0 ? (
          <li className="text-white/45">No insights yet — ensure the league is synced.</li>
        ) : (
          insights.map((i, idx) => (
            <li key={idx} className="rounded-lg border border-white/8 bg-black/25 p-2">
              <span className="font-semibold text-cyan-200/95">{i.title}</span> · {i.score}/100
              <p className="mt-1 text-white/60">{i.description}</p>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}

function WaiverBody({
  leagueId,
  hasLeague,
  refreshTick,
}: {
  leagueId: string
  hasLeague: boolean
  refreshTick: number
}) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<{ playerName: string; reason: string; priority: number }[]>([])

  useEffect(() => {
    if (!hasLeague || !leagueId) {
      setSuggestions([])
      return
    }
    setLoading(true)
    setErr(null)
    void fetch('/api/waiver-ai-suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ leagueId }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('waiver'))))
      .then((j: { suggestions?: typeof suggestions }) => setSuggestions(j.suggestions ?? []))
      .catch(() => setErr('Waiver suggestions unavailable for this league.'))
      .finally(() => setLoading(false))
  }, [hasLeague, leagueId, refreshTick])

  if (!hasLeague) {
    return <p className="text-[13px] text-white/55">Pick a league for waiver AI targets.</p>
  }
  if (loading && suggestions.length === 0) {
    return <p className="text-[13px] text-white/50">Loading waiver suggestions…</p>
  }
  if (err && suggestions.length === 0) {
    return <p className="text-[13px] text-red-300/90">{err}</p>
  }

  return (
    <div className="space-y-2">
      {loading ? <p className="text-[11px] text-cyan-200/60">Refreshing…</p> : null}
      <ol className="max-h-64 list-decimal space-y-2 overflow-y-auto pl-4 text-[12px] text-white/80">
        {suggestions.length === 0 ? (
          <li className="text-white/45">No suggestions returned.</li>
        ) : (
          suggestions.map((s, idx) => (
            <li key={idx}>
              <span className="font-semibold text-white">{s.playerName}</span> (prio {s.priority})
              <p className="text-white/55">{s.reason}</p>
            </li>
          ))
        )}
      </ol>
    </div>
  )
}

function TrendingBody({ sport, refreshTick }: { sport: SportFilter; refreshTick: number }) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [players, setPlayers] = useState<
    { playerName: string | null; position: string | null; team: string | null; crowdScore: number; sport: string }[]
  >([])

  useEffect(() => {
    setLoading(true)
    setErr(null)
    const q = sport === 'ALL' ? 'ALL' : sport
    void fetch(`/api/dashboard/ai-tools/trending-players?sport=${encodeURIComponent(q)}`, {
      cache: 'no-store',
      credentials: 'same-origin',
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('trend'))))
      .then((j: { players?: typeof players }) => setPlayers(j.players ?? []))
      .catch(() => setErr('Could not load trending players from the database.'))
      .finally(() => setLoading(false))
  }, [sport, refreshTick])

  if (loading && players.length === 0) {
    return <p className="text-[13px] text-white/50">Loading top 20 trending…</p>
  }
  if (err && players.length === 0) {
    return <p className="text-[13px] text-red-300/90">{err}</p>
  }

  return (
    <div className="space-y-2">
      {loading ? <p className="text-[11px] text-cyan-200/60">Refreshing…</p> : null}
      <ol className="max-h-64 list-decimal space-y-1.5 overflow-y-auto pl-4 text-[12px]">
      {players.map((p, i) => (
        <li key={i} className="text-white/80">
          <span className="font-medium text-white">{p.playerName ?? 'Player'}</span>
          <span className="text-white/40"> · {p.sport.toUpperCase()} </span>
          {p.position ? `${p.position}` : ''}
          {p.team ? ` · ${p.team}` : ''}
          <span className="text-cyan-300/90"> · buzz {p.crowdScore}</span>
        </li>
      ))}
      </ol>
    </div>
  )
}

function PowerBody({
  leagueId,
  leagueName,
  hasLeague,
  refreshTick,
}: {
  leagueId: string
  leagueName: string
  hasLeague: boolean
  refreshTick: number
}) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [teams, setTeams] = useState<{ teamName: string; powerScore?: number; rank?: number }[]>([])

  useEffect(() => {
    if (!hasLeague || !leagueId) {
      setTeams([])
      setSummary(null)
      return
    }
    setLoading(true)
    setErr(null)
    let cancelled = false
    void (async () => {
      try {
        const pr = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/power-rankings`, {
          cache: 'no-store',
          credentials: 'same-origin',
        })
        if (!pr.ok) throw new Error('pr')
        const j = (await pr.json()) as {
          teams?: {
            displayName?: string | null
            username?: string | null
            rosterId?: number
            powerScore?: number
            rank?: number
          }[]
        }
        if (cancelled) return
        const t = (j.teams ?? []).map((x) => ({
          teamName: String(x.displayName || x.username || `Team ${x.rosterId ?? ''}`),
          powerScore: x.powerScore,
          rank: x.rank,
        }))
        setTeams(t)

        const cm = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/power-rankings/commentary`, {
          cache: 'no-store',
          credentials: 'same-origin',
        })
        if (cm.ok) {
          const cj = (await cm.json()) as {
            rankingSummary?: string | null
            narrativeExplanation?: string | null
            formulaExplanation?: string | null
          }
          const parts = [cj.rankingSummary, cj.narrativeExplanation, cj.formulaExplanation].filter(
            (x): x is string => Boolean(x && String(x).trim()),
          )
          if (parts.length) setSummary(parts.join('\n\n'))
        }
      } catch {
        if (!cancelled) {
          setErr('Power rankings not available — league may need sync or data.')
          setTeams([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hasLeague, leagueId, refreshTick])

  if (!hasLeague) {
    return <p className="text-[13px] text-white/55">Select a league for power rankings.</p>
  }
  if (loading && teams.length === 0) {
    return <p className="text-[13px] text-white/50">Loading power rankings…</p>
  }
  if (err && teams.length === 0) {
    return <p className="text-[13px] text-red-300/90">{err}</p>
  }

  return (
    <div className="space-y-2 text-[12px] text-white/80">
      <p className="font-semibold text-white">{leagueName}</p>
      {loading ? <p className="text-[11px] text-cyan-200/60">Refreshing…</p> : null}
      {summary ? <p className="leading-snug text-cyan-100/90">{summary}</p> : null}
      <ul className="max-h-48 space-y-1 overflow-y-auto">
        {teams.slice(0, 12).map((t, i) => (
          <li key={i} className="flex justify-between gap-2 border-b border-white/5 py-1">
            <span>
              #{t.rank} {t.teamName}
            </span>
            {typeof t.powerScore === 'number' ? (
              <span className="text-white/50">{t.powerScore.toFixed(1)}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

function InjuryBody({ sport, refreshTick }: { sport: SportFilter; refreshTick: number }) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [articles, setArticles] = useState<{ title: string; source: string; publishedAt: string | null }[]>([])
  const [players, setPlayers] = useState<{ name: string; injuryStatus: string | null; team: string }[]>([])
  const [grokDigests, setGrokDigests] = useState<
    { sport: string; summary: string; bullets: string[]; generatedAt: string }[]
  >([])

  useEffect(() => {
    setLoading(true)
    setErr(null)
    const q = sport === 'ALL' ? 'ALL' : sport
    void fetch(`/api/dashboard/ai-tools/injury-brief?sport=${encodeURIComponent(q)}`, {
      cache: 'no-store',
      credentials: 'same-origin',
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('inj'))))
      .then(
        (j: {
          articles?: typeof articles
          playerInjuries?: { name: string; injuryStatus: string | null; team: string }[]
          injuryReports?: { name: string; team: string; status: string; gameStatus?: string | null }[]
          grokInjuryDigests?: { sport: string; summary: string; bullets: string[]; generatedAt: string }[]
        }) => {
          setArticles(j.articles ?? [])
          setGrokDigests(j.grokInjuryDigests ?? [])
          const fromPlayers = (j.playerInjuries ?? []).map((p) => ({
            name: p.name,
            team: p.team,
            injuryStatus: p.injuryStatus,
          }))
          const fromReports = (j.injuryReports ?? []).map((r) => ({
            name: r.name,
            team: r.team,
            injuryStatus: r.gameStatus ?? r.status,
          }))
          const merged = [...fromPlayers, ...fromReports]
          const seen = new Set<string>()
          const deduped = merged.filter((row) => {
            const k = `${row.name}|${row.team}`.toLowerCase()
            if (seen.has(k)) return false
            seen.add(k)
            return true
          })
          setPlayers(deduped.slice(0, 18))
        }
      )
      .catch(() => setErr('Injury feed unavailable (sync NewsAPI / sports data in admin jobs).'))
      .finally(() => setLoading(false))
  }, [sport, refreshTick])

  if (loading && articles.length === 0 && players.length === 0 && grokDigests.length === 0) {
    return <p className="text-[13px] text-white/50">Loading injury intel from DB feeds…</p>
  }
  if (err && articles.length === 0 && players.length === 0 && grokDigests.length === 0) {
    return <p className="text-[13px] text-red-300/90">{err}</p>
  }

  const digestForFilter =
    sport === 'ALL'
      ? grokDigests.slice(0, 4)
      : grokDigests.filter((d) => d.sport === sport).slice(0, 2)

  return (
    <div className="grid max-h-64 gap-3 overflow-y-auto text-[12px] sm:grid-cols-2">
      {loading ? <p className="col-span-full text-[11px] text-cyan-200/60">Refreshing…</p> : null}
      {digestForFilter.length > 0 ? (
        <div className="col-span-full space-y-2 border-b border-white/10 pb-2">
          <p className="text-[11px] font-bold uppercase text-white/40">Injury digest (Grok → DB cache)</p>
          {digestForFilter.map((g, i) => (
            <div key={`${g.sport}-${i}`} className="rounded-md border border-white/10 bg-[#0a1228]/80 p-2">
              <p className="text-[10px] uppercase text-cyan-200/50">{g.sport}</p>
              {g.summary ? <p className="mt-1 leading-snug text-white/80">{g.summary}</p> : null}
              {g.bullets?.length ? (
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-white/65">
                  {g.bullets.slice(0, 6).map((b, j) => (
                    <li key={j}>{b}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <div>
        <p className="mb-1 text-[11px] font-bold uppercase text-white/40">Headlines</p>
        <ul className="space-y-1.5 text-white/70">
          {articles.slice(0, 8).map((a, i) => (
            <li key={i}>{a.title}</li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-1 text-[11px] font-bold uppercase text-white/40">Player statuses</p>
        <ul className="space-y-1.5 text-white/70">
          {players.map((p, i) => (
            <li key={i}>
              {p.name} ({p.team}) — {p.injuryStatus ?? '—'}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function WarRoomBody({ leagueName }: { leagueName: string }) {
  return (
    <div className="space-y-2 text-[13px] leading-relaxed text-white/70">
      <p>
        AF Legacy is the premium tier for draft prep, future game planning, and multi-year roster construction for{' '}
        <span className="text-white">{leagueName}</span>.
      </p>
      <p className="text-[12px] text-white/45">
        Use Ask Chimmy for a personalized plan, or open the AF Legacy product page to review upgrade options.
      </p>
    </div>
  )
}

function MatchupPrepBody({
  leagueId,
  leagueName,
  hasLeague,
  sport,
  refreshTick,
}: {
  leagueId: string
  leagueName: string
  hasLeague: boolean
  sport: SportFilter
  refreshTick: number
}) {
  const [data, setData] = useState<MatchupPrepDashboardResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!hasLeague || !leagueId.trim()) {
      setData(null)
      setErr(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setErr(null)
    const sportFilter = sport === 'ALL' ? 'ALL' : isSupportedSport(sport) ? sport : 'ALL'
    void fetch('/api/ai-tools/matchup-prep/dashboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sportFilter,
        leagueId: leagueId.trim(),
        teamFocus: 'my_team',
        teamExternalId: null,
        opponentExternalId: null,
        timeHorizon: 'this_matchup',
        strategyMode: 'balanced',
        skipAi: true,
        toggles: {
          includeLiveNews: true,
          includeInjuries: true,
          includeScheduleAdjustments: true,
          includeWeather: false,
          includeStreamingRecommendations: true,
          includeOpponentTrendAnalysis: true,
          includePlayoffContext: true,
          includeRookieProspectContext: false,
        },
      }),
    })
      .then(async (r) => {
        const json = (await r.json()) as MatchupPrepDashboardResult | { ok: false; error?: string }
        if (cancelled) return
        if (!r.ok || !json.ok) {
          setData(null)
          setErr((json as { error?: string }).error ?? 'Matchup prep unavailable.')
          return
        }
        setData(json)
      })
      .catch(() => {
        if (!cancelled) {
          setData(null)
          setErr('Network error.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [hasLeague, leagueId, sport, refreshTick])

  if (!hasLeague) {
    return <p className="text-[13px] text-white/55">Select a league for matchup prep.</p>
  }
  if (loading && !data) {
    return <p className="text-[13px] text-white/50">Loading matchup board…</p>
  }
  if (err && !data) {
    return <p className="text-[13px] text-red-300/90">{err}</p>
  }
  if (!data?.ok) {
    return <p className="text-[13px] text-white/55">{err ?? 'No matchup data yet.'}</p>
  }

  const d = data
  return (
    <div className="space-y-3 rounded-xl border border-white/8 bg-black/30 p-3 text-[12px] text-white/80">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-white">{leagueName}</p>
        {d.degraded ? (
          <span className="rounded border border-amber-500/35 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-200">
            Partial data
          </span>
        ) : (
          <span className="rounded border border-emerald-500/25 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-200">
            Live
          </span>
        )}
      </div>
      {loading ? <p className="text-[11px] text-cyan-200/60">Refreshing…</p> : null}
      <p className="text-white/60">
        vs <span className="text-white/90">{d.oppTeamName ?? 'Opponent TBD'}</span>
        {d.weekLabel ? <span className="text-white/40"> · {d.weekLabel}</span> : null}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[10px] uppercase text-white/40">Proj. edge</p>
          <p className="text-lg font-bold tabular-nums text-cyan-200">
            {d.projectedEdge != null ? `${d.projectedEdge > 0 ? '+' : ''}${d.projectedEdge.toFixed(1)}` : '—'}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-white/40">Win chance</p>
          <p className="text-lg font-bold tabular-nums text-emerald-200/90">
            {d.winProbability != null ? `${d.winProbability}%` : '—'}
          </p>
        </div>
      </div>
      {d.myProjectedTotal != null && d.oppProjectedTotal != null ? (
        <p className="text-white/55">
          You {d.myProjectedTotal.toFixed(1)} — Opp {d.oppProjectedTotal.toFixed(1)} (projected)
        </p>
      ) : null}
      {d.gamePlan?.length ? (
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase text-white/40">Top actions</p>
          <ul className="space-y-1.5 text-white/70">
            {d.gamePlan.slice(0, 3).map((a) => (
              <li key={a.id} className="leading-snug">
                <span className="text-white/90">{a.title}</span>
                {a.detail ? <span className="text-white/50"> — {a.detail}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {d.dataGaps?.length ? (
        <p className="text-[11px] text-amber-200/80">
          Note: {d.dataGaps.slice(0, 2).join(' ')}
          {d.dataGaps.length > 2 ? '…' : ''}
        </p>
      ) : null}
      <p className="text-[10px] text-white/35">Updated {new Date(d.computedAt).toLocaleString()}</p>
    </div>
  )
}

function LongTermCoachingBody({
  leagueId,
  leagueName,
  hasLeague,
  refreshTick,
}: {
  leagueId: string
  leagueName: string
  hasLeague: boolean
  refreshTick: number
}) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<LongTermCoachingAnalysis | null>(null)

  useEffect(() => {
    if (!hasLeague || !leagueId) {
      setAnalysis(null)
      return
    }
    setLoading(true)
    setErr(null)
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/ai-tools/long-term-coaching', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leagueId,
            horizonYears: 3,
            strategyMode: 'auto',
            teamExternalId: null,
            skipAi: true,
          }),
        })
        const json = (await res.json()) as { ok?: boolean; analysis?: LongTermCoachingAnalysis; error?: string }
        if (cancelled) return
        if (!res.ok || !json.ok || !json.analysis) {
          setErr(json.error ?? 'Long-term coaching unavailable for this league.')
          setAnalysis(null)
          return
        }
        setAnalysis(json.analysis)
      } catch {
        if (!cancelled) {
          setErr('Could not load long-term coaching.')
          setAnalysis(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hasLeague, leagueId, refreshTick])

  if (!hasLeague) {
    return <p className="text-[13px] text-white/55">Select a league for long-term coaching.</p>
  }
  if (loading && !analysis) {
    return <p className="text-[13px] text-cyan-200/60">Building outlook…</p>
  }
  if (err) {
    return <p className="text-[13px] text-amber-200/85">{err}</p>
  }
  const a = analysis
  if (!a) {
    return <p className="text-[13px] text-white/55">No data yet.</p>
  }
  const fmt = a.signals.strategyClass.replace(/_/g, ' ')
  const dir = a.plan.recommendedDirection.replace(/_/g, ' ')
  const tw = a.signals.titleWindowYears
  return (
    <div className="space-y-2 rounded-xl border border-white/8 bg-black/30 p-3 text-[12px] text-white/80">
      <p className="font-semibold text-white">{leagueName}</p>
      {a.formatWarning ? (
        <p className="text-[11px] text-amber-200/90">{a.formatWarning}</p>
      ) : null}
      <p>
        <span className="text-white/45">Classification:</span>{' '}
        <span className="text-violet-200/95">{fmt}</span>
      </p>
      <p>
        <span className="text-white/45">Direction:</span> <span className="text-white/90">{dir}</span>
      </p>
      <p>
        <span className="text-white/45">Title window (est. years):</span>{' '}
        <span className="tabular-nums text-white/90">{tw != null ? tw : '—'}</span>
      </p>
      <p className="text-white/55">
        Short-term strength {a.signals.shortTermStrengthIndex}/100 · Long-term asset index {a.signals.longTermAssetIndex}/100 ·
        Pick capital {a.signals.pickCapitalScore.toFixed(0)}
      </p>
      <p className="text-[11px] leading-snug text-white/60">{a.plan.currentWindowAssessment}</p>
      <p className="text-[10px] text-white/35">Updated {new Date(a.computedAt).toLocaleString()}</p>
    </div>
  )
}
