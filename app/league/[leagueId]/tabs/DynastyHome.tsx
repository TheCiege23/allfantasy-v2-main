'use client'

import { useEffect, useState } from 'react'
import { LeaguePickBoard } from '@/components/dynasty/LeaguePickBoard'

export type DynastyHomeProps = {
  leagueId: string
  view?: 'dynasty' | 'dynasty_taxi' | 'dynasty_picks'
}

type Sub = 'overview' | 'taxi' | 'picks' | 'league_picks' | 'standings' | 'schedule'

const VIEW_TO_SUB: Record<string, Sub> = {
  dynasty: 'overview',
  dynasty_taxi: 'taxi',
  dynasty_picks: 'picks',
}

interface TaxiPlayer {
  id: string
  name: string
  position: string
  /** Null when the player's pro-experience year is unknown — the badge is hidden rather than guessed. */
  eligibilityYearsLeft: number | null
}

interface FuturePick {
  id: string
  year: number
  round: number
  fromTeam: string | null
  type: 'own' | 'traded_away' | 'incoming'
}

interface StandingRow {
  rank: number
  teamName: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
  draftPosition: number | null
}

function useDynastyData(leagueId: string) {
  const [taxi, setTaxi] = useState<TaxiPlayer[]>([])
  const [picks, setPicks] = useState<FuturePick[]>([])
  const [standings, setStandings] = useState<StandingRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    // Taxi and picks come from one `dynasty-hub` read (the old `/dynasty/taxi` and `/dynasty/picks`
    // URLs never existed, so both views were always empty).
    Promise.all([
      fetch(`/api/leagues/${leagueId}/dynasty-hub`).then((r) => (r.ok ? r.json() : { taxi: [], picks: [] })),
      fetch(`/api/leagues/${leagueId}/standings`).then((r) => (r.ok ? r.json() : { standings: [] })),
    ])
      .then(([hubRes, standingsRes]) => {
        if (cancelled) return
        setTaxi(hubRes.taxi ?? [])
        setPicks(hubRes.picks ?? [])
        setStandings(standingsRes.standings ?? [])
      })
      .catch(() => {
        // non-fatal — show empty state
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId])

  return { taxi, picks, standings, loading }
}

export function DynastyHome({ leagueId, view = 'dynasty' }: DynastyHomeProps) {
  const [sub, setSub] = useState<Sub>(VIEW_TO_SUB[view] ?? 'overview')
  const { taxi, picks, standings, loading } = useDynastyData(leagueId)

  useEffect(() => {
    setSub(VIEW_TO_SUB[view] ?? 'overview')
  }, [view])

  const SUBS: [Sub, string][] = [
    ['overview', 'Overview'],
    ['taxi', '🚕 Taxi Squad'],
    ['picks', '📋 Draft Picks'],
    ['league_picks', '🗂 All Teams’ Picks'],
    ['standings', '📊 Standings'],
    ['schedule', '📅 Schedule'],
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4 text-[#e6edf3]">
      <div className="flex flex-wrap gap-2 border-b border-white/[0.08] pb-3">
        {SUBS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={sub === id}
            onClick={() => setSub(id)}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              sub === id
                ? 'bg-purple-500/15 text-purple-100 ring-1 ring-purple-500/35'
                : 'bg-white/[0.05] text-white/45 hover:bg-white/10 hover:text-white/85'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center py-16 text-sm text-white/35">
          Loading dynasty data…
        </div>
      ) : (
        <>
          {sub === 'overview' && (
            <DynastyOverview taxiCount={taxi.length} pickCount={picks.length} standingCount={standings.length} />
          )}
          {sub === 'taxi' && <TaxiSquadView taxi={taxi} />}
          {sub === 'picks' && <FuturePicksView picks={picks} />}
          {sub === 'league_picks' && <LeaguePickBoard leagueId={leagueId} />}
          {sub === 'standings' && <DynastyStandingsView standings={standings} />}
          {sub === 'schedule' && <DynastyScheduleView leagueId={leagueId} />}
        </>
      )}
    </div>
  )
}

function DynastyOverview({
  taxiCount,
  pickCount,
  standingCount,
}: {
  taxiCount: number
  pickCount: number
  standingCount: number
}) {
  const stats = [
    { label: 'Taxi Squad', value: taxiCount, icon: '🚕' },
    { label: 'Future Picks', value: pickCount, icon: '📋' },
    { label: 'Teams', value: standingCount, icon: '🏆' },
  ]
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-4 text-center"
          >
            <div className="text-2xl">{s.icon}</div>
            <div className="mt-1 text-xl font-bold text-white">{s.value}</div>
            <div className="text-[11px] text-white/45">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-4 text-sm text-white/50">
        Dynasty league hub — manage your taxi squad, trade future picks, and track standings across the dynasty.
      </div>
    </div>
  )
}

function TaxiSquadView({ taxi }: { taxi: TaxiPlayer[] }) {
  if (taxi.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-10 text-sm text-white/35">
        No players on taxi squad.
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {taxi.map((p) => (
        <div
          key={p.id}
          className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.04] px-4 py-3"
        >
          <div>
            <p className="text-sm font-semibold text-white">{p.name}</p>
            <p className="text-[11px] text-white/45">{p.position}</p>
          </div>
          {p.eligibilityYearsLeft != null && (
            <span className="rounded-md bg-purple-500/15 px-2 py-0.5 text-[11px] font-medium text-purple-200">
              {p.eligibilityYearsLeft} yr{p.eligibilityYearsLeft !== 1 ? 's' : ''} left
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function FuturePicksView({ picks }: { picks: FuturePick[] }) {
  if (picks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-10 text-sm text-white/35">
        No future draft picks.
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {picks.map((pick) => (
        <div
          key={pick.id}
          className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.04] px-4 py-3"
        >
          <div>
            <p className="text-sm font-semibold text-white">
              {pick.year} Round {pick.round}
            </p>
            <p className="text-[11px] text-white/45">
              {pick.type === 'incoming'
                ? `From ${pick.fromTeam ?? 'another team'}`
                : pick.type === 'traded_away'
                  ? `To ${pick.fromTeam ?? 'another team'}`
                  : 'Own pick'}
            </p>
          </div>
          <span
            className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
              pick.type === 'incoming'
                ? 'bg-emerald-500/15 text-emerald-200'
                : pick.type === 'traded_away'
                  ? 'bg-rose-500/15 text-rose-200'
                  : 'bg-white/[0.08] text-white/55'
            }`}
          >
            {pick.type === 'incoming' ? 'Incoming' : pick.type === 'traded_away' ? 'Traded away' : 'Own'}
          </span>
        </div>
      ))}
    </div>
  )
}

function DynastyStandingsView({ standings }: { standings: StandingRow[] }) {
  if (standings.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-10 text-sm text-white/35">
        No standings data yet.
      </div>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/[0.08] text-left text-[11px] font-semibold uppercase tracking-wider text-white/35">
            <th className="pb-2 pr-4">#</th>
            <th className="pb-2 pr-4">Team</th>
            <th className="pb-2 pr-4 text-right">W</th>
            <th className="pb-2 pr-4 text-right">L</th>
            <th className="pb-2 pr-4 text-right">T</th>
            <th className="pb-2 text-right">PF</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.05]">
          {standings.map((row) => (
            <tr key={row.rank} className="text-white/75 hover:bg-white/[0.03]">
              <td className="py-2.5 pr-4 text-white/35">{row.rank}</td>
              <td className="py-2.5 pr-4 font-medium text-white">{row.teamName}</td>
              <td className="py-2.5 pr-4 text-right text-emerald-300">{row.wins}</td>
              <td className="py-2.5 pr-4 text-right text-rose-300">{row.losses}</td>
              <td className="py-2.5 pr-4 text-right">{row.ties}</td>
              <td className="py-2.5 text-right">{row.pointsFor.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DynastyScheduleView({ leagueId }: { leagueId: string }) {
  const [matchups, setMatchups] = useState<Array<{ week: number; home: string; away: string; homeScore: number | null; awayScore: number | null }>>([])
  const [scheduleLoading, setScheduleLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/redraft/season?leagueId=${leagueId}`)
      .then((r) => (r.ok ? r.json() : { matchups: [] }))
      .then((data) => {
        if (cancelled) return
        setMatchups(data.matchups ?? [])
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setScheduleLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId])

  if (scheduleLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-10 text-sm text-white/35">
        Loading schedule…
      </div>
    )
  }

  if (matchups.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-10 text-sm text-white/35">
        Schedule not yet generated.
      </div>
    )
  }

  const byWeek = matchups.reduce<Record<number, typeof matchups>>((acc, m) => {
    ;(acc[m.week] ??= []).push(m)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      {Object.entries(byWeek)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([week, games]) => (
          <div key={week}>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/35">Week {week}</p>
            <div className="space-y-1.5">
              {games.map((g, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.04] px-4 py-2.5 text-sm"
                >
                  <span className="text-white">{g.away}</span>
                  <span className="text-[12px] text-white/40">
                    {g.awayScore != null && g.homeScore != null
                      ? `${g.awayScore.toFixed(1)} – ${g.homeScore.toFixed(1)}`
                      : 'vs'}
                  </span>
                  <span className="text-white">{g.home}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  )
}
