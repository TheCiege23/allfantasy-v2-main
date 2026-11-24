'use client'

import { SLEEPER_PROJECTION_TITLE } from '@/lib/redraft/nflRosterOutlookModel'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { UserLeague } from '@/app/dashboard/types'
import type { MatchupCenterPayload, MatchupPlayerSlot } from '@/lib/matchup-center/types'
import { maxWeekForSport } from '@/components/matchup-center/MatchupTabContainer'
import { useLeagueRealtimeRefresh } from '@/hooks/useLeagueRealtimeRefresh'
import { claimRouteRefresh } from '@/components/core-app/routeRefreshClaim'
import { fmt1, formatRecord, initialsOf, pairScoreboard, rowPointTone, shortPlayerName, type ScoreboardRow } from '@/lib/league/native/nativeScreenModels'
import type { NativeBoardGame } from '@/lib/matchup-center/nativeMatchupModel'
import { isNativeGuillotineLeague } from '@/lib/guillotine/nativeGuillotineScreens'
import { GuillotineMatchupScreen } from './NativeGuillotineScreens'
import { isRotisserieLeagueSettings } from '@/lib/category-scoring/nativeCategoryScoringContext'
import { Card, PosPill, ScreenHead, Segmented, OpponentRankChip, PlayerAvatar, PlayerNameButton, WeatherChip, useNativePlayerCard } from './NativeScreenParts'
import { TournamentBracketCard } from './TournamentBracketCard'
import { slotGameState } from '@/lib/league-media/redraftScreens'
import { RedraftScoreBug, RedraftScreen, useRedraftScreen, useRedraftScreenContext } from './RedraftScreenParts'

/**
 * Matchup — handoff §3, `Matchup.png` / `MobileMatchup.png`.
 *
 * Reads two DB-backed routes: `/api/leagues/[id]/matchup-center` (the viewer's matchup, win
 * probability and the deterministic insight copy) and `/api/leagues/[id]/scoring/matchups` (the
 * week's games, for the league scoreboard). Both answer from the league's own season — its schedule,
 * its bracket and the points its scoring counted (lib/matchup-center/nativeMatchupModel.ts). No
 * provider is called from here and no score is computed client-side.
 *
 * THE WEEK IS THE SERVER'S UNTIL THE MANAGER PICKS ONE. This screen used to start on
 * `league.currentWeek ?? 1`, read once on mount, before the league's week had loaded — so it sat on
 * week 1 all season. It now asks for no week, and the routes answer for the season's current one.
 */
type View = 'mine' | 'league'

/** How many games the scoreboard shows beside "My matchup" before offering the full list. */
const SCOREBOARD_GLANCE_GAMES = 8

function sideLine(rec: MatchupCenterPayload['left']['record'], remaining: number) {
  return (
    <>
      {formatRecord(rec)}
      <span> · {remaining} left to play</span>
    </>
  )
}

/** "vs NYG · Sun 1:00 PM" for a game not started; the feed's own label once it has. */
function slotGameLine(p: MatchupPlayerSlot): string {
  const label = p.gameLabel || (p.gameStatus === 'final' ? 'Final' : '—')
  if (String(p.opponent ?? '').toUpperCase() === 'BYE') return 'Bye week'
  if (!p.opponent) return label
  const vs = `${p.outlook?.homeAway === 'away' ? '@' : 'vs'} ${p.opponent}`
  if (p.gameStatus !== 'upcoming') return `${vs} · ${label}`
  const k = p.outlook?.kickoffTimeIso ? new Date(p.outlook.kickoffTimeIso) : null
  return k && Number.isFinite(k.getTime()) ? `${vs} · ${k.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : vs
}

function SlotCell({ p, side, sport }: { p: MatchupPlayerSlot | null; side: 'left' | 'right'; sport: string | null | undefined }) {
  const openCard = useNativePlayerCard(sport)
  // Redraft: a live / final dot from the feed's own game state (none for an unknown state).
  const rd = useRedraftScreenContext()
  if (!p) return <div className="nls-player" data-side={side}><strong className="nls-muted">Empty</strong></div>
  const status = slotGameLine(p)
  const team = p.team ? <span data-long>{p.team} · </span> : null
  const o = p.outlook ?? null
  const media = Boolean(p.headshotUrl || o?.teamLogoUrl)
  const meta = o && p.gameStatus !== 'final' && (o.opponentRank || o.weather) ? (
    <span className="nls-pl-meta">
      <OpponentRankChip id={p.playerId} opponent={p.opponent} rank={o.opponentRank} testIdPrefix="matchup" />
      <WeatherChip id={p.playerId} weather={o.weather} testIdPrefix="matchup" />
    </span>
  ) : null
  return (
    <div className="nls-player" data-side={side}>
      <span className="nls-pl" data-media={media || undefined}>
        {media ? <span className="nls-mavatar"><PlayerAvatar name={p.name} headshotUrl={p.headshotUrl} teamLogoUrl={o?.teamLogoUrl} /></span> : null}
        <span className="nls-pl-text">
          <strong title={p.name}>
            <PlayerNameButton name={p.name} onOpen={() => openCard({ id: p.playerId, name: p.name, position: p.position, team: p.team, imageUrl: p.headshotUrl })}>
              <span className="nls-long">{p.name}</span>
              <span className="nls-short">{shortPlayerName(p.name)}</span>
            </PlayerNameButton>
          </strong>
          <small data-live={p.gameStatus === 'live' || undefined} data-game={rd ? slotGameState(p.gameStatus) ?? undefined : undefined}>
            {side === 'left' ? <>{team}{status}</> : <>{status}{p.team ? <span data-long> · {p.team}</span> : null}</>}
          </small>
          {meta}
        </span>
      </span>
    </div>
  )
}

/** A starter's points, with his AF projection beneath until his game is final. */
function SlotPoints({ p, other, side, show }: { p: MatchupPlayerSlot | null; other: MatchupPlayerSlot | null; side: 'left' | 'right'; show: boolean }) {
  const mine = p?.currentPoints ?? 0
  const theirs = other?.currentPoints ?? 0
  const af = p?.afProjectedPoints != null && Number.isFinite(p.afProjectedPoints) ? p.afProjectedPoints : null
  // A team defense: the AF engine projects none, so Sleeper's number is drawn and named as Sleeper's.
  const sleeper = af == null ? p?.outlook?.providerProjection ?? null : null
  const proj = p && show && p.gameStatus !== 'final' ? af ?? sleeper?.points ?? null : null
  return (
    <span className="nls-pts" data-side={side} data-pts={rowPointTone(mine, theirs, p?.gameStatus === 'final')}>
      {p && show ? (p.gameStatus === 'upcoming' && proj != null ? '—' : mine.toFixed(1)) : '—'}
      {proj != null ? (
        <small data-testid={`matchup-proj-${p!.playerId}`} data-source={sleeper ? 'sleeper' : 'allfantasy'} title={sleeper ? SLEEPER_PROJECTION_TITLE : "AF projection in this league's scoring"}>
          {proj.toFixed(1)}{sleeper ? <span className="nls-proj-src"> Sleeper</span> : null}
        </small>
      ) : null}
    </span>
  )
}

type ScreenProps = { league: UserLeague; onSelectTab: (id: string) => void }

export function NativeMatchupScreen(props: ScreenProps) {
  const rd = useRedraftScreen(props.league)
  const state = String(props.league.lifecycleState ?? props.league.status ?? '').toLowerCase()
  if (['setup', 'pre_draft', 'drafting', 'in_progress'].includes(state)) {
    return <RedraftScreen identity={rd}><div className="nls" data-testid="native-matchup-screen">
      <ScreenHead eyebrow="Matchup" title="Your season starts with the draft" />
      <Card label="Matchups are coming" tone="accent">
        <p>Finish the draft to fill your roster and get ready for weekly matchups.</p>
        <div className="nls-actions"><button type="button" className="nls-btn" data-variant="primary" onClick={() => props.onSelectTab('draft')}>Open Draft HQ</button></div>
      </Card>
    </div></RedraftScreen>
  }
  // Guillotine has no opponent: the tab is the week's scores against the chop line.
  if (isNativeGuillotineLeague(props.league)) return <RedraftScreen identity={rd}><GuillotineMatchupScreen {...props} /></RedraftScreen>
  return <RedraftScreen identity={rd}>{isRotisserieLeagueSettings(props.league.settings) ? <RotisserieMatchupScreen {...props} /> : <HeadToHeadMatchupScreen {...props} />}</RedraftScreen>
}

/**
 * Rotisserie has no weekly opponent. Its matchup rows exist only as scoring containers — the engine
 * pins both scores to 0 (`lib/redraft/scoringEngine.ts`) — so the head-to-head screen would show a
 * 0.0 vs 0.0 "matchup" and a win probability for a game nobody plays. Point at the standings instead.
 */
function RotisserieMatchupScreen({ onSelectTab }: ScreenProps) {
  const rd = useRedraftScreenContext()
  return (
    <div className="nls" data-testid="native-matchup-screen" data-rd-screen={rd ? 'matchup' : undefined}>
      <ScreenHead eyebrow="Rotisserie" title="No weekly matchup" />
      <Card label="How this league is decided" tone="accent">
        <p>
          This is a rotisserie league. Every week&apos;s stats add to your season totals, and teams are ranked in each
          category. Your standing is the sum of those category ranks, so there is no opponent to beat this week.
        </p>
        <div className="nls-card-foot">
          <button type="button" className="nls-btn" data-variant="primary" onClick={() => onSelectTab('standings')}>View category standings</button>
          <button type="button" className="nls-btn" onClick={() => onSelectTab('roster')}>Edit my lineup</button>
        </div>
      </Card>
    </div>
  )
}

function HeadToHeadMatchupScreen({ league, onSelectTab }: ScreenProps) {
  const rd = useRedraftScreenContext()
  const season = useMemo(() => {
    const n = Number(league.season)
    return Number.isFinite(n) && n > 0 ? n : new Date().getFullYear()
  }, [league.season])
  const maxWeek = maxWeekForSport(String(league.sport ?? 'NFL'))
  // null: the league's current week, which the routes resolve. A number: the week the manager picked.
  const [pickedWeek, setPickedWeek] = useState<number | null>(null)
  // A league that plays several games a week: which of the viewer's games the card shows (1-based).
  const [gameNumber, setGameNumber] = useState(1)
  const [view, setView] = useState<View>('mine')
  const [payload, setPayload] = useState<MatchupCenterPayload | null>(null)
  const [board, setBoard] = useState<ScoreboardRow[]>([])
  const [games, setGames] = useState<NativeBoardGame[] | null>(null)
  const [boardWeek, setBoardWeek] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true)
        setError(null)
      }
      const id = encodeURIComponent(league.id)
      const weekQuery = pickedWeek != null ? `&week=${pickedWeek}` : ''
      try {
        const [mRes, bRes] = await Promise.all([
          fetch(`/api/leagues/${id}/matchup-center?season=${season}${weekQuery}${gameNumber > 1 ? `&game=${gameNumber}` : ''}`, { credentials: 'include', cache: 'no-store' }),
          fetch(`/api/leagues/${id}/scoring/matchups?season=${season}${weekQuery}`, { credentials: 'include', cache: 'no-store' }),
        ])
        const mJson = (await mRes.json().catch(() => ({}))) as { payload?: MatchupCenterPayload; error?: string }
        const bJson = (await bRes.json().catch(() => ({}))) as { week?: number; matchups?: ScoreboardRow[]; games?: NativeBoardGame[] }
        if (!mRes.ok) {
          if (!silent) {
            setPayload(null)
            setError(mJson.error ?? 'We could not load this matchup.')
          }
        } else {
          setPayload(mJson.payload ?? null)
        }
        if (bRes.ok) {
          setBoard(Array.isArray(bJson.matchups) ? bJson.matchups : [])
          setGames(Array.isArray(bJson.games) ? bJson.games : null)
          setBoardWeek(typeof bJson.week === 'number' ? bJson.week : null)
        } else if (!silent) {
          setBoard([])
          setGames(null)
        }
      } catch {
        if (!silent) setError('We could not load this matchup.')
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [league.id, season, pickedWeek, gameNumber],
  )

  // The week on screen: the one picked, else the one the routes answered for.
  const week = pickedWeek ?? payload?.week ?? boardWeek ?? Math.min(maxWeek, Math.max(1, league.currentWeek ?? 1))
  const goToWeek = (next: number) => {
    setGameNumber(1)
    setPickedWeek(Math.min(maxWeek, Math.max(1, next)))
  }

  useEffect(() => {
    void load()
  }, [load])
  useLeagueRealtimeRefresh(league.id, () => void load(true))
  useEffect(() => {
    const ms = payload?.refreshIntervalMs
    if (!ms || !Number.isFinite(ms) || ms <= 0) return
    const t = window.setInterval(() => void load(true), ms)
    // While this screen polls its own scores, the league page's 30-second server re-render stands
    // down (LeagueShell, routeRefreshClaim): the two used to run side by side on every tick.
    const release = claimRouteRefresh()
    return () => {
      window.clearInterval(t)
      release()
    }
  }, [payload?.refreshIntervalMs, load])

  const rows = useMemo(() => {
    if (!payload) return []
    const n = Math.max(payload.left.starters.length, payload.right.starters.length)
    return Array.from({ length: n }, (_, i) => {
      const l = payload.left.starters[i] ?? null
      const r = payload.right.starters[i] ?? null
      return { pos: l?.position ?? r?.position ?? '—', l, r }
    })
  }, [payload])
  const pairs = useMemo(() => pairScoreboard(board, payload?.left.rosterId ?? null), [board, payload?.left.rosterId])
  const native = payload?.native ?? null
  // A category league's two numbers are categories won: whole numbers, and no points beside a player.
  const categories = native?.scoreUnit === 'categories'
  const showPlayerPoints = native ? native.playerPointsAvailable : true
  const fmtScore = (n: number) => (categories ? String(Math.round(n)) : n.toFixed(1))
  // A week with no game for this team (a bye, or nothing scheduled): no score card for a game nobody plays.
  const noGame = native != null && native.gameCount === 0

  const prob = payload?.winProbabilityLeft
  const left = payload?.left
  const right = payload?.right
  const leftLeads = left && right ? left.totalPoints >= right.totalPoints : true
  const insight = payload ? (payload.insights.startSit || payload.insights.matchupEdge || '').trim() : ''

  const weekControls = (
    <>
      <Segmented label="Matchup view" value={view} onChange={setView} options={[{ id: 'mine', label: 'My matchup' }, { id: 'league', label: 'League scoreboard' }]} />
      <button type="button" className="nls-iconbtn" aria-label="Previous week" disabled={week <= 1 || loading} onClick={() => goToWeek(week - 1)}>
        <ChevronLeft size={18} aria-hidden />
      </button>
      <button type="button" className="nls-iconbtn" aria-label="Next week" disabled={week >= maxWeek || loading} onClick={() => goToWeek(week + 1)}>
        <ChevronRight size={18} aria-hidden />
      </button>
    </>
  )

  const boardLine = (name: string, pts: number | null, lead: boolean) => (
    <div className="nls-board-line" data-lead={lead}>
      <span>{name}</span>
      <span>{pts == null ? '—' : categories ? String(Math.round(pts)) : fmt1(pts)}</span>
    </div>
  )
  /*
   * The week's games. Beside "My matchup" the list is a glance, not the whole league: a 36-team league
   * that plays five games a week has 90 games, which pushed the page to nine screens (seen on a real
   * league, 2026-11-19). It shows the first few, the viewer's own first, and a way to the full list.
   */
  const boardCard = (limit: number | null) => {
    const shown = games && limit != null && games.length > limit ? games.slice(0, limit) : games
    return (
    <Card label={`League scoreboard · Wk ${week}`}>
      {games && shown ? (
        games.length ? (
          // One line per game, from the league's own schedule and bracket.
          <>
          <ul className="nls-board" data-testid="native-scoreboard">
            {shown.map((g) => {
              const hp = g.home.totalPoints
              const ap = g.away?.totalPoints ?? null
              return (
                <li key={g.id} data-mine={g.mine || undefined} data-state={g.status}>
                  {g.label ? <div className="nls-board-line"><span className="nls-muted">{g.label}</span><span /></div> : null}
                  {boardLine(g.home.teamName, hp, hp != null && ap != null && hp > ap)}
                  {g.away ? boardLine(g.away.teamName, ap, hp != null && ap != null && ap > hp) : <div className="nls-board-line"><span className="nls-muted">Bye</span><span /></div>}
                </li>
              )
            })}
          </ul>
          {shown.length < games.length ? (
            <div className="nls-card-foot">
              <span className="nls-muted nls-mono">{shown.length} of {games.length} games</span>
              <button type="button" className="nls-btn" data-testid="native-scoreboard-all" onClick={() => setView('league')}>See all {games.length} games</button>
            </div>
          ) : null}
          </>
        ) : (
          <p className="nls-muted">No games are scheduled for week {week}.</p>
        )
      ) : pairs.length ? (
        <ul className="nls-board">
          {pairs.map((p) => {
            const hp = p.home.totalPoints ?? null
            const ap = p.away?.totalPoints ?? null
            return (
              <li key={p.home.rosterId} data-mine={p.mine || undefined}>
                {boardLine(p.home.teamName, hp, hp != null && ap != null && hp > ap)}
                {p.away ? boardLine(p.away.teamName, ap, hp != null && ap != null && ap > hp) : <div className="nls-board-line"><span className="nls-muted">Bye</span><span /></div>}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="nls-muted">Scores appear here once week {week} is scored.</p>
      )}
    </Card>
    )
  }
  const scoreboard = boardCard(null)
  const scoreboardGlance = boardCard(SCOREBOARD_GLANCE_GAMES)

  // A league that plays more than one game a week: the viewer's other games, each one a tap away.
  const otherGames = native && native.gameCount > 1 ? (
    <Card label={`Your games this week · ${native.gameNumber} of ${native.gameCount}`}>
      <div className="nls-actions" data-testid="native-matchup-games">
        {Array.from({ length: native.gameCount }, (_, i) => (
          <button key={i} type="button" className="nls-btn" data-variant={native.gameNumber === i + 1 ? 'primary' : undefined} aria-pressed={native.gameNumber === i + 1} disabled={loading} onClick={() => setGameNumber(i + 1)}>
            Game {i + 1}
          </button>
        ))}
      </div>
      <ul className="nls-board">
        {native.otherGames.map((g) => (
          <li key={g.id} data-state={g.status}>
            {boardLine(g.home.teamName, g.home.totalPoints, false)}
            {g.away ? boardLine(g.away.teamName, g.away.totalPoints, false) : null}
          </li>
        ))}
      </ul>
    </Card>
  ) : null

  return (
    <div className="nls" data-testid="native-matchup-screen" data-rd-screen={rd ? 'matchup' : undefined}>
      <ScreenHead eyebrow="Matchup" title={`Week ${week}`}>
        {weekControls}
      </ScreenHead>

      {error ? <p className="nls-error" role="alert">{error}</p> : null}
      {loading && !payload ? <p className="nls-empty" role="status">Loading matchup…</p> : null}
      {/* No team in this league (a commissioner who does not play): the week's games still show. */}
      {!payload && !loading && games?.length ? scoreboard : null}
      {native?.gameLabel ? <p className="nls-overlay" data-testid="native-matchup-round">{native.gameLabel}</p> : null}
      {noGame ? (
        <p className="nls-empty" role="status" data-testid="native-matchup-no-game">
          {native?.bye ? `Your team has a bye in week ${week}.` : `Your team has no game in week ${week}.`}
        </p>
      ) : null}

      {/* Redraft: the broadcast score bug (same payload, same numbers). Every other format: the score card. */}
      {payload && left && right && rd && !noGame ? <RedraftScoreBug payload={payload} week={week} /> : null}
      {payload && left && right && !rd && !noGame ? (
        <section className="nls-card nls-card-flush" aria-label="Score">
          {payload.conceptOverlay ? <p className="nls-overlay">{payload.conceptOverlay}</p> : null}
          <div className="nls-score">
            <div className="nls-side" data-side="left">
              <span className="nls-avatar" aria-hidden>{initialsOf(left.teamName)}</span>
              <div className="nls-side-name">
                <strong>{left.teamName}</strong>
                <small>{sideLine(left.record, left.remainingStarters)}</small>
              </div>
            </div>
            <div className="nls-score-mid">
              <div className="nls-score-nums" aria-label={`${left.teamName} ${fmtScore(left.totalPoints)}, ${right.teamName} ${fmtScore(right.totalPoints)}`}>
                <b data-lead={leftLeads}>{fmtScore(left.totalPoints)}</b>
                <span>vs</span>
                <b data-lead={!leftLeads}>{fmtScore(right.totalPoints)}</b>
              </div>
            </div>
            <div className="nls-side" data-side="right">
              <span className="nls-avatar" aria-hidden>{initialsOf(right.teamName)}</span>
              <div className="nls-side-name">
                <strong>{right.teamName}</strong>
                <small>{sideLine(right.record, right.remainingStarters)}</small>
              </div>
            </div>
            <div className="nls-prob">
              {prob != null ? (
                <>
                  <div className="nls-probbar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(prob * 100)} aria-label={`${left.teamName} win probability`}>
                    <span style={{ width: `${(prob * 100).toFixed(1)}%` }} />
                    <span />
                  </div>
                  <p className="nls-probline">
                    AF win prob <b>{Math.round(prob * 100)}%</b>
                    {!left.projectedTotalIncludesFallback && !right.projectedTotalIncludesFallback ? ` · proj ${fmt1(left.projectedTotal)} – ${fmt1(right.projectedTotal)}` : ''}
                  </p>
                </>
              ) : (
                <p className="nls-probline">Win probability needs real projections for every starter.</p>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {/* Divisions-tournament conference leagues, bracket weeks only: the entrant's bracket game. */}
      <TournamentBracketCard leagueId={league.id} settings={league.settings} week={week} />

      {payload ? (
        <div className="nls-cols">
          {view === 'mine' ? (
            <section className="nls-card nls-card-flush" aria-label="Starters">
              <h3 className="nls-label nls-card-head">Starters</h3>
              {rows.length ? (
                <ul className="nls-rows">
                  {rows.map((row, i) => {
                    return (
                      <li key={`${row.pos}-${i}`} className="nls-mrow">
                        <SlotCell p={row.l} side="left" sport={league.sport} />
                        <SlotPoints p={row.l} other={row.r} side="left" show={showPlayerPoints} />
                        <PosPill label={row.pos} />
                        <SlotPoints p={row.r} other={row.l} side="right" show={showPlayerPoints} />
                        <SlotCell p={row.r} side="right" sport={league.sport} />
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="nls-empty">No starters yet for week {payload.week}. Set your lineup, or check back once the week is scored.</p>
              )}
              <div className="nls-card-foot">
                <span className="nls-muted nls-mono">{payload.matchupStatus === 'final' ? 'Final' : payload.matchupStatus === 'live' ? 'Live' : 'Upcoming'}</span>
                <button type="button" className="nls-btn" onClick={() => onSelectTab('roster')}>Edit my lineup</button>
              </div>
            </section>
          ) : (
            scoreboard
          )}
          <aside className="nls-aside" aria-label="Matchup insight">
            <Card label="Chimmy · AF edge" tone="accent">
              <p>{insight || 'No edge to report for this week yet.'}</p>
              <button type="button" className="nls-btn" data-variant="primary" data-block="true" onClick={() => onSelectTab('roster')}>Review lineup</button>
            </Card>
            {otherGames}
            {view === 'mine' ? scoreboardGlance : null}
          </aside>
        </div>
      ) : null}
    </div>
  )
}
