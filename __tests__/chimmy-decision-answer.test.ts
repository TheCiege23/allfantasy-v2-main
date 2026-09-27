import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ access: vi.fn(), start: vi.fn(), waiver: vi.fn(), trade: vi.fn(), lineup: vi.fn(), target: vi.fn(), finder: vi.fn(), pending: vi.fn() }))
vi.mock('@/lib/chimmy/chimmy-league-snapshot', () => ({ loadLeagueGroundingForUser: h.access }))
vi.mock('@/lib/chimmy/lineupScenarioGrounding', () => ({ buildStartSitScenario: h.start, buildWaiverScenario: h.waiver }))
vi.mock('@/lib/chimmy/tradeScenarioGrounding', () => ({ buildTradeScenario: h.trade }))
vi.mock('@/lib/chimmy/lineupOptimizerGrounding', () => ({ buildLineupOptimization: h.lineup, singleSwapCall: () => null }))
vi.mock('@/lib/chimmy/tradeTargetVerdict', () => ({ buildTradeTargetVerdict: h.target }))
vi.mock('@/lib/chimmy/tradeFinderGrounding', () => ({ buildTradeFinder: h.finder, readTradeFinderPosition: (word: string) => word?.toUpperCase() ?? null }))

vi.mock('@/lib/chimmy/pendingTradeQuestions', () => ({ pendingTradeQuestions: h.pending }))

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
  it.each([
    ['unavailable_player', 'Choose an available player'],
    ['players_locked', 'Keep already-started players in place'],
  ])('gives eligibility guidance rather than a sync loop for %s', async (reason, guidance) => {
    h.start.mockResolvedValue({ kind: 'start_sit', status: 'unresolved', reason, detail: 'These players cannot be compared for a new lineup move.' })
    const out = await prepareChimmyDecisionAnswer({ question: 'Should I start Chase or Jefferson?', leagueId: 'l1', userId: 'u1' })
    expect(out).toMatchObject({ status: 'needs_data', leagueId: 'authorized-league', gap: { code: reason } })
    expect(out?.answer).toContain(guidance)
    expect(out?.gap?.remedy).toContain('AutoSubs')
    expect(out?.gap?.remedy).not.toContain('Sync')
    expect(h.lineup).not.toHaveBeenCalled()
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

describe('pending and screenshot offer resolution', () => {
  const scenario = { status: 'ready', kind: 'trade', give: [{ playerId: 'qw', name: 'Quincy Williams' }, { playerId: 'cs', name: 'Carson Schwesinger' }],
    get: [{ playerId: 'tt', name: 'Tyrone Tracy' }, { playerId: 'rf', name: 'Ryan Fitzgerald' }, { playerId: 'pick:2027:1:other', name: '2027 1st' }], partnerTeamName: 'Layes23', picks: 1,
    recommendation: { action: 'counter', explanation: 'The league value needs a stronger return.' },
    value: { grade: 'C', given: 100, received: 90, coveragePct: 100 }, lineup: { before: 150, after: 130, delta: -20 },
    depthChanges: [{ position: 'LB', before: 4, after: 2 }], playoffOdds: { available: false } }
  it('analyzes the actual uploaded offer even on an image-only follow-up', async () => {
    h.trade.mockResolvedValue(scenario)
    const out = await prepareChimmyDecisionAnswer({ question: '', leagueId: 'l1', userId: 'u1',
      screenshotEvidence: 'Trade gives: Quincy Williams and Carson Schwesinger\nTrade receives: Tyrone Tracy and Ryan Fitzgerald and 2027 1st' })
    expect(h.trade).toHaveBeenCalledWith({ message: 'Should I trade Quincy Williams and Carson Schwesinger for Tyrone Tracy and Ryan Fitzgerald and 2027 1st?', leagueId: 'authorized-league', userId: 'u1' })
    expect(out?.answer).toContain('COUNTER:')
    expect(out?.answer).toContain('LB roster depth: 4 before, 2 after')
    expect(out?.answer).toContain('Playoff effect unavailable')
    expect(out?.answer).toContain('Future-season results are not computed')
    expect(out?.sources).toContain('screenshot_vision')
  })
  it('reads and evaluates pending offers without asking the user to retype them', async () => {
    h.pending.mockResolvedValue({ offers: [{ id: 'offer-1', question: 'Should I trade Quincy Williams for Tyrone Tracy?' }], gap: null })
    h.trade.mockResolvedValueOnce(null).mockResolvedValueOnce(scenario)
    const out = await prepareChimmyDecisionAnswer({ question: 'Should I accept my pending trades?', leagueId: 'l1', userId: 'u1' })
    expect(h.pending).toHaveBeenCalledWith({ id: 'authorized-league' }, 'u1')
    expect(out?.answer).toContain('Offer offer-1')
    expect(out?.answer).toContain('COUNTER:')
  })
  it('keeps unreadable offers free and does not claim there are none', async () => {
    h.pending.mockResolvedValue({ offers: [], gap: 'The provider inbox could not be read; this does not mean you have none.' })
    const out = await prepareChimmyDecisionAnswer({ question: 'Should I accept my pending trades?', leagueId: 'l1', userId: 'u1' })
    expect(out).toMatchObject({ status: 'needs_data', gap: { code: 'pending_offer_unavailable' } })
    expect(out?.answer).toContain('does not mean you have none')
  })
  it('does not replace explicitly named pending trade assets with an arbitrary inbox offer', async () => {
    h.trade.mockResolvedValue(scenario)
    await prepareChimmyDecisionAnswer({ question: 'Should I accept this pending trade of Quincy Williams for Tyrone Tracy?', leagueId: 'l1', userId: 'u1' })
    expect(h.pending).not.toHaveBeenCalled()
  })
  it('does not bill a screenshot verdict when an asset disappeared during resolution', async () => {
    h.trade.mockResolvedValue({ ...scenario, get: scenario.get.slice(0, 2) })
    const out = await prepareChimmyDecisionAnswer({ question: '', leagueId: 'l1', userId: 'u1', screenshotEvidence: 'Trade gives: Quincy Williams and Carson Schwesinger\nTrade receives: Tyrone Tracy and Ryan Fitzgerald and 2027 1st' })
    expect(out).toMatchObject({ status: 'needs_data', gap: { code: 'screenshot_assets_unresolved' } })
  })
  it('does not grade a pending package after dropping one of its assets', async () => {
    h.pending.mockResolvedValue({ offers: [{ id: 'offer', question: 'Should I trade Quincy Williams for Tyrone Tracy?', assetCount: 6 }], gap: null })
    h.trade.mockResolvedValueOnce(null).mockResolvedValueOnce(scenario)
    const out = await prepareChimmyDecisionAnswer({ question: 'Should I accept my pending trades?', leagueId: 'l1', userId: 'u1' })
    expect(out?.status).toBe('needs_data')
    expect(out?.answer).toContain('Not every offer asset resolved')
  })
  it('keeps partial value-only analysis free when the lineup cannot be computed', async () => {
    h.trade.mockResolvedValue({ ...scenario, lineup: null, lineupUnavailable: 'Weekly projections missing.' })
    const out = await prepareChimmyDecisionAnswer({ question: 'Grade this trade: Quincy Williams for Tyrone Tracy', leagueId: 'l1', userId: 'u1' })
    expect(out).toMatchObject({ status: 'needs_data', gap: { code: 'trade_impact_incomplete' } })
    expect(out?.answer).toContain('Trade Center grade: C')
    expect(out?.answer).toContain('partial analysis')
  })
  it('keeps an explicitly requested season-impact decision free when the model is unavailable', async () => {
    h.trade.mockResolvedValue(scenario)
    const out = await prepareChimmyDecisionAnswer({ question: 'Should I accept this trade if I want to compete next few years?', leagueId: 'l1', userId: 'u1' })
    expect(out).toMatchObject({ status: 'needs_data', gap: { code: 'season_impact_missing' } })
    expect(out?.answer).toContain('no charge')
  })
})
