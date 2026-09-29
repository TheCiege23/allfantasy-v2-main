import { CoreDepthLock, FreeUntilNote } from '@/components/core-app/CoreDepthLock'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import { SELL_TEAMS_SHOWN, slotName, type SellTeam, type WhoStartsHim as WhoStartsHimData } from '@/lib/core-app/whoStartsHim'

/**
 * "Who'd start him" — for each league where he is yours, the other teams he would crack the best
 * lineup of, best fit first (lib/core-app/whoStartsHim.ts). AF Pro (`player_depth`): a trade move,
 * decided server-side — a locked viewer's payload carries nothing but the lock.
 */

function teamLine(t: SellTeam): string {
  return t.bumps ? `at ${slotName(t.slot)}, over ${t.bumps.name}` : `at ${slotName(t.slot)} — a slot they can’t fill`
}

export function WhoStartsHim({
  data,
  playerName,
  access,
}: {
  data: WhoStartsHimData | null
  playerName: string
  access: CoreDepthAccess | null
}) {
  if (!data) return null
  const last = playerName.trim().split(/\s+/).slice(-1)[0] || playerName
  return (
    <section className="af-card af-pf-ws" aria-labelledby="af-pf-ws-h">
      <h3 className="af-label" id="af-pf-ws-h">
        Who&apos;d start {last}
      </h3>
      {data.locked ? (
        access ? <CoreDepthLock access={access} what={`Which teams would start ${last}`} /> : null
      ) : (
        <>
          {access ? <FreeUntilNote access={access} /> : null}
          <ul className="af-pf-ws-list">
            {data.leagues.map((l) => (
              <li key={l.leagueId} className="af-pf-ws-row">
                <div className="af-pf-ws-head">
                  <span className="af-pf-ws-league">{l.leagueName}</span>
                  {l.state === 'ranked' ? (
                    <span className={`af-pf-ws-count${l.teams.length === 0 ? ' is-none' : ''}`}>
                      {l.teams.length === 0
                        ? `no team would start him over what they have`
                        : `would start for ${l.teams.length} of ${l.otherTeams} ${l.otherTeams === 1 ? 'team' : 'teams'}`}
                    </span>
                  ) : (
                    <span className="af-pf-ws-note">{l.note}</span>
                  )}
                </div>
                {l.teams.length > 0 ? (
                  <ol className="af-pf-ws-teams">
                    {l.teams.slice(0, SELL_TEAMS_SHOWN).map((t) => (
                      <li key={t.key}>
                        <span className="af-pf-ws-team">{t.teamName}</span> <span className="af-pf-ws-why">{teamLine(t)}</span>
                      </li>
                    ))}
                    {l.teams.length > SELL_TEAMS_SHOWN ? (
                      <li className="af-pf-ws-more">+{l.teams.length - SELL_TEAMS_SHOWN} more</li>
                    ) : null}
                  </ol>
                ) : null}
                {l.teams.length > 0 ? (
                  <a className="af-pf-ws-go" href={`/core/trades?league=${encodeURIComponent(l.leagueId)}`}>
                    Open Trade Center
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="af-pf-ws-foot">
            Ranked by how much he&apos;d add to each team&apos;s best lineup, using market value in that league&apos;s format as the
            measure. It&apos;s who has room for him — not who will say yes.
          </p>
        </>
      )}
    </section>
  )
}
