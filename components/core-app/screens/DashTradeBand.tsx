import Link from 'next/link'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-dash-trade.css'
import type { RecentTrade } from '@/lib/core-app/recentTrades'

/**
 * Trades that just landed in your leagues.
 *
 * ⚠ THIS ANSWERS A QUESTION THE PRODUCT WAS TELLING USERS IT COULD NOT. The
 * home's coverage note said trades are not ingested and the league home
 * hard-coded its feed unavailable for the same stated reason — while the
 * trade-grade sweep was resolving both sides of every trade, down to the
 * individual draft picks, every thirty minutes. See lib/core-app/recentTrades.
 *
 * ⚠ WHO GOT WHAT, AND NO GRADE. The sweep's letter is retrospective, scored on
 * points already realised: days after a trade it is measuring nearly nothing,
 * and a 2027 pick contributes zero because that draft has not happened. A
 * letter over an empty measurement is the "C means no data" failure this repo
 * has already been bitten by, so the card states the swap and stops. The full
 * ledger, where the grade has had a season to mean something, is one click
 * away.
 *
 * ⚠ A PICK IS NAMED AS A PICK. "2027 4th", never the player it later became —
 * the two managers traded the pick, and resolving it would rewrite the deal
 * they actually made.
 *
 * Renders nothing when no trade landed in the last two weeks. A trade from
 * March is not news, and an empty "recent trades" band is furniture.
 */

const VISIBLE_ASSETS = 4

function agoLabel(iso: string, now: Date): string | null {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  const mins = Math.round((now.getTime() - t) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function DashTradeBand({ trades, now }: { trades: RecentTrade[]; now: Date }) {
  if (!trades || trades.length === 0) return null

  return (
    <section className="af-core af-trade" aria-label="Trades that just landed">
      <div className="af-trade-head">
        <span className="af-label af-trade-kicker">Trades that just landed</span>
        <span className="af-trade-count af-num">
          {trades.length === 1 ? '1 in the last 2 weeks' : `${trades.length} in the last 2 weeks`}
        </span>
      </div>

      <div className="af-trade-list">
        {trades.map((t) => {
          const ago = agoLabel(t.acceptedAt, now)
          return (
            <article key={`${t.platformLeagueId}:${t.id}`} className="af-trade-card">
              <div className="af-trade-meta">
                <Link className="af-trade-league" href={`/league/${t.leagueId}?view=legacy`}>
                  {t.leagueName}
                </Link>
                {ago ? <span className="af-trade-ago af-num">{ago}</span> : null}
              </div>

              <div className="af-trade-sides">
                {t.sides.map((s) => (
                  <div key={s.rosterId} className="af-trade-side">
                    <span className="af-trade-mgr">{s.teamName || s.managerName}</span>
                    <span className="af-trade-got af-num">RECEIVED</span>
                    <ul className="af-trade-assets">
                      {s.received.slice(0, VISIBLE_ASSETS).map((a, i) => (
                        <li key={`${a.kind}:${a.name}:${i}`} data-kind={a.kind}>
                          {a.name}
                          {a.position ? (
                            <span className="af-trade-pos af-num"> {a.position}</span>
                          ) : null}
                        </li>
                      ))}
                      {s.received.length > VISIBLE_ASSETS ? (
                        <li className="af-trade-more">
                          +{s.received.length - VISIBLE_ASSETS} more
                        </li>
                      ) : null}
                      {s.received.length === 0 ? (
                        /* Never an empty column with an arrow pointing into it. */
                        <li className="af-trade-more">nothing we can name</li>
                      ) : null}
                    </ul>
                  </div>
                ))}
              </div>

              <Link className="af-trade-open" href={`/league/${t.leagueId}?view=legacy`}>
                Open the trade ledger
              </Link>
            </article>
          )
        })}
      </div>
    </section>
  )
}
