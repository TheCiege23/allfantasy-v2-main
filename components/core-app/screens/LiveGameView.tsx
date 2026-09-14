'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MiniPlayerImg from '@/components/MiniPlayerImg'
import type {
  BaseballAtBat,
  BaseballBoxTable,
  BaseballBoxTeam,
  BaseballDetail,
  BasketballBoxPlayer,
  BasketballBoxTeam,
  BasketballDetail,
  BasketballPlay,
  BasketballShot,
  GameDetailDrive,
  GameDetailLeader,
  GameDetailPlay,
  GameDetailPlayerLine,
  GameDetailTeam,
  HockeyBoxTeam,
  HockeyDetail,
  HockeyPlay,
  HockeyPlayer,
  HockeyShot,
  LiveGameDetail,
} from '@/lib/live/espnGameSummary'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-live.css'

/**
 * The clicked-game view ("gamecast") — one game in depth, opened from a score
 * card on `/core/live` or `/live`.
 *
 * Everything here is ESPN's per-game summary as trimmed by `trimEspnGameSummary`
 * and cached by `getEspnGameSummary`. It opens as `?game=<id>` on the existing
 * live pages and polls the existing `/api/dashboard/live-scores?view=game` — no
 * new route, because the repo is at its route ceiling.
 *
 * Honesty rules carried over from the cards:
 *   - the win % shown is ESPN's own figure and is labelled as ESPN's;
 *   - a failed refresh keeps the last good game on screen and says so, rather
 *     than blanking a live game;
 *   - the drive field draws a ball only where the feed's text placed one.
 */

export type GameViewPayload = { detail: LiveGameDetail | null; stale: boolean; failed: boolean }

const LIVE_POLL_MS = 20_000
const IDLE_POLL_MS = 120_000
const YARD_MARKS = [10, 20, 30, 40, 50, 60, 70, 80, 90]

export function LiveGameView({
  initial,
  sport,
  gameId,
  backHref,
}: {
  initial: GameViewPayload | null
  sport: string
  gameId: string
  backHref: string
}) {
  const [payload, setPayload] = useState<GameViewPayload | null>(initial)
  const [tab, setTab] = useState<'scoring' | 'all'>('scoring')
  const seq = useRef(0)
  const detail = payload?.detail ?? null
  const state = detail?.status.state ?? 'pre'

  const load = useCallback(async () => {
    const mine = ++seq.current
    try {
      const res = await fetch(
        `/api/dashboard/live-scores?view=game&sport=${encodeURIComponent(sport)}&game=${encodeURIComponent(gameId)}`,
        { cache: 'no-store' },
      )
      if (!res.ok) return
      const next = (await res.json()) as GameViewPayload
      if (mine !== seq.current) return
      // A failed read never replaces a game already on screen; it marks it stale.
      setPayload((prev) => (next.detail ? next : prev?.detail ? { ...prev, stale: true } : next))
    } catch {
      setPayload((prev) => (prev?.detail ? { ...prev, stale: true } : prev))
    }
  }, [sport, gameId])

  useEffect(() => {
    // A final does not change; polling it would only spend requests.
    if (state === 'post') return
    const id = window.setInterval(() => void load(), state === 'in' ? LIVE_POLL_MS : IDLE_POLL_MS)
    return () => window.clearInterval(id)
  }, [load, state])

  if (!detail) {
    return (
      <div className="af-live af-gv">
        <Link className="af-gv-back" href={backHref}>
          ← Live Scores
        </Link>
        <div className="af-live-empty" data-tone={payload?.failed ? 'bad' : undefined}>
          <p className="af-live-empty-title">
            {payload?.failed ? 'We could not load this game right now.' : 'No game view for this game.'}
          </p>
          <p className="af-live-empty-body">
            {payload?.failed
              ? 'This is a problem on our end, not the game. Retrying automatically.'
              : 'Game views are available for NFL, college football, NBA, WNBA, college basketball, NHL, MLB and college baseball games.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="af-live af-gv" data-state={state}>
      <Link className="af-gv-back" href={backHref}>
        ← Live Scores
      </Link>

      <GameHeader detail={detail} />

      {payload?.stale ? (
        <p className="af-gv-stale" role="status">
          Showing the last update we have — the latest refresh did not come through. Retrying.
        </p>
      ) : null}

      <div className="af-gv-grid">
        <div className="af-gv-col" data-col="side">
          <LeadersPanel detail={detail} />
          {detail.baseball ? <DecisionsPanel detail={detail} baseball={detail.baseball} /> : null}
          <TeamStatsPanel detail={detail} />
        </div>
        <div className="af-gv-col" data-col="main">
          {detail.baseball ? (
            <>
              {state === 'in' ? <AtBatPanel detail={detail} baseball={detail.baseball} /> : null}
              <SprayChart detail={detail} baseball={detail.baseball} />
              {detail.lastPlay ? (
                <section className="af-gv-card" aria-labelledby="af-gv-lastplay-mlb">
                  <h2 className="af-label" id="af-gv-lastplay-mlb">
                    Last play
                  </h2>
                  <LastPlay detail={detail} play={detail.lastPlay} />
                </section>
              ) : null}
              <BaseballPlayByPlay detail={detail} baseball={detail.baseball} tab={tab} onTab={setTab} />
            </>
          ) : detail.basketball ? (
            <>
              <ShotChart detail={detail} basketball={detail.basketball} />
              {detail.lastPlay ? (
                <section className="af-gv-card" aria-labelledby="af-gv-lastplay-h">
                  <h2 className="af-label" id="af-gv-lastplay-h">
                    Last play
                  </h2>
                  <LastPlay detail={detail} play={detail.lastPlay} />
                </section>
              ) : null}
              <BasketballPlayByPlay detail={detail} basketball={detail.basketball} tab={tab} onTab={setTab} />
            </>
          ) : detail.hockey ? (
            <>
              <RinkShotMap detail={detail} hockey={detail.hockey} />
              {detail.lastPlay ? (
                <section className="af-gv-card" aria-labelledby="af-gv-lastplay-hk">
                  <h2 className="af-label" id="af-gv-lastplay-hk">
                    Last play
                  </h2>
                  <LastPlay detail={detail} play={detail.lastPlay} />
                </section>
              ) : null}
              <HockeyPlayByPlay detail={detail} hockey={detail.hockey} tab={tab} onTab={setTab} />
            </>
          ) : (
            <>
              <DrivePanel detail={detail} />
              <PlayByPlayPanel detail={detail} tab={tab} onTab={setTab} />
            </>
          )}
        </div>
      </div>

      {detail.basketball ? <BoxScore detail={detail} basketball={detail.basketball} /> : null}
      {detail.hockey ? <HockeyBoxScore detail={detail} hockey={detail.hockey} /> : null}
      {detail.baseball ? <BaseballBoxScore detail={detail} baseball={detail.baseball} /> : null}

      <GameFooter detail={detail} />
    </div>
  )
}

/* ── helpers ───────────────────────────────────────────────────────────────── */

function teamColor(team: GameDetailTeam, fallback: string): string {
  return team.color && /^[0-9a-f]{6}$/i.test(team.color) ? `#${team.color}` : fallback
}

/**
 * A team colour that stays visible as a marker on the dark rink. Many NHL teams
 * are black — measured: BOS `231f20`, LA `121212`, neither with an alternate —
 * and rendered as-is their shots vanish into the ice. Too dark → the alternate
 * colour if that is readable → the fallback. Two teams landing on the same
 * colour would make the map unreadable, so the caller resolves that too.
 */
export function markerColor(team: Pick<GameDetailTeam, 'color' | 'altColor'>, fallback: string): string {
  const luminance = (hex: string | null) => {
    if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return -1
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  if (luminance(team.color) >= 0.18) return `#${team.color}`
  if (luminance(team.altColor) >= 0.18) return `#${team.altColor}`
  return fallback
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

function periodName(n: number | null, kind: 'quarter' | 'period' | 'half' = 'quarter'): string {
  if (n == null) return 'Other'
  const regulation = kind === 'half' ? 2 : kind === 'period' ? 3 : 4
  const unit = kind === 'half' ? 'Half' : kind === 'period' ? 'Period' : 'Quarter'
  if (n <= regulation) return `${ordinal(n)} ${unit}`
  return n === regulation + 1 ? 'Overtime' : `${n - regulation}OT`
}

function TeamLogo({ team, size }: { team: GameDetailTeam; size: number }) {
  return team.logo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="af-gv-logo" src={team.logo} alt="" width={size} height={size} loading="lazy" />
  ) : (
    <span className="af-gv-logo af-live-team-mark af-num" style={{ width: size, height: size }} aria-hidden>
      {team.abbrev}
    </span>
  )
}

/* ── header ────────────────────────────────────────────────────────────────── */

function GameHeader({ detail }: { detail: LiveGameDetail }) {
  const { home, away, status } = detail
  const live = status.state === 'in'
  const leader =
    home.score != null && away.score != null && home.score !== away.score
      ? home.score > away.score
        ? 'home'
        : 'away'
      : null
  // Baseball has nine innings and extras are just more innings; hockey three
  // periods; college basketball two halves; football and NBA four quarters.
  const baseball = detail.baseball
  const regulation = baseball ? 9 : detail.hockey ? 3 : detail.basketball?.periods === 'halves' ? 2 : 4
  const periods = Math.max(regulation, home.linescores.length, away.linescores.length)
  const showLines = home.linescores.length > 0 || away.linescores.length > 0

  return (
    <header className="af-gv-head">
      <HeaderTeam team={away} side="away" leading={leader === 'away'} live={live} />
      <div className="af-gv-center">
        <span className="af-live-clock" data-idle={live ? undefined : 'true'}>
          {live ? <span className="af-live-pulse" aria-hidden /> : null}
          <span className="af-num">{status.detail ?? '—'}</span>
        </span>
        {showLines ? (
          <table className="af-live-linescore af-gv-lines af-num">
            <thead>
              <tr>
                <th scope="col" aria-label="Team" />
                {Array.from({ length: periods }, (_, i) => (
                  <th key={i} scope="col">
                    {baseball || i < regulation ? i + 1 : i === regulation ? 'OT' : `${i - regulation + 1}OT`}
                  </th>
                ))}
                <th scope="col">{baseball ? 'R' : 'T'}</th>
                {baseball ? (
                  <>
                    <th scope="col">H</th>
                    <th scope="col">E</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {[away, home].map((t) => (
                <tr key={t.id}>
                  <th scope="row">{t.abbrev}</th>
                  {Array.from({ length: periods }, (_, i) => (
                    <td key={i}>{t.linescores[i] ?? ''}</td>
                  ))}
                  <td className="af-live-linescore-total">{t.score ?? '—'}</td>
                  {baseball ? (
                    <>
                      <td className="af-live-linescore-he">
                        {(t.id === home.id ? baseball.hitsErrors.home : baseball.hitsErrors.away).hits ?? ''}
                      </td>
                      <td className="af-live-linescore-he">
                        {(t.id === home.id ? baseball.hitsErrors.home : baseball.hitsErrors.away).errors ?? ''}
                      </td>
                    </>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
      <HeaderTeam team={home} side="home" leading={leader === 'home'} live={live} />
    </header>
  )
}

function HeaderTeam({
  team,
  side,
  leading,
  live,
}: {
  team: GameDetailTeam
  side: 'home' | 'away'
  leading: boolean
  live: boolean
}) {
  return (
    <div className="af-gv-team" data-side={side}>
      <TeamLogo team={team} size={48} />
      <span className="af-gv-team-text">
        <span className="af-gv-team-name">
          {team.rank != null && team.rank <= 25 ? <span className="af-gv-rank af-num">{team.rank} </span> : null}
          {team.name}
          {live && team.possession ? (
            <span className="af-live-possession" role="img" aria-label="has the ball" title="Possession" />
          ) : null}
        </span>
        <span className="af-gv-team-record af-num">
          {team.record ?? ''}
          {team.record ? ' · ' : ''}
          {side === 'home' ? 'Home' : 'Away'}
        </span>
      </span>
      <span className="af-gv-score af-num" data-leading={leading}>
        {team.score ?? '—'}
      </span>
    </div>
  )
}

/* ── game leaders ──────────────────────────────────────────────────────────── */

function LeadersPanel({ detail }: { detail: LiveGameDetail }) {
  const rows = useMemo(() => {
    const order: string[] = []
    for (const l of [...detail.leaders.away, ...detail.leaders.home]) {
      if (!order.includes(l.category)) order.push(l.category)
    }
    return order.map((category) => ({
      category,
      away: detail.leaders.away.find((l) => l.category === category) ?? null,
      home: detail.leaders.home.find((l) => l.category === category) ?? null,
    }))
  }, [detail.leaders])

  if (rows.length === 0) return null
  return (
    <section className="af-gv-card" aria-labelledby="af-gv-leaders">
      <h2 className="af-label" id="af-gv-leaders">
        Game leaders
      </h2>
      <div className="af-gv-vs">
        <span className="af-gv-vs-team">
          <TeamLogo team={detail.away} size={22} />
          <span className="af-num">{detail.away.abbrev}</span>
        </span>
        <span className="af-gv-vs-team" data-side="home">
          <span className="af-num">{detail.home.abbrev}</span>
          <TeamLogo team={detail.home} size={22} />
        </span>
      </div>
      <ul className="af-gv-leaders">
        {rows.map((r) => (
          <li key={r.category} className="af-gv-leader-row">
            <LeaderSide leader={r.away} side="away" />
            <span className="af-gv-leader-cat">{(r.away ?? r.home)?.label}</span>
            <LeaderSide leader={r.home} side="home" />
          </li>
        ))}
      </ul>
    </section>
  )
}

function LeaderSide({ leader, side }: { leader: GameDetailLeader | null; side: 'home' | 'away' }) {
  if (!leader) return <span className="af-gv-leader" data-side={side} />
  return (
    <span className="af-gv-leader" data-side={side}>
      <span className="af-gv-leader-top">
        <MiniPlayerImg sleeperId={null} name={leader.name} avatarUrl={leader.headshot} size={40} />
        <span className="af-gv-leader-value af-num">{leader.mainValue ?? '—'}</span>
      </span>
      <span className="af-gv-leader-name">
        {leader.shortName ?? leader.name}
        {leader.position ? <span className="af-gv-leader-pos"> {leader.position}</span> : null}
      </span>
      {leader.summary ? <span className="af-gv-leader-line af-num">{leader.summary}</span> : null}
    </span>
  )
}

/* ── team stats ────────────────────────────────────────────────────────────── */

function TeamStatsPanel({ detail }: { detail: LiveGameDetail }) {
  if (detail.teamStats.length === 0) return null
  const awayColor = teamColor(detail.away, 'var(--accent)')
  const homeColor = teamColor(detail.home, 'var(--muted)')
  return (
    <section className="af-gv-card" aria-labelledby="af-gv-teamstats">
      <h2 className="af-label" id="af-gv-teamstats">
        Team stats
      </h2>
      <ul className="af-gv-stats">
        {detail.teamStats.map((s) => (
          <li key={s.key} className="af-gv-stat">
            <span className="af-gv-stat-top">
              <span className="af-num">{s.away}</span>
              <span className="af-gv-stat-label">{s.label}</span>
              <span className="af-num">{s.home}</span>
            </span>
            <span className="af-gv-stat-bars" aria-hidden>
              <span className="af-gv-bar" style={{ flexGrow: s.awayShare, background: awayColor }} />
              <span className="af-gv-bar" style={{ flexGrow: s.homeShare, background: homeColor }} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ── drive ─────────────────────────────────────────────────────────────────── */

function DrivePanel({ detail }: { detail: LiveGameDetail }) {
  const drive = detail.drive
  if (!drive) return null
  const s = detail.situation
  const offense: 'home' | 'away' | null =
    s?.offense ?? (drive.teamId === detail.away.id ? 'away' : drive.teamId === detail.home.id ? 'home' : null)
  const ball = s?.ballOn ?? drive.endBallOn
  const start = drive.startBallOn
  const toward = offense === 'away' ? 1 : offense === 'home' ? -1 : 0
  const goalToGo = /goal/i.test(s?.shortDownDistance ?? '')
  const firstDown =
    ball != null && s?.distance != null && toward !== 0 && !goalToGo
      ? Math.min(100, Math.max(0, ball + toward * s.distance))
      : null
  const driveTeam = drive.teamId === detail.home.id ? detail.home : drive.teamId === detail.away.id ? detail.away : null

  return (
    <section className="af-gv-card af-gv-drive" aria-labelledby="af-gv-drive">
      <div className="af-gv-drive-head">
        {driveTeam ? <TeamLogo team={driveTeam} size={26} /> : null}
        <span className="af-gv-drive-title">
          <h2 className="af-label" id="af-gv-drive">
            {drive.isCurrent ? 'Current drive' : 'Last drive'}
          </h2>
          <span className="af-gv-drive-desc af-num">
            {drive.description ?? ''}
            {!drive.isCurrent && drive.result ? ` · ${drive.result}` : ''}
          </span>
        </span>
      </div>

      {s ? (
        <div className="af-gv-downball">
          <span>
            <span className="af-label">Down</span>
            <strong className="af-num">{s.shortDownDistance ?? '—'}</strong>
          </span>
          <span>
            <span className="af-label">Ball on</span>
            <strong className="af-num">{s.possessionText ?? '—'}</strong>
          </span>
        </div>
      ) : null}

      {ball != null ? (
        <div
          className="af-live-field af-gv-field"
          role="img"
          aria-label={`${driveTeam ? `${driveTeam.abbrev} ball` : 'Ball'}${s?.possessionText ? ` on ${s.possessionText}` : ''}`}
        >
          <EndZone team={detail.away} />
          <div className="af-live-grass">
            {YARD_MARKS.map((y) => (
              <span key={y} className="af-live-yard" style={{ left: `${y}%` }}>
                <span className="af-live-yard-num af-num">{y <= 50 ? y : 100 - y}</span>
              </span>
            ))}
            {start != null ? (
              <span
                className="af-gv-driveline"
                style={{ left: `${Math.min(start, ball)}%`, width: `${Math.abs(ball - start)}%` }}
              />
            ) : null}
            {firstDown != null ? <span className="af-live-firstdown" style={{ left: `${firstDown}%` }} /> : null}
            <span
              className="af-live-ball"
              data-dir={toward > 0 ? 'right' : toward < 0 ? 'left' : 'none'}
              style={{ left: `${ball}%` }}
            />
          </div>
          <EndZone team={detail.home} />
        </div>
      ) : null}

      {detail.lastPlay ? <LastPlay detail={detail} play={detail.lastPlay} /> : null}
    </section>
  )
}

function EndZone({ team }: { team: GameDetailTeam }) {
  const color = teamColor(team, '')
  return (
    <span className="af-live-endzone af-gv-endzone" style={color ? { background: color } : undefined}>
      <span className="af-num">{team.abbrev}</span>
    </span>
  )
}

const PASS_GROUPS = ['passing', 'receiving', 'defensive', 'interceptions', 'rushing']
const RUSH_GROUPS = ['rushing', 'defensive', 'receiving', 'passing']
const ANY_GROUPS = [
  'passing',
  'rushing',
  'receiving',
  'defensive',
  'interceptions',
  'kicking',
  'punting',
  'kickReturns',
  'puntReturns',
  'fumbles',
  'basketball',
  'forwards',
  'defenses',
  'goalies',
  'batting',
  'pitching',
]
const PREFERRED_STATS: Record<string, string[]> = {
  batting: ['H-AB', 'R', 'RBI', 'HR'],
  pitching: ['IP', 'H', 'ER', 'K'],
  basketball: ['PTS', 'REB', 'AST', 'FG'],
  // `S` is the shot count; ESPN's skater `SOG` column is all zeros (see SKATER_COLUMNS).
  forwards: ['G', 'A', 'S', '+/-'],
  defenses: ['G', 'A', 'S', '+/-'],
  goalies: ['SV', 'SA', 'GA', 'SV%'],
  passing: ['C/ATT', 'YDS', 'TD', 'INT'],
  rushing: ['CAR', 'YDS', 'TD', 'LONG'],
  receiving: ['REC', 'YDS', 'TD', 'TGTS'],
  defensive: ['TOT', 'SOLO', 'SACKS', 'TFL'],
  interceptions: ['INT', 'YDS', 'TD'],
  kicking: ['FG', 'LONG', 'XP', 'PTS'],
  punting: ['NO', 'YDS', 'AVG', 'LONG'],
  kickReturns: ['NO', 'YDS', 'AVG', 'TD'],
  puntReturns: ['NO', 'YDS', 'AVG', 'TD'],
  fumbles: ['FUM', 'LOST', 'REC'],
}

/** The box-score line that fits the play: a passer's passing line on a pass, a runner's rushing line on a run. */
export function lineForPlay(lines: GameDetailPlayerLine[], playType: string | null): GameDetailPlayerLine | null {
  const t = (playType ?? '').toLowerCase()
  const order = /pass|reception|sack|interception/.test(t) ? PASS_GROUPS : /rush/.test(t) ? RUSH_GROUPS : ANY_GROUPS
  for (const g of order) {
    const hit = lines.find((l) => l.group === g)
    if (hit) return hit
  }
  return lines[0] ?? null
}

/**
 * A play type a person can read. College basketball sends ESPN's internal names —
 * "LayUpShot", "JumpShot", and "MadeFreeThrow" even for a MISSED free throw — so
 * camelCase is split and the free throw loses its misleading "Made". Types that
 * are already words ("Pass Reception", "Driving Layup Shot") pass through untouched.
 */
export function playTypeLabel(type: string | null): string | null {
  if (!type) return null
  if (/^madefreethrow$/i.test(type)) return 'Free Throw'
  return type.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\bLay Up\b/g, 'Layup')
}

export function statCells(line: GameDetailPlayerLine): Array<{ label: string; value: string }> {
  const want = PREFERRED_STATS[line.group] ?? line.labels.slice(0, 4)
  const cells: Array<{ label: string; value: string }> = []
  for (const label of want) {
    const i = line.labels.indexOf(label)
    if (i >= 0) cells.push({ label, value: line.stats[i] ?? '—' })
  }
  return cells.slice(0, 4)
}

function LastPlay({ detail, play }: { detail: LiveGameDetail; play: GameDetailPlay }) {
  const wp = detail.winProbability
  const favored = wp ? (wp.home >= wp.away ? detail.home : detail.away) : null
  const favoredPct = wp ? Math.max(wp.home, wp.away) : null
  const title =
    play.statYardage != null && /pass|rush|reception/i.test(play.type ?? '')
      ? `${play.statYardage}-yd ${/rush/i.test(play.type ?? '') ? 'Run' : 'Pass'}`
      : playTypeLabel(play.type) ?? 'Last play'
  const cards = detail.lastPlayAthleteIds
    .map((id) => {
      const lines = detail.players[id]
      const line = lines ? lineForPlay(lines, play.type) : null
      return line ? { id, line } : null
    })
    .filter((c): c is { id: string; line: GameDetailPlayerLine } => c != null)

  return (
    <div className="af-gv-lastplay">
      <div className="af-gv-lastplay-top">
        <strong className="af-gv-lastplay-title">{title}</strong>
        {favored && favoredPct != null ? (
          <span className="af-gv-wp af-num" title="ESPN's win probability after this play">
            ESPN win % · {favored.abbrev} {favoredPct}
          </span>
        ) : null}
        <span className="af-label af-gv-lastplay-tag">Last play</span>
      </div>
      <p className="af-gv-lastplay-text">{play.text}</p>
      {cards.length > 0 ? (
        <div className="af-gv-involved">
          {cards.map(({ id, line }) => {
            const team = line.teamId === detail.home.id ? detail.home : line.teamId === detail.away.id ? detail.away : null
            return (
              <div key={id} className="af-gv-pcard">
                <div className="af-gv-pcard-head">
                  <MiniPlayerImg sleeperId={null} name={line.name} avatarUrl={line.headshot} size={40} />
                  <span className="af-gv-pcard-id">
                    <span className="af-gv-pcard-name">{line.name}</span>
                    <span className="af-gv-pcard-meta af-num">
                      {team ? team.abbrev : ''}
                      {line.jersey ? ` · #${line.jersey}` : ''}
                    </span>
                  </span>
                </div>
                <dl className="af-gv-pcard-stats">
                  {statCells(line).map((c) => (
                    <div key={c.label}>
                      <dt className="af-label">{c.label}</dt>
                      <dd className="af-num">{c.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )
          })}
        </div>
      ) : null}
      {play.downDistance ? <p className="af-gv-lastplay-dd af-num">{play.downDistance}</p> : null}
    </div>
  )
}

/* ── play-by-play ──────────────────────────────────────────────────────────── */

function PlayByPlayPanel({
  detail,
  tab,
  onTab,
}: {
  detail: LiveGameDetail
  tab: 'scoring' | 'all'
  onTab: (t: 'scoring' | 'all') => void
}) {
  const scoringByPeriod = useMemo(() => {
    const groups: Array<{ period: number | null; plays: LiveGameDetail['scoringPlays'] }> = []
    for (const p of detail.scoringPlays) {
      const last = groups[groups.length - 1]
      if (last && last.period === p.period) last.plays.push(p)
      else groups.push({ period: p.period, plays: [p] })
    }
    return groups
  }, [detail.scoringPlays])

  return (
    <section className="af-gv-card" aria-labelledby="af-gv-pbp">
      <h2 className="af-label" id="af-gv-pbp">
        Play-by-play
      </h2>
      <div className="af-live-scope af-gv-tabs" role="group" aria-label="Which plays to show">
        <button
          type="button"
          className="af-live-scope-btn"
          data-active={tab === 'scoring'}
          aria-pressed={tab === 'scoring'}
          onClick={() => onTab('scoring')}
        >
          Scoring plays
        </button>
        <button
          type="button"
          className="af-live-scope-btn"
          data-active={tab === 'all'}
          aria-pressed={tab === 'all'}
          onClick={() => onTab('all')}
        >
          All plays
        </button>
      </div>

      {tab === 'scoring' ? (
        scoringByPeriod.length === 0 ? (
          <p className="af-gv-none">No scoring plays yet.</p>
        ) : (
          scoringByPeriod.map((g) => (
            <div key={`${g.period}`} className="af-gv-period">
              <h3 className="af-label af-gv-period-head">{periodName(g.period)}</h3>
              <ul className="af-gv-plays">
                {g.plays.map((p) => (
                  <li key={p.id} className="af-gv-score-play">
                    {p.teamLogo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="af-gv-logo" src={p.teamLogo} alt={p.teamAbbrev ?? ''} width={28} height={28} loading="lazy" />
                    ) : (
                      <span className="af-gv-logo" aria-hidden />
                    )}
                    <span className="af-gv-score-play-text">
                      <strong>{p.type ?? 'Score'}</strong>
                      <span className="af-num af-gv-muted">
                        {p.clock ?? ''}
                        {p.period != null ? ` · ${ordinal(p.period)}` : ''}
                      </span>
                      <span className="af-gv-play-desc">{p.text}</span>
                    </span>
                    <span className="af-gv-running af-num">
                      <span>
                        {p.awayScore ?? '—'}
                        <small>{detail.away.abbrev}</small>
                      </span>
                      <span>
                        {p.homeScore ?? '—'}
                        <small>{detail.home.abbrev}</small>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )
      ) : (
        <AllPlays detail={detail} />
      )}
    </section>
  )
}

function AllPlays({ detail }: { detail: LiveGameDetail }) {
  const newestFirst = useMemo(() => [...detail.drives].reverse(), [detail.drives])
  const [open, setOpen] = useState<Set<string>>(() => new Set(newestFirst[0] ? [newestFirst[0].id] : []))
  if (newestFirst.length === 0) return <p className="af-gv-none">No plays yet.</p>
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  return (
    <ul className="af-gv-drives">
      {newestFirst.map((d, i) => (
        <DriveRow key={d.id || i} drive={d} detail={detail} open={open.has(d.id)} onToggle={() => toggle(d.id)} />
      ))}
    </ul>
  )
}

function DriveRow({
  drive,
  detail,
  open,
  onToggle,
}: {
  drive: GameDetailDrive
  detail: LiveGameDetail
  open: boolean
  onToggle: () => void
}) {
  const team = drive.teamId === detail.home.id ? detail.home : drive.teamId === detail.away.id ? detail.away : null
  const panelId = `af-gv-drive-${drive.id}`
  return (
    <li className="af-gv-drive-row" data-open={open}>
      <button type="button" className="af-gv-drive-toggle" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={onToggle}>
        {team ? <TeamLogo team={team} size={24} /> : <span className="af-gv-logo" aria-hidden />}
        <span className="af-gv-drive-row-text">
          <strong>{drive.isCurrent ? 'Current drive' : drive.result ?? 'Drive'}</strong>
          <span className="af-num af-gv-muted">{drive.description ?? ''}</span>
        </span>
        <span className="af-live-mine-chev" aria-hidden />
      </button>
      {open ? (
        <ol id={panelId} className="af-gv-drive-plays">
          {[...drive.plays].reverse().map((p, i) => (
            <li key={p.id || i} className="af-gv-play" data-scoring={p.scoring}>
              <span className="af-gv-play-meta af-num">
                {p.downDistance ?? p.type ?? ''}
                {p.clock ? ` · ${p.clock}` : ''}
                {p.period != null ? ` ${ordinal(p.period)}` : ''}
              </span>
              <span className="af-gv-play-desc">{p.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  )
}

/* ── basketball ────────────────────────────────────────────────────────────── */

/**
 * ⚠ ESPN'S SHOT `y` IS FEET FROM THE RIM, NOT FROM THE BASELINE. Measured on NBA
 * CHI @ GS (401810798) against 159 shots whose text states a distance ("26-foot
 * three"): with the rim at (25, 0) the median error is 0.66 ft (p90 1.24); with
 * the rim at the baseline-relative 5.25 ft it is 3.1 ft. Layups and dunks sit at
 * y 0–6. So the drawing puts the rim 5.25 ft below the baseline edge and shifts
 * every shot by that much, and anything past half court (a heave) is left off.
 */
const RIM_FROM_BASELINE = 5.25
const HALF_COURT = 47

function ShotChart({ detail, basketball }: { detail: LiveGameDetail; basketball: BasketballDetail }) {
  const [side, setSide] = useState<'both' | 'away' | 'home'>('both')
  const colors = { away: teamColor(detail.away, 'var(--accent)'), home: teamColor(detail.home, 'var(--warn)') }
  const sideOf = (s: BasketballShot): 'home' | 'away' | null =>
    s.teamId === detail.home.id ? 'home' : s.teamId === detail.away.id ? 'away' : null
  const onCourt = basketball.shots.filter((s) => {
    const y = s.y + RIM_FROM_BASELINE
    return y >= 0 && y <= HALF_COURT
  })
  const visible = side === 'both' ? onCourt : onCourt.filter((s) => sideOf(s) === side)
  const made = visible.filter((s) => s.made).length

  if (basketball.shots.length === 0) return null
  return (
    <section className="af-gv-card" aria-labelledby="af-gv-shots">
      <div className="af-gv-shots-head">
        <h2 className="af-label" id="af-gv-shots">
          Shot chart
        </h2>
        <span className="af-gv-muted af-num">
          {made}/{visible.length} FG
        </span>
      </div>
      <div className="af-live-scope af-gv-tabs" role="group" aria-label="Whose shots to show">
        {(
          [
            ['both', 'Both'],
            ['away', detail.away.abbrev],
            ['home', detail.home.abbrev],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="af-live-scope-btn"
            data-active={side === key}
            aria-pressed={side === key}
            onClick={() => setSide(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <svg
        className="af-gv-court"
        viewBox={`0 0 50 ${HALF_COURT}`}
        role="img"
        aria-label={`Shot chart: ${made} of ${visible.length} field goals made`}
      >
        <rect className="af-gv-court-floor" x="0" y="0" width="50" height={HALF_COURT} />
        <g className="af-gv-court-lines" data-court={basketball.court}>
          {/* Lane: 12 ft for NCAA men; 16 ft for the NBA and the WNBA. */}
          {basketball.court === 'college' ? (
            <rect x="19" y="0" width="12" height="19" />
          ) : (
            <rect x="17" y="0" width="16" height="19" />
          )}
          {/* 3-point line: 22 ft 1.75 in (21 ft 7.75 in in the corners) for NCAA men and
              the WNBA; 23 ft 9 in (22 ft in the corners) for the NBA. */}
          {basketball.court === 'pro' ? (
            <path d="M3 0 L3 14.2 A23.75 23.75 0 0 0 47 14.2 L47 0" />
          ) : (
            <path d="M3.35 0 L3.35 9.93 A22.15 22.15 0 0 0 46.65 9.93 L46.65 0" />
          )}
          <circle cx="25" cy="19" r="6" />
          <path d="M21 5.25 A4 4 0 0 0 29 5.25" />
          <line x1="22" y1="4" x2="28" y2="4" />
          <circle cx="25" cy={RIM_FROM_BASELINE} r="0.75" />
          <path d="M19 47 A6 6 0 0 1 31 47" />
        </g>
        {visible.map((s) => {
          const cx = s.x
          const cy = s.y + RIM_FROM_BASELINE
          const color = colors[sideOf(s) ?? 'away']
          return s.made ? (
            <circle key={s.id} className="af-gv-shot" data-made="true" cx={cx} cy={cy} r={0.85} fill={color}>
              <title>{s.text}</title>
            </circle>
          ) : (
            <g key={s.id} className="af-gv-shot" data-made="false" stroke={color}>
              <line x1={cx - 0.7} y1={cy - 0.7} x2={cx + 0.7} y2={cy + 0.7} />
              <line x1={cx - 0.7} y1={cy + 0.7} x2={cx + 0.7} y2={cy - 0.7} />
              <title>{s.text}</title>
            </g>
          )
        })}
      </svg>
      <p className="af-gv-shots-key af-gv-muted">● made · ✕ missed · free throws not shown</p>
    </section>
  )
}

function BasketballPlayByPlay({
  detail,
  basketball,
  tab,
  onTab,
}: {
  detail: LiveGameDetail
  basketball: BasketballDetail
  tab: 'scoring' | 'all'
  onTab: (t: 'scoring' | 'all') => void
}) {
  /*
   * ⚠ ONE QUARTER AT A TIME. The first version listed every scoring play of the
   * game at once — ~170 rows on CHI @ GS, a 6,400px desktop page and a 21,000px
   * phone page (measured on the rendered view). Basketball scores too often for
   * an all-game list; ESPN pages it by quarter and so does this. It opens on the
   * newest quarter, which is the live end of the game.
   */
  const periods = useMemo(
    () =>
      [...new Set(basketball.plays.map((p) => p.period).filter((n): n is number => n != null))].sort(
        (a, b) => a - b,
      ),
    [basketball.plays],
  )
  const [picked, setPicked] = useState<number | null>(null)
  const active = picked != null && periods.includes(picked) ? picked : (periods[periods.length - 1] ?? null)
  const plays = useMemo(
    () =>
      basketball.plays
        .filter((p) => p.period === active && (tab === 'scoring' ? p.scoring : !/substitution/i.test(p.type ?? '')))
        .reverse(),
    [basketball.plays, active, tab],
  )
  const groups: Array<{ period: number | null; plays: BasketballPlay[] }> =
    active != null ? [{ period: active, plays }] : []
  // College plays two halves ("1st Half", "2nd Half", then "OT" on NCAAB 401825532).
  const halves = basketball.periods === 'halves'
  const regulation = halves ? 2 : 4
  const periodShort = (n: number) =>
    n <= regulation ? `${halves ? 'H' : 'Q'}${n}` : n === regulation + 1 ? 'OT' : `${n - regulation}OT`

  const teamFor = (id: string | null) => (id === detail.home.id ? detail.home : id === detail.away.id ? detail.away : null)

  return (
    <section className="af-gv-card" aria-labelledby="af-gv-bpbp">
      <h2 className="af-label" id="af-gv-bpbp">
        Play-by-play
      </h2>
      <div className="af-live-scope af-gv-tabs" role="group" aria-label="Which plays to show">
        <button
          type="button"
          className="af-live-scope-btn"
          data-active={tab === 'scoring'}
          aria-pressed={tab === 'scoring'}
          onClick={() => onTab('scoring')}
        >
          Scoring plays
        </button>
        <button
          type="button"
          className="af-live-scope-btn"
          data-active={tab === 'all'}
          aria-pressed={tab === 'all'}
          onClick={() => onTab('all')}
        >
          All plays
        </button>
      </div>
      {periods.length > 1 ? (
        <div className="af-live-scope af-gv-tabs" role="group" aria-label={halves ? 'Half' : 'Quarter'}>
          {periods.map((n) => (
            <button
              key={n}
              type="button"
              className="af-live-scope-btn"
              data-active={n === active}
              aria-pressed={n === active}
              onClick={() => setPicked(n)}
            >
              {periodShort(n)}
            </button>
          ))}
        </div>
      ) : null}
      {groups.length === 0 || groups[0]!.plays.length === 0 ? (
        <p className="af-gv-none">{tab === 'scoring' ? 'No scoring plays in this period.' : 'No plays yet.'}</p>
      ) : (
        groups.map((g) => (
          <div key={`${g.period}`} className="af-gv-period">
            <h3 className="af-label af-gv-period-head">{periodName(g.period, halves ? 'half' : 'quarter')}</h3>
            <ol className="af-gv-plays af-gv-bplays">
              {g.plays.map((p, i) => {
                const team = teamFor(p.teamId)
                return (
                  <li key={p.id || i} className="af-gv-bplay" data-scoring={p.scoring}>
                    {team ? <TeamLogo team={team} size={18} /> : <span className="af-gv-logo" aria-hidden />}
                    <span className="af-gv-bplay-clock af-num">{p.clock ?? ''}</span>
                    <span className="af-gv-play-desc">{p.text}</span>
                    {p.scoring && p.awayScore != null && p.homeScore != null ? (
                      <span className="af-gv-bplay-score af-num">
                        {p.awayScore}–{p.homeScore}
                      </span>
                    ) : (
                      <span />
                    )}
                  </li>
                )
              })}
            </ol>
          </div>
        ))
      )}
    </section>
  )
}

function BoxScore({ detail, basketball }: { detail: LiveGameDetail; basketball: BasketballDetail }) {
  const teams = [
    { team: detail.away, box: basketball.box.away },
    { team: detail.home, box: basketball.box.home },
  ].filter((t): t is { team: GameDetailTeam; box: BasketballBoxTeam } => t.box != null)
  if (teams.length === 0) return null
  return (
    <section className="af-gv-card af-gv-box" aria-labelledby="af-gv-box">
      <h2 className="af-label" id="af-gv-box">
        Box score
      </h2>
      {teams.map(({ team, box }) => (
        <BoxTeam key={team.id} team={team} box={box} />
      ))}
    </section>
  )
}

function BoxTeam({ team, box }: { team: GameDetailTeam; box: BasketballBoxTeam }) {
  const played = box.players.filter((p) => !p.didNotPlay)
  const starters = played.filter((p) => p.starter)
  const bench = played.filter((p) => !p.starter)
  const dnp = box.players.filter((p) => p.didNotPlay)
  const cols = box.labels.length

  const row = (p: BasketballBoxPlayer) => (
    <tr key={p.athleteId}>
      <th scope="row" className="af-gv-box-name">
        {p.shortName ?? p.name}
        {p.position ? <span className="af-gv-leader-pos"> {p.position}</span> : null}
      </th>
      {box.labels.map((_, i) => (
        <td key={i}>{p.stats[i] ?? ''}</td>
      ))}
    </tr>
  )

  return (
    <div className="af-gv-box-team" data-team={team.id}>
      <div className="af-gv-box-team-head">
        <TeamLogo team={team} size={22} />
        <strong>{team.name}</strong>
      </div>
      <div className="af-gv-box-scroll">
        <table className="af-gv-box-table af-num">
          <thead>
            <tr>
              <th scope="col" className="af-gv-box-name">
                Starters
              </th>
              {box.labels.map((l) => (
                <th key={l} scope="col">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {starters.map(row)}
            {bench.length > 0 ? (
              <tr className="af-gv-box-group">
                <th scope="rowgroup" colSpan={cols + 1}>
                  Bench
                </th>
              </tr>
            ) : null}
            {bench.map(row)}
            {dnp.map((p) => (
              <tr key={p.athleteId} className="af-gv-box-dnp">
                <th scope="row" className="af-gv-box-name">
                  {p.shortName ?? p.name}
                </th>
                <td colSpan={cols}>{p.reason ? `DNP · ${p.reason}` : 'Did not play'}</td>
              </tr>
            ))}
            {box.totals.some((t) => t) ? (
              <tr className="af-gv-box-total">
                <th scope="row" className="af-gv-box-name">
                  Team
                </th>
                {box.labels.map((_, i) => (
                  <td key={i}>{box.totals[i] ?? ''}</td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── hockey ────────────────────────────────────────────────────────────────── */

/**
 * One offensive zone, net on the right. Shots arrive already normalised so each
 * team attacks +x (see `hockeyAttackSigns`); x is feet from centre ice, the goal
 * line sits at 89, and the end boards round off with a 28 ft corner radius.
 */
function RinkShotMap({ detail, hockey }: { detail: LiveGameDetail; hockey: HockeyDetail }) {
  const [side, setSide] = useState<'both' | 'away' | 'home'>('both')
  const away = markerColor(detail.away, 'var(--accent)')
  const home = markerColor(detail.home, 'var(--warn)')
  const colors = { away, home: home.toLowerCase() === away.toLowerCase() ? 'var(--warn)' : home }
  const sideOf = (s: HockeyShot): 'home' | 'away' | null =>
    s.teamId === detail.home.id ? 'home' : s.teamId === detail.away.id ? 'away' : null
  const visible = side === 'both' ? hockey.shots : hockey.shots.filter((s) => sideOf(s) === side)
  const goals = visible.filter((s) => s.kind === 'goal').length
  const onGoal = visible.filter((s) => s.kind !== 'missed').length

  if (hockey.shots.length === 0) return null
  return (
    <section className="af-gv-card" aria-labelledby="af-gv-rink">
      <div className="af-gv-shots-head">
        <h2 className="af-label" id="af-gv-rink">
          Shot map
        </h2>
        <span className="af-gv-muted af-num">
          {goals} G · {onGoal} SOG
        </span>
      </div>
      <div className="af-live-scope af-gv-tabs" role="group" aria-label="Whose shots to show">
        {(
          [
            ['both', 'Both'],
            ['away', detail.away.abbrev],
            ['home', detail.home.abbrev],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="af-live-scope-btn"
            data-active={side === key}
            aria-pressed={side === key}
            onClick={() => setSide(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <svg
        className="af-gv-rink"
        viewBox="0 -42.5 100 85"
        role="img"
        aria-label={`Shot map: ${goals} goals, ${onGoal} shots on goal`}
      >
        <path className="af-gv-rink-ice" d="M0 -42.5 L72 -42.5 A28 28 0 0 1 100 -14.5 L100 14.5 A28 28 0 0 1 72 42.5 L0 42.5 Z" />
        <line className="af-gv-rink-red" x1="0.4" y1="-42.5" x2="0.4" y2="42.5" />
        <line className="af-gv-rink-blue" x1="25" y1="-42.5" x2="25" y2="42.5" />
        <line className="af-gv-rink-red" x1="89" y1="-36.7" x2="89" y2="36.7" />
        <path className="af-gv-rink-crease" d="M89 -6 A6 6 0 0 0 89 6 Z" />
        <rect className="af-gv-rink-net" x="89" y="-3" width="3.3" height="6" />
        {[-22, 22].map((y) => (
          <g key={y}>
            <circle className="af-gv-rink-circle" cx="69" cy={y} r="15" />
            <circle className="af-gv-rink-dot" cx="69" cy={y} r="1" />
            <circle className="af-gv-rink-dot" cx="20" cy={y} r="1" />
          </g>
        ))}
        {visible.map((s) => {
          const color = colors[sideOf(s) ?? 'away']
          return (
            <circle
              key={s.id}
              className="af-gv-hshot"
              data-kind={s.kind}
              cx={s.x}
              cy={s.y}
              r={s.kind === 'goal' ? 2.1 : 1.3}
              fill={s.kind === 'missed' ? 'none' : color}
              stroke={color}
            >
              <title>{s.text}</title>
            </circle>
          )
        })}
      </svg>
      <p className="af-gv-shots-key af-gv-muted">
        large = goal · filled = shot on goal · hollow = missed · every team shown attacking the right-hand net
      </p>
    </section>
  )
}

function HockeyPlayByPlay({
  detail,
  hockey,
  tab,
  onTab,
}: {
  detail: LiveGameDetail
  hockey: HockeyDetail
  tab: 'scoring' | 'all'
  onTab: (t: 'scoring' | 'all') => void
}) {
  const periods = useMemo(
    () =>
      [...new Set(hockey.plays.map((p) => p.period).filter((n): n is number => n != null))].sort((a, b) => a - b),
    [hockey.plays],
  )
  const [picked, setPicked] = useState<number | null>(null)
  const active = picked != null && periods.includes(picked) ? picked : (periods[periods.length - 1] ?? null)
  // Goals are few enough to show for the whole game; all plays page by period.
  const plays = useMemo(
    () =>
      (tab === 'scoring'
        ? hockey.plays.filter((p) => p.scoring)
        : hockey.plays.filter((p) => p.period === active)
      ).slice().reverse(),
    [hockey.plays, active, tab],
  )
  const teamFor = (id: string | null) => (id === detail.home.id ? detail.home : id === detail.away.id ? detail.away : null)
  const periodShort = (n: number) => (n <= 3 ? ordinal(n) : n === 4 ? 'OT' : `${n - 3}OT`)
  const strengthTag = (s: string | null) => (s && !/even/i.test(s) ? (/power/i.test(s) ? 'PP' : /short/i.test(s) ? 'SH' : s) : null)

  return (
    <section className="af-gv-card" aria-labelledby="af-gv-hpbp">
      <h2 className="af-label" id="af-gv-hpbp">
        Play-by-play
      </h2>
      <div className="af-live-scope af-gv-tabs" role="group" aria-label="Which plays to show">
        <button
          type="button"
          className="af-live-scope-btn"
          data-active={tab === 'scoring'}
          aria-pressed={tab === 'scoring'}
          onClick={() => onTab('scoring')}
        >
          Goals
        </button>
        <button
          type="button"
          className="af-live-scope-btn"
          data-active={tab === 'all'}
          aria-pressed={tab === 'all'}
          onClick={() => onTab('all')}
        >
          All plays
        </button>
      </div>
      {tab === 'all' && periods.length > 1 ? (
        <div className="af-live-scope af-gv-tabs" role="group" aria-label="Period">
          {periods.map((n) => (
            <button
              key={n}
              type="button"
              className="af-live-scope-btn"
              data-active={n === active}
              aria-pressed={n === active}
              onClick={() => setPicked(n)}
            >
              {periodShort(n)}
            </button>
          ))}
        </div>
      ) : null}
      {tab === 'all' && active != null ? (
        <h3 className="af-label af-gv-period-head">{periodName(active, 'period')}</h3>
      ) : null}
      {plays.length === 0 ? (
        <p className="af-gv-none">{tab === 'scoring' ? 'No goals yet.' : 'No plays yet.'}</p>
      ) : (
        <ol className="af-gv-plays af-gv-bplays">
          {plays.map((p: HockeyPlay, i) => {
            const team = teamFor(p.teamId)
            const tag = p.scoring ? strengthTag(p.strength) : null
            return (
              <li key={p.id || i} className="af-gv-bplay" data-scoring={p.scoring}>
                {team ? <TeamLogo team={team} size={18} /> : <span className="af-gv-logo" aria-hidden />}
                <span className="af-gv-bplay-clock af-num">
                  {p.clock ?? ''}
                  {tab === 'scoring' && p.period != null ? ` ${periodShort(p.period)}` : ''}
                </span>
                <span className="af-gv-play-desc">
                  {tag ? <span className="af-gv-strength af-num">{tag}</span> : null}
                  {p.text}
                </span>
                {p.scoring && p.awayScore != null && p.homeScore != null ? (
                  <span className="af-gv-bplay-score af-num">
                    {p.awayScore}–{p.homeScore}
                  </span>
                ) : (
                  <span />
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

// ⚠ Shots are `S`, not `SOG`: in ESPN's skater rows `SOG` read 0 for all 36
// skaters of LA @ BOS while `S` summed to the team shot totals (16 / 23).
const SKATER_COLUMNS = ['G', 'A', '+/-', 'S', 'HT', 'BS', 'PIM', 'FO%', 'TOI']
const GOALIE_COLUMNS = ['SA', 'GA', 'SV', 'SV%', 'TOI']

function HockeyBoxScore({ detail, hockey }: { detail: LiveGameDetail; hockey: HockeyDetail }) {
  const teams = [
    { team: detail.away, box: hockey.box.away },
    { team: detail.home, box: hockey.box.home },
  ].filter((t): t is { team: GameDetailTeam; box: HockeyBoxTeam } => t.box != null)
  if (teams.length === 0) return null
  return (
    <section className="af-gv-card af-gv-box" aria-labelledby="af-gv-hbox">
      <h2 className="af-label" id="af-gv-hbox">
        Box score
      </h2>
      {teams.map(({ team, box }) => (
        <HockeyBoxTeamTable key={team.id} team={team} box={box} />
      ))}
    </section>
  )
}

function HockeyBoxTeamTable({ team, box }: { team: GameDetailTeam; box: HockeyBoxTeam }) {
  const skaterCols = SKATER_COLUMNS.filter((c) => box.skaterLabels.includes(c))
  const goalieCols = GOALIE_COLUMNS.filter((c) => box.goalieLabels.includes(c))
  const cell = (p: HockeyPlayer, labels: string[], col: string) => p.stats[labels.indexOf(col)] ?? ''
  const forwards = box.skaters.filter((s) => s.unit === 'F')
  const defense = box.skaters.filter((s) => s.unit === 'D')
  const skaterRow = (p: HockeyPlayer) => (
    <tr key={p.athleteId}>
      <th scope="row" className="af-gv-box-name">
        {p.shortName ?? p.name}
        {p.position ? <span className="af-gv-leader-pos"> {p.position}</span> : null}
      </th>
      {skaterCols.map((c) => (
        <td key={c}>{cell(p, box.skaterLabels, c)}</td>
      ))}
    </tr>
  )
  return (
    <div className="af-gv-box-team" data-team={team.id}>
      <div className="af-gv-box-team-head">
        <TeamLogo team={team} size={22} />
        <strong>{team.name}</strong>
      </div>
      {skaterCols.length > 0 ? (
        <div className="af-gv-box-scroll">
          <table className="af-gv-box-table af-num">
            <thead>
              <tr>
                <th scope="col" className="af-gv-box-name">
                  Forwards
                </th>
                {skaterCols.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {forwards.map(skaterRow)}
              {defense.length > 0 ? (
                <tr className="af-gv-box-group">
                  <th scope="rowgroup" colSpan={skaterCols.length + 1}>
                    Defense
                  </th>
                </tr>
              ) : null}
              {defense.map(skaterRow)}
            </tbody>
          </table>
        </div>
      ) : null}
      {box.goalies.length > 0 && goalieCols.length > 0 ? (
        <div className="af-gv-box-scroll">
          <table className="af-gv-box-table af-num" data-kind="goalies">
            <thead>
              <tr>
                <th scope="col" className="af-gv-box-name">
                  Goalies
                </th>
                {goalieCols.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {box.goalies.map((g) => (
                <tr key={g.athleteId}>
                  <th scope="row" className="af-gv-box-name">
                    {g.shortName ?? g.name}
                  </th>
                  {goalieCols.map((c) => (
                    <td key={c}>{cell(g, box.goalieLabels, c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

/* ── baseball ──────────────────────────────────────────────────────────────── */

/*
 * ESPN's pitch-location chart units. The zone is the rectangle that best separates
 * called strikes from balls across 195 umpire calls (COL @ DET 401816920 and
 * KC @ BOS 401816922): it sorts 187 of them correctly. The frame covers every pitch
 * seen across five games that day (x 31–212, y 78–262).
 */
const STRIKE_ZONE = { x0: 80, x1: 148, y0: 148, y1: 196 }
const DIAMOND_BASES = [
  { key: 'first', cx: 86, cy: 50 },
  { key: 'second', cx: 50, cy: 14 },
  { key: 'third', cx: 14, cy: 50 },
] as const

function halfLabel(half: BaseballAtBat['half'], inning: number | null, short = false): string {
  if (inning == null) return ''
  const h = half === 'top' ? 'Top' : half === 'bottom' ? (short ? 'Bot' : 'Bottom') : ''
  return `${h} ${ordinal(inning)}`.trim()
}

function boxLine(detail: LiveGameDetail, id: string | null, group: 'batting' | 'pitching') {
  const line = id ? detail.players[id]?.find((l) => l.group === group) : undefined
  return {
    line,
    stat: (label: string) => {
      const i = line ? line.labels.indexOf(label) : -1
      return line && i >= 0 ? (line.stats[i] ?? null) || null : null
    },
  }
}

function AtBatPanel({ detail, baseball }: { detail: LiveGameDetail; baseball: BaseballDetail }) {
  const cur = baseball.current
  if (!cur) return null
  const last = baseball.atBats[baseball.atBats.length - 1]
  // Pitches belong to the at-bat still in progress; between batters the zone is empty.
  const pitches = last && !last.complete ? last.pitches : []
  const occupied = DIAMOND_BASES.filter((b) => cur.on[b.key]).map((b) => b.key)
  const basesLabel =
    occupied.length === 0 ? 'Bases empty' : `Runner${occupied.length > 1 ? 's' : ''} on ${occupied.join(' and ')}`
  const pitcher = boxLine(detail, cur.pitcherId, 'pitching')
  const batter = boxLine(detail, cur.batterId, 'batting')
  const people = [
    {
      role: 'Pitching',
      line: pitcher.line,
      summary: [pitcher.stat('IP') && `${pitcher.stat('IP')} IP`, pitcher.stat('PC') && `${pitcher.stat('PC')} P`]
        .filter(Boolean)
        .join(' · '),
    },
    {
      role: 'At bat',
      line: batter.line,
      summary: batter.stat('H-AB') ? `${batter.stat('H-AB')} today` : '',
    },
  ]

  return (
    <section className="af-gv-card" aria-labelledby="af-gv-atbat-h">
      <h2 className="af-label" id="af-gv-atbat-h">
        At bat
      </h2>
      <div className="af-gv-atbat">
        <div className="af-gv-atbat-main">
          <div className="af-live-diamond-block">
            <svg
              className="af-live-diamond"
              viewBox="0 0 100 100"
              role="img"
              aria-label={`${basesLabel}${
                cur.balls != null && cur.strikes != null ? `, ${cur.balls}-${cur.strikes} count` : ''
              }${cur.outs != null ? `, ${cur.outs} ${cur.outs === 1 ? 'out' : 'outs'}` : ''}`}
            >
              <path className="af-live-diamond-path" d="M50 86 L86 50 L50 14 L14 50 Z" />
              {DIAMOND_BASES.map((b) => (
                <rect
                  key={b.key}
                  className="af-live-base"
                  data-base={b.key}
                  data-on={cur.on[b.key]}
                  x={b.cx - 8}
                  y={b.cy - 8}
                  width={16}
                  height={16}
                  transform={`rotate(45 ${b.cx} ${b.cy})`}
                />
              ))}
              <rect className="af-live-plate" x={44} y={80} width={12} height={12} transform="rotate(45 50 86)" />
            </svg>
            <div className="af-live-count" aria-hidden>
              {(
                [
                  ['B', cur.balls, 3, 'good'],
                  ['S', cur.strikes, 2, 'bad'],
                  ['O', cur.outs, 2, 'warn'],
                ] as const
              ).map(([label, n, max, tone]) => (
                <span key={label} className="af-live-count-row" data-count={label}>
                  <span className="af-label">{label}</span>
                  {Array.from({ length: max }, (_, i) => (
                    <span key={i} className="af-live-count-dot" data-tone={tone} data-on={n != null && i < n} />
                  ))}
                </span>
              ))}
            </div>
            <ul className="af-live-atbat">
              {people.map((p) =>
                p.line ? (
                  <li key={p.role} className="af-live-atbat-row">
                    <MiniPlayerImg sleeperId={null} name={p.line.name} avatarUrl={p.line.headshot} size={30} />
                    <span className="af-live-atbat-text">
                      <span className="af-label">{p.role}</span>
                      <span className="af-live-atbat-name">{p.line.name}</span>
                      {p.summary ? <span className="af-live-atbat-line af-num">{p.summary}</span> : null}
                    </span>
                  </li>
                ) : null,
              )}
            </ul>
          </div>
          {pitches.length > 0 ? (
            <ol className="af-gv-pitches">
              {pitches.map((p, i) => (
                <li key={p.id || i} data-kind={p.kind}>
                  <span className="af-gv-pitch-n af-num" data-kind={p.kind}>
                    {p.number ?? i + 1}
                  </span>
                  <span>{p.call ?? 'Pitch'}</span>
                  <span className="af-gv-muted af-num">
                    {[p.pitchType, p.velocity != null ? `${p.velocity} mph` : null].filter(Boolean).join(' · ')}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
        <svg
          className="af-gv-zone"
          viewBox="15 65 220 210"
          role="img"
          aria-label={`Pitch locations this at-bat: ${pitches.length}`}
        >
          <rect
            className="af-gv-zone-box"
            x={STRIKE_ZONE.x0}
            y={STRIKE_ZONE.y0}
            width={STRIKE_ZONE.x1 - STRIKE_ZONE.x0}
            height={STRIKE_ZONE.y1 - STRIKE_ZONE.y0}
          />
          {pitches.map((p, i) =>
            p.x != null && p.y != null ? (
              <g key={p.id || i} className="af-gv-pitch" data-kind={p.kind}>
                <circle cx={p.x} cy={p.y} r={9} />
                <text x={p.x} y={p.y}>
                  {p.number ?? i + 1}
                </text>
              </g>
            ) : null,
          )}
        </svg>
      </div>
    </section>
  )
}

/**
 * Where every charted ball in play landed, in feet from the plate (see SPRAY_PLATE).
 * The park outline is a generic 330–400 ft field for scale, not this ballpark.
 */
function SprayChart({ detail, baseball }: { detail: LiveGameDetail; baseball: BaseballDetail }) {
  const [side, setSide] = useState<'both' | 'away' | 'home'>('both')
  const away = markerColor(detail.away, 'var(--accent)')
  const home = markerColor(detail.home, 'var(--warn)')
  const colors = { away, home: home.toLowerCase() === away.toLowerCase() ? 'var(--warn)' : home }
  const balls = baseball.atBats
    .filter((a) => a.battedBall)
    .map((a) => ({
      ab: a,
      bb: a.battedBall!,
      side: a.battingTeamId === detail.home.id ? ('home' as const) : a.battingTeamId === detail.away.id ? ('away' as const) : null,
    }))
  if (balls.length === 0) return null
  const visible = side === 'both' ? balls : balls.filter((b) => b.side === side)
  const hits = visible.filter((b) => b.bb.kind !== 'out').length
  const homers = visible.filter((b) => b.bb.kind === 'hr').length

  return (
    <section className="af-gv-card" aria-labelledby="af-gv-spray">
      <div className="af-gv-shots-head">
        <h2 className="af-label" id="af-gv-spray">
          Spray chart
        </h2>
        <span className="af-gv-muted af-num">
          {hits} hit{hits === 1 ? '' : 's'} · {homers} HR
        </span>
      </div>
      <div className="af-live-scope af-gv-tabs" role="group" aria-label="Whose batted balls to show">
        {(
          [
            ['both', 'Both'],
            ['away', detail.away.abbrev],
            ['home', detail.home.abbrev],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="af-live-scope-btn"
            data-active={side === key}
            aria-pressed={side === key}
            onClick={() => setSide(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <svg
        className="af-gv-diamond"
        viewBox="-310 -470 620 495"
        role="img"
        aria-label={`Spray chart: ${hits} hits, ${homers} home runs`}
      >
        <path className="af-gv-diamond-grass" d="M0 0 L-233 -233 Q0 -567 233 -233 Z" />
        <path className="af-gv-diamond-dirt" d="M0 0 L-106 -106 A150 150 0 0 1 106 -106 Z" />
        <path className="af-gv-diamond-line" d="M0 0 L-300 -300 M0 0 L300 -300" />
        <path className="af-gv-diamond-path" d="M0 0 L63.6 -63.6 L0 -127.3 L-63.6 -63.6 Z" />
        <circle className="af-gv-diamond-mound" cx={0} cy={-60.5} r={9} />
        {[
          [63.6, -63.6],
          [0, -127.3],
          [-63.6, -63.6],
        ].map(([x, y]) => (
          <rect key={`${x}`} className="af-gv-diamond-base" x={x! - 5} y={y! - 5} width={10} height={10} transform={`rotate(45 ${x} ${y})`} />
        ))}
        {visible.map(({ ab, bb, side: s }) => {
          const color = colors[s ?? 'away']
          return (
            <circle
              key={ab.id}
              className="af-gv-bb"
              data-kind={bb.kind}
              cx={bb.x}
              cy={-bb.y}
              r={bb.kind === 'hr' ? 11 : 7}
              fill={bb.kind === 'out' ? 'none' : color}
              stroke={color}
            >
              <title>{ab.result ?? bb.call ?? ''}</title>
            </circle>
          )
        })}
      </svg>
      <p className="af-gv-shots-key af-gv-muted">
        large = home run · filled = hit · hollow = out or other · plate at the bottom, generic 330–400 ft park for scale
      </p>
    </section>
  )
}

function BaseballPlayByPlay({
  detail,
  baseball,
  tab,
  onTab,
}: {
  detail: LiveGameDetail
  baseball: BaseballDetail
  tab: 'scoring' | 'all'
  onTab: (t: 'scoring' | 'all') => void
}) {
  const innings = useMemo(
    () => [...new Set(baseball.atBats.map((a) => a.inning).filter((n): n is number => n != null))].sort((a, b) => a - b),
    [baseball.atBats],
  )
  const [picked, setPicked] = useState<number | null>(null)
  const active = picked != null && innings.includes(picked) ? picked : (innings[innings.length - 1] ?? null)
  const scoring = useMemo(() => baseball.atBats.filter((a) => a.scoring).slice().reverse(), [baseball.atBats])
  // Newest first: within an inning the bottom half comes before the top.
  const halves = useMemo(() => {
    const inInning = baseball.atBats.filter((a) => a.inning === active)
    return (['bottom', 'top'] as const)
      .map((half) => ({ half, atBats: inInning.filter((a) => a.half === half).slice().reverse() }))
      .filter((g) => g.atBats.length > 0)
  }, [baseball.atBats, active])
  const teamFor = (id: string | null) => (id === detail.home.id ? detail.home : id === detail.away.id ? detail.away : null)

  const row = (a: BaseballAtBat, withInning: boolean) => {
    const team = teamFor(a.battingTeamId)
    const batterName = a.batterId ? detail.players[a.batterId]?.[0]?.name : null
    return (
      <li key={a.id} className="af-gv-bplay" data-scoring={a.scoring}>
        {team ? <TeamLogo team={team} size={18} /> : <span className="af-gv-logo" aria-hidden />}
        <span className="af-gv-bplay-clock af-num">
          {withInning ? halfLabel(a.half, a.inning, true) : `${a.pitches.length} P`}
        </span>
        <span className="af-gv-play-desc">
          {a.result ?? `${batterName ?? 'Batter'} at bat`}
          {a.events.map((e, i) => (
            <span key={i} className="af-gv-bevent">
              {e}
            </span>
          ))}
        </span>
        {a.scoring && a.awayScore != null && a.homeScore != null ? (
          <span className="af-gv-bplay-score af-num">
            {a.awayScore}–{a.homeScore}
          </span>
        ) : (
          <span />
        )}
      </li>
    )
  }

  return (
    <section className="af-gv-card" aria-labelledby="af-gv-mlbpbp">
      <h2 className="af-label" id="af-gv-mlbpbp">
        Play-by-play
      </h2>
      <div className="af-live-scope af-gv-tabs" role="group" aria-label="Which plays to show">
        <button
          type="button"
          className="af-live-scope-btn"
          data-active={tab === 'scoring'}
          aria-pressed={tab === 'scoring'}
          onClick={() => onTab('scoring')}
        >
          Scoring plays
        </button>
        <button
          type="button"
          className="af-live-scope-btn"
          data-active={tab === 'all'}
          aria-pressed={tab === 'all'}
          onClick={() => onTab('all')}
        >
          All plays
        </button>
      </div>
      {tab === 'scoring' ? (
        scoring.length === 0 ? (
          <p className="af-gv-none">No runs yet.</p>
        ) : (
          <ol className="af-gv-plays af-gv-bplays">{scoring.map((a) => row(a, true))}</ol>
        )
      ) : (
        <>
          {innings.length > 1 ? (
            <div className="af-live-scope af-gv-tabs" role="group" aria-label="Inning">
              {innings.map((n) => (
                <button
                  key={n}
                  type="button"
                  className="af-live-scope-btn"
                  data-active={n === active}
                  aria-pressed={n === active}
                  onClick={() => setPicked(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          ) : null}
          {halves.length === 0 ? <p className="af-gv-none">No plays yet.</p> : null}
          {halves.map((g) => (
            <div key={g.half}>
              <h3 className="af-label af-gv-period-head">{halfLabel(g.half, active)}</h3>
              <ol className="af-gv-plays af-gv-bplays">{g.atBats.map((a) => row(a, false))}</ol>
            </div>
          ))}
        </>
      )}
    </section>
  )
}

function DecisionsPanel({ detail, baseball }: { detail: LiveGameDetail; baseball: BaseballDetail }) {
  if (baseball.decisions.length === 0) return null
  return (
    <section className="af-gv-card" aria-labelledby="af-gv-decisions">
      <h2 className="af-label" id="af-gv-decisions">
        Pitchers of record
      </h2>
      <ul className="af-gv-decisions">
        {baseball.decisions.map((d) => {
          const team = d.teamId === detail.home.id ? detail.home : d.teamId === detail.away.id ? detail.away : null
          const { line, stat } = boxLine(detail, d.athleteId, 'pitching')
          const summary = [stat('IP') && `${stat('IP')} IP`, stat('ER') && `${stat('ER')} ER`, stat('K') && `${stat('K')} K`]
            .filter(Boolean)
            .join(' · ')
          return (
            <li key={d.key} className="af-gv-decision">
              <MiniPlayerImg sleeperId={null} name={d.name} avatarUrl={line?.headshot ?? null} size={36} />
              <span className="af-live-atbat-text">
                <span className="af-label">{d.label}</span>
                <span className="af-live-atbat-name">
                  {d.name}
                  {team ? <span className="af-gv-leader-pos"> {team.abbrev}</span> : null}
                </span>
                {summary ? <span className="af-live-atbat-line af-num">{summary}</span> : null}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const BATTING_COLUMNS = ['AB', 'R', 'H', 'RBI', 'HR', 'BB', 'K', 'AVG']
const PITCHING_COLUMNS = ['IP', 'H', 'R', 'ER', 'BB', 'K', 'HR', 'PC', 'ERA']

function BaseballBoxScore({ detail, baseball }: { detail: LiveGameDetail; baseball: BaseballDetail }) {
  const teams = [
    { team: detail.away, box: baseball.box.away },
    { team: detail.home, box: baseball.box.home },
  ].filter((t): t is { team: GameDetailTeam; box: BaseballBoxTeam } => t.box != null)
  if (teams.length === 0) return null
  return (
    <section className="af-gv-card af-gv-box" aria-labelledby="af-gv-mlbbox">
      <h2 className="af-label" id="af-gv-mlbbox">
        Box score
      </h2>
      {teams.map(({ team, box }) => (
        <div key={team.id} className="af-gv-box-team" data-team={team.id}>
          <div className="af-gv-box-team-head">
            <TeamLogo team={team} size={22} />
            <strong>{team.name}</strong>
          </div>
          <BaseballBoxTableView kind="batting" heading="Batters" table={box.batting} columns={BATTING_COLUMNS} />
          <BaseballBoxTableView kind="pitching" heading="Pitchers" table={box.pitching} columns={PITCHING_COLUMNS} />
        </div>
      ))}
    </section>
  )
}

function BaseballBoxTableView({
  kind,
  heading,
  table,
  columns,
}: {
  kind: 'batting' | 'pitching'
  heading: string
  table: BaseballBoxTable | null
  columns: string[]
}) {
  if (!table) return null
  const cols = columns.filter((c) => table.labels.includes(c))
  if (cols.length === 0) return null
  const cell = (stats: string[], c: string) => stats[table.labels.indexOf(c)] ?? ''
  return (
    <div className="af-gv-box-scroll">
      <table className="af-gv-box-table af-num" data-kind={kind}>
        <thead>
          <tr>
            <th scope="col" className="af-gv-box-name">
              {heading}
            </th>
            {cols.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.players.map((p) => (
            // A batter who came off the bench shares his slot's bat order and is not a starter.
            <tr key={p.athleteId} data-sub={kind === 'batting' && !p.starter}>
              <th scope="row" className="af-gv-box-name">
                {p.shortName ?? p.name}
                {kind === 'batting' && p.position ? <span className="af-gv-leader-pos"> {p.position}</span> : null}
                {p.note ? <span className="af-gv-leader-pos"> ({p.note})</span> : null}
              </th>
              {cols.map((c) => (
                <td key={c}>{cell(p.stats, c)}</td>
              ))}
            </tr>
          ))}
          {table.totals.some(Boolean) ? (
            <tr className="af-gv-bbox-total">
              <th scope="row" className="af-gv-box-name">
                Team
              </th>
              {cols.map((c) => (
                <td key={c}>{cell(table.totals, c)}</td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

/* ── footer ────────────────────────────────────────────────────────────────── */

function GameFooter({ detail }: { detail: LiveGameDetail }) {
  const bits = [
    detail.venue ? `${detail.venue.name}${detail.venue.location ? ` · ${detail.venue.location}` : ''}` : null,
    detail.weather,
    detail.attendance != null ? `Attendance ${detail.attendance.toLocaleString('en-US')}` : null,
  ].filter((b): b is string => !!b)
  if (bits.length === 0) return null
  return <p className="af-live-venue af-gv-footer">{bits.join(' · ')}</p>
}
