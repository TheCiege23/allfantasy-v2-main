import 'server-only'
import { screenshotTradeQuestion } from './tradeOfferEvidence'
import { tradeSeasonOutlook } from './tradeSeasonOutlook'
import { tradeDecisionRecommendation, tradeFutureStructure } from './tradeDecisionRecommendation'
import { loadLeagueGroundingForUser } from './chimmy-league-snapshot'
import { chimmyDecisionKind, decisionAnswer, type ChimmyDecisionAnswer } from './decisionAnswerContract'
import { buildStartSitScenario, buildWaiverScenario } from './lineupScenarioGrounding'
import { buildTradeScenario } from './tradeScenarioGrounding'
import { buildLineupOptimization, singleSwapCall } from './lineupOptimizerGrounding'
import { parseTradeTargetQuestion } from './tradeTargetQuestion'
import { buildTradeTargetVerdict } from './tradeTargetVerdict'
import { renderTradeTargetVerdict } from './tradeTargetDecision'
import { buildTradeFinder, readTradeFinderPosition } from './tradeFinderGrounding'
import type { ReadyChimmyScenario } from './tradeScenarioTypes'
import type { ChatStartCall } from './tools/chimmyTools'

const points = (n: number | null) => n == null ? 'not computed' : n.toFixed(1)
const names = (ps: Array<{ name: string }>) => ps.map(p => p.name).join(', ')

/** User-facing evidence, rendered from engine fields. No model may add a verdict or confidence. */
export function renderDecisionScenario(s: ReadyChimmyScenario): string {
  if (s.kind === 'start_sit') {
    const pick = s.options.find(p => p.playerId === s.startPlayerId)
    const header = s.contested && pick ? `Start ${pick.name}.` : s.options.every(p => p.inBestLineup) ? 'Both fit in your best lineup; start both.' : 'Neither fits in your best projected lineup.'
    return [header, `Week ${s.week.week}, ${s.week.season}, under your league's scoring:`,
      ...s.options.map(p => `${p.name}: ${points(p.points)} projected points; lineup total if started: ${points(p.lineupIfStarted)}.`),
      ...(s.unfilledSlots.length ? [`Unfilled slots: ${s.unfilledSlots.join(', ')}. These totals exclude those slots.`] : []),
      ...(s.unpricedExcluded ? [`${s.unpricedExcluded} active players lack projections and were excluded.`] : []),
      'Check game locks and current injury news before making a change. Projections are estimates; weather and news after the last sync are not included.'].join('\n')
  }
  if (s.kind === 'waiver') {
    return [`Add/drop comparison: ${s.add.name}${s.drop ? ` for ${s.drop.name}` : ' (no drop named)'}.`,
      `Week ${s.week.week}, ${s.week.season}, under your league's scoring: ${s.add.name} ${points(s.add.points)} projected points${s.drop ? `; ${s.drop.name} ${points(s.drop.points)}` : ''}.`,
      s.lineup ? `Starting lineup: ${points(s.lineup.before)} before, ${points(s.lineup.after)} after (${points(s.lineup.delta)} point change).` : `Lineup impact unavailable: ${s.lineupUnavailable ?? 'missing projections'}.`,
      ...(s.rosterRoomUnchecked ? ['Roster room has not been checked; name the player you would drop.'] : []),
      ...(s.unfilledSlots.length ? [`Totals exclude unfilled slots: ${s.unfilledSlots.join(', ')}.`] : []),
      'This compares one week; it does not authorize a claim or determine whether it will succeed. FAAB competition, future weeks and playoff odds are not computed.'].join('\n')
  }
  return [tradeDecisionRecommendation(s),
    `You give ${names(s.give)}; you receive ${names(s.get)} from ${s.partnerTeamName}.`,
    s.value.grade ? `Trade Center grade: ${s.value.grade}${s.value.label ? ` — ${s.value.label}` : ''}.` : `No trade grade: ${s.value.withheld ?? 'league values are incomplete'}.`,
    `League value (${s.value.basis ?? 'league chart'}): ${points(s.value.given)} given, ${points(s.value.received)} received. Coverage: ${s.value.coveragePct}%.`,
    s.lineup ? `Week ${s.lineupWeek ?? 'unknown'} projected lineup: ${points(s.lineup.before)} before, ${points(s.lineup.after)} after (${points(s.lineup.delta)} point change).` : `Lineup impact unavailable: ${s.lineupUnavailable ?? 'missing projections'}.`,
    ...(s.unpricedExcluded ? [`${s.unpricedExcluded} rostered players have no projection and were excluded from lineup totals.`] : []),
    ...(s.depthChanges ?? []).map(d => `${d.position} roster depth: ${d.before} before, ${d.after} after.`),
    ...(s.picks ? ['Pick values use round averages; exact draft slots are unknown.'] : []),
    ...(s.competitiveContext ? [`Current competitive position: ${s.competitiveContext.wins}-${s.competitiveContext.losses}-${s.competitiveContext.ties}${s.competitiveContext.rank != null ? `, rank ${s.competitiveContext.rank}` : ''} in the synced standings. This is current standing, not a post-trade playoff probability.`] : []),
    ...tradeFutureStructure(s),
    s.playoffOdds.available ? `Playoff scenario estimate: ${s.playoffOdds.before.toFixed(1)}% before, ${s.playoffOdds.after.toFixed(1)}% after (${s.playoffOdds.delta.toFixed(1)} percentage-point change; ${s.playoffOdds.iterations} paired simulations). ${s.playoffOdds.reason}` : `Playoff effect unavailable: ${s.playoffOdds.reason}`,
    'Future-season results are not computed; player development, future injuries and future draft selections are unknown.'].join('\n')
}

/** Shared by full chat, bubble/public advice and private mentions. Membership is checked here too. */
export async function prepareChimmyDecisionAnswer(args: { question: string; leagueId?: string | null; userId?: string | null; screenshotEvidence?: string | null }): Promise<ChimmyDecisionAnswer | null> {
  const imageTrade = screenshotTradeQuestion(args.screenshotEvidence)
  const kind = imageTrade.question || imageTrade.clarification ? 'trade' : chimmyDecisionKind(args.question)
  if (!kind) return null
  let provenLeagueId: string | null = null
  const gap = (code: string, detail: string, remedy: string) => decisionAnswer({ kind, status: 'needs_data', leagueId: provenLeagueId,
    answer: `${detail}\n${remedy}`, sources: [], gap: { code, remedy } })
  if (!args.leagueId || !args.userId) return gap('league_required', 'I need your league and roster before computing this decision.', 'Select a league in Chimmy and ask again.')
  try {
    const access = await loadLeagueGroundingForUser(args.userId, args.leagueId)
    if (!access.ok) return gap('league_unavailable', 'I could not read an authorized league for this decision.', 'Open a league you belong to, sync it, and ask again.')
    provenLeagueId = access.snapshot.id
    const enrichTrade = tradeSeasonOutlook(access.snapshot, args.userId)
    const needsSeason = /\bplayoff|\bcompete|\bfuture|\bnext\s+(?:few\s+)?years/i.test(args.question)
    if (imageTrade.clarification) return gap('screenshot_trade_unclear', imageTrade.clarification, 'Confirm the assets on each side; no trade verdict was computed.')
    const input = { message: imageTrade.question ?? args.question, leagueId: provenLeagueId, userId: args.userId }
    const namedTrade = kind === 'trade' && /\bpending\b|\b(?:this|that|the)\s+(?:trade|offer)\b/i.test(args.question) ? await buildTradeScenario(input) : null
    if (kind === 'trade' && !imageTrade.question && !namedTrade && /\bpending\b|\b(?:this|that|the)\s+(?:trade|offer)\b/i.test(args.question)) {
      const { pendingTradeQuestions } = await import('./pendingTradeQuestions')
      const pending = await pendingTradeQuestions(access.snapshot, args.userId)
      if (!pending.offers.length) return gap('pending_offer_unavailable', pending.gap ?? 'The pending offer could not be read.', 'Attach the trade screenshot or identify the offer.')
      const results = await Promise.all(pending.offers.map(async offer => {
        const scenario = await buildTradeScenario({ ...input, message: offer.question })
        return { offer, scenario: scenario?.status === 'ready' ? await enrichTrade(scenario) : scenario }
      }))
      const ready = results.filter(r => r.scenario?.status === 'ready' && (r.offer.assetCount == null || r.offer.assetCount === r.scenario.give.length + r.scenario.get.length) && r.scenario.value.grade && r.scenario.lineup && !r.scenario.unpricedExcluded)
      const answer = results.map(r => `Offer ${r.offer.id}:\n${r.scenario?.status === 'ready' ? (r.offer.assetCount != null && r.offer.assetCount !== r.scenario.give.length + r.scenario.get.length ? 'Not every offer asset resolved; no verdict was computed for this package.' : renderDecisionScenario(r.scenario)) : r.scenario?.status === 'unresolved' ? r.scenario.detail : 'The assets could not be resolved against your league roster.'}`).join('\n\n')
      if (!ready.length) return gap('pending_offer_evaluation_missing', answer, 'Sync league rosters, scoring and values before deciding.')
      if (needsSeason && results.some(r => r.scenario?.status !== 'ready' || !r.scenario.playoffOdds.available)) return gap('season_impact_missing', answer, 'This is a partial analysis, with no charge. Sync the league and complete schedule/projection coverage before relying on a playoff-impact decision.')
      return decisionAnswer({ kind, status: 'ready', leagueId: provenLeagueId, answer,
        sources: ['provider_pending_offers', 'league_rosters', 'league_scoring', 'trade_engine'] })
    }
    if (kind === 'trade') {
      if (!imageTrade.question && /\b(?:find|suggest|recommend|propose)\b.*\btrades?\b|\btrade\s+ideas?\b/i.test(args.question)) {
        const positionWord = args.question.match(/\b(?:QB|RB|WR|TE|quarterback|running back|wide receiver|tight end)\b/i)?.[0]
        const result = await buildTradeFinder({ leagueId: provenLeagueId, userId: args.userId, position: readTradeFinderPosition(positionWord) })
        if (result.status === 'unavailable') return gap('trade_discovery_unavailable', result.reason, 'Sync league settings, rosters and values, then retry.')
        if (result.ideas.length === 0) return gap('no_trade_ideas', result.noIdeasReason ?? 'No supported offers were found.', 'Try a different position or name a specific trade to evaluate.')
        return decisionAnswer({ kind, status: 'ready', leagueId: provenLeagueId, sources: ['league_rosters', 'trade_discovery', 'market_values'],
          answer: [`Trade ideas for ${result.you.teamName}:`, ...result.ideas.map(idea =>
            `${idea.partnerTeam}: give ${names(idea.give)}, receive ${names(idea.get)}. Market values ${points(idea.giveTotal)} vs ${points(idea.getTotal)}; fairness band: ${idea.fairness}.${idea.why.length ? ` ${idea.why.join(' ')}` : ''}${!idea.sendable ? ' This package needs review before proposing.' : ''}`),
            'These are engine-generated starting offers from market value and roster fit, not completed trade verdicts. Ask to grade a specific offer for lineup impact; acceptance and playoff effects are unknown.'].join('\n') })
      }
      const target = imageTrade.question ? null : parseTradeTargetQuestion(args.question)
      if (target) {
        const result = await buildTradeTargetVerdict({ playerName: target.playerName, leagueId: provenLeagueId, userId: args.userId })
        return result.status === 'decided'
          ? decisionAnswer({ kind, status: 'ready', leagueId: provenLeagueId, answer: renderTradeTargetVerdict(result.verdict), sources: ['trade_engine', 'league_rosters', 'league_scoring'] })
          : gap(result.reason, result.detail, 'Confirm the full player name and sync your league roster before retrying.')
      }
    }
    let scenario = kind === 'trade' ? namedTrade ?? await buildTradeScenario(input)
      : kind === 'waiver' ? await buildWaiverScenario({ ...input, engineClaims: null })
      : await buildStartSitScenario(input)
    if (scenario?.status === 'unresolved') return gap(scenario.reason, scenario.detail, 'Sync league settings and rosters, then confirm the player names and ask again.')
    if (scenario?.status === 'ready') {
      if ('value' in scenario && imageTrade.assetCount != null && imageTrade.assetCount !== scenario.give.length + scenario.get.length) return gap('screenshot_assets_unresolved', 'I received the screenshot, but not every asset resolved against the league roster. No complete-package verdict was computed.', 'Confirm every player and pick on both sides before deciding.')
      // A resolved trade with no grade and no impact is still a missing answer, never a paid verdict.
      if ('value' in scenario && !scenario.value.grade && !scenario.lineup) return gap('valuation_missing', scenario.value.withheld ?? 'This trade could not be priced.', 'Sync league values and projections, then retry.')
      if ('value' in scenario && (!scenario.value.grade || !scenario.lineup || scenario.unpricedExcluded)) return gap('trade_impact_incomplete', renderDecisionScenario(scenario), 'This is a partial analysis. Sync league values and complete weekly projections before treating it as an acceptance decision.')
      if ('value' in scenario) {
        scenario = await enrichTrade(scenario)
        if (needsSeason && !scenario.playoffOdds.available) return gap('season_impact_missing', renderDecisionScenario(scenario), 'This is a partial analysis, with no charge. Sync the league and complete season-model coverage before relying on a playoff-impact decision.')
      }
      if (scenario.kind === 'waiver' && !scenario.lineup && scenario.add.points == null && scenario.drop?.points == null) return gap('projections_missing', 'The move was identified, but its players and lineup impact could not be projected.', 'Sync your league and retry when weekly projections are available.')
      const startCalls: ChatStartCall[] = []
      if (scenario.kind === 'start_sit' && scenario.contested) {
        const pick = scenario.options.find(p => p.playerId === scenario.startPlayerId)
        const other = scenario.options.find(p => p.playerId !== scenario.startPlayerId)
        const season = Number(scenario.week.season)
        if (pick && other && Number.isInteger(season)) startCalls.push({
          leagueId: provenLeagueId, season, week: scenario.week.week,
          rec: { key: pick.playerId, name: pick.name }, alt: { key: other.playerId, name: other.name }, slot: null,
        })
      }
      return decisionAnswer({ kind, status: 'ready', leagueId: provenLeagueId, answer: (imageTrade.question ? 'I read the attached offer and resolved its assets against your league roster.\n' : '') + renderDecisionScenario(scenario),
        ...(startCalls.length ? { startCalls } : {}),
        scenario, sources: [...(imageTrade.question ? ['screenshot_vision'] : []), 'league_rosters', 'league_scoring', kind === 'trade' ? 'trade_engine' : 'weekly_projections'] })
    }
    if (kind === 'lineup') {
      const result = await buildLineupOptimization({ leagueId: provenLeagueId, userId: args.userId })
      if (result.status === 'unresolved') return gap(result.reason, result.detail, 'Sync your league and check that weekly projections are available, then retry.')
      const call = singleSwapCall(result, provenLeagueId)
      return decisionAnswer({ kind, status: 'ready', leagueId: provenLeagueId, sources: ['league_rosters', 'league_scoring', 'weekly_projections'],
        ...(call ? { startCalls: [call] } : {}),
        answer: [`Best projected lineup for week ${result.week.week}, ${result.week.season}:`,
          ...result.best.slots.map(s => `${s.slot}: ${s.player.name} (${points(s.player.points)} projected points).`),
          `Projected total: ${points(result.best.points)} under your league's scoring.`,
          ...(result.gain != null ? [`Change from current lineup: ${points(result.gain)} projected points.`] : ['The current lineup could not be fully priced for comparison.']),
          ...(result.current.emptySlots ? [`Your current lineup has ${result.current.emptySlots} empty slots.`] : []),
          ...result.unpricedStarters.map(p => `${p.name} starts currently but has no projection; check bye, injury and availability.`),
          ...result.injuredStarters.map(p => `${p.name}: ${p.injury}. Check current availability.`),
          ...(result.unfilledSlots.length ? [`Unfilled slots: ${result.unfilledSlots.join(', ')}. No eligible player has a projection.`] : []),
          ...(result.unpricedActive ? [`${result.unpricedActive} active players lack projections and were excluded.`] : []),
          'Check game locks and injury news before changing your lineup. This is a one-week projection, not a guarantee.'].join('\n') })
    }
    return gap('decision_inputs_required', 'I could not resolve a specific move to evaluate.', kind === 'trade' ? 'Name what you give and receive, or ask whether to trade for a named player.' : 'Name the player to add and the player to drop. FAAB bidding needs additional waiver-engine evidence.')
  } catch {
    return gap('engine_unavailable', 'The decision engine could not complete this comparison.', 'Try again after syncing your league. No recommendation was computed.')
  }
}
