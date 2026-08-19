'use client'

/**
 * LeagueInfoRail — Broadcast Deck replacement for the league page's LEFT rail.
 *
 * Slice 2A of the league redesign: the desktop left panel stops being a chat
 * column (chat moves to the floating ChimmyBubble) and becomes league-specific
 * context that follows you across every tab: identity, your team, standings,
 * and vitals — all from the same real synced data the Decide tab uses. Honest
 * absent-states ("—", "not synced yet") instead of invented numbers.
 */

import { useMemo } from 'react'
import type { LeagueTeamSlot, UserLeague } from '@/app/dashboard/types'
import { isPreseason, useProjectedStandings } from '@/components/decide/useProjectedStandings'
import './broadcast-deck.css'

export type LeagueInfoRailProps = {
  league: UserLeague
  teams: LeagueTeamSlot[]
  userTeamId?: string | null
  isCommissioner?: boolean
  onOpenTab: (tabId: string) => void
}

export function LeagueInfoRail({
  league,
  teams,
  userTeamId = null,
  isCommissioner = false,
  onOpenTab,
}: LeagueInfoRailProps) {
  const myTeam = useMemo(
    () => teams.find((t) => t.id === userTeamId) ?? null,
    [teams, userTeamId],
  )
  const standings = useMemo(
    () =>
      [...teams].sort(
        (a, b) => (b.wins ?? 0) - (a.wins ?? 0) || (b.pointsFor ?? 0) - (a.pointsFor ?? 0),
      ),
    [teams],
  )
  const preseason = useMemo(() => isPreseason(teams), [teams])
  const projected = useProjectedStandings(league.id ?? null, preseason)
  const record = myTeam
    ? `${myTeam.wins}–${myTeam.losses}${myTeam.ties > 0 ? `–${myTeam.ties}` : ''}`
    : '—'

  return (
    <div className="bdx bdx-rail" data-testid="league-info-rail">
      {/* Identity */}
      <div className="bdx-rail-head">
        <div className="bdx-disp bdx-rail-name">{league.name}</div>
        <div className="bdx-rail-chips">
          <span className="bdx-chip">{String(league.sport || 'NFL')}</span>
          <span className="bdx-chip">{league.teamCount || teams.length || '—'} teams</span>
          {league.format ? <span className="bdx-chip">{league.format}</span> : null}
          {isCommissioner ? <span className="bdx-chip grad">Commish</span> : null}
        </div>
      </div>

      {/* Your team */}
      <div className="bdx-rail-sec">
        <h3>Your team</h3>
        {myTeam ? (
          <div className="bdx-rows">
            <div className="bdx-row"><span className="k">Team</span><span className="x">{myTeam.teamName || '—'}</span></div>
            <div className="bdx-row"><span className="k">Record</span><span className="x">{record}</span></div>
            <div className="bdx-row"><span className="k">PF / PA</span><span className="x">{myTeam.pointsFor.toFixed(1)} / {myTeam.pointsAgainst.toFixed(1)}</span></div>
            <div className="bdx-row"><span className="k">FAAB</span><span className="x">{myTeam.faabRemaining != null ? `$${myTeam.faabRemaining}` : '—'}</span></div>
          </div>
        ) : (
          <div className="bdx-rail-empty">No claimed team in this league yet.</div>
        )}
      </div>

      {/* Standings — projected week-1 ranking until real games are played */}
      <div className="bdx-rail-sec">
        <h3>{projected ? `Standings · projected wk ${projected.week}` : 'Standings'}</h3>
        {projected ? (
          <>
            <table className="bdx-stand">
              <tbody>
                {projected.rows.slice(0, 8).map((row, i) => (
                  <tr
                    key={row.rosterId}
                    className={
                      myTeam?.platformUserId && row.ownerId === myTeam.platformUserId ? 'me' : undefined
                    }
                  >
                    <td className="rk">{i + 1}</td>
                    <td className="nm">{row.teamName || row.name}</td>
                    <td className="rec">{row.projectedPoints.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="bdx-rail-empty" style={{ marginTop: 6 }}>
              Projected week-{projected.week} starter points
              {projected.scoringMode === 'league-scored'
                ? ' · your league’s scoring'
                : ' · format-based projections'}
              . Real results take over after kickoff.
            </div>
          </>
        ) : standings.length > 0 ? (
          <table className="bdx-stand">
            <tbody>
              {standings.slice(0, 8).map((t, i) => (
                <tr key={t.id} className={myTeam && t.id === myTeam.id ? 'me' : undefined}>
                  <td className="rk">{i + 1}</td>
                  <td className="nm">{t.teamName || t.ownerName || 'Team'}</td>
                  <td className="rec">
                    {t.wins}–{t.losses}
                    {t.ties > 0 ? `–${t.ties}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="bdx-rail-empty">No team records synced yet.</div>
        )}
        <button type="button" className="bdx-btn sec bdx-rail-link" onClick={() => onOpenTab('standings')}>
          Full standings
        </button>
      </div>

      {/* Vitals */}
      <div className="bdx-rail-sec">
        <h3>Vitals</h3>
        <div className="bdx-rows">
          <div className="bdx-row"><span className="k">Scoring</span><span className="x">{league.scoring || '—'}</span></div>
          <div className="bdx-row">
            <span className="k">Trade deadline</span>
            <span className="x">{league.tradeDeadlineWeek ? `Wk ${league.tradeDeadlineWeek}` : 'None'}</span>
          </div>
          <div className="bdx-row">
            <span className="k">Playoffs</span>
            <span className="x">{league.playoffStartWeek ? `Wk ${league.playoffStartWeek}` : '—'}</span>
          </div>
          <div className="bdx-row"><span className="k">Season</span><span className="x">{league.season ?? '—'}</span></div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="bdx-rail-sec">
        <h3>Go to</h3>
        <div className="bdx-rail-nav">
          <button type="button" className="bdx-btn pri" onClick={() => onOpenTab('decide')}>Decide</button>
          <button type="button" className="bdx-btn sec" onClick={() => onOpenTab('trades')}>Trades</button>
          <button type="button" className="bdx-btn sec" onClick={() => onOpenTab('waivers')}>Waivers</button>
          {isCommissioner ? (
            <button type="button" className="bdx-btn sec" onClick={() => onOpenTab('settings')}>Commish</button>
          ) : null}
        </div>
      </div>

      {/* Parent-brand mark */}
      <div className="bdx-rail-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/brown-pig-llc.png"
          alt="Brown Pig LLC"
          onError={(e) => {
            ;(e.currentTarget.parentElement as HTMLElement | null)?.style.setProperty('display', 'none')
          }}
        />
        <span>
          An <b>AllFantasy</b> product
          <br />
          built by <b>Brown Pig LLC</b>
        </span>
      </div>
    </div>
  )
}

export default LeagueInfoRail
