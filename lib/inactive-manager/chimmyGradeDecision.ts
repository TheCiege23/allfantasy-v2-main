/**
 * CHIMMY IN A DEVY OR CAMPUS-TO-CANTON LEAGUE ANSWERS ON THE TRADE SCREEN'S OWN GRADE.
 *
 * A roster there mixes pro players and college players. The Trade Center prices college players with
 * their own campus valuations — college points over replacement for the eligibility years left, the
 * pro option from verified draft ranks, the league's standings weights, Campus and Canton picks
 * (lib/decision-os/trade/nbaCampusTradeValue.ts and the football campus grade). Those price a DEAL,
 * not one player at a time, and they refuse whenever any piece lacks verified evidence.
 *
 * So Chimmy does not re-price these deals in a third way. It reads the one grade the trade screen shows
 * (`proposalOneGrade`, from Chimmy's side), and:
 *
 *   - accepts when what it gets beats what it gives by its manager's fairness margin;
 *   - in a league with SEPARATE Campus and Canton standings, accepts only when NEITHER division loses
 *     by more than that margin and at least one gains — a win in one table does not pay for a loss
 *     in the other;
 *   - declines, with the screen's own reason, whenever the screen cannot grade the deal.
 *
 * The roster rules of ./autopilotTrades.ts still apply: two-team only, never more than
 * `MAX_STARTERS_GIVEN` starters, never more starters out than players back. Pure.
 */
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import { MAX_STARTERS_GIVEN, type TradeAnswer } from './autopilotTrades'

type Item = { itemType: string; itemReference: string | null; fromRosterId: string; toRosterId: string }

const isPlayerItem = (i: Item) => !/pick|faab/i.test(i.itemType) && Boolean(i.itemReference)

export function decideOnLeagueGrade(args: {
  grade: TradeGradeView
  /** The Chimmy team's league roster id. */
  rosterId: string
  items: readonly Item[]
  starterIds: readonly string[]
  fairness: number
}): TradeAnswer {
  const { grade, rosterId, fairness } = args
  const giving = args.items.filter((i) => i.fromRosterId === rosterId)
  const getting = args.items.filter((i) => i.toRosterId === rosterId)
  const out = (decision: TradeAnswer['decision'], code: TradeAnswer['code'], reason: string, give = 0, get = 0): TradeAnswer =>
    ({ decision, code, reason, give: Math.round(give), get: Math.round(get) })

  if (getting.length === 0) return out('reject', 'nothing_offered', 'Nothing was offered to the team.')

  const starters = new Set(args.starterIds)
  const startersGiven = giving.filter((i) => isPlayerItem(i) && starters.has(String(i.itemReference))).length
  const playersBack = getting.filter(isPlayerItem).length

  const totals = (() => {
    if (grade.graded) return { give: grade.giveValue, get: grade.getValue, ok: grade.getValue >= grade.giveValue * (1 + fairness) }
    const divisions = grade.divisionImpacts
    if (!divisions?.length) return null
    const give = divisions.reduce((s, d) => s + d.giveValue, 0)
    const get = divisions.reduce((s, d) => s + d.getValue, 0)
    const noLoss = divisions.every((d) => d.getValue >= d.giveValue * (1 + fairness) || (d.giveValue === 0 && d.getValue >= 0))
    const someGain = divisions.some((d) => d.getValue > d.giveValue)
    return { give, get, ok: noLoss && someGain }
  })()

  if (!totals) {
    const why = grade.graded ? '' : String(grade.reason ?? '').trim()
    return out('reject', 'cannot_value', why ? `Chimmy could not put a value on this deal: ${why}` : 'Chimmy could not put a value on this deal, so it passed.')
  }
  if (startersGiven > MAX_STARTERS_GIVEN) return out('reject', 'too_many_starters', 'That is too many starters to give up in one deal.', totals.give, totals.get)
  if (startersGiven > playersBack) return out('reject', 'lineup_hole', 'This would leave the team short a starter, so Chimmy passed.', totals.give, totals.get)
  if (totals.get <= 0) return out('reject', 'cannot_value', 'Chimmy could not put a value on this deal, so it passed.', totals.give, totals.get)
  return totals.ok
    ? out('accept', 'accepted', 'Chimmy likes this deal for the team.', totals.give, totals.get)
    : out('reject', 'not_enough', 'Chimmy would need a bit more coming back to do this deal.', totals.give, totals.get)
}
