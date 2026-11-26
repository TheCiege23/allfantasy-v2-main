/**
 * Every draft-room pick-trade surface takes its verdict from THE league grade (2026-11-26):
 * the builder preview, the suggestions ranking, the commissioner AI manager's auto-answer and the orphan
 * AI manager's answer. The grader is the ONLY double here, so each assertion fails if a surface keeps or
 * regrows a verdict of its own: every case is chosen so the retired overall-distance rule answers the
 * opposite way.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  grade: vi.fn(),
  createGrader: vi.fn(),
  session: null as any,
  prisma: {
    draftPickTradeProposal: { findFirst: vi.fn(), update: vi.fn() },
    aiManagerAuditLog: { create: vi.fn() },
  },
  appendDraftPickTrades: vi.fn(),
  shadow: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'user-a' } })) }))
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/decision-os/trade/leagueTradeGrader', () => ({
  createLeagueTradeGrader: (...a: unknown[]) => h.createGrader(...a),
  gradeDeal: async (grader: any, args: any) =>
    grader ? grader.grade({ give: args.give.assets, get: args.get.assets, viewerSide: args.viewerSide }) : { graded: false, reason: 'no league', basis: null },
}))
vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: vi.fn(async () => true),
  getCurrentUserRosterIdForLeague: vi.fn(async () => 'ra'),
}))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({
  getDraftSessionByLeague: vi.fn(async () => h.session),
  buildSessionSnapshot: vi.fn(async () => null),
}))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({ getDraftUISettingsForLeague: vi.fn(async () => ({ pickTradeEnabled: true })) }))
vi.mock('@/lib/tournament-mode/safety', () => ({ isDraftPickTradingAllowedForLeague: vi.fn(async () => true) }))
vi.mock('@/lib/openai-client', () => ({ openaiChatJson: vi.fn(), parseJsonContentFromChatCompletion: vi.fn() }))
vi.mock('@/lib/provider-config', () => ({ getProviderStatus: () => ({ anyAi: false }) }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    async resolveForUser() {
      return { hasAccess: false }
    }
  },
}))
vi.mock('@/lib/draft/getCanonicalDraftState', () => ({ getCanonicalDraftState: vi.fn(async () => null) }))
vi.mock('@/lib/decision-os/trade/surfaceShadow', () => ({ recordTradeSurfaceShadow: h.shadow }))
vi.mock('@/lib/live-draft-engine/DraftPickTradeService', () => ({ appendDraftPickTrades: h.appendDraftPickTrades }))
vi.mock('@/lib/commissioner-ai-draft-manager/CommissionerAiDraftManagerService', () => ({
  parseCommissionerAiManagers: () => ({ assignments: [], tradeRules: {} }),
  getAssignmentForRoster: (_b: unknown, rosterId: string) => (rosterId === 'rb' ? { rosterId, active: true } : null),
}))

const SLOTS = [
  { slot: 1, rosterId: 'ra', displayName: 'Alpha' },
  { slot: 2, rosterId: 'rb', displayName: 'Beta' },
  { slot: 3, rosterId: 'rc', displayName: 'Gamma' },
  { slot: 4, rosterId: 'rd', displayName: 'Delta' },
]
const rookieSession = (extra: Record<string, unknown> = {}) => ({
  id: 's1',
  leagueId: 'L',
  status: 'in_progress',
  draftType: 'snake',
  thirdRoundReversal: false,
  teamCount: 4,
  rounds: 4,
  slotOrder: SLOTS,
  tradedPicks: [],
  picks: [],
  draftModeLabel: 'rookie',
  playerPool: 'rookies_only',
  startedAt: new Date('2026-05-01T00:00:00Z'),
  createdAt: new Date('2026-04-01T00:00:00Z'),
  ...extra,
})
const view = (action: string, letter: string, partnerLetter: string, giveValue: number, getValue: number) => ({
  graded: true, letter, partnerLetter, label: 'label', action, giveValue, getValue, recommendation: `rec ${letter}`,
})
const json = (body: unknown) => ({ json: async () => body }) as any
const ctx = { params: Promise.resolve({ leagueId: 'L' }) } as any

let analyze: typeof import('@/app/api/leagues/[leagueId]/draft/trade-builder/analyze/route').POST
let suggestions: typeof import('@/app/api/leagues/[leagueId]/draft/trade-builder/suggestions/route').POST
let autoRespond: typeof import('@/lib/commissioner-ai-draft-manager/aiTradeAutoResponse').maybeAutoRespondToTradeProposal
let orphan: typeof import('@/lib/orphan-ai-manager/OrphanAIManagerService').evaluateOrphanTradeDecision

beforeAll(async () => {
  analyze = (await import('@/app/api/leagues/[leagueId]/draft/trade-builder/analyze/route')).POST
  suggestions = (await import('@/app/api/leagues/[leagueId]/draft/trade-builder/suggestions/route')).POST
  autoRespond = (await import('@/lib/commissioner-ai-draft-manager/aiTradeAutoResponse')).maybeAutoRespondToTradeProposal
  orphan = (await import('@/lib/orphan-ai-manager/OrphanAIManagerService')).evaluateOrphanTradeDecision
}, 300_000)

beforeEach(() => {
  vi.clearAllMocks()
  h.session = rookieSession()
  h.createGrader.mockResolvedValue({ grade: h.grade })
})

describe('trade-builder/analyze', () => {
  it('moving back a full round reads ACCEPT when the grade says so — verdict, values and shadow all from the grade', async () => {
    h.grade.mockResolvedValue(view('accept', 'A', 'F', 2000, 4000))
    // Alpha gives 1.01 (#1) for Beta's 2.02 (#7 in a 4-team snake): six picks back.
    const res = await analyze(json({ giveRound: 1, giveSlot: 1, receiveRound: 2, receiveSlot: 2, receiverRosterId: 'rb' }), ctx)
    const body = await res.json()
    expect(body.verdict).toBe('accept')
    expect(body.tradeGrade).toMatchObject({ graded: true, letter: 'A', partnerLetter: 'F', action: 'accept' })
    expect(body.summary).toBe('rec A')
    expect(body.reasons).toContain('League value: you send 2,000 and get 4,000.')
    expect(body.structuredAnalysis).toEqual({ overallDelta: 6, moveDirection: 'down' })
    expect(h.shadow.mock.calls[0][0].surfaceVerdict).toBe('accept')
    // Both picks at their exact slots: 1.01 is the 1st of round 1; 2.02 is the 3rd pick of round 2 (#7).
    expect(h.grade.mock.calls[0][0].give[0]).toMatchObject({ round: 1, roundPick: 1 })
    expect(h.grade.mock.calls[0][0].get[0]).toMatchObject({ round: 2, roundPick: 3 })
  })

  it('a startup draft is not graded: no verdict chip value, the reason as the summary, the grader never loaded', async () => {
    h.session = rookieSession({ draftModeLabel: 'startup', playerPool: 'all' })
    const res = await analyze(json({ giveRound: 1, giveSlot: 1, receiveRound: 2, receiveSlot: 2, receiverRosterId: 'rb' }), ctx)
    const body = await res.json()
    expect(body.verdict).toBe('not_graded')
    expect(body.tradeGrade.graded).toBe(false)
    expect(body.summary).toMatch(/Only rookie-draft picks are graded/)
    expect(body.declineReasons).toEqual([])
    expect(h.createGrader).not.toHaveBeenCalled()
  })
})

describe('trade-builder/suggestions', () => {
  it('orders candidates by how close to even they are on league value, not by overall distance', async () => {
    // Alpha owns #1, #8, #9, #16; Beta owns #2, #7, #10, #15 (4-team snake).
    // Make the FARTHEST-apart swap the most even, and the adjacent one the most lopsided.
    h.grade.mockImplementation(async ({ give, get }: any) => {
      const g = give[0].round * 10 + give[0].roundPick
      const r = get[0].round * 10 + get[0].roundPick
      if (g === 11 && r === 43) return view('review', 'C', 'C', 5000, 4990)
      if (g === 11 && r === 12) return view('decline', 'F', 'A', 5000, 1000)
      return view('counter', 'D', 'B', 5000, 3500)
    })
    const res = await suggestions(json({ partnerRosterId: 'rb', suggestionKind: 'fair' }), ctx)
    const body = await res.json()
    expect(body.rankingBasis).toBe('league_value')
    expect(body.suggestionSource).toBe('league_grade')
    expect(body.suggestions[0]).toMatchObject({ giveRound: 1, giveSlot: 1, receiveRound: 4, receiveSlot: 2 })
    expect(body.suggestions[0].tradeGrade).toMatchObject({ graded: true, letter: 'C' })
    expect(body.suggestions[0].rationale).toMatch(/league grade you C · them C/)
    const lopsided = body.suggestions.findIndex((s: any) => s.giveRound === 1 && s.giveSlot === 1 && s.receiveRound === 1 && s.receiveSlot === 2)
    expect(lopsided === -1 || lopsided > 0).toBe(true)
    // One grader for the whole list.
    expect(h.createGrader).toHaveBeenCalledTimes(1)
  })

  it('a startup draft keeps board order and says the ranking is draft position, with the reason', async () => {
    h.session = rookieSession({ draftModeLabel: null, playerPool: 'all' })
    const res = await suggestions(json({ partnerRosterId: 'rb', suggestionKind: 'fair' }), ctx)
    const body = await res.json()
    expect(body.rankingBasis).toBe('draft_position')
    expect(body.gradeWithheldReason).toMatch(/Only rookie-draft picks are graded/)
    expect(body.suggestions[0].tradeGrade).toMatchObject({ graded: false })
    expect(h.createGrader).not.toHaveBeenCalled()
  })
})

describe('commissioner AI manager auto-answer', () => {
  const proposal = (session: Record<string, unknown>) => ({
    id: 'p1', status: 'pending', proposerRosterId: 'ra', receiverRosterId: 'rb', proposerName: 'Alpha',
    // Alpha offers 2.02 (#7) for Beta's 1.02 (#2): Beta (the AI) would move BACK five picks.
    giveRound: 2, giveSlot: 2, receiveRound: 1, receiveSlot: 2,
    giveOriginalRosterId: 'rb', receiveOriginalRosterId: 'rb',
    session: { ...rookieSession(), ...session },
  })

  it('accepts a move-back when the grade says accept (the distance rule countered it)', async () => {
    h.prisma.draftPickTradeProposal.findFirst.mockResolvedValue(proposal({}))
    h.appendDraftPickTrades.mockResolvedValue({ success: true })
    h.grade.mockResolvedValue(view('accept', 'B', 'D', 3000, 3600))
    await autoRespond('L', 'p1')
    // The AI's side: it gives 1.02 and gets 2.02.
    expect(h.grade.mock.calls[0][0].give[0]).toMatchObject({ round: 1, roundPick: 2 })
    expect(h.prisma.draftPickTradeProposal.update.mock.calls.at(-1)[0].data.status).toBe('accepted')
  })

  it('rejects when the grade says decline', async () => {
    h.prisma.draftPickTradeProposal.findFirst.mockResolvedValue(proposal({}))
    h.grade.mockResolvedValue(view('decline', 'F', 'A', 6000, 1000))
    await autoRespond('L', 'p1')
    expect(h.prisma.draftPickTradeProposal.update.mock.calls[0][0].data.status).toBe('rejected')
    expect(h.appendDraftPickTrades).not.toHaveBeenCalled()
  })

  it('leaves an UNGRADED offer pending for the commissioner — no accept, no reject', async () => {
    h.prisma.draftPickTradeProposal.findFirst.mockResolvedValue(proposal({ draftModeLabel: 'startup', playerPool: 'all' }))
    await autoRespond('L', 'p1')
    expect(h.prisma.draftPickTradeProposal.update).not.toHaveBeenCalled()
    expect(h.appendDraftPickTrades).not.toHaveBeenCalled()
  })
})

describe('orphan AI manager', () => {
  it('answers from the grade for the ORPHAN side, and holds when not graded', async () => {
    h.grade.mockResolvedValueOnce(view('counter', 'D', 'B', 5000, 4000))
    const a = await orphan({ leagueId: 'L', userId: 'c', session: rookieSession() as any, give: { round: 1, slot: 1 }, get: { round: 1, slot: 4 } })
    expect(a).toMatchObject({ decision: 'counter', action: 'trade_counter', reason: 'rec D' })
    expect(h.grade.mock.calls[0][0].give[0]).toMatchObject({ round: 1, roundPick: 1 })
    h.grade.mockResolvedValueOnce(view('review', 'C', 'C', 5000, 4950))
    expect((await orphan({ leagueId: 'L', session: rookieSession() as any, give: { round: 1, slot: 1 }, get: { round: 1, slot: 2 } })).decision).toBe('accept')
    const held = await orphan({ leagueId: 'L', session: rookieSession({ draftModeLabel: 'startup', playerPool: 'all' }) as any, give: { round: 1, slot: 1 }, get: { round: 4, slot: 4 } })
    expect(held).toMatchObject({ decision: 'hold', action: 'trade_hold' })
  })
})
