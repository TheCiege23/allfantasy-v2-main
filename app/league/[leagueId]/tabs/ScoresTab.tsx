'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { useSleeperPlayers } from '@/lib/hooks/useSleeperPlayers'
import { IDPMatchupView } from '@/app/idp/components/IDPMatchupView'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { StartVsComparisonLauncher } from '@/components/app/player-comparison/StartVsComparisonLauncher'
import { GameWeatherInline } from '@/components/sports/GameWeatherInline'
import { TeamLogo } from '@/app/components/TeamLogo'
import type { GameWeather } from '@/hooks/usePhase1Data'

type LiveScoreGame = {
  gameId: string
  homeTeam: string
  homeTeamFull: string
  homeScore: number
  awayTeam: string
  awayTeamFull: string
  awayScore: number
  status: string
  statusDetail: string
  period: number
  clock: string
  completed: boolean
  startTime: string
  venue: string | null
  broadcast: string | null
  week: number | null
}

type LiveScoresPayload = {
  sport: string
  scores: LiveScoreGame[]
  count: number
  source: string
  hasLiveGames: boolean
  fetchedAt: string | null
}

function formatKickoff(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function statusLabel(g: LiveScoreGame): { label: string; tone: 'live' | 'final' | 'upcoming' } {
  if (g.completed || g.status === 'STATUS_FINAL') return { label: 'Final', tone: 'final' }
  if (g.status === 'STATUS_IN_PROGRESS' || g.status === 'STATUS_HALFTIME') {
    return {
      label: g.status === 'STATUS_HALFTIME' ? 'Halftime' : g.clock || `Q${g.period}`,
      tone: 'live',
    }
  }
  return { label: formatKickoff(g.startTime), tone: 'upcoming' }
}

export type ScoresTabProps = {
  league: UserLeague
  sport?: string
  idpLeagueUi?: boolean
}

function maxWeekForSport(sportU: string): number {
  switch (sportU) {
    case 'NBA':
    case 'NHL':
      return 24
    case 'MLB':
      return 27
    case 'SOCCER':
      return 38
    case 'NCAAB':
      return 35
    default:
      return 18
  }
}

function positionPillsForSport(sportU: string): string[] {
  if (sportU === 'NBA') return ['All', 'PG', 'SG', 'SF', 'PF', 'C']
  if (sportU === 'NHL') return ['All', 'C', 'LW', 'RW', 'D', 'G']
  if (sportU === 'MLB') return ['All', 'P', 'C', '1B', '2B', '3B', 'SS', 'OF']
  return ['All', 'QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB']
}

function GameDayLeadersEmpty({ sportU }: { sportU: string }) {
  const isNflLike = ['NFL', 'NCAAF'].includes(sportU)
  return (
    <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
      <div className="mb-6 text-white/[0.12]" aria-hidden>
        {isNflLike ? (
          <svg viewBox="0 0 200 120" className="mx-auto h-32 w-auto md:h-36">
            <ellipse cx="100" cy="95" rx="42" ry="14" fill="currentColor" opacity="0.35" />
            <path
              d="M72 88c2-18 18-32 28-32s26 14 28 32c-8 4-16 6-28 6s-20-2-28-6z"
              fill="currentColor"
              opacity="0.45"
            />
            <ellipse cx="100" cy="78" rx="22" ry="12" fill="currentColor" opacity="0.55" />
            <path
              d="M96 68h8v6l-4 3-4-3v-6z"
              fill="currentColor"
              opacity="0.4"
            />
            <line x1="100" y1="20" x2="100" y2="62" stroke="currentColor" strokeWidth="3" opacity="0.35" />
            <path d="M85 20h30l-6 8h-18l-6-8z" fill="currentColor" opacity="0.35" />
            <line x1="70" y1="55" x2="130" y2="55" stroke="currentColor" strokeWidth="1.5" opacity="0.2" />
            <line x1="75" y1="48" x2="125" y2="48" stroke="currentColor" strokeWidth="1.5" opacity="0.15" />
          </svg>
        ) : (
          <svg viewBox="0 0 200 120" className="mx-auto h-28 w-auto md:h-32 text-white/[0.15]">
            <circle cx="100" cy="65" r="28" fill="none" stroke="currentColor" strokeWidth="3" />
            <path
              d="M100 37v56M82 65h36"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        )}
      </div>
      <p className="text-base font-semibold text-white">Players have yet to play</p>
      <p className="mt-2 max-w-sm text-sm text-white/40">
        Game day leaders will show here once games begin
      </p>
    </div>
  )
}

export function ScoresTab({ league, sport, idpLeagueUi = false }: ScoresTabProps) {
  const resolved = normalizeToSupportedSport(sport ?? league.sport) ?? 'NFL'
  const sportU = resolved.toUpperCase()
  const maxWeek = maxWeekForSport(sportU)
  const initialWeek = useMemo(() => {
    const cw = league.currentWeek
    if (typeof cw === 'number' && Number.isFinite(cw)) {
      return Math.min(maxWeek, Math.max(1, Math.floor(cw)))
    }
    return 1
  }, [league.currentWeek, maxWeek])

  const [week, setWeek] = useState(initialWeek)
  const [pos, setPos] = useState<string>('All')
  const [scoresNav, setScoresNav] = useState<'leaders' | 'matchups'>('leaders')
  const { players } = useSleeperPlayers(resolved)

  // Live scores from RI → ESPN → DB cache via /api/sports/live-scores.
  const [scoresLoading, setScoresLoading] = useState(true)
  const [scoresError, setScoresError] = useState<string | null>(null)
  const [scoresPayload, setScoresPayload] = useState<LiveScoresPayload | null>(null)

  const loadScores = useCallback(async () => {
    setScoresLoading(true)
    setScoresError(null)
    try {
      const r = await fetch(`/api/sports/live-scores?sport=${encodeURIComponent(resolved)}`, {
        cache: 'no-store',
      })
      const j = (await r.json().catch(() => null)) as LiveScoresPayload | null
      if (!r.ok || !j || !Array.isArray(j.scores)) {
        setScoresPayload(null)
        setScoresError('Could not load live scores.')
      } else {
        setScoresPayload(j)
      }
    } catch (e) {
      setScoresPayload(null)
      setScoresError(e instanceof Error ? e.message : 'Could not load live scores.')
    } finally {
      setScoresLoading(false)
    }
  }, [resolved])

  useEffect(() => {
    void loadScores()
  }, [loadScores])

  // Auto-refresh while live games are in progress.
  useEffect(() => {
    if (!scoresPayload?.hasLiveGames) return
    const id = setInterval(() => void loadScores(), 60_000)
    return () => clearInterval(id)
  }, [scoresPayload?.hasLiveGames, loadScores])

  // Weather data for inline display
  const [weatherData, setWeatherData] = useState<GameWeather[]>([])
  useEffect(() => {
    fetch(`/api/sports/weather?sport=${encodeURIComponent(resolved)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const items = Array.isArray(d?.weather) ? d.weather : Array.isArray(d?.data) ? d.data : []
        setWeatherData(items)
      })
      .catch(() => {})
  }, [resolved])

  const gamesForWeek = useMemo<LiveScoreGame[]>(() => {
    const all = scoresPayload?.scores ?? []
    if (!all.length) return []
    const matchingWeek = all.filter((g) => g.week === week)
    // If RI/ESPN didn't tag week numbers, just show whatever is in the feed.
    return matchingWeek.length > 0 ? matchingWeek : all
  }, [scoresPayload, week])

  const pills = useMemo(() => positionPillsForSport(sportU), [sportU])

  const weekOptions = useMemo(() => Array.from({ length: maxWeek }, (_, i) => i + 1), [maxWeek])

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-sport={resolved} data-testid="scores-game-center">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-4 pb-4 pt-4 md:px-5 md:pt-5">
        <h1 className="text-xl font-bold tracking-tight text-white md:text-2xl">Game Center</h1>
        <label className="relative shrink-0">
          <span className="sr-only">Select week</span>
          <select
            value={week}
            onChange={(e) => setWeek(Number(e.target.value))}
            className="min-w-[180px] appearance-none rounded-full border border-white/[0.1] bg-[#07071a] py-2 pl-4 pr-10 text-[13px] font-medium text-white/90 shadow-inner focus:border-[#ff3d81]/35 focus:outline-none focus:ring-1 focus:ring-[#ff3d81]/25"
            data-testid="scores-week-select"
          >
            {weekOptions.map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-white/40">
            ▾
          </span>
        </label>
      </div>

      {/* Weather strip */}
      {weatherData.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-white/[0.06] px-4 py-2 md:px-5">
          {weatherData.slice(0, 8).map((w, i) => (
            <div key={`${w.team}-${i}`} className="flex items-center gap-1.5 text-[11px] text-white/50">
              <span className="font-medium text-white/70">{w.team}</span>
              <GameWeatherInline weather={w} />
            </div>
          ))}
        </div>
      )}

      <div className="border-b border-white/[0.06] px-4 pb-3 md:px-5">
        <div className="rounded-xl border border-white/[0.08] bg-[#0a1228]/40 p-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-white/45">Start A vs B</p>
          <StartVsComparisonLauncher
            leagueId={league.id}
            sport={resolved}
            weekOrPeriod={`Week ${week}`}
            showNameInputs
          />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 md:grid-cols-[200px_minmax(0,1fr)] md:gap-0">
        {/* Sidebar */}
        <aside className="border-b border-white/[0.06] md:border-b-0 md:border-r md:border-white/[0.06]">
          <nav className="flex gap-2 p-3 md:flex-col md:p-4" aria-label="Game center sections">
            <button
              type="button"
              onClick={() => setScoresNav('leaders')}
              className={`relative flex items-center gap-2 rounded-xl py-2.5 pl-3 pr-3 text-left text-[11px] font-bold uppercase tracking-[0.12em] transition md:w-full ${
                scoresNav === 'leaders'
                  ? 'bg-white/[0.06] text-white shadow-inner ring-1 ring-white/[0.08] before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:rounded-r before:bg-[#ff3d81]'
                  : 'text-white/45 hover:bg-white/[0.04] hover:text-white/70'
              }`}
              data-testid="scores-nav-leaders"
            >
              <span className="text-[14px]" aria-hidden>
                🏈
              </span>
              Game day leaders
            </button>
            {idpLeagueUi ? (
              <button
                type="button"
                onClick={() => setScoresNav('matchups')}
                className={`relative rounded-xl py-2.5 pl-3 pr-3 text-left text-[11px] font-bold uppercase tracking-[0.12em] transition md:w-full ${
                  scoresNav === 'matchups'
                    ? 'bg-white/[0.06] text-white shadow-inner ring-1 ring-white/[0.08] before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:rounded-r before:bg-[#ff3d81]'
                    : 'text-white/45 hover:bg-white/[0.04] hover:text-white/70'
                }`}
                data-testid="scores-nav-matchups"
              >
                Matchups
              </button>
            ) : null}
          </nav>
        </aside>

        {/* Main */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {scoresNav === 'leaders' ? (
            <>
              <div className="sticky top-0 z-[1] border-b border-white/[0.05] bg-[#07071a]/95 px-3 py-3 backdrop-blur-sm md:px-5">
                <div className="flex flex-wrap gap-1.5">
                  {pills.map((p) => {
                    const active = pos === p
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPos(p)}
                        className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                          active
                            ? 'bg-[#ff3d81]/25 text-[#ffd7e5] ring-1 ring-[#ff3d81]/35'
                            : 'bg-white/[0.04] text-white/55 hover:bg-white/[0.07] hover:text-white/80'
                        }`}
                        data-testid={`scores-pos-${p.toLowerCase()}`}
                      >
                        {p}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-5">
                {scoresLoading ? (
                  <p className="px-2 py-10 text-center text-sm text-white/40">Loading games…</p>
                ) : scoresError ? (
                  <p className="px-2 py-10 text-center text-sm text-amber-300/85">{scoresError}</p>
                ) : gamesForWeek.length === 0 ? (
                  <GameDayLeadersEmpty sportU={sportU} />
                ) : (
                  <ul className="grid gap-2 md:grid-cols-2" data-testid="scores-games-list">
                    {gamesForWeek.map((g) => {
                      const status = statusLabel(g)
                      const toneClass =
                        status.tone === 'live'
                          ? 'bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/30'
                          : status.tone === 'final'
                            ? 'bg-white/[0.05] text-white/60 ring-1 ring-white/[0.08]'
                            : 'bg-[#ff3d81]/10 text-[#ffd7e5]/85 ring-1 ring-[#ff3d81]/25'
                      const homeWin = g.completed && g.homeScore > g.awayScore
                      const awayWin = g.completed && g.awayScore > g.homeScore
                      return (
                        <li
                          key={g.gameId}
                          className="rounded-xl border border-white/[0.07] bg-[#0a1228] p-3"
                          data-testid={`scores-game-${g.gameId}`}
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${toneClass}`}>
                              {status.label}
                            </span>
                            {g.broadcast ? (
                              <span className="truncate text-[10px] text-white/40">{g.broadcast}</span>
                            ) : null}
                          </div>
                          <div className="space-y-1.5">
                            <div className={`flex items-center justify-between gap-2 ${awayWin ? 'text-white' : 'text-white/75'}`}>
                              <span className="flex min-w-0 items-center gap-2">
                                <TeamLogo teamAbbr={g.awayTeam} sport={resolved} size={20} />
                                <span className="truncate text-[13px] font-semibold">{g.awayTeamFull || g.awayTeam}</span>
                              </span>
                              <span className="shrink-0 text-[15px] font-bold tabular-nums">
                                {status.tone === 'upcoming' ? '—' : g.awayScore}
                              </span>
                            </div>
                            <div className={`flex items-center justify-between gap-2 ${homeWin ? 'text-white' : 'text-white/75'}`}>
                              <span className="flex min-w-0 items-center gap-2">
                                <TeamLogo teamAbbr={g.homeTeam} sport={resolved} size={20} />
                                <span className="truncate text-[13px] font-semibold">{g.homeTeamFull || g.homeTeam}</span>
                              </span>
                              <span className="shrink-0 text-[15px] font-bold tabular-nums">
                                {status.tone === 'upcoming' ? '—' : g.homeScore}
                              </span>
                            </div>
                          </div>
                          {g.venue ? (
                            <p className="mt-2 text-[10px] text-white/35">{g.venue}</p>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                )}
                {scoresPayload?.source ? (
                  <p className="mt-3 px-1 text-center text-[10px] text-white/30">
                    Source: {scoresPayload.source.replace(/_/g, ' ')} · {scoresPayload.scores.length} games
                  </p>
                ) : null}
              </div>
            </>
          ) : idpLeagueUi ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
              <IDPMatchupView
                leagueId={league.id}
                yourTeamName="Your team"
                oppTeamName="Opponent"
                week={week}
                sport={resolved}
                yourOffenseIds={[]}
                oppOffenseIds={[]}
                yourDefenseIds={['4040', '4041', '4042']}
                oppDefenseIds={['4043', '4044', '4045']}
                players={players}
                live
              />
            </div>
          ) : null}
        </main>
      </div>
    </div>
  )
}
