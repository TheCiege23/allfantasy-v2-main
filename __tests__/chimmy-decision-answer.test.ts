import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ access: vi.fn(), start: vi.fn(), waiver: vi.fn(), trade: vi.fn(), lineup: vi.fn(), target: vi.fn(), finder: vi.fn() }))
vi.mock('@/lib/chimmy/chimmy-league-snapshot', () => ({ loadLeagueGroundingForUser: h.access }))
vi.mock('@/lib/chimmy/lineupScenarioGrounding', () => ({ buildStartSitScenario: h.start, buildWaiverScenario: h.waiver }))
vi.mock('@/lib/chimmy/tradeScenarioGrounding', () => ({ buildTradeScenario: h.trade }))
vi.mock('@/lib/chimmy/lineupOptimizerGrounding', () => ({ buildLineupOptimization: h.lineup, singleSwapCall: () => null }))
vi.mock('@/lib/chimmy/tradeTargetVerdict', () => ({ buildTradeTargetVerdict: h.target }))
vi.mock('@/lib/chimmy/tradeFinderGrounding', () => ({ buildTradeFinder: h.finder, readTradeFinderPosition: (word: string) => word?.toUpperCase() ?? null }))

import { chimmyDecisionKind, decisionAnswerMeta } from '@/lib/chimmy/decisionAnswerContract'
import { prepareChimmyDecisionAnswer } from '@/lib/chimmy/decisionAnswerService'

beforeEach(() => {
  vi.resetAllMocks()
  h.access.mockResolvedValue({ ok: true, snapshot: { id: 'authorized-league' } })
  h.start.mockResolvedValue(null)
  h.trade.mockResolvedValue(null)
  h.waiver.mockResolvedValue(null)
})

describe('shared consequential-answer contract', () => {
  it.each([
    ['Should I start Chase or Jefferson?', 'lineup'], ['Who should I start?', 'lineup'], ['Optimize my lineup', 'lineup'],
    ['Grade this trade: Chase for Jefferson', 'trade'], ['Is this trade fair?', 'trade'],
    ['Accept or decline: my Kelce for his Bowers?', 'trade'],
    ['Should I add Reed and drop Brown?', 'waiver'], ['How much FAAB should I bid?', 'waiver'],
  ])('routes %s through the %s engine lane', (q, kind) => expect(chimmyDecisionKind(q)).toBe(kind))
  it.each(['What is Bijan dynasty trade value?', 'How does waiver priority work?', 'What is FAAB?', 'When does the season start?', 'Who won the last trade?', 'Tell me the league standings'])('keeps %s out of the action lane', q => expect(chimmyDecisionKind(q)).toBeNull())
  it('asks for a league without reading a private engine', async () => {
    const out = await prepareChimmyDecisionAnswer({ question: 'Who should I start?', userId: 'u1' })
    expect(out).toMatchObject({ status: 'needs_data', authority: 'explanation_only', leagueId: null, gap: { code: 'league_required' } })
    expect(h.access).not.toHaveBeenCalled()
    expect(h.lineup).not.toHaveBeenCalled()
  })
  it.each(['not_member', 'not_found'])('returns the same private-safe gap for %s', async reason => {
    h.access.mockResolvedValue({ ok: false, reason })
    const out = await prepareChimmyDecisionAnswer({ question: 'Grade this trade: Chase for Jefferson', leagueId: 'unproven', userId: 'u1' })
    expect(out).toMatchObject({ status: 'needs_data', leagueId: null, gap: { code: 'league_unavailable' } })
    expect(out?.answer).not.toContain(reason)
    expect(h.trade).not.toHaveBeenCalled()
  })
  it('uses the access-check snapshot id rather than the raw requested id', async () => {
    h.trade.mockResolvedValue({ status: 'unresolved', reason: 'sides_unclear', detail: 'The sides are unclear.' })
    const out = await prepareChimmyDecisionAnswer({ question: 'Is this trade fair?', leagueId: 'raw-request', userId: 'u1' })
    expect(h.trade).toHaveBeenCalledWith({ message: 'Is this trade fair?', leagueId: 'authorized-league', userId: 'u1' })
    expect(out).toMatchObject({ status: 'needs_data', gap: { code: 'sides_unclear' } })
  })
  it('keeps engine picks and projections in the answer, without a model verdict', async () => {
    h.start.mockResolvedValue({ kind: 'start_sit', status: 'ready', week: { week: 4, season: '2026' }, contested: true,
      startPlayerId: 'a', options: [{ playerId: 'a', name: 'Chase', points: 20, lineupIfStarted: 120, inBestLineup: true },
        { playerId: 'b', name: 'Jefferson', points: 18, lineupIfStarted: 118, inBestLineup: false }], unfilledSlots: ['TE'], unpricedExcluded: 1 })
    const out = await prepareChimmyDecisionAnswer({ question: 'Should I start Chase or Jefferson?', leagueId: 'l1', userId: 'u1' })
    expect(out?.answer).toContain('Start Chase.')
    expect(out?.answer).toContain('20.0 projected points')
    expect(out?.answer).toContain('Unfilled slots: TE')
    expect(out).toMatchObject({ status: 'ready', authority: 'explanation_only', sources: ['league_rosters', 'league_scoring', 'weekly_projections'] })
    expect(out?.startCalls?.[0]).toMatchObject({ leagueId: 'authorized-league', season: 2026, week: 4, rec: { key: 'a', name: 'Chase' }, alt: { key: 'b', name: 'Jefferson' } })
    expect(decisionAnswerMeta(out!)).not.toHaveProperty('answer')
  })
  it('does not sell an ungraded trade with no computed impact as a ready answer', async () => {
    h.trade.mockResolvedValue({ status: 'ready', value: { grade: null, withheld: 'Values missing.' }, lineup: null })
    const out = await prepareChimmyDecisionAnswer({ question: 'Grade this trade: Chase for Jefferson', leagueId: 'l1', userId: 'u1' })
    expect(out).toMatchObject({ status: 'needs_data', gap: { code: 'valuation_missing' } })
  })
  it('returns an actionable gap when the engine throws', async () => {
    h.start.mockRejectedValue(new Error('private database details'))
    const out = await prepareChimmyDecisionAnswer({ question: 'Who should I start?', leagueId: 'l1', userId: 'u1' })
    expect(out).toMatchObject({ status: 'needs_data', gap: { code: 'engine_unavailable' } })
    expect(out?.answer).not.toContain('private database')
  })
  it('does not guess an add or FAAB bid when no move was resolved', async () => {
    const out = await prepareChimmyDecisionAnswer({ question: 'How much FAAB should I bid?', leagueId: 'l1', userId: 'u1' })
    expect(out).toMatchObject({ status: 'needs_data', gap: { code: 'decision_inputs_required' } })
  })
  it('keeps trade discovery available with engine-generated offers and explicit limits', async () => {
    h.finder.mockResolvedValue({ status: 'ready', you: { teamName: 'My team' }, ideas: [{ partnerTeam: 'Partner', give: [{ name: 'Chase' }], get: [{ name: 'Jefferson' }], giveTotal: 100, getTotal: 101, fairness: 'balanced', why: ['Fits a WR need.'], sendable: true }] })
    const out = await prepareChimmyDecisionAnswer({ question: 'Find trade ideas for WR', leagueId: 'l1', userId: 'u1' })
    expect(h.finder).toHaveBeenCalledWith({ leagueId: 'authorized-league', userId: 'u1', position: 'WR' })
    expect(out?.answer).toContain('give Chase, receive Jefferson')
    expect(out?.answer).toContain('not completed trade verdicts')
    expect(out?.status).toBe('ready')
  })
})
