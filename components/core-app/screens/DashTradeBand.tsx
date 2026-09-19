import Link from 'next/link'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-dash-trade.css'
import type { RecentTrade } from '@/lib/core-app/recentTrades'
import { PlayerImage } from '@/app/components/PlayerImage'
import { TeamLogo } from '@/app/components/TeamLogo'

/**
 * Latest trade activity in your leagues.
 *
 * ⚠ THIS ANSWERS A QUESTION THE PRODUCT WAS TELLING USERS IT COULD NOT. The
 * home's coverage note said trades are not ingested and the league home
 * hard-coded its feed unavailable for the same stated reason — while the
 * trade-grade sweep was resolving both sides of every trade, down to the
 * individual draft picks, every thirty minutes. See lib/core-app/recentTrades.
 *
 * The sweep's result letter is retrospective — scored on points already
 * realised — while a new trade needs the expectation loader's market view.
 * Each side therefore labels its basis and explains which contextual inputs
 * were available. A zero-signal result never appears as an earned C.
 *
 * The verdict that IS shown asks whether the deal was balanced ON THE DAY, by
 * market value of what each side received — the question a manager actually
 * asks the hour a trade lands, and one the canonical engine can answer now
 * because it prices a future pick properly instead of at zero. It renders only
 * when every asset on both sides priced; absent means exactly that.
 *
 * ⚠ A PICK IS NAMED AS A PICK. "2027 4th", never the player it later became —
 * the two managers traded the pick, and resolving it would rewrite the deal
 * they actually made.
 *
 * Renders nothing when no trade landed in the last two weeks. A trade from
 * March is not news, and an empty "recent trades" band is furniture.
 */

const VISIBLE_ASSETS = 4

/**
 * The verdict, in names rather than the engine's A/B.
 *
 * A reader cannot act on "Slightly favors A" — they do not know which side the
 * engine called A, and nothing on the card tells them. The verdict already
 * carries the roster it favours, so the sentence can name the manager.
 */
function verdictSentence(t: RecentTrade): string {
  const v = t.verdict
  if (!v) return ''
  if (v.favoursRosterId == null) return 'An even deal on paper'
  const side = t.sides.find((s) => s.rosterId === v.favoursRosterId)
  const who = side ? side.teamName || side.managerName : null
  const strength = v.verdict.toLowerCase().includes('strongly') ? 'Clearly favours' : 'Slightly favours'
  /* No name resolved: say the shape of the verdict, never a placeholder. */
  return who ? `${strength} ${who}` : 'One side comes out ahead'
}

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

function statusLabel(status?: string): string | null {
  if (!status) return null
  return ({
    pending: 'Proposed',
    awaiting_votes: 'Awaiting votes',
    awaiting_commissioner: 'Commissioner review',
    accepted: 'Accepted',
    scheduled: 'Scheduled',
    processed: 'Completed',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
    countered: 'Countered',
    expired: 'Expired',
    vetoed: 'Vetoed',
    reversed: 'Reversed',
  } as Record<string, string>)[status] ?? status.replaceAll('_', ' ')
}

export function DashTradeBand({ trades, now }: { trades: RecentTrade[]; now: Date }) {
  if (!trades || trades.length === 0) return null

  return (
    <section className="af-core af-trade" aria-label="Latest league trades">
      <div className="af-trade-head">
        <span className="af-label af-trade-kicker">Latest league trades</span>
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
                {t.leagueAvatarUrl ? <img className="af-trade-league-avatar" src={t.leagueAvatarUrl} alt="" /> : null}
                <Link className="af-trade-league" href={`/league/${t.leagueId}?view=trades`}>
                  {t.leagueName}
                </Link>
                {ago ? <span className="af-trade-ago af-num">{ago}</span> : null}
                {statusLabel(t.status) ? <span className="af-trade-ago af-num">{statusLabel(t.status)}</span> : null}
              </div>

              <div className="af-trade-sides">
                {t.sides.map((s) => (
                  <div key={s.rosterId} className="af-trade-side">
                    <span className="af-trade-manager">
                      {s.avatarUrl ? <img className="af-trade-avatar" src={s.avatarUrl} alt="" /> : null}
                      <span className="af-trade-mgr">{s.teamName || s.managerName}</span>
                    </span>
                    <span className="af-trade-got af-num">{t.status === 'processed' ? 'RECEIVED' : 'IN THIS TRADE'}</span>
                    <ul className="af-trade-assets">
                      {s.received.slice(0, VISIBLE_ASSETS).map((a, i) => (
                        <li key={`${a.kind}:${a.name}:${i}`} data-kind={a.kind}>
                          {a.kind === 'player' && a.playerId ? (
                            <PlayerImage sleeperId={a.playerId} sport={t.sport ?? 'NFL'} name={a.name} position={a.position ?? undefined} headshotUrl={a.headshotUrl} size={26} />
                          ) : null}
                          <span>{a.name}{a.position ? <span className="af-trade-pos af-num"> {a.position}</span> : null}</span>
                          {a.kind === 'player' && a.team ? <TeamLogo teamAbbr={a.team} sport={t.sport ?? 'NFL'} logoUrl={a.teamLogoUrl} size={18} /> : null}
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
                    {s.gradeBasis || s.gradeReason ? (
                      <div className="af-trade-side-grade" data-ungraded={!s.grade}>
                        <span className="af-trade-side-letter">{s.grade ?? '—'}</span>
                        <span><strong>{s.gradeBasis ?? 'Contextual grade withheld'}</strong> · {s.gradeReason}</span>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              {t.verdict ? (
                <p className="af-trade-verdict">
                  {/*
                    ⚠ THE ENGINE SAYS "favors A" AND A READER HAS NO IDEA WHO A
                    IS. Its vocabulary is positional — team A versus team B —
                    and that leaked straight onto the card. The manager's own
                    name is the only version of this sentence anyone can act on,
                    and the roster id needed to say it was already on the
                    verdict.
                  */}
                  <span
                    className="af-trade-verdict-word"
                    data-fair={t.verdict.favoursRosterId == null ? 'true' : 'false'}
                  >
                    {verdictSentence(t)}
                  </span>
                  <span className="af-trade-conf af-num">
                    {' '}
                    · valued the day it was made
                    {t.verdict.confidence > 0 ? ` · ${t.verdict.confidence}% confidence` : ''}
                  </span>
                </p>
              ) : null}

              <Link className="af-trade-open" href={`/league/${t.leagueId}?view=trades`}>
                Open this league&rsquo;s trades
              </Link>
            </article>
          )
        })}
      </div>
    </section>
  )
}
