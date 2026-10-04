'use client'

import '@/components/core-app/af-trades.css'
import PlayerName from '@/components/core-app/player-card/PlayerName'
import { PlayerCardLeagueScope } from '@/components/core-app/player-card/PlayerCardProvider'
import { PlayerImage } from '@/app/components/PlayerImage'
import { TeamLogo } from '@/app/components/TeamLogo'
import type { TradesData, TradeRecord, PendingOffer, TradeAgentIdea } from '@/lib/core-app/trades'
import { useFocusTradeFromUrl } from '@/components/core-app/useFocusTradeFromUrl'
import { assetValues, gradeReasons } from '@/lib/core-app/importedTradeTimeline'
import { gradeMoment } from '@/lib/decision-os/trade/gradeMoment'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { tradeUiCopy } from '@/lib/core-app/tradeUiCopy'
import { TopicTip } from '@/components/core-app/TopicTip'

/**
 * The Sleeper transaction id a row stands for — the id a trade email or push links to.
 * History rows carry the graded ledger's `<leagueId>:<transactionId>`; offers carry it bare.
 */
function linkIdOf(id: string): string {
  return id.split(':').pop() ?? id
}

/**
 * Screen 6 — Trades.
 *
 * "Offer, grade, counter — all scored against this league's own rules."
 *
 * Sleeper trades include the same assets and grading inputs used by trade
 * emails. Each manager's projected or realized grade stays with their side.
 * Imported counts-only records retain their separate fallback presentation.
 */

export type TradesProps = {
  data: TradesData
  /** The Trade Center already renders pending offers above its builder. */
  hidePending?: boolean
}

function Unavailable({ reason }: { reason: string }) {
  const language = useOptionalLanguage().language
  return <p className="af-tr-unavailable">{tradeUiCopy(reason, language)}</p>
}

/**
 * One offer waiting on the platform.
 *
 * ⚠ NO ACCEPT / REJECT / COUNTER, DELIBERATELY. Sleeper's public API has no
 * write endpoint, so a button here could not do what it says. The league's
 * `sourceLink` in the header is the way to go and answer it.
 */
function OfferCard({ offer }: { offer: PendingOffer }) {
  const language = useOptionalLanguage().language
  const copy = (value: string) => tradeUiCopy(value, language)
  const side = (label: string, lines: PendingOffer['give']) => (
    <div className="af-tr-offer-side">
      <span className="af-label">{label}</span>
      {lines.length > 0 ? (
        <ul className="af-tr-offer-assets">
          {lines.map((l, i) => (
            <li key={`${l.label}:${i}`}>
              <span className="af-tr-offer-name">{l.label}</span>
              {l.sublabel ? <span className="af-tr-offer-sub">{l.sublabel}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        /* A real shape, not a rendering gap: a pick-only or FAAB-only side of a
           deal genuinely has nothing on it. An empty list would read as broken. */
        <p className="af-tr-offer-none">{copy('nothing')}</p>
      )}
    </div>
  )

  return (
    <li className="af-tr-offer" data-trade-id={linkIdOf(offer.id)}>
      <header className="af-tr-offer-head">
        <span className="af-tr-offer-partner">{offer.partnerName}</span>
        {offer.proposedAt ? (
          <time className="af-tr-offer-when" dateTime={offer.proposedAt}>
            {new Date(offer.proposedAt).toLocaleDateString()}
          </time>
        ) : null}
      </header>
      <div className="af-tr-offer-sides">
        {side(copy('You send'), offer.give)}
        {side(copy('You get'), offer.get)}
      </div>
      <div className="af-tr-offer-eval" data-graded={offer.evaluation.graded}>
        {/* THE grade — the same letter this deal gets in the Trade Center and on the league page. */}
        {offer.evaluation.graded ? (
          <>
            <span className="af-tr-offer-grade af-num">{offer.evaluation.letter}</span>
            <span className="af-tr-offer-eval-copy">
              <strong>
                {copy(offer.evaluation.label)} · {copy('you get')} {offer.evaluation.getValue.toLocaleString()} {copy('for')}{' '}
                {offer.evaluation.giveValue.toLocaleString()}
              </strong>
              <span>{copy(offer.evaluation.recommendation)}</span>
              <small>{copy('Graded on league value')} · {copy(offer.evaluation.basis)}</small>
            </span>
          </>
        ) : (
          <span className="af-tr-offer-eval-copy">
            <strong>{copy('Grade withheld')}</strong>
            <span>{copy(offer.evaluation.reason)}</span>
            {offer.evaluation.basis ? <small>{copy(offer.evaluation.basis)}</small> : null}
          </span>
        )}
      </div>
    </li>
  )
}

/**
 * ⚠ "WE LOOKED AND FOUND NOTHING" AND "WE DID NOT LOOK" GET DIFFERENT SENTENCES.
 * They used to share one, and it claimed the second while meaning neither.
 */
function OfferColumn({
  title,
  state,
  empty,
}: {
  title: string
  state: TradesData['inbox']
  empty: string
}) {
  const language = useOptionalLanguage().language
  return (
    <section className="af-card af-tr-pending-col">
      <h2 className="af-label">{tradeUiCopy(title, language)}</h2>
      {state.available ? (
        state.data.length > 0 ? (
          <ul className="af-tr-offers">
            {state.data.map((o) => (
              <OfferCard key={o.id} offer={o} />
            ))}
          </ul>
        ) : (
          <Unavailable reason={empty} />
        )
      ) : (
        <Unavailable reason={state.reason} />
      )}
    </section>
  )
}

const assetList = (assets: TradeAgentIdea['give']) => assets.map((a) => (a.position ? `${a.name} (${a.position})` : a.name)).join(', ')

/**
 * The nightly trade agent's ideas (design step 9). Suggest only: a deal both sides grade C on this
 * league's values, on which both rosters gain. Shown only to this manager — the partner is not told.
 */
function AgentIdeas({ state }: { state: NonNullable<TradesData['agentIdeas']> }) {
  const language = useOptionalLanguage().language
  const copy = (value: string) => tradeUiCopy(value, language)
  return (
    <section className="af-card af-tr-ideas" aria-label={copy('Trade ideas')}>
      <h2 className="af-label">{copy('Trade ideas')} <TopicTip topic="tradeIdeas" /></h2>
      <p className="af-tr-ideas-why">
        {copy('Near-even on this league’s values, and each roster comes out ahead. Only you see these; nothing is sent.')}
      </p>
      {state.available ? (
        <ul className="af-tr-ideas-list">
          {state.data.map((idea) => (
            <li key={idea.id} className="af-tr-idea">
              <p className="af-tr-idea-deal">
                {copy('Give')} <strong>{assetList(idea.give)}</strong> {copy('for')} <strong>{assetList(idea.get)}</strong>
                {idea.partnerName ? <> {copy('with')} {idea.partnerName}</> : null}
              </p>
              <p className="af-tr-idea-grade">
                <span className="af-num">
                  {idea.letter}/{idea.partnerLetter}
                </span>{' '}
                · {copy('your roster')} <span className="af-num">+{idea.viewerFitPct}%</span> · {copy('theirs')}{' '}
                <span className="af-num">+{idea.partnerFitPct}%</span> · {copy('suggested')}{' '}
                <time dateTime={idea.runDate}>{idea.runDate}</time>
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <Unavailable reason={state.reason} />
      )}
    </section>
  )
}

function TradeCard({ trade }: { trade: TradeRecord }) {
  const language = useOptionalLanguage().language
  const copy = (value: string) => tradeUiCopy(value, language)
  const assets = trade.playersIn + trade.playersOut + trade.picks
  /*
   * THE grade (see `TradeRecord.leagueGrade`) — the letter the Trade Center, the grade email and the
   * grade list below all show. It is taken from `players[0]`'s side: that side RECEIVED the grade's
   * `get` and sent its `give`, so `players[1]` reads the mirror (`partnerLetter` is exact).
   */
  const leagueGrade = trade.players.length === 2 ? trade.leagueGrade ?? null : null
  const graded = leagueGrade?.graded ? leagueGrade : null
  const labelOf = (i: number) => (trade.players[i]?.isYou ? copy('You') : trade.players[i]?.manager ?? copy('Another manager'))
  const reasons = graded ? gradeReasons(graded, labelOf(0), labelOf(1)) : []
  const sideValues = (side: TradeRecord['players'][number], i: number) =>
    graded
      ? assetValues(
          [
            ...side.received.map((p) => ({ id: p.sleeperId, label: p.name })),
            ...(side.picks ?? []).map((label, j) => ({ id: `pick:${j}`, label, gradedAs: side.pickDrafted?.[j] ?? null })),
          ],
          graded.lines,
          i === 0 ? 'get' : 'give',
        )
      : []

  return (
    <li className="af-card af-tr-card" data-trade-id={linkIdOf(trade.transactionId)}>
      <header className="af-tr-card-head">
        <span className="af-tr-when af-num">
          {trade.season ?? '—'}
          {trade.week != null ? ` · ${copy('wk')} ${trade.week}` : ''}
        </span>
        <span className="af-tr-partner">
          {trade.partnerTeamName ? `${copy('with')} ${trade.partnerTeamName}` : copy('partner not identified')}
        </span>
      </header>

      <div className="af-tr-sides" aria-label={trade.yourSide === 'unknown' ? (language === 'es' ? `Intercambio desde la perspectiva de ${trade.players[0]?.manager ?? 'el primer mánager'}` : `Trade from ${trade.players[0]?.manager ?? 'the first manager'}'s perspective`) : copy('Your trade')}>
        <div className="af-tr-side">
          <div className="af-label">{copy(trade.yourSide === 'unknown' ? 'Received' : 'In')}</div>
          <div className="af-tr-count af-num">{trade.playersIn}</div>
          <div className="af-tr-count-label">
            {copy(trade.playersIn === 1 ? 'player' : 'players')}
          </div>
        </div>

        <div className="af-tr-swap" aria-hidden>
          ⇄
        </div>

        <div className="af-tr-side">
          <div className="af-label">{trade.yourSide === 'unknown' ? copy('Sent') : language === 'es' ? 'Sale' : 'Out'}</div>
          <div className="af-tr-count af-num">{trade.playersOut}</div>
          <div className="af-tr-count-label">
            {copy(trade.playersOut === 1 ? 'player' : 'players')}
          </div>
        </div>

        {trade.picks > 0 ? (
          <div className="af-tr-side">
            <div className="af-label">{copy('Picks')}</div>
            <div className="af-tr-count af-num">{trade.picks}</div>
            <div className="af-tr-count-label">{copy('included')}</div>
          </div>
        ) : null}
      </div>

      {/*
        Who received what. Each row is a SIDE, named by the manager who got those
        players — see `TradeRecord.players`. A side whose manager id did not
        resolve says "another manager" rather than printing a raw Sleeper user id.
      */}
      {trade.players.length > 0 ? (
        <div className="af-tr-players">
          {trade.players.map((side, i) => {
            const values = sideValues(side, i)
            const letter = graded ? (i === 0 ? graded.letter : graded.partnerLetter) : null
            return (
            <div className="af-tr-players-side" key={`${side.manager ?? 'unknown'}-${i}`}>
              <span className="af-tr-manager-identity">
                {side.avatarUrl ? <img className="af-tr-manager-avatar" src={side.avatarUrl} alt="" /> : null}
                <span className="af-label af-tr-players-who" data-you={side.isYou}>
                  {side.isYou ? copy('You got') : `${side.manager ?? copy('Another manager')} ${copy('got')}`}
                </span>
              </span>
              <span className="af-tr-players-list">
                {side.received.map((p, j) => (
                  <span className="af-tr-player-asset" key={p.sleeperId}>
                    <PlayerImage sleeperId={p.sleeperId} sport="NFL" name={p.name} position={p.position ?? undefined} headshotUrl={p.headshotUrl} size={28} />
                    <PlayerName
                      sport="NFL"
                      sleeperId={p.sleeperId}
                      name={p.name}
                      position={p.position}
                      team={p.team}
                    />
                    {p.team ? <TeamLogo teamAbbr={p.team} sport="NFL" logoUrl={p.teamLogoUrl} size={20} /> : null}
                    {values[j] != null ? <em className="af-tr-asset-value af-num">{Math.round(values[j]!).toLocaleString()}</em> : null}
                  </span>
                ))}
                {side.picks?.map((pick, j) => {
                  const value = values[side.received.length + j] ?? null
                  const drafted = side.pickDrafted?.[j] ?? null
                  return (
                    <span key={`${pick}-${j}`}>
                      {side.received.length > 0 || j > 0 ? ', ' : ''}{pick}
                      {drafted ? <span className="af-tr-pick-drafted"> ({copy('drafted')} {drafted})</span> : null}
                      {value != null ? <em className="af-tr-asset-value af-num">{Math.round(value).toLocaleString()}</em> : null}
                    </span>
                  )
                })}
              </span>
              {graded && letter ? (
                <div className="af-tr-leaguegrade" data-letter={letter}>
                  <span className="af-tr-leaguegrade-letter af-num">{letter}</span>
                  <span className="af-tr-leaguegrade-line">
                    {language === 'es'
                      ? `Calificación de la liga · recibió ${(i === 0 ? graded.getValue : graded.giveValue).toLocaleString()} por ${(i === 0 ? graded.giveValue : graded.getValue).toLocaleString()} en valor de liga ${copy(gradeMoment(graded))}`
                      : `League grade · got ${(i === 0 ? graded.getValue : graded.giveValue).toLocaleString()} for ${(i === 0 ? graded.giveValue : graded.getValue).toLocaleString()} in league value ${gradeMoment(graded)}`}
                  </span>
                </div>
              ) : null}
              {/*
                ⚠ A 'Market' letter is a SECOND value grade from the email's projection, and it can
                disagree with the league letter above. Where the league grade exists it is the one
                shown; a 'Realized' letter stays, because points actually scored are a different fact.
              */}
              {side.gradeBasis && !(graded && side.gradeBasis === 'Market') ? (
                <div className="af-tr-grade" data-ungradable={!side.grade}>
                  <span className="af-tr-grade-badge af-num">{side.grade ?? '—'}</span>
                  <span className="af-tr-grade-why">{copy(side.gradeBasis)} · {copy(side.gradeNote ?? '')}</span>
                </div>
              ) : null}
            </div>
            )
          })}
        </div>
      ) : null}

      {reasons.length > 0 ? (
        <ul className="af-tr-leaguegrade-why" aria-label={copy('Why it graded this way')}>
          {reasons.map((line) => <li key={line}>{copy(line)}</li>)}
        </ul>
      ) : null}
      {leagueGrade && !leagueGrade.graded ? (
        <p className="af-tr-leaguegrade-withheld">{copy('League grade withheld:')} {copy(leagueGrade.reason)}</p>
      ) : null}

      {/*
        The grade slot. Kept in the layout the handoff specifies so the shape is
        right, but filled with the reason no letter can be issued — an empty
        badge would read as a pending grade, and a "C" would read as average.
      */}
      {!trade.players.some((side) => side.gradeBasis) && !leagueGrade ? <div className="af-tr-grade" data-ungradable="true">
        <span className="af-tr-grade-badge af-num">n/a</span>
        <span className="af-tr-grade-why">
          {assets > 0
            ? copy('Counts only in this view — see Trade grades below for the priced version.')
            : copy('Not gradable — nothing was recorded as moving in this trade.')}
        </span>
      </div> : null}
    </li>
  )
}

export function Trades({ data, hidePending = false }: TradesProps) {
  const language = useOptionalLanguage().language
  const copy = (value: string) => tradeUiCopy(value, language)
  // A trade email or push lands here with `?trade=`; bring that trade into view.
  useFocusTradeFromUrl()
  return (
    /*
      Names on this screen belong to THIS league, so the card opens in its
      league flavour — who holds him now, and what he costs here.

      ⚠ BLOCK COMMENT, NOT `//`. Two `//` lines in exactly this position pass
      `tsc --noEmit` and are REJECTED by SWC ("Unexpected token. Expected jsx
      identifier"), so the typecheck was clean while the Next build failed and
      took `app/core/(shell)/[[...screen]]/page.tsx` down with it.
    */
    <PlayerCardLeagueScope leagueId={data.league.id}>
    <div className="af-tr">
      {/* ── League-specific grading banner ──────────────────────────── */}
      {data.gradingContext.available ? (
        <div className="af-tr-context">
          <span className="af-label">{copy('Scored for this league only')}</span>
          <p className="af-tr-context-body">
            {language === 'es' ? 'Las calificaciones y recomendaciones usan las reglas de ' : 'Grades and recommendations on this page are calculated against '}
            <strong>{data.gradingContext.data.leagueName}</strong>
            {data.gradingContext.data.format ? ` — ${data.gradingContext.data.format}` : ''}, {' '}
            {data.gradingContext.data.teamCount} {copy('teams')}. {copy('The same trade grades differently in a different league.')}
          </p>
        </div>
      ) : null}

      {/* ── Deadline ────────────────────────────────────────────────── */}
      <div className="af-tr-deadline">
        <span className="af-label">{copy('Trade deadline')}</span>
        {data.deadline.available ? (
          data.deadline.data.none ? (
            /*
              The platform's sentinel for "trades stay open" (99, or any week past
              the end of the regular season). Rendering it literally would print
              "Week 99" on a screen people plan around.
            */
            <span className="af-tr-deadline-value">{copy('No deadline — trades stay open all season')}</span>
          ) : (
            <span className="af-tr-deadline-value">
              {copy('Week')} <span className="af-num">{data.deadline.data.week}</span>
              {data.deadline.data.regularSeasonLength != null ? (
                <span className="af-tr-deadline-why">
                  {language === 'es' ? `de una temporada regular de ${data.deadline.data.regularSeasonLength} semanas` : `of a ${data.deadline.data.regularSeasonLength}-week regular season`}
                </span>
              ) : null}
            </span>
          )
        ) : (
          <span className="af-tr-deadline-why">{copy(data.deadline.reason)}</span>
        )}
      </div>

      {/* ── Nightly trade ideas (absent until the agent's table exists) ── */}
      {data.agentIdeas ? <AgentIdeas state={data.agentIdeas} /> : null}

      {/* ── Inbox / sent ────────────────────────────────────────────── */}
      {!hidePending ? <div className="af-tr-pending">
        <OfferColumn title="Inbox" state={data.inbox} empty="No offers waiting on you." />
        <OfferColumn title="Sent" state={data.sent} empty="You have no offers out." />
      </div> : null}

      {/* ── Completed trades ────────────────────────────────────────── */}
      <section className="af-tr-history">
        {data.historyNotice ? <p className="af-tr-grade-why" role="status">{copy(data.historyNotice)}</p> : null}
        <header className="af-tr-history-head">
          <h2 className="af-display af-tr-history-title">{copy('Completed trades')}</h2>
          {/*
            What a completed trade's letter and the number beside each asset are. The numbers used to
            carry a per-asset `title` saying so — hover-only, so a phone never showed it.
          */}
          <TopicTip topic="completedTradeGrade" />
          {data.history.available ? (
            <span className="af-chip af-num">{data.history.data.length}</span>
          ) : null}
        </header>

        {data.history.available ? (
          data.history.data.length > 0 ? (
            <ul className="af-tr-list">
              {data.history.data.map((t) => (
                <TradeCard key={t.transactionId} trade={t} />
              ))}
            </ul>
          ) : (
            <Unavailable reason="No trades recorded in this league." />
          )
        ) : (
          <Unavailable reason={data.history.reason} />
        )}
      </section>

      {/* ── Grades ──────────────────────────────────────────────────── */}
      {!data.canonicalHistory ? <section className="af-card af-tr-section">
        <h2 className="af-label">{copy('Trade grades')} <TopicTip topic="tradeGrade" /></h2>
        {data.grades.available ? (
          <ul className="af-tr-graderows">
            {data.grades.data.slice(0, 12).map((g) => (
              <li key={g.transactionId} className="af-tr-graderow">
                {/*
                  ⚠ A LETTER OR A REASON — NEVER BOTH, AND NEVER A LETTER AS A
                  FALLBACK. A grade withheld for partial coverage must not render
                  as a dimmed "C"; that is the precise failure the engine exists to
                  prevent, and it would be reintroduced here in one line of JSX.
                */}
                {g.letter ? (
                  <span className="af-tr-graderow-letter" data-grade={g.letter}>
                    {g.letter}
                  </span>
                ) : (
                  <span className="af-tr-graderow-letter" data-grade="none" aria-label={copy('not graded')}>
                    —
                  </span>
                )}
                <span className="af-tr-graderow-main">
                  <span className="af-tr-graderow-meta af-num">
                    {[g.season, g.week ? `${copy('WK')} ${g.week}` : null].filter(Boolean).join(' · ')}
                    {' · '}
                    {g.playersOut} {copy('out')} / {g.playersIn} {copy('in')}
                    {/*
                      ⚠ PICKS GET THEIR OWN CLAUSE RATHER THAN BEING FOLDED INTO THE
                      out/in COUNTS. Adding them there would silently change what those
                      two numbers mean on a row people already read; a "2 for 1" that was
                      really "2 for 1 plus a first" is a different trade, and this says so
                      without restating the old figures.
                    */}
                    {g.picksOut + g.picksIn > 0
                      ? ` · ${g.picksOut + g.picksIn} ${copy(g.picksOut + g.picksIn === 1 ? 'pick' : 'picks')}`
                      : ''}
                  </span>
                  <span className="af-tr-graderow-why">
                    {g.letter
                      ? language === 'es' ? `recibió el ${g.sharePct}% del valor intercambiado` : `received ${g.sharePct}% of the traded value`
                      : copy(g.withheldReason ?? '')}
                  </span>
                  {/*
                    WHY it graded that way, the same sentences the cross-league board shows.

                    ⚠ EMPTY ON A TRADE THAT IS NOT THE VIEWER'S OWN, by construction in the
                    loader: this path holds a display name for one side only, and captioning
                    another manager's trade with a platform user id would be worse than the
                    line above it. Empty also for an ungraded trade, where the slot already
                    carries `withheldReason`.
                  */}
                  {g.breakdown.length > 0 ? (
                    <ul className="af-tr-graderow-breakdown">
                      {g.breakdown.map((line) => (
                        <li key={line}>{copy(line)}</li>
                      ))}
                    </ul>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Unavailable reason={data.grades.reason} />
        )}
      </section> : null}
    </div>
    </PlayerCardLeagueScope>
  )
}

export default Trades
