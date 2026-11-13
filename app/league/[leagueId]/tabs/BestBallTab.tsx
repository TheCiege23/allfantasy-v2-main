'use client'

import { useEffect, useMemo, useState } from 'react'
import type { SupportedSport } from '@/lib/sport-scope'

type SubTab = 'lineup' | 'roster' | 'contest' | 'history'

type BestBallApiResponse = {
  league: {
    id: string
    name: string
    sport: string
    season: number
    summary: string
    settings: {
      mode: 'standard' | 'underdog'
      draftMode: string
      contestStructure: string
      matchupFormat: string
      waiversEnabled: boolean
      tradesEnabled: boolean
      substitutionsEnabled: boolean
      playoffTeams: number
      /** The period the league is actually scored with (lib/bestball/scoringPeriod.ts). */
      scoringPeriod?: string
    }
    profile: {
      label: string
      scoringPeriod: string
      recommendedRosterSize: number
      lineupSlots: Array<{ code: string; count: number }>
      notes: string[]
    }
  }
  selectedWeek: number
  weeksAvailable: number[]
  /** `native` when read from AllFantasy's own scoring; absent for the legacy tables. */
  source?: 'native'
  /** A hosted league whose draft is not finished: why nothing is scored yet. */
  draftNotice?: string | null
  /** A daily league whose season has no regular-season opener yet: daily scoring is waiting for it. */
  dailyScheduleNotice?: string | null
  lineups: Array<{
    rosterId: string
    teamName: string
    totalPoints: number
    /** `daily`: each day's best lineup was summed, and `slot` says how many days a player counted. */
    scoringPeriod?: 'daily'
    winLoss: string | null
    /** Native leagues: `provisional` until every game and stat for the week is final. */
    status?: 'final' | 'provisional'
    /** `position`: the one he was scored at; `positionNow`: native sealed weeks, when today's differs. */
    starters: Array<{ playerId: string; name: string; position: string; positionNow?: string; team: string | null; points: number; slot: string | null }>
    bench: Array<{ playerId: string; name: string; position: string; positionNow?: string; team: string | null; points: number | null; reason?: string }>
    unfilledSlots?: string[]
    awaitingStats?: number
    /** Native: the week was sealed on seats that differ from the league's current ones — which ones. */
    sealedSeatsNote?: string
  }>
  rosterComposition: Array<{ rosterId: string; teamName: string; playerCount: number }>
  standings: Array<{ rosterId: string; rank: number | null; teamName: string; wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number }>
  history: Array<{ rosterId: string; week: number; totalPoints: number; status?: 'final' | 'provisional' }>
}

const RESULT_LABEL: Record<string, string> = { W: 'Won', L: 'Lost', T: 'Tied' }

type BestBallTabProps = {
  leagueId: string
  sport: SupportedSport | string
}

export function BestBallTab({ leagueId, sport }: BestBallTabProps) {
  const [sub, setSub] = useState<SubTab>('lineup')
  const [week, setWeek] = useState(1)
  const [data, setData] = useState<BestBallApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/bestball?week=${week}`, {
          cache: 'no-store',
        })
        const json = (await res.json()) as BestBallApiResponse | { error?: string }
        if (!res.ok) {
          const message =
            typeof json === 'object' && json !== null && 'error' in json && typeof json.error === 'string'
              ? json.error
              : 'Failed to load Best Ball data'
          throw new Error(message)
        }
        if (!cancelled) {
          setData(json as BestBallApiResponse)
          setWeek((current) => (current === week ? (json as BestBallApiResponse).selectedWeek : current))
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load Best Ball data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [leagueId, week])

  const historyByRoster = useMemo(() => {
    const map = new Map<string, Array<{ week: number; totalPoints: number; status?: 'final' | 'provisional' }>>()
    for (const row of data?.history ?? []) {
      const list = map.get(row.rosterId) ?? []
      list.push({ week: row.week, totalPoints: row.totalPoints, status: row.status })
      map.set(row.rosterId, list)
    }
    return map
  }, [data])

  const daily = data?.league.settings.scoringPeriod === 'daily'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 text-[#e6edf3]">
      <div className="flex flex-wrap gap-2 border-b border-white/10 pb-3">
        {(['lineup', 'roster', 'contest', 'history'] as const).map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`bestball-sub-${id}`}
            onClick={() => setSub(id)}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${
              sub === id ? 'bg-[#ff3d81]/20 text-[#ffb8d1]' : 'bg-white/[0.05] text-white/50 hover:text-white/80'
            }`}
          >
            {id === 'lineup' ? 'Optimized Lineups' : id.charAt(0).toUpperCase() + id.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[12px] text-white/45">
        <span>Sport: {String(sport)}</span>
        <span className="text-white/25">|</span>
        <label className="flex items-center gap-1">
          Week
          <select
            value={week}
            onChange={(e) => setWeek(Number(e.target.value))}
            className="rounded border border-white/15 bg-[#0a1228] px-2 py-1 text-white"
          >
            {(data?.weeksAvailable?.length ? data.weeksAvailable : [week]).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        {data?.league ? <span className="rounded-full border border-[#ff3d81]/20 bg-[#ff3d81]/10 px-2 py-1 text-[11px] text-[#ffd7e5]">{data.league.summary}</span> : null}
      </div>

      {loading ? <div className="rounded-xl border border-white/10 bg-[#0a1228]/60 p-4 text-sm text-white/60">Loading Best Ball data...</div> : null}
      {error ? <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div> : null}

      {!loading && !error && data && sub === 'lineup' ? (
        <div className="flex flex-col gap-4">
          <p data-testid="bestball-lineup-explainer" className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-relaxed text-white/60">
            {daily ? (
              <>
                Nobody sets a lineup in Best Ball. This league uses <span className="font-semibold text-[#ffd7e5]">daily best ball</span>: each day the
                highest-scoring legal lineup from the players on your roster that day counts automatically, and the week score is the sum of the days.
              </>
            ) : (
              <>Nobody sets a lineup in Best Ball. Each week the highest-scoring legal lineup from your whole roster counts automatically.</>
            )}{' '}
            Scores stay <span className="font-semibold text-[#fde68a]">provisional</span> until every game and stat for the week is final.
          </p>
          {daily && data.dailyScheduleNotice ? (
            <div data-testid="bestball-daily-schedule-pending" className="rounded-xl border border-[var(--line)] bg-[#38bdf8]/10 p-4 text-sm text-[#bae6fd]">
              {data.dailyScheduleNotice}
            </div>
          ) : null}
          {/* The current season's draft is open: shown whether the tab is empty or still holding last
              season's lineups (a renewed league mid-draft), so neither reads as this season's scoring. */}
          {data.draftNotice ? (
            <div data-testid="bestball-draft-pending" className="rounded-xl border border-[var(--line)] bg-[#fde68a]/10 p-4 text-sm text-[#fde68a]">
              {data.draftNotice}
            </div>
          ) : data.lineups.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-[#0a1228]/60 p-4 text-sm text-white/60">
              No scored weeks yet. Lineups appear here once the first games are played.
            </div>
          ) : null}
          <div className="grid gap-4 xl:grid-cols-2">
            {data.lineups.map((lineup) => (
              <article key={lineup.rosterId} data-testid="bestball-lineup-card" className="min-w-0 rounded-xl border border-white/10 bg-[#0a1228]/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-white">{lineup.teamName}</h2>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-white/45">
                      <span>Week {data.selectedWeek}</span>
                      {lineup.scoringPeriod === 'daily' ? (
                        <span data-testid="bestball-lineup-daily" className="rounded-full bg-[#38bdf8]/15 px-1.5 py-px text-[11px] font-semibold text-[#bae6fd]">
                          Daily best ball
                        </span>
                      ) : null}
                      {lineup.status ? (
                        <span
                          data-testid="bestball-lineup-status"
                          className={`rounded-full px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide ${
                            lineup.status === 'final' ? 'bg-emerald-400/15 text-[#a7f3d0]' : 'bg-amber-400/15 text-[#fde68a]'
                          }`}
                        >
                          {lineup.status === 'final' ? 'Final' : 'Provisional'}
                        </span>
                      ) : null}
                      {lineup.winLoss ? <span>{RESULT_LABEL[lineup.winLoss] ?? lineup.winLoss}</span> : null}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-lg font-bold text-[#ffb8d1]">{lineup.totalPoints.toFixed(2)}</div>
                    <div className="text-[11px] text-white/40">{lineup.starters.length} counted</div>
                  </div>
                </div>
                {lineup.sealedSeatsNote ? (
                  <p data-testid="bestball-lineup-sealed-seats" className="mt-2 text-[11px] text-white/55">
                    {lineup.sealedSeatsNote}
                  </p>
                ) : null}
                {lineup.awaitingStats ? (
                  <p className="mt-2 text-[11px] text-[#fde68a]/80">
                    Waiting on stats for {lineup.awaitingStats} player{lineup.awaitingStats === 1 ? '' : 's'}; this total can still change.
                  </p>
                ) : null}
                <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-white/35">
                  Counted
                  {lineup.scoringPeriod === 'daily' ? (
                    <span className="normal-case tracking-normal text-white/35"> · points summed over the days each player made that day&apos;s best lineup</span>
                  ) : null}
                </div>
                <div className="mt-1.5 space-y-1.5">
                  {lineup.starters.map((starter) => (
                    <div key={`${starter.slot}-${starter.playerId}`} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="w-12 shrink-0 rounded bg-[#ff3d81]/15 px-1.5 py-0.5 text-center text-[11px] font-semibold text-[#ffb8d1]">
                          {starter.slot ?? starter.position}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-white">{starter.name}</div>
                          <div className="truncate text-white/45">
                            {starter.position}
                            {starter.positionNow ? <span data-testid="bestball-position-now"> (now {starter.positionNow})</span> : null}
                            {starter.team ? ` · ${starter.team}` : ''}
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 font-semibold text-[#ffd7e5]">{starter.points.toFixed(2)}</div>
                    </div>
                  ))}
                  {(lineup.unfilledSlots ?? []).map((slot, i) => (
                    <div key={`unfilled-${slot}-${i}`} className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-rose-300/25 px-3 py-2 text-xs text-rose-200/80">
                      <span>
                        <span className="mr-2 inline-block w-12 rounded bg-rose-400/10 px-1.5 py-0.5 text-center text-[11px] font-semibold">{slot}</span>
                        No eligible player on the roster
                      </span>
                      <span className="font-semibold">0.00</span>
                    </div>
                  ))}
                </div>
                {lineup.bench.length > 0 ? (
                  <details className="group mt-3">
                    <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-wide text-white/35 hover:text-white/60">
                      Didn&apos;t count ({lineup.bench.length}) <span className="normal-case tracking-normal text-white/30 group-open:hidden">· show why</span>
                    </summary>
                    <div className="mt-1.5 space-y-1.5">
                      {lineup.bench.map((player) => (
                        <div key={player.playerId} data-testid="bestball-bench-row" className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 truncate text-white/80">
                              {player.name}{' '}
                              <span className="text-white/40">
                                {player.position}
                                {player.positionNow ? <span data-testid="bestball-position-now"> (now {player.positionNow})</span> : null}
                                {player.team ? ` · ${player.team}` : ''}
                              </span>
                            </div>
                            <div className="shrink-0 text-white/50">{player.points == null ? '—' : player.points.toFixed(2)}</div>
                          </div>
                          {player.reason ? <div className="mt-0.5 text-[11px] text-white/45">{player.reason}</div> : null}
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {!loading && !error && data && sub === 'roster' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.rosterComposition.map((roster) => (
            <article key={roster.rosterId} className="rounded-xl border border-white/10 bg-[#0a1228]/70 p-4">
              <h2 className="text-sm font-semibold text-white">{roster.teamName}</h2>
              <p className="mt-1 text-xs text-white/45">{roster.playerCount} players on the roster{data.source === 'native' ? ` in week ${data.selectedWeek}` : ''}</p>
              <p className="mt-3 text-xs text-white/60">
                {data.source === 'native'
                  ? daily
                    ? 'Each day the highest-scoring legal lineup from the players on the roster that day counts automatically; the week is the sum of the days.'
                    : 'Each week the highest-scoring legal lineup from these players counts automatically.'
                  : `Recommended roster size: ${data.league.profile.recommendedRosterSize}. Best Ball automatically optimizes legal starters ${daily ? 'every day, and sums the days into the week' : 'every week'}.`}
              </p>
            </article>
          ))}
        </div>
      ) : null}

      {!loading && !error && data && sub === 'contest' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-[#0a1228]/80 p-4">
            <h2 className="text-sm font-semibold text-white">League Rules</h2>
            <div className="mt-3 space-y-2 text-xs text-white/60">
              <p>Mode: <span className="text-white">{data.league.settings.mode}</span></p>
              <p>Draft mode: <span className="text-white">{data.league.settings.draftMode}</span></p>
              <p>Contest structure: <span className="text-white">{data.league.settings.contestStructure}</span></p>
              <p>Scoring: <span className="text-white">{data.league.settings.matchupFormat}</span></p>
              <p>Lineups: <span className="text-white">{daily ? 'Daily best ball (each day summed)' : 'Weekly best ball'}</span></p>
              <p>Waivers: <span className="text-white">{data.league.settings.waiversEnabled ? 'On' : 'Off'}</span></p>
              <p>Trades: <span className="text-white">{data.league.settings.tradesEnabled ? 'On' : 'Off'}</span></p>
              <p>Manual substitutions: <span className="text-white">{data.league.settings.substitutionsEnabled ? 'On' : 'Off'}</span></p>
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#0a1228]/80 p-4">
            <h2 className="text-sm font-semibold text-white">Standings</h2>
            <div className="mt-3 space-y-2 text-xs">
              {data.standings.map((row) => (
                <div key={row.rosterId} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                  <div>
                    <div className="font-medium text-white">#{row.rank ?? '-'} {row.teamName}</div>
                    <div className="text-white/45">{row.wins}-{row.losses}-{row.ties}</div>
                  </div>
                  <div className="font-semibold text-[#ffd7e5]">{row.pointsFor.toFixed(2)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {!loading && !error && data && sub === 'history' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.lineups.map((lineup) => (
            <article key={lineup.rosterId} className="rounded-xl border border-white/10 bg-[#0a1228]/70 p-4">
              <h2 className="text-sm font-semibold text-white">{lineup.teamName}</h2>
              <div className="mt-3 space-y-2 text-xs">
                {(historyByRoster.get(lineup.rosterId) ?? []).map((row) => (
                  <div key={`${lineup.rosterId}-${row.week}`} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                    <span className="text-white/60">
                      Week {row.week}
                      {row.status === 'provisional' ? <span className="ml-2 text-[11px] font-semibold uppercase text-[#fde68a]/80">Provisional</span> : null}
                    </span>
                    <span className="font-semibold text-[#ffd7e5]">{row.totalPoints.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  )
}
