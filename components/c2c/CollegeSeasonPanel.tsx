'use client'

/**
 * The college side of an NFL C2C league on separate standings (lib/c2c/campusSeason): its standings,
 * a week of college matchups, the college champion and the overall title. Shows nothing for a league
 * without a college season.
 */
import { useEffect, useState } from 'react'
import '@/components/core-app/af-core.css'
import '@/components/league/league-overview.css'
import '@/components/standings/league-standings.css'
import type { CampusSeasonView } from '@/lib/c2c/campusSeason/campusSeasonView'

const pts = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const record = (w: number, l: number, t: number) => `${w}-${l}${t ? `-${t}` : ''}`

function weekLabel(view: CampusSeasonView, week: number): string {
  if (week <= view.regularSeasonWeeks) return `College week ${week}`
  const round = week - view.regularSeasonWeeks
  const rounds = Math.ceil(Math.log2(Math.max(2, view.playoffTeams)))
  return round === rounds ? 'College final' : round === rounds - 1 ? 'College semifinals' : `College playoffs, round ${round}`
}

export function CollegeSeasonView({ view, onWeek }: { view: CampusSeasonView; onWeek?: (week: number) => void }) {
  const name = (id: string | null) => (id ? view.teams[id]?.name ?? 'Team' : 'Bye')
  const showMedian = view.standings.some((s) => s.medianWins + s.medianLosses + s.medianTies > 0)
  const champion = view.championRosterId ? name(view.championRosterId) : null
  const overallLeader = view.overall[0]
  return (
    <section className="af-core af-league-overview league-standings" aria-label="College standings">
      <header>
        <div>
          <p className="league-standings__eyebrow">{view.season} / College side</p>
          <h2>College standings</h2>
        </div>
      </header>
      {champion ? <p className="league-standings__note"><strong>{champion}</strong> won the college title.</p> : null}

      <div className="league-standings__scroll" role="region" aria-label="College standings table" tabIndex={0}>
        <table>
          <caption className="sr-only">College standings, {view.season}</caption>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Team</th>
              <th scope="col">W-L</th>
              {showMedian && <th scope="col">vs median</th>}
              <th scope="col">Points for</th>
              <th scope="col">Points against</th>
            </tr>
          </thead>
          <tbody>
            {view.standings.map((s) => (
              <tr key={s.rosterId}>
                <td>{s.rank ?? '—'}</td>
                <th scope="row">{name(s.rosterId)}{s.seed ? <span className="league-standings__firsts">{` · seed ${s.seed}`}</span> : null}</th>
                <td>{record(s.wins, s.losses, s.ties)}</td>
                {showMedian && <td>{record(s.medianWins, s.medianLosses, s.medianTies)}</td>}
                <td>{pts(s.pointsFor)}</td>
                <td>{pts(s.pointsAgainst)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {view.weeks.length > 0 && (
        <div className="league-standings__controls">
          <label>
            Week
            <select aria-label="College week" value={view.week} onChange={(e) => onWeek?.(Number(e.target.value))}>
              {view.weeks.map((w) => <option key={w} value={w}>{weekLabel(view, w)}</option>)}
            </select>
          </label>
        </div>
      )}
      <ul aria-label={weekLabel(view, view.week)} className="league-standings__matchups">
        {view.matchups.map((m) => (
          <li key={m.id}>
            {m.awayRosterId ? (
              <span>
                {name(m.homeRosterId)} <strong>{pts(m.homeScore)}</strong> {'–'} <strong>{pts(m.awayScore)}</strong> {name(m.awayRosterId)}
                {m.status === 'active' ? ' · live' : m.status === 'scheduled' ? ' · not started' : ''}
              </span>
            ) : (
              <span>{name(m.homeRosterId)}: {m.kind === 'playoff' ? 'first-round bye' : `bye, ${pts(m.homeScore)} points`}</span>
            )}
          </li>
        ))}
      </ul>

      {overallLeader ? (
        <details>
          <summary>Overall title: {name(overallLeader.rosterId)} leads, {record(overallLeader.wins, overallLeader.losses, overallLeader.ties)} across both sides</summary>
          <ol>
            {view.overall.map((o) => (
              <li key={o.rosterId}>{name(o.rosterId)} {record(o.wins, o.losses, o.ties)}, {pts(o.pointsFor)} points</li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  )
}

export function CollegeSeasonPanel({ leagueId }: { leagueId: string }) {
  const [view, setView] = useState<CampusSeasonView | null>(null)
  const [week, setWeek] = useState<number | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/leagues/${encodeURIComponent(leagueId)}/c2c/college-season${week ? `?week=${week}` : ''}`, { signal: controller.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { collegeSeason?: CampusSeasonView | null } | null) => { if (!controller.signal.aborted) setView(d?.collegeSeason ?? null) })
      .catch(() => { /* the panel simply does not show */ })
    return () => controller.abort()
  }, [leagueId, week])
  if (!view) return null
  return <CollegeSeasonView view={view} onWeek={setWeek} />
}
