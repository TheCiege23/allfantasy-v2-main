'use client'

import '@/components/core-app/af-war-ready.css'
import type { PlayoffReady } from '@/lib/core-app/warRoomPlayoffReady'
import { pct } from '@/lib/core-app/outlookCopy'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { warRoomPlayoffReadyMessages } from '@/lib/core-app/messages/warRoomPlayoffReady'

/**
 * Playoff readiness — War Room phase 7, for the league on screen (rules in
 * lib/core-app/warRoomPlayoffReady.ts). Free. A team out of the title race sees nothing here: the road
 * ahead is its section, and an empty "readiness" card would only repeat that it is out.
 */

export function WarPlayoffReady({ view }: { view: PlayoffReady }) {
  const m = useMessages(warRoomPlayoffReadyMessages)
  // The feed's designation words (Out, Questionable…) through the same table Game Plan's chips use.
  const { language } = useOptionalLanguage()
  if (view.kind === 'none' && view.why === 'out_of_it') return null

  return (
    <section className="af-wr" id="war-ready" aria-labelledby="af-wr-heading">
      <h2 id="af-wr-heading" className="af-label af-wr-heading">
        {m.heading}
      </h2>

      {view.kind === 'none' ? (
        <p className="af-wr-note">{m.none(view.why)}</p>
      ) : (
        <>
          <div className="af-wr-top">
            <p className="af-wr-weeks">
              {m.weeks(
                view.weeks.length > 1 ? `${view.weeks[0]}–${view.weeks[view.weeks.length - 1]}` : `${view.weeks[0]}`,
                view.weeks.length,
              )}
            </p>
            <p className="af-wr-odds">{m.odds(pct(view.odds.title), pct(view.odds.playoff), view.odds.bye == null ? null : pct(view.odds.bye))}</p>
          </div>

          <div className="af-wr-grid">
            <div className="af-wr-block" data-tone={view.onBye.length > 0 ? 'warn' : 'ok'}>
              <h3 className="af-label af-wr-sub">{m.byeHeading}</h3>
              {view.onBye.length === 0 ? (
                <p className="af-wr-ok">{m.byeNone}</p>
              ) : (
                <ul className="af-wr-list">
                  {view.onBye.map((s) => (
                    <li key={s.player.id}>{m.byeRow(s.player.name, s.player.position, s.byeWeeks[0]!)}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="af-wr-block" data-tone={view.injured.length > 0 ? 'warn' : 'ok'}>
              <h3 className="af-label af-wr-sub">{m.injuredHeading}</h3>
              {view.injured.length === 0 ? (
                <p className="af-wr-ok">{m.injuredNone}</p>
              ) : (
                <ul className="af-wr-list">
                  {view.injured.map((s) => (
                    <li key={s.player.id} data-kind={s.injury!.kind}>
                      {m.injuredRow(s.player.name, s.player.position, coreUiCopy(s.injury!.status, language))}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="af-wr-block">
            <h3 className="af-label af-wr-sub">{m.thinHeading}</h3>
            <p className="af-wr-note">{m.thinLead}</p>
            {view.thinnest.length === 0 ? (
              <p className="af-wr-ok">{m.thinNone}</p>
            ) : (
              <ol className="af-wr-list af-wr-thin">
                {view.thinnest.map((s) => (
                  <li key={s.player.id}>
                    {m.thinRow(s.player.name, s.player.position, s.dropOff.toFixed(1), s.backup?.name ?? null)}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <p className="af-wr-note">{m.basis(view.basisWeek?.week ?? null)}</p>
        </>
      )}
    </section>
  )
}

export default WarPlayoffReady
