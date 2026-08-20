'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeftRight, Minus, Plus } from 'lucide-react'
import type { UserLeague } from '@/app/dashboard/types'
import { PlayerImage } from '@/app/components/PlayerImage'
import { TeamLogo } from '@/app/components/TeamLogo'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { positionsForSport, matchesPositionFilter } from '@/lib/trending-players/position-filters'
import type { TrendPlayerCard, TrendingDashboardOutput, TrendingSourceFlags } from '@/lib/trending-players/types'
import { parseTrendPlayerId } from '@/lib/trending-players/parseTrendPlayerId'

export type TrendTabProps = {
  league: UserLeague
  onPlayerClick: (playerId: string) => void
  sport?: string
}

type TrendPill = string

type TrendBoardPayload = {
  totalTeams: number
  playerRosterPct: Record<string, number>
  playerOwner: Record<string, { displayName: string }>
  myPlayerIds: string[]
  error?: string
}

type DashboardSuccess = Extract<TrendingDashboardOutput, { ok: true }>

type TrendColumnRow = TrendPlayerCard & {
  platformId: string
  signalType: 'fantasy' | 'real' | 'hybrid'
}

function badgePosition(pos: string): string {
  if (pos === 'DST') return 'DEF'
  return pos
}

function sourceSignalType(card: TrendPlayerCard): 'fantasy' | 'real' | 'hybrid' {
  const sources = (card.sources ?? []).map((s) => s.toLowerCase())
  const hasFantasy = sources.some((s) => s.includes('fantasycalc'))
  const hasReal = sources.some(
    (s) =>
      s.includes('meta') ||
      s.includes('trending_players') ||
      s.includes('sleeper') ||
      s.includes('platform_signals') ||
      s.includes('injury') ||
      s.includes('news'),
  )
  if (hasFantasy && hasReal) return 'hybrid'
  if (hasFantasy) return 'fantasy'
  return 'real'
}

function sourceSignalLabel(signalType: 'fantasy' | 'real' | 'hybrid'): string {
  if (signalType === 'fantasy') return 'Fantasy'
  if (signalType === 'hybrid') return 'Real + Fantasy'
  return 'Real'
}

function sourceSignalClass(signalType: 'fantasy' | 'real' | 'hybrid'): string {
  if (signalType === 'fantasy') return 'border-sky-400/25 bg-sky-400/10 text-sky-200'
  if (signalType === 'hybrid') return 'border-violet-400/25 bg-violet-400/10 text-violet-100'
  return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100'
}

function TrendRowAction({
  kind,
  onActivate,
}: {
  kind: 'add' | 'trade' | 'drop'
  onActivate: () => void
}) {
  const wrap =
    kind === 'add'
      ? 'border-emerald-500/45 bg-emerald-500/15 text-emerald-300'
      : kind === 'drop'
        ? 'border-rose-500/45 bg-rose-500/15 text-rose-300'
        : 'border-sky-500/45 bg-sky-500/15 text-sky-200'
  const Icon = kind === 'add' ? Plus : kind === 'drop' ? Minus : ArrowLeftRight
  const label = kind === 'add' ? 'Free agent — add' : kind === 'drop' ? 'On your roster' : 'Rostered — trade'
  return (
    <button
      type="button"
      onClick={onActivate}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${wrap} transition hover:brightness-110`}
      aria-label={label}
      title={label}
    >
      <Icon className="h-4 w-4" strokeWidth={2.5} />
    </button>
  )
}

export function TrendTab({ league, onPlayerClick, sport }: TrendTabProps) {
  const resolvedSport = normalizeToSupportedSport(sport ?? league.sport) ?? 'NFL'
  const pills = useMemo(() => positionsForSport(resolvedSport), [resolvedSport])

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [filterUp, setFilterUp] = useState<TrendPill>('ALL')
  const [filterDown, setFilterDown] = useState<TrendPill>('ALL')
  const [board, setBoard] = useState<TrendBoardPayload | null>(null)
  const [data, setData] = useState<DashboardSuccess | null>(null)

  const loadBoard = useCallback(async () => {
    try {
      const r = await fetch(`/api/league/trend-board?leagueId=${encodeURIComponent(league.id)}`, {
        credentials: 'include',
      })
      const d = (await r.json().catch(() => null)) as TrendBoardPayload | null
      if (r.ok && d && typeof d.playerRosterPct === 'object') {
        setBoard({
          totalTeams: d.totalTeams ?? 0,
          playerRosterPct: d.playerRosterPct ?? {},
          playerOwner: d.playerOwner ?? {},
          myPlayerIds: Array.isArray(d.myPlayerIds) ? d.myPlayerIds : [],
        })
      } else {
        setBoard({
          totalTeams: 0,
          playerRosterPct: {},
          playerOwner: {},
          myPlayerIds: [],
          error: typeof (d as { error?: string } | null)?.error === 'string' ? (d as { error: string }).error : undefined,
        })
      }
    } catch {
      setBoard({ totalTeams: 0, playerRosterPct: {}, playerOwner: {}, myPlayerIds: [] })
    }
  }, [league.id])

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    await loadBoard()

    try {
      const r = await fetch('/api/ai-tools/trending-players/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sportFilter: resolvedSport,
          leagueId: league.id,
          trendType: 'all',
          position: 'ALL',
          rookiesOnly: false,
          timeWindow: '7d',
          contextMode: 'league_wide',
          limitPerSide: 18,
          skipAi: true,
        }),
      })
      const j = (await r.json().catch(() => null)) as TrendingDashboardOutput | { error?: string } | null
      if (!r.ok || !j || !('ok' in j) || !j.ok) {
        setData(null)
        setErr(('error' in (j ?? {}) && typeof (j as { error?: string }).error === 'string') ? (j as { error: string }).error : 'Could not load trend data.')
        return
      }
      setData(j)
    } catch (error) {
      setData(null)
      setErr(error instanceof Error ? error.message : 'Could not load trend data.')
    } finally {
      setLoading(false)
    }
  }, [league.id, loadBoard, resolvedSport])

  useEffect(() => {
    void load()
  }, [load])

  const mySet = useMemo(() => new Set(board?.myPlayerIds ?? []), [board])

  const upRows = useMemo<TrendColumnRow[]>(() => {
    return (data?.risers ?? []).map((card) => {
      const parsed = parseTrendPlayerId(card.playerId)
      return {
        ...card,
        platformId: parsed.platformId,
        signalType: sourceSignalType(card),
      }
    })
  }, [data])

  const downRows = useMemo<TrendColumnRow[]>(() => {
    return (data?.fallers ?? []).map((card) => {
      const parsed = parseTrendPlayerId(card.playerId)
      return {
        ...card,
        platformId: parsed.platformId,
        signalType: sourceSignalType(card),
      }
    })
  }, [data])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 md:gap-4 md:p-5">
      <div className="space-y-1.5">
        <p className="text-[10px] leading-snug text-white/35">
          Trend blends <span className="text-white/55">real-world signals</span> from injuries, usage, lineup and market activity with{' '}
          <span className="text-white/55">fantasy valuation</span> from the DB-backed FantasyCalc cache. Each row is labeled as Real, Fantasy, or Real + Fantasy.
        </p>
        {data?.sourceFlags ? <SourceFlagsBar flags={data.sourceFlags} /> : null}
        {data?.dataGaps?.length ? (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-[10px] text-amber-100/85">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="leading-snug">{data.dataGaps.slice(0, 2).join(' ')}</span>
          </div>
        ) : null}
      </div>
      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-2 md:gap-5">
        <TrendColumn
          title="Trending up"
          rows={upRows}
          sport={resolvedSport}
          loading={loading}
          error={err}
          filter={filterUp}
          pills={pills}
          onFilterChange={setFilterUp}
          onPlayerClick={onPlayerClick}
          direction="up"
          board={board}
          mySet={mySet}
        />
        <TrendColumn
          title="Trending down"
          rows={downRows}
          sport={resolvedSport}
          loading={loading}
          error={err}
          filter={filterDown}
          pills={pills}
          onFilterChange={setFilterDown}
          onPlayerClick={onPlayerClick}
          direction="down"
          board={board}
          mySet={mySet}
        />
      </div>
    </div>
  )
}

function SourceFlagsBar({ flags }: { flags: TrendingSourceFlags }) {
  const chipBase = 'rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide'
  const on = 'bg-emerald-500/15 text-emerald-200'
  const off = 'bg-white/5 text-white/35'
  const partial = 'bg-amber-500/12 text-amber-100/90'

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className={`${chipBase} ${flags.fantasyCalcReady ? on : off}`}>Fantasy</span>
      <span className={`${chipBase} ${flags.metaTrendsReady ? on : off}`}>Real</span>
      <span className={`${chipBase} ${flags.sleeperTrendingReady ? on : off}`}>Market</span>
      <span className={`${chipBase} ${flags.injuryNewsLayerReady ? on : partial}`}>News</span>
      <span className={`${chipBase} ${flags.projectionLayerReady ? on : off}`}>Proj</span>
      <span className={`${chipBase} ${flags.leagueScoringApplied ? on : partial}`}>League</span>
    </div>
  )
}

function TrendColumn({
  title,
  rows,
  sport,
  loading,
  error,
  filter,
  pills,
  onFilterChange,
  onPlayerClick,
  direction,
  board,
  mySet,
}: {
  title: string
  rows: TrendColumnRow[]
  sport: string
  loading: boolean
  error: string | null
  filter: TrendPill
  pills: TrendPill[]
  onFilterChange: (p: TrendPill) => void
  onPlayerClick: (id: string) => void
  direction: 'up' | 'down'
  board: TrendBoardPayload | null
  mySet: Set<string>
}) {
  const filteredRows = useMemo(() => {
    if (filter === 'ALL') return rows
    return rows.filter((row) => matchesPositionFilter(row.position || '—', filter, normalizeToSupportedSport(sport)))
  }, [filter, rows, sport])

  return (
    <section className="flex min-h-[320px] flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0a1228]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2.5 md:px-4">
        <h2 className="text-[13px] font-bold tracking-tight text-white">{title}</h2>
        <label className="relative">
          <span className="sr-only">Position filter</span>
          <select
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            className="appearance-none rounded-lg border border-white/[0.1] bg-[#07071a] py-1.5 pl-2.5 pr-8 text-[11px] font-semibold text-white/85 focus:border-[#ff3d81]/40 focus:outline-none focus:ring-1 focus:ring-[#ff3d81]/30"
          >
            {pills.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-white/35">
            ▾
          </span>
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-2 md:px-2">
        {loading ? (
          <p className="px-3 py-8 text-center text-sm text-white/40">Loading…</p>
        ) : error ? (
          <p className="px-3 py-8 text-center text-sm text-amber-300/90">{error}</p>
        ) : filteredRows.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-white/40">No trending data.</p>
        ) : (
          <ul className="space-y-0.5">
            {filteredRows.map((row, i) => {
              const id = row.platformId
              const pct = board?.playerRosterPct[id]
              const owner = board?.playerOwner[id]?.displayName
              const rosteredLabel = pct != null && Number.isFinite(pct) ? `${Math.round(pct)}%` : '—%'
              const showTeam = row.team && row.team !== 'FA' && row.team !== '—'

              let action: 'add' | 'trade' | 'drop' = 'add'
              if (mySet.has(id)) action = 'drop'
              else if (owner) action = 'trade'

              const deltaClass = direction === 'up' ? 'text-emerald-400' : 'text-rose-400'
              const rawDelta = Math.round(row.trendDelta)
              const deltaText = rawDelta > 0 ? `+${Math.abs(rawDelta).toLocaleString()}` : `${rawDelta.toLocaleString()}`

              const posLine = (
                <span className="flex flex-wrap items-center gap-1">
                  <span>{badgePosition(row.position || '—')}</span>
                  <span className="text-white/25">·</span>
                  {showTeam ? (
                    <>
                      <TeamLogo teamAbbr={row.team} sport={sport} size={14} />
                      <span>{row.team}</span>
                    </>
                  ) : (
                    <span>—</span>
                  )}
                </span>
              )

              return (
                <li key={`${row.playerId}-${i}`}>
                  <div className="flex items-center gap-2 rounded-lg px-1.5 py-2 transition hover:bg-white/[0.04] md:gap-2.5 md:px-2">
                    <TrendRowAction kind={action} onActivate={() => onPlayerClick(id)} />
                    <span className="w-5 shrink-0 text-center text-[12px] font-semibold tabular-nums text-white/50">
                      {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => onPlayerClick(id)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      data-testid={`trend-tab-row-${id}`}
                    >
                      <PlayerImage
                        sleeperId={id}
                        sport={sport}
                        name={row.name}
                        position={row.position}
                        headshotUrl={row.headshotUrl}
                        size={40}
                        variant="round"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate text-[13px] font-semibold text-white">{row.name}</p>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide ${sourceSignalClass(row.signalType)}`}>
                            {sourceSignalLabel(row.signalType)}
                          </span>
                        </div>
                        <div className="text-[11px] text-white/40">{posLine}</div>
                        <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-white/55">{row.snippet}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                          {row.chips.slice(0, 2).map((chip) => (
                            <span key={chip} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-white/55">
                              {chip}
                            </span>
                          ))}
                          {owner ? (
                            <span className="truncate text-[#ff9ec0]/85">→ {owner}</span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                    <div className="flex shrink-0 flex-col items-end gap-0.5 pl-1">
                      <span className={`text-[15px] font-bold tabular-nums ${deltaClass}`}>{deltaText}</span>
                      <span className="text-[10px] text-white/38">Rostered {rosteredLabel}</span>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
