import 'server-only'
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
  return [`You give ${names(s.give)}; you receive ${names(s.get)} from ${s.partnerTeamName}.`,
    s.value.grade ? `Trade Center grade: ${s.value.grade}${s.value.label ? ` — ${s.value.label}` : ''}.` : `No trade grade: ${s.value.withheld ?? 'league values are incomplete'}.`,
    `League value (${s.value.basis ?? 'league chart'}): ${points(s.value.given)} given, ${points(s.value.received)} received. Coverage: ${s.value.coveragePct}%.`,
    s.lineup ? `Week ${s.lineupWeek ?? 'unknown'} projected lineup: ${points(s.lineup.before)} before, ${points(s.lineup.after)} after (${points(s.lineup.delta)} point change).` : `Lineup impact unavailable: ${s.lineupUnavailable ?? 'missing projections'}.`,
    ...(s.picks ? ['Pick values use round averages; exact draft slots are unknown.'] : []),
    'Lineup impact covers one week. Playoff odds and future-season outcomes are not computed.'].join('\n')
}

/** Shared by full chat, bubble/public advice and private mentions. Membership is checked here too. */
export async function prepareChimmyDecisionAnswer(args: { question: string; leagueId?: string | null; userId?: string | null }): Promise<ChimmyDecisionAnswer | null> {
  const kind = chimmyDecisionKind(args.question)
  if (!kind) return null
  let provenLeagueId: string | null = null
  const gap = (code: string, detail: string, remedy: string) => decisionAnswer({ kind, status: 'needs_data', leagueId: provenLeagueId,
    answer: `${detail}\n${remedy}`, sources: [], gap: { code, remedy } })
  if (!args.leagueId || !args.userId) return gap('league_required', 'I need your league and roster before computing this decision.', 'Select a league in Chimmy and ask again.')
  try {
    const access = await loadLeagueGroundingForUser(args.userId, args.leagueId)
    if (!access.ok) return gap('league_unavailable', 'I could not read an authorized league for this decision.', 'Open a league you belong to, sync it, and ask again.')
    provenLeagueId = access.snapshot.id
    const input = { message: args.question, leagueId: provenLeagueId, userId: args.userId }
    if (kind === 'trade') {
      if (/\b(?:find|suggest|recommend|propose)\b.*\btrades?\b|\btrade\s+ideas?\b/i.test(args.question)) {
        const positionWord = args.question.match(/\b(?:QB|RB|WR|TE|quarterback|running back|wide receiver|tight end)\b/i)?.[0]
        const result = await buildTradeFinder({ leagueId: provenLeagueId, userId: args.userId, position: readTradeFinderPosition(positionWord) })
        if (result.status === 'unavailable') return gap('trade_discovery_unavailable', result.reason, 'Sync league settings, rosters and values, then retry.')
        if (result.ideas.length === 0) return gap('no_trade_ideas', result.noIdeasReason ?? 'No supported offers were found.', 'Try a different position or name a specific trade to evaluate.')
        return decisionAnswer({ kind, status: 'ready', leagueId: provenLeagueId, sources: ['league_rosters', 'trade_discovery', 'market_values'],
          answer: [`Trade ideas for ${result.you.teamName}:`, ...result.ideas.map(idea =>
            `${idea.partnerTeam}: give ${names(idea.give)}, receive ${names(idea.get)}. Market values ${points(idea.giveTotal)} vs ${points(idea.getTotal)}; fairness band: ${idea.fairness}.${idea.why.length ? ` ${idea.why.join(' ')}` : ''}${!idea.sendable ? ' This package needs review before proposing.' : ''}`),
            'These are engine-generated starting offers from market value and roster fit, not completed trade verdicts. Ask to grade a specific offer for lineup impact; acceptance and playoff effects are unknown.'].join('\n') })
      }
      const target = parseTradeTargetQuestion(args.question)
      if (target) {
        const result = await buildTradeTargetVerdict({ playerName: target.playerName, leagueId: provenLeagueId, userId: args.userId })
        return result.status === 'decided'
          ? decisionAnswer({ kind, status: 'ready', leagueId: provenLeagueId, answer: renderTradeTargetVerdict(result.verdict), sources: ['trade_engine', 'league_rosters', 'league_scoring'] })
          : gap(result.reason, result.detail, 'Confirm the full player name and sync your league roster before retrying.')
      }
    }
    const scenario = kind === 'trade' ? await buildTradeScenario(input)
      : kind === 'waiver' ? await buildWaiverScenario({ ...input, engineClaims: null })
      : await buildStartSitScenario(input)
    if (scenario?.status === 'unresolved') return gap(scenario.reason, scenario.detail, 'Sync league settings and rosters, then confirm the player names and ask again.')
    if (scenario?.status === 'ready') {
      // A resolved trade with no grade and no impact is still a missing answer, never a paid verdict.
      if ('value' in scenario && !scenario.value.grade && !scenario.lineup) return gap('valuation_missing', scenario.value.withheld ?? 'This trade could not be priced.', 'Sync league values and projections, then retry.')
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
      return decisionAnswer({ kind, status: 'ready', leagueId: provenLeagueId, answer: renderDecisionScenario(scenario),
        ...(startCalls.length ? { startCalls } : {}),
        scenario, sources: ['league_rosters', 'league_scoring', kind === 'trade' ? 'trade_engine' : 'weekly_projections'] })
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
