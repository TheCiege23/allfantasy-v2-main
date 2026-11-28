'use client'

import { useCallback, useEffect, useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { LeagueActivityTab } from '@/components/league/LeagueActivityTab'
import { fmt1, initialsOf } from '@/lib/league/native/nativeScreenModels'
import type { LeagueWeekCard, LeagueWeekCards, LeagueWeekCardTeam } from '@/server/services/nativeLeagueWeekCards'
import { NativeStandingsScreen } from './NativeStandingsScreen'
import { noScheduleYet } from '@/lib/league/scheduleState'

/**
 * The League page (owner, 2026-11-27): Sleeper's League tab is three things — every matchup this week,
 * the standings, and the league's activity — and nothing else. History stays one tap away at the
 * bottom; chat is in the bottom bar. The Standings and Activity sections are the existing screens,
 * unchanged, so nothing they already say is lost.
 */
export function NativeLeaguePageScreen(props: { league: UserLeague; isCommissioner: boolean; onSelectTab: (id: string) => void }) {
  const { league, isCommissioner, onSelectTab } = props
  return (
    <div className="nls nls-league-page" data-testid="native-league-page">
      {/* No schedule until the draft ends (owner, 2026-11-28), so no Matchups section before it. */}
      {noScheduleYet(league) ? null : <LeagueWeekMatchups leagueId={league.id} />}
      {/* Each screen carries its own title ("Standings & playoffs", "Activity"); a second heading here said it twice. */}
      <section aria-label="Standings">
        <NativeStandingsScreen league={league} isCommissioner={isCommissioner} onSelectTab={onSelectTab} />
      </section>
      {/* Nothing has happened before the draft: no Activity section until there is some. */}
      {noScheduleYet(league) ? null : (
        <section aria-label="Activity">
          <LeagueActivityTab leagueId={league.id} />
        </section>
      )}
      <div className="nls-lp-more">
        <button type="button" className="nls-btn" data-testid="league-page-history" onClick={() => onSelectTab('legacy')}>
          League history
        </button>
      </div>
    </div>
  )
}

export { noScheduleYet }

function LeagueWeekMatchups({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<LeagueWeekCards | null>(null)
  const [week, setWeek] = useState<number | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'none'>('loading')

  const load = useCallback(async () => {
    setState('loading')
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/week-cards${week != null ? `?week=${week}` : ''}`, { cache: 'no-store' })
      if (!res.ok) {
        setData(null)
        setState('none')
        return
      }
      setData((await res.json()) as LeagueWeekCards)
      setState('ready')
    } catch {
      setData(null)
      setState('none')
    }
  }, [leagueId, week])
  useEffect(() => {
    void load()
  }, [load])

  // A league with no head-to-head week (no season yet, rotisserie, a chop league) shows no Matchups section.
  if (state === 'none' || (state === 'ready' && !data?.cards.length)) return null
  const shown = data?.week ?? week
  return (
    <section aria-labelledby="nls-lp-matchups" data-testid="league-page-matchups">
      <div className="nls-lp-headrow">
        <h2 id="nls-lp-matchups" className="nls-lp-head">Matchups</h2>
        {shown != null ? (
          <div className="nls-lp-week" role="group" aria-label="Week">
            <button type="button" className="nls-btn" aria-label="Previous week" disabled={shown <= 1} onClick={() => setWeek(Math.max(1, shown - 1))}>‹</button>
            <span data-testid="league-page-week">Week {shown}</span>
            <button type="button" className="nls-btn" aria-label="Next week" onClick={() => setWeek(shown + 1)}>›</button>
          </div>
        ) : null}
      </div>
      {state === 'loading' && !data ? (
        <p className="nls-muted">Loading this week&apos;s matchups…</p>
      ) : (
        <ul className="nls-lp-cards">
          {data?.cards.map((c) => <MatchupCard key={c.id} card={c} />)}
        </ul>
      )}
    </section>
  )
}

function Avatar({ team }: { team: LeagueWeekCardTeam }) {
  const [broken, setBroken] = useState(false)
  return team.avatarUrl && !broken ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="nls-lp-avatar" src={team.avatarUrl} alt="" onError={() => setBroken(true)} />
  ) : (
    <span className="nls-lp-avatar" aria-hidden>{initialsOf(team.name)}</span>
  )
}

/** One side of a card. `pct` is this side's win chance (0–100) before the game is final. */
function Side({ team, pct, status, won, align }: { team: LeagueWeekCardTeam; pct: number | null; status: LeagueWeekCard['status']; won: boolean | null; align: 'left' | 'right' }) {
  const score = status === 'upcoming' ? null : team.points
  const leading = pct != null && pct >= 50
  return (
    <div className="nls-lp-side" data-align={align} data-you={team.isYou || undefined} data-won={won ?? undefined}>
      <div className="nls-lp-top">
        <Avatar team={team} />
        <div className="nls-lp-score">
          <strong data-testid={`league-page-score-${team.rosterId}`}>{score != null ? fmt1(score) : '—'}</strong>
          {team.projected != null ? <small>proj {fmt1(team.projected)}</small> : null}
        </div>
      </div>
      {pct != null ? (
        <div className="nls-lp-win" data-lead={leading || undefined}>
          <span className="nls-lp-bar"><span style={{ width: `${pct}%` }} /></span>
          <span className="nls-lp-pct" data-testid={`league-page-win-${team.rosterId}`}>{pct}% win</span>
        </div>
      ) : null}
      <div className="nls-lp-name">
        <span>{team.name}{team.isYou ? <span className="nls-sr"> (your team)</span> : null}</span>
        {team.record ? <small>{team.record}</small> : null}
      </div>
    </div>
  )
}

function MatchupCard({ card }: { card: LeagueWeekCard }) {
  const homePct = card.homeWinProbability == null ? null : Math.round(card.homeWinProbability * 100)
  const final = card.status === 'final'
  const hp = card.home.points ?? 0
  const ap = card.away?.points ?? 0
  const homeWon = final && card.away ? (hp === ap ? null : hp > ap) : null
  return (
    <li className="nls-lp-card" data-mine={card.mine || undefined} data-testid={`league-page-card-${card.id}`}>
      {card.label ? <div className="nls-lp-label">{card.label}</div> : null}
      <div className="nls-lp-row">
        <Side team={card.home} pct={homePct} status={card.status} won={homeWon} align="left" />
        <span className="nls-lp-vs">
          <span aria-hidden>{final ? 'Final' : card.status === 'live' ? 'Live' : 'vs'}</span>
          {card.games > 1 ? <small data-testid={`league-page-games-${card.id}`}>{card.games} games</small> : null}
        </span>
        {card.away ? (
          <Side team={card.away} pct={homePct == null ? null : 100 - homePct} status={card.status} won={homeWon == null ? null : !homeWon} align="right" />
        ) : (
          <div className="nls-lp-side nls-lp-bye" data-align="right"><span className="nls-muted">Bye</span></div>
        )}
      </div>
    </li>
  )
}
