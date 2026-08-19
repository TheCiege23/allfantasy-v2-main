'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Brain,
  Flame,
  BarChart3,
  RefreshCw,
  GitCompare,
  ListChecks,
  ShieldAlert,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { getPlayerImage } from '@/lib/players/getPlayerImage'
import { normalizePlayer } from '@/lib/players/normalizePlayer'
import type { PlayerEntry } from '@/components/app/draft-room/PlayerPanel'

export type DraftWarRoomSnapshot = {
  bestPick: { name: string; position: string; team: string | null; adp?: number | null }
  confidence: number
  reasoning: string[]
  strategyTip: string
  risk: 'low' | 'medium' | 'high'
  riskNote: string
  alternatives: Array<{ name: string; position: string; team: string | null; adp?: number | null }>
  teamNeedSummary?: string
  fallback: boolean
}

type CompareState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'ready'
      winner: 'A' | 'B'
      confidence: number
      breakdown: { projection: string; matchup: string; usage: string; risk: string }
      advice: string
      fallback: boolean
    }
  | { status: 'error'; message: string }

function riskStyles(risk: 'low' | 'medium' | 'high') {
  if (risk === 'low') return 'border-emerald-400/35 bg-emerald-500/10 text-emerald-100'
  if (risk === 'medium') return 'border-amber-400/35 bg-amber-500/10 text-amber-100'
  return 'border-rose-400/35 bg-rose-500/12 text-rose-100'
}

function WarRoomSkeleton() {
  return (
    <div className="space-y-3 p-1" data-testid="draft-war-room-skeleton">
      <Skeleton className="h-28 rounded-xl" style={{ animationDelay: '0ms' }} />
      <Skeleton className="h-16 rounded-lg" style={{ animationDelay: '80ms' }} />
      <Skeleton className="h-10 rounded-lg" style={{ animationDelay: '160ms' }} />
      <Skeleton className="h-12 rounded-lg" style={{ animationDelay: '240ms' }} />
    </div>
  )
}

export type DraftWarRoomProps = {
  sport: string
  leagueId: string
  expanded?: boolean
  defaultCollapsed?: boolean
  data: DraftWarRoomSnapshot | null
  loading: boolean
  error: string | null
  canDraft: boolean
  /** Current overall pick number — used to show "Value Drop" badge when ADP >> pick. */
  currentPick?: number | null
  onRefresh: (force?: boolean) => void
  onVisible?: () => void
  resolvePlayerEntry: (name: string, position: string) => PlayerEntry | null
  onDraftPlayer: (player: PlayerEntry) => void
  onAddToQueue: (player: PlayerEntry) => void
}

export function DraftWarRoom({
  sport,
  leagueId,
  expanded = true,
  defaultCollapsed = false,
  data,
  loading,
  error,
  canDraft,
  currentPick,
  onRefresh,
  onVisible,
  resolvePlayerEntry,
  onDraftPlayer,
  onAddToQueue,
}: DraftWarRoomProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [compareA, setCompareA] = useState<PlayerEntry | null>(null)
  const [compareB, setCompareB] = useState<PlayerEntry | null>(null)
  const [compareResult, setCompareResult] = useState<CompareState>({ status: 'idle' })

  useEffect(() => {
    if (expanded && !collapsed) onVisible?.()
  }, [expanded, collapsed, onVisible])

  const bestEntry = useMemo(() => {
    if (!data?.bestPick) return null
    return resolvePlayerEntry(data.bestPick.name, data.bestPick.position)
  }, [data?.bestPick, resolvePlayerEntry])

  const headshotFor = useCallback(
    (p: { name: string; position: string; team: string | null }) => {
      const entry = resolvePlayerEntry(p.name, p.position)
      const n = normalizePlayer({
        name: p.name,
        position: p.position,
        team: p.team,
        sport,
        display: entry?.display ?? undefined,
      })
      return getPlayerImage(n, sport)
    },
    [resolvePlayerEntry, sport],
  )

  const runCompare = useCallback(
    async (overrideA?: PlayerEntry | null, overrideB?: PlayerEntry | null) => {
      const pa = overrideA ?? compareA
      const pb = overrideB ?? compareB
      if (!pa || !pb) return
      setCompareResult({ status: 'loading' })
      try {
        const res = await fetch('/api/ai/draft/compare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leagueId,
            sport,
            playerA: {
              name: pa.name,
              position: pa.position,
              team: pa.team ?? null,
              adp: pa.aiAdp ?? pa.adp ?? null,
            },
            playerB: {
              name: pb.name,
              position: pb.position,
              team: pb.team ?? null,
              adp: pb.aiAdp ?? pb.adp ?? null,
            },
            rosterContext: data?.teamNeedSummary ?? undefined,
          }),
        })
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (!res.ok || json.ok === false) {
          setCompareResult({ status: 'error', message: typeof json.error === 'string' ? json.error : 'Compare failed' })
          return
        }
        const br = json.breakdown && typeof json.breakdown === 'object' ? (json.breakdown as Record<string, unknown>) : {}
        setCompareResult({
          status: 'ready',
          winner: json.winner === 'B' ? 'B' : 'A',
          confidence: Number(json.confidence) || 70,
          breakdown: {
            projection: String(br.projection ?? ''),
            matchup: String(br.matchup ?? ''),
            usage: String(br.usage ?? ''),
            risk: String(br.risk ?? ''),
          },
          advice: String(json.advice ?? ''),
          fallback: Boolean(json.fallback),
        })
      } catch (e) {
        setCompareResult({
          status: 'error',
          message: e instanceof Error ? e.message : 'Compare failed',
        })
      }
    },
    [compareA, compareB, data?.teamNeedSummary, leagueId, sport],
  )

  const winnerPlayer = useMemo(() => {
    if (compareResult.status !== 'ready') return null
    return compareResult.winner === 'A' ? compareA : compareB
  }, [compareResult, compareA, compareB])

  if (!expanded) return null

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-b from-[#0a1428] via-[#070f1c] to-[#060a14] shadow-[0_0_40px_rgba(34,211,238,0.06)]"
      data-testid="draft-war-room"
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between gap-2 border-b border-white/[0.07] bg-black/20 px-3 py-2.5 text-left"
      >
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-cyan-300" />
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-100/90">AF Legacy</span>
          {data?.fallback ? (
            <span className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[9px] text-white/55">Rules + AI</span>
          ) : (
            <span className="rounded border border-emerald-400/25 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] text-emerald-100/90">Live</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRefresh(true)
            }}
            disabled={loading}
            className="rounded border border-white/12 bg-black/30 p-1.5 text-white/70 hover:bg-white/10 disabled:opacity-50"
            aria-label="Refresh war room"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {collapsed ? <ChevronDown className="h-4 w-4 text-white/50" /> : <ChevronUp className="h-4 w-4 text-white/50" />}
        </div>
      </button>

      {!collapsed && (
        <div className="space-y-3 p-3">
          {loading && !data ? <WarRoomSkeleton /> : null}

          {error && (
            <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100" role="alert">
              {error}
            </p>
          )}

          {data?.bestPick && !bestEntry ? (
            <p
              className="rounded-lg border border-cyan-400/25 bg-cyan-500/10 px-2 py-1.5 text-[11px] text-cyan-50"
              role="status"
              data-testid="draft-war-room-pick-unresolved"
            >
              This suggestion is not in your live player pool (they may have just been drafted). Use Refresh or pick from the board.
            </p>
          ) : null}

          {data && (
            <>
              {/* Best pick */}
              <div className="rounded-xl border border-orange-400/25 bg-gradient-to-br from-orange-500/10 to-transparent p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-200/90">
                  <Flame className="h-3.5 w-3.5" />
                  Best pick
                </div>
                <div className="flex gap-3">
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full border border-white/10 bg-black/30">
                    {headshotFor(data.bestPick) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={headshotFor(data.bestPick)!}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-lg font-bold text-white/50">
                        {data.bestPick.name.charAt(0)}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-white">{data.bestPick.name}</p>
                    <p className="text-[11px] text-white/60">
                      {data.bestPick.position}
                      {data.bestPick.team ? ` · ${data.bestPick.team}` : ''}
                      {data.bestPick.adp != null ? ` · ADP ${data.bestPick.adp}` : ''}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-cyan-400/30 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-medium text-cyan-100">
                        {data.confidence}% match
                      </span>
                      {currentPick != null && data.bestPick.adp != null && Math.abs(data.bestPick.adp - currentPick) > 15 ? (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                          Value Drop
                        </span>
                      ) : null}
                      {data.teamNeedSummary ? (
                        <span className="truncate text-[10px] text-white/45">{data.teamNeedSummary}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              {/* Why */}
              <div className="rounded-xl border border-white/[0.08] bg-[#0a1220]/90 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">
                  <ListChecks className="h-3.5 w-3.5 text-violet-300" />
                  Why this pick
                </div>
                <ul className="space-y-1.5 text-[11px] leading-snug text-white/78">
                  {data.reasoning.slice(0, 4).map((line, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-cyan-400/80" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Strategy + risk */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-violet-400/20 bg-violet-500/8 p-2.5">
                  <div className="mb-1 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-violet-200/85">
                    <Sparkles className="h-3 w-3" />
                    Strategy tip
                  </div>
                  <p className="text-[11px] leading-snug text-white/82">{data.strategyTip}</p>
                </div>
                <div className={`rounded-xl border p-2.5 ${riskStyles(data.risk)}`}>
                  <div className="mb-1 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.16em]">
                    <ShieldAlert className="h-3 w-3" />
                    Risk · {data.risk}
                  </div>
                  <p className="text-[11px] leading-snug opacity-95">{data.riskNote}</p>
                </div>
              </div>

              {/* Alternatives */}
              {data.alternatives.length > 0 && (
                <div className="rounded-xl border border-white/[0.07] bg-black/20 p-2.5">
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
                    <BarChart3 className="h-3.5 w-3.5 text-sky-300" />
                    Alternatives
                  </div>
                  <ul className="space-y-1.5">
                    {data.alternatives.slice(0, 3).map((alt) => {
                      const entry = resolvePlayerEntry(alt.name, alt.position)
                      return (
                        <li key={`${alt.name}-${alt.position}`}>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/8 bg-[#0c1528]/90 px-2 py-1.5 text-left text-[11px] text-white/85 hover:border-cyan-400/25 hover:bg-cyan-500/8"
                            onClick={() => {
                              if (!entry) return
                              if (!compareA || compareA.name === entry.name) {
                                setCompareA(entry)
                                setCompareB(null)
                                setCompareResult({ status: 'idle' })
                                return
                              }
                              setCompareB(entry)
                              setCompareResult({ status: 'idle' })
                            }}
                          >
                            <span className="truncate">
                              {alt.name}{' '}
                              <span className="text-white/50">
                                {alt.position}
                                {alt.team ? ` · ${alt.team}` : ''}
                              </span>
                            </span>
                            <GitCompare className="h-3.5 w-3.5 shrink-0 text-white/35" />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  <p className="mt-1.5 text-[9px] text-white/40">
                    Tap alternatives to set Player A, then Player B — then Run AI compare, or use the dropdowns below.
                  </p>
                </div>
              )}

              {/* Quick actions */}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!canDraft || !bestEntry}
                  onClick={() => bestEntry && onDraftPlayer(bestEntry)}
                  className="inline-flex flex-1 min-w-[140px] items-center justify-center gap-1.5 rounded-lg border border-cyan-400/35 bg-cyan-500/15 px-3 py-2 text-[11px] font-medium text-cyan-50 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Flame className="h-3.5 w-3.5" />
                  Draft recommended
                </button>
                <button
                  type="button"
                  disabled={!bestEntry}
                  onClick={() => bestEntry && onAddToQueue(bestEntry)}
                  className="inline-flex flex-1 min-w-[120px] items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-[11px] text-white/85 hover:bg-white/10 disabled:opacity-40"
                >
                  Add to queue
                </button>
                <button
                  type="button"
                  disabled={data.alternatives.length < 2}
                  onClick={() => {
                    const a = resolvePlayerEntry(data.alternatives[0]!.name, data.alternatives[0]!.position)
                    const b = resolvePlayerEntry(data.alternatives[1]!.name, data.alternatives[1]!.position)
                    if (!a || !b) return
                    setCompareA(a)
                    setCompareB(b)
                    void runCompare(a, b)
                  }}
                  className="inline-flex flex-1 min-w-[140px] items-center justify-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-[11px] text-violet-100 hover:bg-violet-500/18 disabled:opacity-40"
                >
                  <GitCompare className="h-3.5 w-3.5" />
                  Compare alternatives
                </button>
              </div>

              {/* Compare players */}
              <div className="rounded-xl border border-white/10 bg-[#070d18]/95 p-3">
                <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/50">
                  <GitCompare className="h-3.5 w-3.5 text-amber-300" />
                  Compare players
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(['A', 'B'] as const).map((side) => {
                    const selected = side === 'A' ? compareA : compareB
                    const players = data.alternatives.length
                      ? [data.bestPick, ...data.alternatives]
                      : [data.bestPick]
                    return (
                      <div key={side}>
                        <p className="mb-1 text-[10px] text-white/45">Player {side}</p>
                        <div className="max-h-32 overflow-y-auto space-y-1 pr-0.5">
                          {players.map((p) => {
                            const isActive = selected?.name === p.name
                            return (
                              <button
                                key={`${side}-${p.name}-${p.position}`}
                                type="button"
                                onClick={() => {
                                  const entry = resolvePlayerEntry(p.name, p.position)
                                  if (side === 'A') {
                                    setCompareA(entry)
                                  } else {
                                    setCompareB(entry)
                                  }
                                  setCompareResult({ status: 'idle' })
                                }}
                                className={`flex w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-left text-[11px] transition ${
                                  isActive
                                    ? 'border-cyan-500 bg-cyan-500/10 text-cyan-100'
                                    : 'border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.06]'
                                }`}
                              >
                                <span className="truncate font-medium">{p.name}</span>
                                <span className="shrink-0 text-[10px] text-white/40">{p.position}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <button
                  type="button"
                  disabled={!compareA || !compareB || compareA.name === compareB.name || compareResult.status === 'loading'}
                  onClick={() => void runCompare()}
                  className="mt-2 w-full rounded-lg border border-amber-400/35 bg-amber-500/12 py-2 text-[11px] font-medium text-amber-50 hover:bg-amber-500/20 disabled:opacity-40"
                >
                  {compareResult.status === 'loading' ? 'Analyzing…' : 'Run AI compare'}
                </button>

                {compareResult.status === 'ready' && compareA && compareB && (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                    {[compareA, compareB].map((pl, idx) => {
                      const side = idx === 0 ? 'A' : 'B'
                      const win = winnerPlayer?.name === pl.name
                      return (
                        <div
                          key={pl.name}
                          className={`rounded-lg border p-2 ${
                            win ? 'border-emerald-400/45 bg-emerald-500/12 shadow-[0_0_20px_rgba(16,185,129,0.12)]' : 'border-white/10 bg-black/25'
                          }`}
                        >
                          <p className="font-semibold text-white">
                            {side}: {pl.name}
                          </p>
                          <p className="text-white/55">
                            {pl.position} · ADP {pl.aiAdp ?? pl.adp ?? '—'}
                          </p>
                        </div>
                      )
                    })}
                    <div className="col-span-2 rounded-lg border border-white/8 bg-black/30 p-2 text-[11px] text-white/80">
                      <p className="font-medium text-emerald-200/90">
                        Winner:{' '}
                        {compareResult.winner === 'A' ? compareA.name : compareB.name} ({compareResult.winner}) —{' '}
                        {compareResult.confidence}% confidence
                        {compareResult.fallback ? (
                          <span className="ml-2 text-[9px] text-white/45">(fallback tier)</span>
                        ) : null}
                      </p>
                      <p className="mt-1 text-white/70">{compareResult.advice}</p>
                      <dl className="mt-2 grid grid-cols-2 gap-1 text-[10px] text-white/60">
                        <dt className="text-white/40">Projection</dt>
                        <dd>{compareResult.breakdown.projection}</dd>
                        <dt className="text-white/40">Matchup</dt>
                        <dd>{compareResult.breakdown.matchup}</dd>
                        <dt className="text-white/40">Usage</dt>
                        <dd>{compareResult.breakdown.usage}</dd>
                        <dt className="text-white/40">Risk</dt>
                        <dd>{compareResult.breakdown.risk}</dd>
                      </dl>
                      <p className="mt-2 text-[10px] text-cyan-200/85">
                        If you need upside → lean the winner’s ceiling game. If you need floor → take the safer weekly projection.
                      </p>
                    </div>
                  </div>
                )}
                {compareResult.status === 'error' && (
                  <p className="mt-2 text-[11px] text-amber-200/90">{compareResult.message}</p>
                )}
              </div>
            </>
          )}

          {!loading && !data && !error ? (
            <p className="py-2 text-center text-[11px] text-white/45">AF Legacy activates when the draft board is live.</p>
          ) : null}
        </div>
      )}
    </section>
  )
}
