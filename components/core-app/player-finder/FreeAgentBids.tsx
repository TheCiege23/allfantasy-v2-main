import { CoreDepthLock, FreeUntilNote } from '@/components/core-app/CoreDepthLock'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import type { FreeAgentBids as FreeAgentBidsData } from '@/lib/core-app/freeAgentBids'

/**
 * "Available in your leagues" — every league where he is a free agent (the strip's FA chips), each
 * with where to claim him and, for AF Pro, a suggested FAAB bid beside that league's own winning
 * bids (lib/core-app/freeAgentBids.ts).
 *
 * Where he is available and the claim link are free — that is "in your leagues". The bid is a move,
 * so it is AF Pro (`player_depth`), decided server-side: a locked viewer's payload carries no bid.
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
  if (!data || data.rows.length === 0) return null
  const last = playerName.trim().split(/\s+/).slice(-1)[0] || playerName
  const n = data.rows.length
  return (
    <section className="af-card af-pf-fa" aria-labelledby="af-pf-fa-h">
      <h3 className="af-label" id="af-pf-fa-h">
        Available in {n} of your leagues
      </h3>
      {!data.bidsLocked && access ? <FreeUntilNote access={access} /> : null}
      <ul className="af-pf-fa-list">
        {data.rows.map((r) => (
          <li key={r.leagueId} className="af-pf-fa-row">
            <div className="af-pf-fa-main">
              <span className="af-pf-fa-league">{r.leagueName}</span>
              {r.bid ? (
                <span className="af-pf-fa-bid af-num">
                  Bid ~${r.bid.amount}
                  <span className="af-pf-fa-of">
                    {' '}
                    of ${r.bid.budget}
                    {r.bid.remaining != null ? ` · $${r.bid.remaining} left` : ''}
                  </span>
                </span>
              ) : r.note ? (
                <span className="af-pf-fa-note">{r.note}</span>
              ) : null}
            </div>
            {r.room ? (
              <p className="af-pf-fa-room af-num">
                This league&apos;s winning bids: median ${r.room.median} · p75 ${r.room.p75} ({r.room.claims} {r.room.claims === 1 ? 'claim' : 'claims'})
              </p>
            ) : null}
            {r.claim ? (
              <a
                className="af-pf-fa-claim"
                href={r.claim.href}
                {...(r.claim.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                Claim {last} in {r.claim.platformLabel}
              </a>
            ) : null}
          </li>
        ))}
      </ul>
      {data.bidsLocked && access ? <CoreDepthLock access={access} what="Suggested FAAB bids" /> : null}
      {!data.bidsLocked ? (
        <p className="af-pf-fa-foot">
          The bid is his market value in each league&apos;s format against its budget, capped at 60% of it — the same number
          Waiver Intel uses. The league&apos;s winning bids sit beside it to calibrate against the room; they are not part of it.
        </p>
      ) : null}
    </section>
  )
}
