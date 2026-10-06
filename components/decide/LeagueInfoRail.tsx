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
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import './broadcast-deck.css'

/** Renders `text` with `token` replaced by `bold` in a <b>, keeping the words around it in order. */
function withBold(text: string, token: string, bold: string) {
  const [before, after = ''] = text.split(token)
  return (
    <>
      {before}
      <b>{bold}</b>
      {after}
    </>
  )
}

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
  const { t } = useOptionalLanguage()
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
          <span className="bdx-chip">{t('decide.rail.teams').replace('{{count}}', String(league.teamCount || teams.length || '—'))}</span>
          {league.format ? <span className="bdx-chip">{league.format}</span> : null}
          {isCommissioner ? <span className="bdx-chip grad">{t('decide.rail.commish')}</span> : null}
        </div>
      </div>

      {/* Your team */}
      <div className="bdx-rail-sec">
        <h3>{t('decide.yourTeam')}</h3>
        {myTeam ? (
          <div className="bdx-rows">
            <div className="bdx-row"><span className="k">{t('decide.team')}</span><span className="x">{myTeam.teamName || '—'}</span></div>
            <div className="bdx-row"><span className="k">{t('decide.record')}</span><span className="x">{record}</span></div>
            <div className="bdx-row"><span className="k">{t('decide.rail.pfPa')}</span><span className="x">{myTeam.pointsFor.toFixed(1)} / {myTeam.pointsAgainst.toFixed(1)}</span></div>
            <div className="bdx-row"><span className="k">FAAB</span><span className="x">{myTeam.faabRemaining != null ? `$${myTeam.faabRemaining}` : '—'}</span></div>
          </div>
        ) : (
          <div className="bdx-rail-empty">{t('decide.noClaimedTeamYet')}</div>
        )}
      </div>

      {/* Standings — projected week-1 ranking until real games are played */}
      <div className="bdx-rail-sec">
        <h3>{projected ? t('decide.rail.standingsProjected').replace('{{week}}', String(projected.week)) : t('decide.standings')}</h3>
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
              {t('decide.rail.projNote')
                .replace('{{week}}', String(projected.week))
                .replace('{{mode}}', projected.scoringMode === 'league-scored' ? t('decide.rail.modeLeague') : t('decide.rail.modeFormat'))}
            </div>
          </>
        ) : standings.length > 0 ? (
          <table className="bdx-stand">
            <tbody>
              {standings.slice(0, 8).map((tm, i) => (
                <tr key={tm.id} className={myTeam && tm.id === myTeam.id ? 'me' : undefined}>
                  <td className="rk">{i + 1}</td>
                  <td className="nm">{tm.teamName || tm.ownerName || t('decide.team')}</td>
                  <td className="rec">
                    {tm.wins}–{tm.losses}
                    {tm.ties > 0 ? `–${tm.ties}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="bdx-rail-empty">{t('decide.noRecordsYet')}</div>
        )}
        <button type="button" className="bdx-btn sec bdx-rail-link" onClick={() => onOpenTab('standings')}>
          {t('decide.rail.fullStandings')}
        </button>
      </div>

      {/* Vitals */}
      <div className="bdx-rail-sec">
        <h3>{t('decide.rail.vitals')}</h3>
        <div className="bdx-rows">
          <div className="bdx-row"><span className="k">{t('decide.scoring')}</span><span className="x">{league.scoring || '—'}</span></div>
          <div className="bdx-row">
            <span className="k">{t('decide.tradeDeadline')}</span>
            <span className="x">{league.tradeDeadlineWeek ? t('decide.rail.wk').replace('{{week}}', String(league.tradeDeadlineWeek)) : t('decide.rail.none')}</span>
          </div>
          <div className="bdx-row">
            <span className="k">{t('decide.playoffs')}</span>
            <span className="x">{league.playoffStartWeek ? t('decide.rail.wk').replace('{{week}}', String(league.playoffStartWeek)) : '—'}</span>
          </div>
          <div className="bdx-row"><span className="k">{t('decide.rail.season')}</span><span className="x">{league.season ?? '—'}</span></div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="bdx-rail-sec">
        <h3>{t('decide.rail.goTo')}</h3>
        <div className="bdx-rail-nav">
          <button type="button" className="bdx-btn pri" onClick={() => onOpenTab('decide')}>{t('decide.rail.decide')}</button>
          <button type="button" className="bdx-btn sec" onClick={() => onOpenTab('trades')}>{t('decide.rail.trades')}</button>
          <button type="button" className="bdx-btn sec" onClick={() => onOpenTab('waivers')}>{t('decide.rail.waivers')}</button>
          {isCommissioner ? (
            <button type="button" className="bdx-btn sec" onClick={() => onOpenTab('settings')}>{t('decide.rail.commish')}</button>
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
          {withBold(t('decide.rail.brandLine1'), '{{brand}}', 'AllFantasy')}
          <br />
          {withBold(t('decide.rail.brandLine2'), '{{maker}}', 'Brown Pig LLC')}
        </span>
      </div>
    </div>
  )
}

export default LeagueInfoRail
