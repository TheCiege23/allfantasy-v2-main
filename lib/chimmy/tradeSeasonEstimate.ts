import { bestLineup, EMPTY_SCENARIO, scenarioEffect, type ScenarioModel } from '@/lib/core-app/outlookScenario'
import { pctOf, simulateSeason } from '@/lib/core-app/outlookSim'
import type { ReadyTradeScenario } from './tradeScenarioTypes'

/** Paired deterministic season sensitivity, with no substitute identities or unpriced zeros. */
export function tradeSeasonEstimate(s: ReadyTradeScenario, model: ScenarioModel, computedAt: string): ReadyTradeScenario['playoffOdds'] {
  const no = (reason: string): ReadyTradeScenario['playoffOdds'] => ({ available: false, reason })
  if (model.refusal || !model.youRosterId || !model.basisWeek || !model.slots.length || !model.weeks.length || model.basisWeek.week !== s.lineupWeek)
    return no('The season model does not have matching roster projections and remaining weeks.')
  if (!Number.isFinite(model.seed) || !Number.isInteger(model.sim.playoffTeams) || model.sim.playoffTeams < 1 || model.sim.playoffTeams > model.sim.teams.length || model.sim.teams.length < 2 || model.sim.teams.length > 64 || !model.sim.remaining.length || model.sim.teams.some(t => !t.profile || !Number.isFinite(t.profile.mu) || !Number.isFinite(t.profile.sigma) || !Number.isFinite(t.profile.n) || t.profile.sigma < 0 || t.profile.n < 1 || ![t.wins, t.losses, t.pointsFor].every(Number.isFinite)))
    return no('Complete scoring-history profiles and a real remaining schedule are required.')
  const ids = new Set(model.sim.teams.map(t => t.rosterId))
  if (ids.size !== model.sim.teams.length || !ids.has(model.youRosterId) || model.sim.remaining.some(g => !ids.has(g.a) || !ids.has(g.b) || g.a === g.b || !model.weeks.includes(g.week)))
    return no('The remaining schedule could not be matched to the modeled teams.')
  const send = s.give.filter(p => !p.playerId.startsWith('pick:')).map(p => p.playerId)
  const receive = s.get.filter(p => !p.playerId.startsWith('pick:')).map(p => p.playerId)
  const you = model.teams.find(t => t.rosterId === model.youRosterId && t.isYou)
  const partners = model.teams.filter(t => !t.isYou && receive.length > 0 && receive.every(id => t.players.some(p => p.id === id)))
  if (!you || partners.length !== 1 || !send.every(id => you.players.some(p => p.id === id))) return no('The trade players could not be matched exactly to both season-model rosters.')
  const partner = partners[0]
  // Taxi players cannot fill an active slot. Preserve them for identity checks, exclude from scoring.
  const pricedModel = { ...model, teams: model.teams.map(t => ({ ...t, players: t.players.map(p => p.slot === 'T' ? { ...p, slot: 'I' as const } : p) })) }
  for (const team of [you, partner]) {
    const base = pricedModel.teams.find(t => t.rosterId === team.rosterId)!.players
    const outgoing = team.isYou ? send : receive
    const incoming = (team.isYou ? partner : you).players.filter(p => (team.isYou ? receive : send).includes(p.id)).map(p => ({ ...p, slot: 'B' as const }))
    const after = [...base.filter(p => !outgoing.includes(p.id)), ...incoming]
    if ([...base, ...after].some(p => p.slot !== 'I' && (p.points == null || !Number.isFinite(p.points)))) return no('An active player lacks a league-scored projection; season impact is withheld.')
    for (const week of [...model.weeks, null]) for (const roster of [base, after]) {
      const lineup = bestLineup(roster, model.slots, week)
      if (lineup.unknown.length || lineup.unfilled.length) return no('A legal full lineup could not be priced before and after the trade for every remaining week.')
    }
  }
  const effect = scenarioEffect(pricedModel, { ...EMPTY_SCENARIO, trades: [{ partnerRosterId: partner.rosterId, send, receive }] })
  if (effect.problems.length) return no(effect.problems.join(' '))
  const iterations = 2000
  const beforeRun = simulateSeason(model.sim, { iterations, seed: model.seed })
  const afterRun = simulateSeason(model.sim, { iterations, seed: model.seed, adjustments: effect.adjustments })
  const before = pctOf(beforeRun.counts[you.rosterId].playoff, iterations)
  const after = pctOf(afterRun.counts[you.rosterId].playoff, iterations)
  return { available: true, before, after, delta: after - before, iterations, computedAt,
    reason: 'Season sensitivity estimate using the real remaining schedule and fitted scoring history. The same projection week is reused across future weeks, with known byes and injuries; this is not a rest-of-season projection feed or a future-years forecast. Draft picks add no current-season points. Sampling and model uncertainty remain.' }
}
