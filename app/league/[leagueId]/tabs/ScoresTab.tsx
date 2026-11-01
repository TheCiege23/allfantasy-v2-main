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
import { resolveRedraftIdentity } from '@/lib/league-media/redraftIdentity'
import { positionPillsForSport, scoreBugStatus, sportGlyph } from '@/lib/league-media/redraftScoreBug'
import './redraft-tailwind-tabs.css'

type LiveScoreGame = {
  gameId: string
  homeTeam: string
  homeTeamFull: string
  /** Crest URL resolved server-side (ESPN feed, or the CFBD directory for college). May be ''. */
  homeLogo?: string | null
  homeScore: number
  awayTeam: string
  awayTeamFull: string
  awayLogo?: string | null
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

function GameDayLeadersEmpty({ sportU }: { sportU: string }) {
  const isNflLike = ['NFL', 'NCAAF'].includes(sportU)
  return (
    <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
      <div className="mb-6 rdt-faint opacity-40" aria-hidden>
        {isNflLike ? (
          <svg viewBox="0 0 200 120" className="mx-auto h-32 w-auto md:h-36">
            <ellipse cx="100" cy="95" rx="42" ry="14" fill="currentColor" opacity="0.35" />
            <path d="M72 88c2-18 18-32 28-32s26 14 28 32c-8 4-16 6-28 6s-20-2-28-6z" fill="currentColor" opacity="0.45" />
            <ellipse cx="100" cy="78" rx="22" ry="12" fill="currentColor" opacity="0.55" />
            <path d="M96 68h8v6l-4 3-4-3v-6z" fill="currentColor" opacity="0.4" />
            <line x1="100" y1="20" x2="100" y2="62" stroke="currentColor" strokeWidth="3" opacity="0.35" />
            <path d="M85 20h30l-6 8h-18l-6-8z" fill="currentColor" opacity="0.35" />
            <line x1="70" y1="55" x2="130" y2="55" stroke="currentColor" strokeWidth="1.5" opacity="0.2" />
            <line x1="75" y1="48" x2="125" y2="48" stroke="currentColor" strokeWidth="1.5" opacity="0.15" />
          </svg>
        ) : (
          <svg viewBox="0 0 200 120" className="mx-auto h-28 w-auto md:h-32">
            <circle cx="100" cy="65" r="28" fill="none" stroke="currentColor" strokeWidth="3" />
            <path d="M100 37v56M82 65h36" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        )}
      </div>
      <p className="text-base font-semibold rdt-text">Players have yet to play</p>
      <p className="mt-2 max-w-sm text-sm rdt-muted">Game day leaders will show here once games begin</p>
    </div>
  )
}

/**
 * One game as a broadcast score bug: a status bar (LIVE in the alert colour, FINAL neutral, the start
 * time in the league accent), then a row per club with a heavy tabular score. The winner's row is
 * lit with the accent bar; the loser's reads muted. Real feed values only — an upcoming game shows "—".
 */
function ScoreBug({ g, sportU, resolved }: { g: LiveScoreGame; sportU: string; resolved: string }) {
  const status = scoreBugStatus(sportU, g)
  const homeWin = g.completed && g.homeScore > g.awayScore
  const awayWin = g.completed && g.awayScore > g.homeScore
  const rows = [
    { side: 'away', abbr: g.awayTeam, full: g.awayTeamFull, logo: g.awayLogo, score: g.awayScore, win: awayWin, lose: homeWin },
    { side: 'home', abbr: g.homeTeam, full: g.homeTeamFull, logo: g.homeLogo, score: g.homeScore, win: homeWin, lose: awayWin },
  ]
  return (
    <li className="rdt-bug" data-tone={status.tone} data-testid={`scores-game-${g.gameId}`}>
      <div className="rdt-bug-bar">
        <span className="rdt-bug-status">
          {status.tone === 'live' ? <span className="rdt-bug-dot" aria-hidden /> : null}
          <span>{status.tone === 'live' && status.label !== 'Live' ? `Live · ${status.label}` : status.label}</span>
        </span>
        {g.broadcast ? <span className="rdt-bug-net">{g.broadcast}</span> : null}
      </div>
      <div className="rdt-bug-rows">
        {rows.map((r) => (
          <div key={r.side} className="rdt-bug-row" data-win={r.win ? 'true' : r.lose ? 'false' : undefined}>
            <span className="rdt-bug-stripe" aria-hidden />
            <TeamLogo teamAbbr={r.abbr} sport={resolved} logoUrl={r.logo} size={24} />
            <span className="rdt-bug-team">
              <span className="rdt-bug-abbr">{r.abbr}</span>
              {r.full && r.full !== r.abbr ? <span className="rdt-bug-name">{r.full}</span> : null}
            </span>
            <span className="rdt-bug-score">{status.tone === 'upcoming' ? '—' : r.score}</span>
          </div>
        ))}
      </div>
      {g.venue ? <p className="rdt-bug-foot">{g.venue}</p> : null}
    </li>
  )
}

export function ScoresTab({ league, sport, idpLeagueUi = false }: ScoresTabProps) {
  const resolved = normalizeToSupportedSport(sport ?? league.sport) ?? 'NFL'
  const sportU = resolved.toUpperCase()
  const identity = resolveRedraftIdentity(league)
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

  const liveCount = useMemo(
    () => gamesForWeek.filter((g) => scoreBugStatus(sportU, g).tone === 'live').length,
    [gamesForWeek, sportU],
  )

  const pills = useMemo(() => positionPillsForSport(sportU), [sportU])

  const weekOptions = useMemo(() => Array.from({ length: maxWeek }, (_, i) => i + 1), [maxWeek])

  return (
    <div
      className="rdt flex min-h-0 flex-1 flex-col"
      data-sport={resolved}
      data-redraft={identity ? 'true' : undefined}
      data-testid="scores-game-center"
    >
      {/* Header */}
      <div className="rdt-head rdt-line border-b px-4 pb-4 pt-4 md:px-5 md:pt-5">
        <div>
          <p className={`rdt-eyebrow ${identity ? 'rdt-eyebrow-accent' : ''}`}>
            {identity ? `Redraft · ${identity.sportLabel} · Week ${week}` : `${sportU} · Week ${week}`}
          </p>
          <h1>Game Center</h1>
          <p className="rdt-head-sub">
            {liveCount > 0 ? `${liveCount} live now · ` : ''}
            {gamesForWeek.length} {gamesForWeek.length === 1 ? 'game' : 'games'} on the board
          </p>
        </div>
        <label className="relative shrink-0">
          <span className="sr-only">Select week</span>
          <select
            value={week}
            onChange={(e) => setWeek(Number(e.target.value))}
            className="rdt-select"
            data-testid="scores-week-select"
          >
            {weekOptions.map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[11px] rdt-faint">▾</span>
        </label>
      </div>

      {/* Weather strip */}
      {weatherData.length > 0 && (
        <div className="rdt-line flex flex-wrap gap-2 border-b px-4 py-2 md:px-5">
          {weatherData.slice(0, 8).map((w, i) => (
            <div key={`${w.team}-${i}`} className="flex items-center gap-1.5 text-[11px] rdt-muted">
              <span className="font-medium rdt-text2">{w.team}</span>
              <GameWeatherInline weather={w} />
            </div>
          ))}
        </div>
      )}

      <div className="rdt-line border-b px-4 py-3 md:px-5">
        <div className="rdt-card rdt-bridge p-3">
          <p className="rdt-eyebrow mb-2">Start A vs B</p>
          <StartVsComparisonLauncher leagueId={league.id} sport={resolved} weekOrPeriod={`Week ${week}`} showNameInputs />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 md:grid-cols-[200px_minmax(0,1fr)] md:gap-0">
        {/* Sidebar */}
        <aside className="rdt-line rdt-side border-b md:border-b-0 md:border-r">
          <nav className="flex gap-2 p-3 md:flex-col md:p-4" aria-label="Game center sections">
            <button
              type="button"
              onClick={() => setScoresNav('leaders')}
              aria-current={scoresNav === 'leaders' ? 'true' : undefined}
              className="flex items-center gap-2 rounded-xl py-2.5 pl-3 pr-3 text-left text-[11px] font-bold uppercase tracking-[0.12em] transition md:w-full"
              data-testid="scores-nav-leaders"
            >
              <span className="text-[14px]" aria-hidden>
                {sportGlyph(sportU)}
              </span>
              Game day leaders
            </button>
            {idpLeagueUi ? (
              <button
                type="button"
                onClick={() => setScoresNav('matchups')}
                aria-current={scoresNav === 'matchups' ? 'true' : undefined}
                className="rounded-xl py-2.5 pl-3 pr-3 text-left text-[11px] font-bold uppercase tracking-[0.12em] transition md:w-full"
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
              <div className="rdt-sticky rdt-line sticky top-0 z-[1] border-b px-3 py-3 backdrop-blur-sm md:px-5">
                <div className="rdt-pills flex flex-wrap gap-1.5">
                  {pills.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPos(p)}
                      aria-pressed={pos === p}
                      className="rounded-full px-3 py-1.5 text-[11px] font-semibold transition"
                      data-testid={`scores-pos-${p.toLowerCase()}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-5">
                {scoresLoading ? (
                  <p className="px-2 py-10 text-center text-sm rdt-muted">Loading games…</p>
                ) : scoresError ? (
                  <p className="px-2 py-10 text-center text-sm rdt-warn">{scoresError}</p>
                ) : gamesForWeek.length === 0 ? (
                  <GameDayLeadersEmpty sportU={sportU} />
                ) : (
                  <ul className="rdt-bugs" data-testid="scores-games-list">
                    {gamesForWeek.map((g) => (
                      <ScoreBug key={g.gameId} g={g} sportU={sportU} resolved={resolved} />
                    ))}
                  </ul>
                )}
                {scoresPayload?.source ? (
                  <p className="mt-3 px-1 text-center text-[11px] rdt-faint">
                    Source: {scoresPayload.source.replace(/_/g, ' ')} · {scoresPayload.scores.length} games
                  </p>
                ) : null}
              </div>
            </>
          ) : idpLeagueUi ? (
            <div className="rdt-bridge min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
              {/*
                The team names, the rosters and the scoreboard all come from the league now. This
                previously passed the literal ids ['4040','4041','4042'] against
                ['4043','4044','4045'] with the names "Your team" and "Opponent".
              */}
              <IDPMatchupView leagueId={league.id} sport={resolved} live />
            </div>
          ) : null}
        </main>
      </div>
    </div>
  )
}
