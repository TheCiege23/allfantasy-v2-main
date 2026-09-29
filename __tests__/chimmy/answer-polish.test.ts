import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Answer polish (2026-09-28): the verdict chip, the FAAB bid card, and "Newer answer below".
 *
 * 🛑 THE RULE UNDER TEST: every one of these comes from ENGINE data, never from the answer's prose.
 * So the decision-lane cases below drive the real `prepareChimmyDecisionAnswer` with mocked engines
 * and read the chip off its result, and the reader cases prove prose alone produces nothing.
 */

const h = vi.hoisted(() => ({ access: vi.fn(), start: vi.fn(), waiver: vi.fn(), trade: vi.fn(), lineup: vi.fn(), target: vi.fn() }))
vi.mock('@/lib/chimmy/chimmy-league-snapshot', () => ({ loadLeagueGroundingForUser: h.access }))
vi.mock('@/lib/chimmy/lineupScenarioGrounding', () => ({ buildStartSitScenario: h.start, buildWaiverScenario: h.waiver }))
vi.mock('@/lib/chimmy/tradeScenarioGrounding', () => ({ buildTradeScenario: h.trade }))
vi.mock('@/lib/chimmy/lineupOptimizerGrounding', () => ({ buildLineupOptimization: h.lineup, singleSwapCall: () => null }))
vi.mock('@/lib/chimmy/tradeTargetVerdict', () => ({ buildTradeTargetVerdict: h.target }))
vi.mock('@/lib/chimmy/tradeFinderGrounding', () => ({ buildTradeFinder: vi.fn(), readTradeFinderPosition: () => null }))
vi.mock('@/lib/chimmy/pendingTradeQuestions', () => ({ pendingTradeQuestions: vi.fn() }))

import { decisionAnswerMeta } from '@/lib/chimmy/decisionAnswerContract'
import { prepareChimmyDecisionAnswer } from '@/lib/chimmy/decisionAnswerService'
import { answerKeysFrom, scenarioVerdict } from '@/lib/chimmy/answerPolishBuild'
import {
  newerAnswers,
  readAnswerKeys,
  readAnswerPolish,
  readChimmyFaabCard,
  readChimmyVerdict,
} from '@/lib/chimmy/answerPolish'
import type { ReadyStartSitScenario, ReadyTradeScenario } from '@/lib/chimmy/tradeScenarioTypes'

const START_SIT = (over: Partial<ReadyStartSitScenario> = {}): ReadyStartSitScenario => ({
  kind: 'start_sit', status: 'ready', unit: 'league_points_this_week' as never, week: { week: 4, season: '2026' },
  contested: true, startPlayerId: 'a', delta: 2,
  options: [
    { playerId: 'a', name: 'Casey Runner', position: 'RB', points: 20, lineupIfStarted: 120, inBestLineup: true },
    { playerId: 'b', name: 'Jordan Catch', position: 'WR', points: 18, lineupIfStarted: 118, inBestLineup: false },
  ],
  unfilledSlots: [], unpricedExcluded: 0, playoffOdds: { available: false, reason: 'n/a' },
  ...over,
})

const TRADE = (over: Partial<ReadyTradeScenario> = {}): ReadyTradeScenario => ({
  kind: 'trade', status: 'ready', give: [{ playerId: 'a', name: 'Casey Runner', position: 'RB' }], get: [{ playerId: 'c', name: 'Riley Deep', position: 'WR' }],
  partnerTeamName: 'Team Two', recommendation: { action: 'accept', explanation: 'Value and fit both favor you.' },
  value: { given: 100, received: 110, delta: 10, grade: 'B+', coveragePct: 100, coverageStatus: 'complete' },
  lineup: { before: 120, after: 124, delta: 4, unit: 'x' }, lineupUnavailable: null, playoffOdds: { available: false, reason: 'n/a' },
  ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  h.access.mockResolvedValue({ ok: true, snapshot: { id: 'league-1' } })
  h.start.mockResolvedValue(null)
  h.trade.mockResolvedValue(null)
  h.waiver.mockResolvedValue(null)
})

describe('the verdict chip comes from the engine', () => {
  it('a contested start/sit reads START <pick>, and the answer opens with the same call', async () => {
    h.start.mockResolvedValue(START_SIT())
    const out = await prepareChimmyDecisionAnswer({ question: 'Should I start Casey Runner or Jordan Catch?', leagueId: 'l1', userId: 'u1' })
    expect(out?.status).toBe('ready')
    expect(out?.answer.startsWith('Start Casey Runner.')).toBe(true)
    expect(decisionAnswerMeta(out!).verdict).toEqual({ key: 'start', source: 'lineup_engine', detail: 'Casey Runner' })
  })

  it('an uncontested start/sit reads START BOTH or SIT BOTH, never a pick', () => {
    const both = START_SIT({ contested: false, startPlayerId: null, options: START_SIT().options.map((o) => ({ ...o, inBestLineup: true })) as never })
    expect(scenarioVerdict(both)).toEqual({ key: 'start_both', source: 'lineup_engine', detail: null })
    const neither = START_SIT({ contested: false, startPlayerId: null, options: START_SIT().options.map((o) => ({ ...o, inBestLineup: false })) as never })
    expect(scenarioVerdict(neither)).toEqual({ key: 'sit_both', source: 'lineup_engine', detail: null })
  })

  it('a trade reads the action the recommendation text leads with', () => {
    expect(scenarioVerdict(TRADE())?.key).toBe('yes')
    expect(scenarioVerdict(TRADE({ recommendation: { action: 'decline', explanation: 'No.' } }))?.key).toBe('no')
    expect(scenarioVerdict(TRADE({ recommendation: { action: 'hold', explanation: 'Wait.' } }))?.key).toBe('hold')
    // A favorable action the lineup maths overrules is COUNTER, exactly as the text says.
    expect(scenarioVerdict(TRADE({ lineup: { before: 120, after: 110, delta: -10, unit: 'x' } }))?.key).toBe('counter')
    expect(scenarioVerdict(TRADE({ lineup: null }))?.key).toBe('counter_hold')
    expect(scenarioVerdict(TRADE({ recommendation: undefined }))).toBeNull()
  })

  it('a waiver add/drop comparison gets no chip — the engine does not decide it', () => {
    expect(scenarioVerdict({ kind: 'waiver' } as never)).toBeNull()
  })

  it('a free partial answer carries no chip, even though its text opens with HOLD', async () => {
    h.trade.mockResolvedValue(TRADE({ lineup: null, lineupUnavailable: 'no projections' }))
    const out = await prepareChimmyDecisionAnswer({ question: 'Grade this trade: Casey Runner for Riley Deep', leagueId: 'l1', userId: 'u1' })
    expect(out?.status).toBe('needs_data')
    expect(out?.answer).toMatch(/^HOLD:/)
    expect(decisionAnswerMeta(out!)).not.toHaveProperty('verdict')
  })

  it('the trade-target engine\'s yes is YES, naming the player', async () => {
    h.target.mockResolvedValue({ status: 'decided', targetName: 'Riley Deep', leagueName: 'L', verdict: { verdict: 'yes', headline: 'Yes, trade for Riley Deep', because: 'x', reasons: [], openWith: null, basis: [] } })
    const out = await prepareChimmyDecisionAnswer({ question: 'Should I trade for Riley Deep?', leagueId: 'l1', userId: 'u1' })
    expect(decisionAnswerMeta(out!).verdict).toEqual({ key: 'yes', source: 'trade_engine', detail: 'Riley Deep' })
  })

  it('a lineup optimization answer carries the optimize_my_lineup key for its league', async () => {
    h.lineup.mockResolvedValue({ status: 'ready', week: { week: 4, season: '2026' }, best: { slots: [], points: 100 }, gain: 0, current: { emptySlots: 0 },
      unpricedStarters: [], injuredStarters: [], unfilledSlots: [], unpricedActive: 0 })
    const out = await prepareChimmyDecisionAnswer({ question: 'Set my best lineup', leagueId: 'l1', userId: 'u1' })
    expect(decisionAnswerMeta(out!).answerKeys).toEqual(['optimize_my_lineup:league-1'])
    expect(decisionAnswerMeta(out!)).not.toHaveProperty('verdict')
  })
})

describe('the client readers', () => {
  it('reject a verdict the table does not know, and never read prose', () => {
    expect(readChimmyVerdict({ key: 'bid', source: 'faab_plan' })).toEqual({ key: 'bid', source: 'faab_plan', detail: null })
    expect(readChimmyVerdict({ key: 'sell', source: 'faab_plan' })).toBeNull()
    expect(readChimmyVerdict({ key: 'hold', source: 'the_model' })).toBeNull()
    expect(readAnswerPolish({ responseStructure: { shortAnswer: 'HOLD. Save your FAAB.' } }).verdict).toBeNull()
  })

  it('read a decision answer\'s verdict from meta.decision only when it is ready', () => {
    const verdict = { key: 'start', source: 'lineup_engine', detail: 'Casey Runner' }
    expect(readAnswerPolish({ decision: { status: 'ready', verdict } }).verdict).toEqual(verdict)
    expect(readAnswerPolish({ decision: { status: 'needs_data', verdict } }).verdict).toBeNull()
  })

  it('drop a half-shaped card rather than render it, and only link https', () => {
    const card = { version: 1, leagueName: 'L', outcome: 'bid', bids: [{ name: 'A', sharePct: 50, ceiling: 20 }], waiverLink: { href: 'https://sleeper.com/leagues/1/players', label: 'Open waivers on Sleeper' } }
    expect(readChimmyFaabCard(card)?.bids).toHaveLength(1)
    expect(readChimmyFaabCard({ ...card, bids: [{ name: 'A' }] })).toBeNull()
    expect(readChimmyFaabCard({ ...card, bids: [] })).toBeNull()
    expect(readChimmyFaabCard({ ...card, waiverLink: { href: 'javascript:alert(1)', label: 'x' } })?.waiverLink).toBeNull()
  })

  it('keep only superseding-tool keys', () => {
    expect(readAnswerKeys(['get_faab_bid_plan:L1', 'get_my_roster:L1', 'get_faab_bid_plan:', 7])).toEqual(['get_faab_bid_plan:L1'])
    expect(answerKeysFrom([{ tool: 'get_my_roster', leagueId: 'L1' }, { tool: 'get_faab_bid_plan', leagueId: 'L1' }, { tool: 'get_faab_bid_plan', leagueId: 'L1' }]))
      .toEqual(['get_faab_bid_plan:L1'])
  })
})

describe('"Newer answer below"', () => {
  const turn = (id: string, keys: string[] | null, role = 'chimmy') => ({ id, role, answerKeys: keys })

  it('marks an earlier answer when a later one re-ran the same tool for the same league', () => {
    const marks = newerAnswers([
      turn('q1', null, 'you'), turn('a1', ['get_faab_bid_plan:L1']),
      // An answer in between that ran no superseding tool is neither marked nor a target.
      turn('q2', null, 'you'), turn('a2', null),
      turn('q3', null, 'you'), turn('a3', ['get_faab_bid_plan:L1']),
    ])
    expect(Object.fromEntries(marks)).toEqual({ a1: 'a3' })
  })

  it('points at the NEAREST newer answer, and leaves the newest unmarked', () => {
    const marks = newerAnswers([turn('a1', ['get_faab_bid_plan:L1']), turn('a2', ['get_faab_bid_plan:L1']), turn('a3', ['get_faab_bid_plan:L1'])])
    expect(Object.fromEntries(marks)).toEqual({ a1: 'a2', a2: 'a3' })
  })

  it('does not cross leagues or tools', () => {
    expect(newerAnswers([turn('a1', ['get_faab_bid_plan:L1']), turn('a2', ['get_faab_bid_plan:L2'])]).size).toBe(0)
    expect(newerAnswers([turn('a1', ['get_faab_bid_plan:L1']), turn('a2', ['optimize_my_lineup:L1'])]).size).toBe(0)
  })
})
