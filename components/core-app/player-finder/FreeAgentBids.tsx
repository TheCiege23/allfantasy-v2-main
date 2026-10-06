'use client'

import { CoreDepthLock, FreeUntilNote } from '@/components/core-app/CoreDepthLock'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import type { FreeAgentBids as FreeAgentBidsData } from '@/lib/core-app/freeAgentBids'
import { TopicTip } from '@/components/core-app/TopicTip'
import { faCopy, faNoteText } from '@/lib/core-app/finderSearchCopy'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

/**
 * "Available in your leagues" — every league where he is a free agent (the strip's FA chips), each
 * with where to claim him and, for AF Pro, a suggested FAAB bid beside that league's own winning
 * bids (lib/core-app/freeAgentBids.ts).
 *
 * Where he is available and the claim link are free — that is "in your leagues". The bid is a move,
 * so it is AF Pro (`player_depth`), decided server-side: a locked viewer's payload carries no bid.
 *
 * Spanish (2026-10-05): built at render from `useOptionalLanguage` (finderSearchCopy.ts); the loader's
 * notes go through `faNoteText` whole or not at all. The AF Pro lock and its "Free until" note are
 * CoreDepthLock's, shared by every gated surface, and stay as that component writes them.
 */
export function FreeAgentBids({
  data,
  playerName,
  access,
}: {
  data: FreeAgentBidsData | null
  playerName: string
  access: CoreDepthAccess | null
}) {
  const { language } = useOptionalLanguage()
  if (!data || data.rows.length === 0) return null
  const t = faCopy(language)
  const last = playerName.trim().split(/\s+/).slice(-1)[0] || playerName
  const n = data.rows.length
  return (
    <section className="af-card af-pf-fa" aria-labelledby="af-pf-fa-h">
      {/* The "?" sits beside the h3, not in it (aria-labelledby), and only where there are bids to explain. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <h3 className="af-label" id="af-pf-fa-h">
          {t.heading(n)}
        </h3>
        {!data.bidsLocked ? <TopicTip topic="faabBid" /> : null}
      </div>
      {!data.bidsLocked && access ? <FreeUntilNote access={access} /> : null}
      <ul className="af-pf-fa-list">
        {data.rows.map((r) => (
          <li key={r.leagueId} className="af-pf-fa-row">
            <div className="af-pf-fa-main">
              <span className="af-pf-fa-league">{r.leagueName}</span>
              {r.bid ? (
                <span className="af-pf-fa-bid af-num">
                  {t.bid(r.bid.amount)}
                  <span className="af-pf-fa-of">
                    {t.ofBudget(r.bid.budget)}
                    {r.bid.remaining != null ? t.left(r.bid.remaining) : ''}
                  </span>
                </span>
              ) : r.note ? (
                <span className="af-pf-fa-note">{faNoteText(r.note, language)}</span>
              ) : null}
            </div>
            {r.room ? (
              <p className="af-pf-fa-room af-num">
                {t.room(r.room.median, r.room.p75, r.room.claims)}
              </p>
            ) : null}
            {r.claim ? (
              <a
                className="af-pf-fa-claim"
                href={r.claim.href}
                {...(r.claim.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                {t.claim(last, r.claim.platformLabel)}
              </a>
            ) : null}
          </li>
        ))}
      </ul>
      {data.bidsLocked && access ? <CoreDepthLock access={access} what="Suggested FAAB bids" /> : null}
      {!data.bidsLocked ? (
        <p className="af-pf-fa-foot">{t.foot}</p>
      ) : null}
    </section>
  )
}
