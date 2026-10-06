'use client'

import { CoreDepthLock, FreeUntilNote } from '@/components/core-app/CoreDepthLock'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { finderPlayerInfoCopy, infoReasonText, type PlayerInfoCopy } from '@/lib/core-app/finderPlayerInfoCopy'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import { SELL_TEAMS_SHOWN, slotName, type SellTeam, type WhoStartsHim as WhoStartsHimData } from '@/lib/core-app/whoStartsHim'

/**
 * "Who'd start him" — for each league where he is yours, the other teams he would crack the best
 * lineup of, best fit first (lib/core-app/whoStartsHim.ts). AF Pro (`player_depth`): a trade move,
 * decided server-side — a locked viewer's payload carries nothing but the lock.
 *
 * Spanish (2026-10-05): the words come from finderPlayerInfoCopy.ts at render, the loader's notes
 * through `infoReasonText` (whole, or English as written). The lock and the "free until" note are the
 * shared CoreDepthLock's, in the reader's language, and so is its subject (`wsLockWhat`).
 */

function teamLine(t: SellTeam, c: PlayerInfoCopy): string {
  return t.bumps ? c.wsOver(slotName(t.slot), t.bumps.name) : c.wsEmptySlot(slotName(t.slot))
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
  const { language } = useOptionalLanguage()
  if (!data) return null
  const c = finderPlayerInfoCopy(language)
  const last = playerName.trim().split(/\s+/).slice(-1)[0] || playerName
  return (
    <section className="af-card af-pf-ws" aria-labelledby="af-pf-ws-h">
      <h3 className="af-label" id="af-pf-ws-h">
        {c.wsHeading(last)}
      </h3>
      {data.locked ? (
        access ? <CoreDepthLock access={access} what={c.wsLockWhat(last)} lang={language} /> : null
      ) : (
        <>
          {access ? <FreeUntilNote access={access} lang={language} /> : null}
          <ul className="af-pf-ws-list">
            {data.leagues.map((l) => (
              <li key={l.leagueId} className="af-pf-ws-row">
                <div className="af-pf-ws-head">
                  <span className="af-pf-ws-league">{l.leagueName}</span>
                  {l.state === 'ranked' ? (
                    <span className={`af-pf-ws-count${l.teams.length === 0 ? ' is-none' : ''}`}>
                      {l.teams.length === 0 ? c.wsNoTeam : c.wsWouldStart(l.teams.length, l.otherTeams)}
                    </span>
                  ) : (
                    <span className="af-pf-ws-note">{l.note != null ? infoReasonText(l.note, language) : null}</span>
                  )}
                </div>
                {l.teams.length > 0 ? (
                  <ol className="af-pf-ws-teams">
                    {l.teams.slice(0, SELL_TEAMS_SHOWN).map((t) => (
                      <li key={t.key}>
                        <span className="af-pf-ws-team">{c.wsTeamName(t.teamName)}</span> <span className="af-pf-ws-why">{teamLine(t, c)}</span>
                      </li>
                    ))}
                    {l.teams.length > SELL_TEAMS_SHOWN ? (
                      <li className="af-pf-ws-more">{c.wsMore(l.teams.length - SELL_TEAMS_SHOWN)}</li>
                    ) : null}
                  </ol>
                ) : null}
                {l.teams.length > 0 ? (
                  <a className="af-pf-ws-go" href={`/core/trades?league=${encodeURIComponent(l.leagueId)}`}>
                    {c.wsOpenTradeCenter}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="af-pf-ws-foot">{c.wsFoot}</p>
        </>
      )}
    </section>
  )
}
