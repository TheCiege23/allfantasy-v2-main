'use client'

import {
  TRADE_OFFER_STATUS_LABELS,
  readTradeOffer,
  readTradeOfferStatus,
  tradeOfferHrefFor,
  type TradeOfferAsset,
  type TradeOfferCard,
  type TradeOfferStatusNote,
} from '@/lib/chat-notifications/tradeOfferCard'
import {
  tradeCardGradeBasisLabel,
  tradeCardGradeLine,
  type TradeCardGrade,
} from '@/lib/league-chat/tradeCardGradeView'

type TradeAsset = { id: string; name: string | null; position?: string | null; team?: string | null }

export type TradeCard = {
  manager: string
  gave: TradeAsset[]
  got: TradeAsset[]
  picksGave: number
  picksGot: number
  season: number | null
  week: number | null
  /** The other side, when the writer knew it. */
  partner?: string | null
  /** FAAB, specialty assets — anything that is not a player or a draft pick — as labels. */
  extrasGave?: string[]
  extrasGot?: string[]
  /** Value of each side from `manager`'s point of view; `valueBasis` says league or market. */
  valueGave?: number | null
  valueGot?: number | null
  /** Absent on cards written before 2026-09-27, whose numbers were always FantasyCalc market value. */
  valueBasis?: 'league' | 'market' | null
  /** THE grade — both teams' letters, or why there is none. Absent on older cards. */
  grade?: TradeCardGrade | null
  /** Where the trade stands, e.g. "Accepted. It goes to commissioner review before it processes." */
  note?: string | null
}

/**
 * A trade, rendered in the conversation rather than in a feed somewhere else.
 *
 * Three variants, chosen from the message itself:
 *   - OFFER    `metadata.tradeOffer` — an offer between the two managers in a DM: both teams,
 *              what each side gives, the note, its status, and "Open trade".
 *   - STATUS   `metadata.tradeOfferStatus` — the one-line follow-up when that offer is answered.
 *   - COMPLETE `card` — a trade that already happened (league chat's trade feed). Unchanged.
 *
 * ⚠ THE OFFER VARIANT IS DISPATCHED FROM `metadata`, NOT FROM `card`. `RichMessage` narrows
 * `metadata.tradeCard` into the completed-trade shape before it calls this, and that shape has no
 * room for an offer. So an offer reaches this component only when the caller hands over the raw
 * metadata; a caller that passes `card` alone renders exactly what it always did. With neither,
 * this renders nothing — safe to call for every message.
 *
 * ⚠ NAMES OR NOTHING. The card names every player, because every traded player
 * id in production resolves — so a missing name is a bug in the writer, not a
 * limitation of the data, and it says "unknown player" rather than printing a
 * raw Sleeper id at somebody.
 *
 * THE GRADE, AND ONLY THE GRADE (2026-09-27). This card used to carry no letter,
 * and the verdict was Chimmy's market take in the message above it — worded from a
 * private letter no other screen uses, so the chat could crown a manager every
 * other surface graded a D. Now, when the one grade can be read, the card shows
 * both teams' letters and the league values they were taken on, and the message is
 * worded from those letters (lib/league-chat/tradeCardGradeView.ts). A withheld
 * grade says why, with no letter — a letter with no data behind it is still worse
 * than none. A card with no grade at all (an older native trade with no receipt)
 * keeps the market take's numbers, labelled as market value.
 */
export function TradeCardView({
  card,
  metadata,
  viewerUserId,
}: {
  card?: TradeCard | null
  /** The message's raw metadata. Pass it and an offer or status message renders as one. */
  metadata?: Record<string, unknown> | null
  /** Picks this viewer's own link on an imported-league offer. */
  viewerUserId?: string | null
}) {
  const offer = metadata ? readTradeOffer(metadata) : null
  if (offer) return <TradeOfferView offer={offer} viewerUserId={viewerUserId ?? null} />
  const status = metadata ? readTradeOfferStatus(metadata) : null
  if (status) return <TradeOfferStatusView note={status} />
  if (!card) return null
  return <CompletedTradeView card={card} />
}

const fmtValue = (n: number) => Math.round(n).toLocaleString('en-US')

function CompletedTradeView({ card }: { card: TradeCard }) {
  const side = (assets: TradeAsset[], picks: number, extras: string[] = []) => {
    const parts: string[] = assets.map((a) => {
      const meta = [a.position, a.team].filter(Boolean).join(' · ')
      return meta ? `${a.name ?? 'Unknown player'} (${meta})` : (a.name ?? 'Unknown player')
    })
    if (picks > 0) parts.push(`${picks} pick${picks === 1 ? '' : 's'}`)
    parts.push(...extras)
    return parts.length > 0 ? parts : ['nothing']
  }
  const valued = typeof card.valueGave === 'number' && typeof card.valueGot === 'number'

  const when = [
    card.season != null ? `${card.season}` : null,
    card.week != null ? `Week ${card.week}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="af-cm-trade">
      <p className="af-cm-trade-head">
        <span className="af-cm-trade-icon" aria-hidden="true">
          ⇄
        </span>
        {card.partner ? `${card.manager} traded with ${card.partner}` : `${card.manager} made a trade`}
        {when ? <span className="af-cm-trade-when"> · {when}</span> : null}
      </p>

      <div className="af-cm-trade-sides">
        <div className="af-cm-trade-side">
          <span className="af-cm-trade-label">
            Gave
            {valued ? <span className="af-cm-trade-value" data-testid="trade-value-gave"> · {fmtValue(card.valueGave!)}</span> : null}
          </span>
          <ul className="af-cm-trade-list">
            {side(card.gave, card.picksGave, card.extrasGave).map((t, i) => (
              <li key={`gave-${i}`}>{t}</li>
            ))}
          </ul>
        </div>
        <div className="af-cm-trade-side">
          <span className="af-cm-trade-label">
            Got
            {valued ? <span className="af-cm-trade-value" data-testid="trade-value-got"> · {fmtValue(card.valueGot!)}</span> : null}
          </span>
          <ul className="af-cm-trade-list">
            {side(card.got, card.picksGot, card.extrasGot).map((t, i) => (
              <li key={`got-${i}`}>{t}</li>
            ))}
          </ul>
        </div>
      </div>

      {card.grade ? (
        <p
          className="af-cm-trade-label af-cm-trade-grade"
          data-testid={card.grade.graded ? 'trade-card-grade' : 'trade-card-grade-withheld'}
        >
          {card.grade.graded ? 'Grade: ' : ''}
          {tradeCardGradeLine(card.manager, card.partner, card.grade)}
          {card.grade.graded ? (
            <span className="af-cm-trade-when"> · {tradeCardGradeBasisLabel(card.grade.basis)}</span>
          ) : null}
        </p>
      ) : null}
      {valued ? (
        <p className="af-cm-trade-when af-cm-trade-valuenote">
          {card.valueBasis === 'league' ? "League value, on this league's chart." : 'Market value, from FantasyCalc.'}
        </p>
      ) : null}
      {card.note ? <p className="af-cm-trade-when af-cm-trade-note">{card.note}</p> : null}
    </div>
  )
}

const PROVIDER_LABEL = { sleeper: 'Sleeper', yahoo: 'Yahoo' } as const

function assetLines(assets: TradeOfferAsset[]): string[] {
  if (assets.length === 0) return ['nothing']
  return assets.map((a) => (a.detail ? `${a.label} (${a.detail})` : a.label))
}

function sideTitle(side: TradeOfferCard['proposer']): string {
  return side.team && side.team !== side.manager ? `${side.manager} · ${side.team}` : side.manager
}

function TradeOfferView({ offer, viewerUserId }: { offer: TradeOfferCard; viewerUserId: string | null }) {
  const href = tradeOfferHrefFor(offer, viewerUserId)
  const statusLabel = TRADE_OFFER_STATUS_LABELS[offer.status]
  const provider = offer.answerOn ? PROVIDER_LABEL[offer.answerOn] : null
  const giveLabel = offer.directionKnown ? 'gives' : 'sends'

  return (
    <div className="af-cm-trade" data-trade-variant="offer" data-trade-status={offer.status}>
      <p className="af-cm-trade-head">
        <span className="af-cm-trade-icon" aria-hidden="true">
          ⇄
        </span>
        {offer.directionKnown
          ? `Trade offer from ${offer.proposer.manager}`
          : `Trade offer between ${offer.proposer.manager} and ${offer.receiver.manager}`}
        {offer.leagueName ? <span className="af-cm-trade-when"> · {offer.leagueName}</span> : null}
      </p>

      <div className="af-cm-trade-sides">
        {[offer.proposer, offer.receiver].map((side, i) => (
          <div className="af-cm-trade-side" key={i === 0 ? 'proposer' : 'receiver'}>
            <span className="af-cm-trade-label">
              {sideTitle(side)} {giveLabel}
            </span>
            <ul className="af-cm-trade-list">
              {assetLines(side.gives).map((t, j) => (
                <li key={`${i}-${j}`}>{t}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {offer.note ? (
        <p className="af-cm-trade-when" style={{ margin: 0, fontStyle: 'italic', overflowWrap: 'anywhere' }}>
          “{offer.note}”
        </p>
      ) : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px' }}>
        <span className="af-cm-trade-label" data-testid="trade-offer-status">
          {statusLabel}
          {provider && offer.status === 'pending' ? ` · answer on ${provider}` : ''}
        </span>
        {href ? (
          <a className="af-cm-linkbtn" href={href}>
            Open trade
          </a>
        ) : null}
      </div>
    </div>
  )
}

function TradeOfferStatusView({ note }: { note: TradeOfferStatusNote }) {
  return (
    <div
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 10px' }}
      data-trade-variant="status"
      data-trade-status={note.status}
    >
      <span className="af-cm-trade-label">
        <span className="af-cm-trade-icon" aria-hidden="true">
          ⇄{' '}
        </span>
        Trade {TRADE_OFFER_STATUS_LABELS[note.status].toLowerCase()}
      </span>
      {note.href ? (
        <a className="af-cm-linkbtn" href={note.href}>
          Open trade
        </a>
      ) : null}
    </div>
  )
}

export default TradeCardView
