'use client'

import type { PickedAsset } from '@/components/core-app/screens/TradeAssetPicker'
import type { LeagueRoster } from '@/components/core-app/screens/useLeagueRosters'
import type { PartnerRanking, PartnerRecommendation } from '@/lib/trade-intel/partnerRanking'

/**
 * "Who should I trade with" — item #8, on the Trade Center.
 *
 * The ranking arrives with the rosters the page already loads (`/trades/rosters` →
 * `partnerRanking`), so this component makes no request of its own. It shows the few best fits
 * with the reasons they ranked, and — where a value-matched deal exists — a button that puts that
 * deal in the builder.
 *
 * ⚠ RENDERS NOTHING WITHOUT A RANKING. An older server omits the field, and a league with no viewer
 * team has none; the chip row below still works in roster order, so absence costs nothing.
 */

/**
 * A suggestion's asset ids back into the builder's vocabulary, from the rosters the page holds.
 *
 * ⚠ RESOLVED FROM THE ROSTERS, NOT FROM THE SUGGESTION. The ranking carries ids, names and values;
 * the builder also needs a headshot, a team and — for a pick — a season and round, all of which the
 * roster rows already have. A pick without a season or round cannot be proposed or priced by the
 * builder, so it is DROPPED and named rather than guessed.
 */
export function suggestionToPickedAssets(
  suggestion: NonNullable<PartnerRecommendation['suggestion']>,
  myRoster: LeagueRoster | null,
  partnerRoster: LeagueRoster | null,
): { give: PickedAsset[]; get: PickedAsset[]; dropped: string[] } {
  const dropped: string[] = []
  const convert = (roster: LeagueRoster | null, a: (typeof suggestion.give)[number]): PickedAsset | null => {
    if (a.kind === 'player') {
      const p = roster?.players.find((x) => x.id === a.id)
      if (!p) {
        dropped.push(a.name)
        return null
      }
      return {
        kind: 'player',
        playerId: p.id,
        name: p.name,
        position: p.position,
        team: p.team,
        value: p.value,
        imageUrl: p.imageUrl,
        stock: p.stock ?? null,
        stockDelta: p.stockDelta ?? null,
        unpricedReason: p.unpricedReason ?? null,
      }
    }
    const pick = roster?.picks.find((x) => x.pickId === a.id)
    if (!pick || pick.season == null || pick.round == null) {
      dropped.push(a.name)
      return null
    }
    return {
      kind: 'pick',
      year: pick.season,
      round: pick.round,
      label: pick.label,
      // An imported pick's id is for display only; an offer must never reference it.
      pickId: pick.proposable === false ? null : pick.pickId,
      itemType: pick.itemType,
      value: pick.value,
      proposable: pick.proposable !== false,
    }
  }
  const give = suggestion.give.flatMap((a) => {
    const c = convert(myRoster, a)
    return c ? [c] : []
  })
  const get = suggestion.get.flatMap((a) => {
    const c = convert(partnerRoster, a)
    return c ? [c] : []
  })
  return { give, get, dropped }
}

function money(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

export function TradePartnerSuggestions(props: {
  ranking: PartnerRanking | null | undefined
  selectedRosterId: string | null
  onChoose: (rosterId: string) => void
  onStartWith: (partner: PartnerRecommendation) => void
  /** How many cards to show. The chip row below lists everyone. */
  limit?: number
}) {
  const ranking = props.ranking
  if (!ranking) return null
  const top = ranking.partners.slice(0, props.limit ?? 3)

  return (
    <section className="af-tc-fits" aria-labelledby="af-tc-fits-title">
      <div className="af-tc-fits-head">
        <span className="af-label" id="af-tc-fits-title">Best trade partners</span>
        <span className="af-tc-row-sub">
          Ranked by what they have spare for you, what you have spare for them, whether a fair deal
          exists, and how they trade.
        </span>
      </div>

      {top.length === 0 ? (
        <p className="af-tc-row-sub">No other team in this league could be ranked.</p>
      ) : (
        <ol className="af-tc-fits-list">
          {top.map((p) => (
            <li key={p.rosterId} className="af-tc-fit" data-fit={p.label.split(' ')[0]!.toLowerCase()} data-on={props.selectedRosterId === p.rosterId}>
              <div className="af-tc-fit-head">
                <span className="af-tc-fit-rank af-num" aria-label={`Rank ${p.rank}`}>{p.rank}</span>
                <span className="af-tc-fit-name">{p.ownerName ?? 'Another manager'}</span>
                <span className="af-tc-spacer" />
                <span className="af-tc-fit-label">{p.label}</span>
                <span className="af-tc-fit-score af-num">
                  {p.score}
                  <small>/100</small>
                </span>
              </div>
              {p.reasons.length > 0 ? (
                <ul className="af-tc-fit-reasons">
                  {p.reasons.slice(0, 3).map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : null}
              {p.suggestion ? (
                <p className="af-tc-fit-deal af-num">
                  You send {p.suggestion.give.map((a) => `${a.name} (${money(a.value)})`).join(' + ')} · You get{' '}
                  {p.suggestion.get.map((a) => `${a.name} (${money(a.value)})`).join(' + ')}
                </p>
              ) : null}
              <div className="af-tc-fit-actions">
                <button
                  type="button"
                  className="af-btn af-btn--ghost"
                  aria-pressed={props.selectedRosterId === p.rosterId}
                  onClick={() => props.onChoose(p.rosterId)}
                >
                  {props.selectedRosterId === p.rosterId ? 'Trading with them' : 'Trade with them'}
                </button>
                {p.suggestion ? (
                  <button type="button" className="af-btn" onClick={() => props.onStartWith(p)}>
                    Start with this deal
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}

      {ranking.gaps.length > 0 ? (
        <ul className="af-tc-fits-gaps">
          {ranking.gaps.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
