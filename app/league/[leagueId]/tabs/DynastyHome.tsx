'use client'

import { useEffect, useState, type ComponentType } from 'react'
import { BarChart3, CalendarDays, CarTaxiFront, ClipboardList, LayoutGrid, Trophy } from 'lucide-react'
import { LeaguePickBoard } from '@/components/dynasty/LeaguePickBoard'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import '@/components/dynasty/dynasty-era.css'

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
  const { t } = useOptionalLanguage()

  useEffect(() => {
    setSub(VIEW_TO_SUB[view] ?? 'overview')
  }, [view])

  const SUBS: [Sub, string, ComponentType<{ className?: string; 'aria-hidden'?: boolean }> | null][] = [
    ['overview', t('dynastyHome.tab.overview'), null],
    ['taxi', t('dynastyHome.tab.taxiSquad'), CarTaxiFront],
    ['picks', t('dynastyHome.tab.draftPicks'), ClipboardList],
    ['league_picks', t('dynastyHome.tab.allTeamsPicks'), LayoutGrid],
    ['standings', t('dynastyHome.tab.standings'), BarChart3],
    ['schedule', t('dynastyHome.tab.schedule'), CalendarDays],
  ]

  return (
    <div className="dyn-era flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4" data-testid="dynasty-home">
      <div className="dyn-era-rule flex flex-wrap gap-2 border-b pb-3">
        {SUBS.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            aria-pressed={sub === id}
            onClick={() => setSub(id)}
            className="dyn-pill rounded-lg px-3 py-1.5 text-[12px] font-semibold"
          >
            {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center py-16 text-sm dyn-era-muted">
          {t('dynastyHome.loading')}
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
  const { t } = useOptionalLanguage()
  const stats = [
    { label: t('dynastyHome.stat.taxiSquad'), value: taxiCount, Icon: CarTaxiFront },
    { label: t('dynastyHome.stat.futurePicks'), value: pickCount, Icon: ClipboardList },
    { label: t('dynastyHome.stat.teams'), value: standingCount, Icon: Trophy },
  ]
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className="dyn-card rounded-xl p-4 text-center"
          >
            <s.Icon className="dyn-gold-icon mx-auto h-6 w-6" aria-hidden />
            <div className="mt-1 text-xl font-bold">{s.value}</div>
            <div className="dyn-era-muted text-[11px]">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="dyn-card dyn-era-text2 rounded-xl p-4 text-sm">
        {t('dynastyHome.hubSentence')}
      </div>
    </div>
  )
}

function TaxiSquadView({ taxi }: { taxi: TaxiPlayer[] }) {
  const { t, tInterpolate } = useOptionalLanguage()
  if (taxi.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-10 text-sm dyn-era-muted">
        {t('dynastyHome.taxi.empty')}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {taxi.map((p) => (
        <div
          key={p.id}
          className="dyn-card flex items-center justify-between rounded-xl px-4 py-3"
        >
          <div>
            <p className="text-sm font-semibold">{p.name}</p>
            <p className="dyn-era-muted text-[11px]">{p.position}</p>
          </div>
          {p.eligibilityYearsLeft != null && (
            <span className="dyn-badge-gold rounded-md px-2 py-0.5 text-[11px] font-medium">
              {tInterpolate(p.eligibilityYearsLeft !== 1 ? 'dynastyHome.taxi.yearsLeftMany' : 'dynastyHome.taxi.yearsLeftOne', { count: p.eligibilityYearsLeft })}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function FuturePicksView({ picks }: { picks: FuturePick[] }) {
  const { t, tInterpolate } = useOptionalLanguage()
  if (picks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-10 text-sm dyn-era-muted">
        {t('dynastyHome.picks.empty')}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {picks.map((pick) => (
        <div
          key={pick.id}
          className="dyn-card flex items-center justify-between rounded-xl px-4 py-3"
        >
          <div>
            <p className="text-sm font-semibold">
              {tInterpolate('dynastyHome.picks.yearRound', { year: pick.year, round: pick.round })}
            </p>
            <p className="dyn-era-muted text-[11px]">
              {pick.type === 'incoming'
                ? tInterpolate('dynastyHome.picks.from', { team: pick.fromTeam ?? t('dynastyHome.picks.anotherTeam') })
                : pick.type === 'traded_away'
                  ? tInterpolate('dynastyHome.picks.to', { team: pick.fromTeam ?? t('dynastyHome.picks.anotherTeam') })
                  : t('dynastyHome.picks.ownPick')}
            </p>
          </div>
          <span
            className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
              pick.type === 'incoming'
                ? 'dyn-badge-teal'
                : pick.type === 'traded_away'
                  ? 'dyn-badge-out'
                  : 'dyn-badge-gold'
            }`}
          >
            {pick.type === 'incoming' ? t('dynastyHome.picks.incoming') : pick.type === 'traded_away' ? t('dynastyHome.picks.tradedAway') : t('dynastyHome.picks.own')}
          </span>
        </div>
      ))}
    </div>
  )
}

function DynastyStandingsView({ standings }: { standings: StandingRow[] }) {
  const { t } = useOptionalLanguage()
  if (standings.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-10 text-sm dyn-era-muted">
        {t('dynastyHome.standings.empty')}
      </div>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="dyn-era-rule dyn-era-muted border-b text-left text-[11px] font-semibold uppercase tracking-wider">
            <th className="pb-2 pr-4">#</th>
            <th className="pb-2 pr-4">{t('dynastyHome.standings.team')}</th>
            <th className="pb-2 pr-4 text-right">{t('dynastyHome.standings.w')}</th>
            <th className="pb-2 pr-4 text-right">{t('dynastyHome.standings.l')}</th>
            <th className="pb-2 pr-4 text-right">{t('dynastyHome.standings.t')}</th>
            <th className="pb-2 text-right">{t('dynastyHome.standings.pf')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.05]">
          {standings.map((row) => (
            <tr key={row.rank} className="dyn-era-text2 hover:bg-white/[0.03]">
              <td className="dyn-era-muted py-2.5 pr-4">{row.rank}</td>
              <td className="py-2.5 pr-4 font-medium text-[color:var(--dyn-text,#E8ECF2)]">{row.teamName}</td>
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
  const { t, tInterpolate } = useOptionalLanguage()
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
      <div className="flex flex-1 items-center justify-center py-10 text-sm dyn-era-muted">
        {t('dynastyHome.schedule.loading')}
      </div>
    )
  }

  if (matchups.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-10 text-sm dyn-era-muted">
        {t('dynastyHome.schedule.empty')}
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
            <p className="dyn-gold-text mb-2 text-[11px] font-bold uppercase tracking-wider">{tInterpolate('dynastyHome.schedule.week', { week })}</p>
            <div className="space-y-1.5">
              {games.map((g, i) => (
                <div
                  key={i}
                  className="dyn-card flex items-center justify-between rounded-xl px-4 py-2.5 text-sm"
                >
                  <span>{g.away}</span>
                  <span className="dyn-era-muted text-[12px]">
                    {g.awayScore != null && g.homeScore != null
                      ? `${g.awayScore.toFixed(1)} – ${g.homeScore.toFixed(1)}`
                      : t('dynastyHome.schedule.vs')}
                  </span>
                  <span>{g.home}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  )
}
