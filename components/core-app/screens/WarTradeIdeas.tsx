'use client'

import Link from 'next/link'

import '@/components/core-app/af-war-trades.css'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import type { WarTradesView, WinNowIdea } from '@/lib/core-app/warRoomTrades'
import { pct, signedPts } from '@/lib/core-app/outlookCopy'
import { CoreDepthLock, FreeUntilNote } from '@/components/core-app/CoreDepthLock'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { warRoomTradesMessages } from '@/lib/core-app/messages/warRoomTrades'

/**
 * Trades that move your odds — War Room phase 2, for the league on screen (rules in
 * lib/core-app/warRoomTrades.ts).
 *
 * ⚠ A LOCKED VIEWER WAS NEVER SENT THE IDEAS. The page skips the loader when `trade_depth` is locked,
 * exactly as Scout skips its edge; this draws the lock in its place. A lock over data the page already
 * sent would be a client-only gate.
 *
 * ⚠ `id="war-trades"` IS AN ANCHOR. The Front's trade-deadline orders link here.
 */

function useCopy() {
  const { language } = useOptionalLanguage()
  return { m: useMessages(warRoomTradesMessages), language }
}

type Copy = ReturnType<typeof useCopy>['m']

function WinNowRow({ idea, rankedBy, href, m }: { idea: WinNowIdea; rankedBy: 'playoff' | 'title'; href: string; m: Copy }) {
  const delta = rankedBy === 'title' ? idea.titleDelta : idea.playoffDelta
  const sendLabel = `${idea.send.name}${idea.send.position ? ` (${idea.send.position})` : ''}`
  const getLabel = `${idea.receive.name}${idea.receive.position ? ` (${idea.receive.position})` : ''}`
  return (
    <li className="af-wt-idea">
      <p className="af-wt-deal">{m.sendGet(sendLabel, getLabel, idea.partnerName)}</p>
      <p className="af-wt-numbers">
        <span className="af-wt-delta af-num" data-tone={delta != null && delta > 0 ? 'good' : undefined}>
          {delta == null ? m.notPriced : rankedBy === 'title' ? m.titleDelta(signedPts(delta)) : m.playoffDelta(signedPts(delta))}
        </span>
        <span className="af-wt-gains af-num">{m.gains(signedPts(idea.youGainPerWeek), signedPts(idea.partnerGainPerWeek))}</span>
      </p>
      {idea.partnerPlayoffPct != null ? <p className="af-wt-fact">{m.partnerFact(pct(idea.partnerPlayoffPct))}</p> : null}
      <Link className="af-wt-build" href={href}>
        {m.build} &rarr;
      </Link>
    </li>
  )
}

export function WarTradeIdeas({ view, access }: { view: WarTradesView | null; access: CoreDepthAccess | null }) {
  const { m, language } = useCopy()
  if (access && !access.unlocked) {
    return (
      <section className="af-wt" id="war-trades" aria-labelledby="af-wt-heading">
        <h2 id="af-wt-heading" className="af-label af-wt-heading">
          {m.heading}
        </h2>
        <CoreDepthLock access={access} what={m.lockWhat} lang={language} />
      </section>
    )
  }
  if (!view) return null
  const t = view.trades

  return (
    <section className="af-wt" id="war-trades" aria-labelledby="af-wt-heading">
      <h2 id="af-wt-heading" className="af-label af-wt-heading">
        {m.heading} {access ? <FreeUntilNote access={access} lang={language} /> : null}
      </h2>

      {t.mode === 'win_now' ? (
        <>
          <p className="af-wt-note">{m.basis(t.basisWeek?.week ?? null)}</p>
          {t.ideas.length > 0 ? (
            <ol className="af-wt-list">
              {t.ideas.map((idea) => (
                <WinNowRow key={`${idea.partnerRosterId}:${idea.send.id}:${idea.receive.id}`} idea={idea} rankedBy={t.rankedBy} href={view.tradeCenterHref} m={m} />
              ))}
            </ol>
          ) : (
            <p className="af-wt-note">{m.noneFound(t.screened)}</p>
          )}
        </>
      ) : t.mode === 'sell' ? (
        <>
          <p className="af-wt-note">{m.sellLead}</p>
          {t.ideas.length > 0 ? (
            <ol className="af-wt-list">
              {t.ideas.map((idea) => (
                <li key={idea.player.id} className="af-wt-idea">
                  <p className="af-wt-deal">{m.sellPlayer(idea.player.name, idea.player.position, idea.player.age, idea.agingFrom)}</p>
                  <ul className="af-wt-partners">
                    {idea.partners.map((p) => (
                      <li key={p.rosterId} className="af-num">
                        {m.sellPartner(p.name, signedPts(p.gainPerWeek), p.playoffPct != null ? pct(p.playoffPct) : null)}
                      </li>
                    ))}
                  </ul>
                  <Link className="af-wt-build" href={view.tradeCenterHref}>
                    {m.build} &rarr;
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <p className="af-wt-note">{m.sellNone}</p>
          )}
        </>
      ) : t.mode === 'closed' ? (
        <p className="af-wt-note">{m.closed(t.deadlineWeek)}</p>
      ) : (
        <p className="af-wt-note">
          {t.why === 'redraft_out'
            ? m.noneRedraftOut
            : t.why === 'not_priced'
              ? m.noneNotPriced(t.reason)
              : t.why === 'no_team'
                ? m.noneNoTeam
                : m.noneUnplaced}
        </p>
      )}
    </section>
  )
}

export default WarTradeIdeas
