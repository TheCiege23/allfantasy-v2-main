'use client'

type TradeAsset = { id: string; name: string | null; position?: string | null; team?: string | null }

export type TradeCard = {
  manager: string
  gave: TradeAsset[]
  got: TradeAsset[]
  picksGave: number
  picksGot: number
  season: number | null
  week: number | null
}

/**
 * A trade, rendered in the conversation rather than in a feed somewhere else.
 *
 * ⚠ NAMES OR NOTHING. The card names every player, because every traded player
 * id in production resolves — so a missing name is a bug in the writer, not a
 * limitation of the data, and it says "unknown player" rather than printing a
 * raw Sleeper id at somebody.
 *
 * ⚠ NO GRADE HERE. This states what happened and stops. Attaching a winner to a
 * trade the moment it lands turns a card people can talk about into a verdict
 * they have to argue with, and this app already knows that a letter grade with
 * no data behind it is worse than no grade at all.
 */
export function TradeCardView({ card }: { card: TradeCard }) {
  const side = (assets: TradeAsset[], picks: number) => {
    const parts: string[] = assets.map((a) => {
      const meta = [a.position, a.team].filter(Boolean).join(' · ')
      return meta ? `${a.name ?? 'Unknown player'} (${meta})` : (a.name ?? 'Unknown player')
    })
    if (picks > 0) parts.push(`${picks} pick${picks === 1 ? '' : 's'}`)
    return parts.length > 0 ? parts : ['nothing']
  }

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
        {card.manager} made a trade
        {when ? <span className="af-cm-trade-when"> · {when}</span> : null}
      </p>

      <div className="af-cm-trade-sides">
        <div className="af-cm-trade-side">
          <span className="af-cm-trade-label">Gave</span>
          <ul className="af-cm-trade-list">
            {side(card.gave, card.picksGave).map((t, i) => (
              <li key={`gave-${i}`}>{t}</li>
            ))}
          </ul>
        </div>
        <div className="af-cm-trade-side">
          <span className="af-cm-trade-label">Got</span>
          <ul className="af-cm-trade-list">
            {side(card.got, card.picksGot).map((t, i) => (
              <li key={`got-${i}`}>{t}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

export default TradeCardView
