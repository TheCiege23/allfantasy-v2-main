'use client'

import { useEffect, useMemo, useState } from 'react'
import type { PlannerTeam, WeekPlanner } from '@/lib/league/weekPlanner'

/**
 * "Games this week" on the Players & waivers screen (2026-11-27): the streaming planner for the
 * daily sports. Model and reasons: lib/league/weekPlanner.ts. Two parts:
 *
 *   WeekPlannerCard  each team's opponent day by day, its games left, and the week's light nights;
 *   GamesLeftChip    "3 left" beside an available player, so the list itself answers "who plays most".
 *
 * Both read one request per league and week (`useWeekPlanner`). Nothing renders for a sport or a
 * week the server has no full schedule for — a partial grid would make a team look idle when it is not.
 */

export const PLANNER_CLIENT_SPORTS = ['NHL', 'NBA', 'NCAAB', 'MLB', 'SOCCER']

type PlannerState = { planner: WeekPlanner | null; teamCodes: Record<string, string> }

export function useWeekPlanner(leagueId: string, sport: string | null | undefined, teams: readonly string[], offset: 0 | 1 = 0) {
  const enabled = PLANNER_CLIENT_SPORTS.includes(String(sport ?? '').toUpperCase())
  const teamKey = useMemo(() => [...new Set(teams.map((t) => t.trim()).filter(Boolean))].sort().slice(0, 80).join('|'), [teams])
  const [state, setState] = useState<PlannerState | null>(null)
  useEffect(() => {
    if (!enabled || !leagueId) return
    let alive = true
    const q = new URLSearchParams({ offset: String(offset) })
    for (const t of teamKey ? teamKey.split('|') : []) q.append('team', t)
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/week-planner?${q.toString()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Partial<PlannerState> | null) => {
        if (alive) setState({ planner: d?.planner ?? null, teamCodes: d?.teamCodes ?? {} })
      })
      .catch(() => alive && setState({ planner: null, teamCodes: {} }))
    return () => {
      alive = false
    }
  }, [enabled, leagueId, teamKey, offset])

  const byCode = useMemo(() => new Map((state?.planner?.teams ?? []).map((t) => [t.team, t])), [state])
  /** The planner row for a player's team as the screen spells it, or null. */
  const teamFor = (team: string | null | undefined): PlannerTeam | null => {
    const c = team ? state?.teamCodes[team.trim()] : null
    return (c && byCode.get(c)) || null
  }
  return { planner: state?.planner ?? null, teamFor }
}

function dayHead(day: string): { dow: string; date: string } {
  const d = new Date(`${day}T12:00:00Z`)
  return { dow: d.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }), date: String(d.getUTCDate()) }
}

export function GamesLeftChip({ team, compact = false }: { team: PlannerTeam | null; compact?: boolean }) {
  if (!team) return null
  const days = team.games.filter((g) => !g.started).map((g) => dayHead(g.day).dow).join(', ')
  return (
    <span
      className="nls-gl-chip"
      data-none={team.remaining === 0 || undefined}
      title={team.remaining ? `Games left this week: ${days}` : 'No games left this week'}
      data-testid="games-left-chip"
    >
      {team.remaining} {compact ? 'left' : team.remaining === 1 ? 'game left' : 'games left'}
      {team.lightRemaining > 0 ? <span className="nls-gl-light" aria-label={`${team.lightRemaining} on light nights`}>★{team.lightRemaining}</span> : null}
    </span>
  )
}

const COLLAPSED_TEAMS = 8

export function WeekPlannerCard({
  planner,
  offset,
  onOffset,
  highlight,
}: {
  planner: WeekPlanner | null
  offset: 0 | 1
  onOffset: (o: 0 | 1) => void
  /** Teams to mark (the screen's own roster's teams, when it knows them). */
  highlight?: ReadonlySet<string>
}) {
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  if (!planner) return null
  const rows = all ? planner.teams : planner.teams.slice(0, COLLAPSED_TEAMS)
  const light = planner.days.filter((d) => d.light)
  return (
    <section className="nls-card nls-card-flush nls-wp" aria-label="Games this week" data-testid="week-planner">
      <div className="nls-wp-head">
        <button type="button" className="nls-wp-toggle" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
          <span className="nls-label">Games {offset ? 'next' : 'this'} week · Week {planner.week}</span>
          <span className="nls-wp-sub">
            {light.length ? `Light nights: ${light.map((d) => dayHead(d.day).dow).join(', ')}` : 'Who plays the most'}
            <span aria-hidden> {open ? '▴' : '▾'}</span>
          </span>
        </button>
        <div className="nls-wp-weeks" role="group" aria-label="Week">
          <button type="button" aria-pressed={offset === 0} onClick={() => onOffset(0)}>This week</button>
          <button type="button" aria-pressed={offset === 1} onClick={() => onOffset(1)}>Next week</button>
        </div>
      </div>
      {open ? (
        <>
          <div className="nls-wp-scroll">
            <table className="nls-wp-table">
              <thead>
                <tr>
                  <th scope="col" className="nls-wp-pin">Team</th>
                  <th scope="col" title="Games not yet started">Left</th>
                  {planner.days.map((d) => {
                    const h = dayHead(d.day)
                    return (
                      <th key={d.day} scope="col" data-today={d.status === 'today' || undefined} data-light={d.light || undefined} title={`${d.games} games${d.light ? ' — a light night' : ''}`}>
                        <span className="nls-wp-dow">{h.dow}</span>
                        <span className="nls-wp-n">{d.games}</span>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const byDay = new Map(t.games.map((g) => [g.day, g]))
                  return (
                    <tr key={t.team} data-mine={highlight?.has(t.team) || undefined} data-testid={`week-planner-${t.team}`}>
                      <th scope="row" className="nls-wp-pin">{t.label}</th>
                      <td className="nls-wp-left">{t.remaining}<span className="nls-wp-of">/{t.count}</span></td>
                      {planner.days.map((d) => {
                        const g = byDay.get(d.day)
                        return (
                          <td key={d.day} data-light={d.light || undefined} data-done={g?.started || undefined}>
                            {g ? `${g.home ? '' : '@'}${g.opponent}` : ''}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="nls-muted nls-wp-note">
            Light nights have the fewest games, so a player who plays then is easier to start. On a player, ★ counts his games
            left on light nights.{' '}
            {planner.teams.length > COLLAPSED_TEAMS ? (
              <button type="button" className="nls-text-link" onClick={() => setAll((x) => !x)}>
                {all ? 'Show fewer teams' : `Show all ${planner.teams.length} teams`}
              </button>
            ) : null}
          </p>
        </>
      ) : null}
    </section>
  )
}
