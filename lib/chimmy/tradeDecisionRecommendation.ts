import type { ReadyTradeScenario } from './tradeScenarioTypes'

/**
 * The call the text below leads with. `withheld` = no recommendation was computed.
 *
 * ⚠ ONE DECISION, TWO READINGS. The verdict chip (`answerPolishBuild.ts`) and the sentence below
 * both come from `decideTrade`, so the chip can never say YES over an answer that opens COUNTER.
 */
export type TradeDecisionAction = 'withheld' | 'accept' | 'decline' | 'hold' | 'counter' | 'counter_hold'

function decideTrade(s: ReadyTradeScenario): { action: TradeDecisionAction; text: string } {
  if (!s.recommendation) return { action: 'withheld', text: 'Recommendation withheld: league valuation is incomplete.' }
  const action = s.recommendation.action
  if (action === 'hold') return { action: 'hold', text: `HOLD: ${s.recommendation.explanation}` }
  if (action === 'decline') return { action: 'decline', text: `NO: ${s.recommendation.explanation}` }
  if (action === 'counter') return { action: 'counter', text: `COUNTER: ${s.recommendation.explanation}` }
  if (s.unpricedExcluded) return { action: 'counter_hold', text: 'COUNTER / HOLD: Some rostered players lack projections and were excluded. Resolve that coverage gap before treating the lineup comparison as an acceptance recommendation.' }
  if (!s.lineup) return { action: 'counter_hold', text: 'COUNTER / HOLD: The value grade alone is not enough to accept. Lineup impact is unavailable; confirm replacements before giving up roster pieces.' }
  if (s.playoffOdds?.available && s.playoffOdds.delta < -1) return { action: 'counter', text: `COUNTER: The season scenario lowers your estimated playoff chance by ${Math.abs(s.playoffOdds.delta).toFixed(1)} percentage points. Retain a scoring contributor or ask for a usable replacement before accepting for a win-now plan.` }
  if (s.lineup.delta < -0.05) {
    const losses = (s.depthChanges ?? []).filter(d => d.after < d.before).map(d => d.position).join(', ')
    return { action: 'counter', text: `COUNTER: This deal lowers your projected starting lineup by ${Math.abs(s.lineup.delta).toFixed(1)} points in week ${s.lineupWeek ?? 'unknown'}. Ask for a usable replacement${losses ? ` at ${losses}` : ''}, or retain an outgoing starter. A favorable value grade does not repair that loss.` }
  }
  return { action: 'accept', text: `YES, on verified value and this week's roster fit: ${s.recommendation.explanation} This is conditional on current availability and your longer-term strategy.` }
}

/** Conservative decision from computed value and lineup, never from an LLM guess. */
export function tradeDecisionRecommendation(s: ReadyTradeScenario): string {
  return decideTrade(s).text
}

/** The action `tradeDecisionRecommendation` leads with, for surfaces that show it as a label. */
export function tradeDecisionAction(s: ReadyTradeScenario): TradeDecisionAction {
  return decideTrade(s).action
}

export function tradeFutureStructure(s: ReadyTradeScenario): string[] {
  const given = s.give.filter(p => p.playerId.startsWith('pick:')).map(p => p.name)
  const received = s.get.filter(p => p.playerId.startsWith('pick:')).map(p => p.name)
  return [
    ...(s.playerAges?.length ? [`Cached player ages: ${s.playerAges.map(p => `${p.name} ${p.age} (${p.side === 'give' ? 'outgoing' : 'incoming'})`).join(', ')}. Age informs a dynasty time horizon, but does not establish how long a player will stay productive.`] : []),
    ...(received.length ? [`Future years: acquiring ${received.join(', ')} adds future draft flexibility, but a pick cannot replace today's lost starter. Its slot and the player it becomes are unknown.`] : []),
    ...(given.length ? [`Future years: sending ${given.join(', ')} reduces future draft flexibility. Do not treat today's lineup gain as a forecast for those seasons.`] : []),
  ]
}
