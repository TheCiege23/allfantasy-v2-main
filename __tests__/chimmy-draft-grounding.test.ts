import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sessionFindUnique: vi.fn(),
  pickFindMany: vi.fn(),
  pickCount: vi.fn(),
  viewerRoster: vi.fn(),
  buildDraftDecisionContext: vi.fn(),
  computeDraftRecommendation: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findUnique: mocks.sessionFindUnique, findFirst: mocks.sessionFindUnique },
    draftPick: { findMany: mocks.pickFindMany, count: mocks.pickCount },
  },
}))

vi.mock('@/lib/live-draft-engine/auth', () => ({ getCurrentUserRosterIdForLeague: mocks.viewerRoster }))
vi.mock('@/lib/shared-services/draft/DraftContextAssembler', () => ({
  buildDraftDecisionContext: mocks.buildDraftDecisionContext,
}))
vi.mock('@/lib/draft-helper/RecommendationEngine', () => ({
  computeDraftRecommendation: mocks.computeDraftRecommendation,
}))

import { buildDraftContext, buildDraftOsRecommendationLines } from '@/lib/chimmy/draftGrounding'

function recommendation(overrides: Record<string, unknown> = {}) {
  return {
    recommendation: {
      player: { name: 'Bijan Robinson', position: 'RB', team: 'ATL', adp: 2.4 },
      reason: 'Best available at your thinnest position.',
      confidence: 0.82,
      needScore: 0.9,
      adpEdge: 1.6,
      adpIsReal: true,
    },
    alternatives: [
      { player: { name: 'CeeDee Lamb', position: 'WR', team: 'DAL', adp: 3.1 }, reason: 'Top WR left.', confidence: 0.7 },
    ],
    reachWarning: null,
    valueWarning: null,
    scarcityInsight: 'Only 2 RB1s remain before your next pick.',
    stackInsight: null,
    correlationInsight: null,
    formatInsight: null,
    byeNote: null,
    explanation: '',
    evidence: [],
    caveats: [],
    uncertainty: null,
    ...overrides,
  }
}

const SLOTS = Array.from({ length: 4 }, (_, i) => ({
  slot: i + 1,
  rosterId: `roster-${i + 1}`,
  displayName: `Manager ${i + 1}`,
}))

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    status: 'in_progress',
    draftType: 'snake',
    rounds: 3,
    teamCount: 4,
    thirdRoundReversal: false,
    currentRoundNum: 1,
    timerSeconds: 60,
    timerEndAt: null,
    slotOrder: SLOTS,
    ...overrides,
  }
}

function pick(overall: number, name: string, manager: string) {
  return {
    overall,
    round: 1,
    slot: overall,
    rosterId: `roster-${overall}`,
    displayName: manager,
    playerName: name,
    position: 'WR',
    team: 'JAX',
  }
}

describe('buildDraftContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sessionFindUnique.mockResolvedValue(session())
    mocks.pickFindMany.mockResolvedValue([pick(2, 'Second Pick', 'Manager 2'), pick(1, 'First Pick', 'Manager 1')])
    mocks.pickCount.mockResolvedValue(2)
    mocks.viewerRoster.mockImplementation(async (_leagueId, userId) => userId === 'app-user-1' ? 'roster-1' : null)
    mocks.buildDraftDecisionContext.mockResolvedValue({ engineInput: { marker: 'engine-input' } })
    mocks.computeDraftRecommendation.mockReturnValue(recommendation())
  })

  it('says the draft is live and who is on the clock', async () => {
    const out = await buildDraftContext('lg1', 'app-user-1')

    expect(out).toContain('DRAFT IS LIVE RIGHT NOW')
    // 4 teams, 2 picks made -> overall 3 -> round 1 slot 3.
    expect(out).toContain('ON THE CLOCK: Manager 3')
    expect(out).toContain('1.03')
  })

  it('lists recent picks with the manager who made them', async () => {
    const out = await buildDraftContext('lg1', 'app-user-1')
    expect(out).toContain('Manager 2 — Second Pick')
  })

  /* Paused means nobody is on the clock, and saying otherwise invents urgency. */
  it('reports a paused draft as having nobody on the clock', async () => {
    mocks.sessionFindUnique.mockResolvedValue(session({ status: 'paused' }))
    const out = await buildDraftContext('lg1', 'app-user-1')

    expect(out).toContain('DRAFT IS PAUSED')
    expect(out).toMatch(/nobody is on the clock/i)
    expect(out).not.toContain('ON THE CLOCK:')
  })

  /*
   * A serpentine board does not describe an auction; there is no clock to be on.
   */
  it('refuses to name a clock for an auction', async () => {
    mocks.sessionFindUnique.mockResolvedValue(session({ draftType: 'auction' }))
    const out = await buildDraftContext('lg1', 'app-user-1')

    expect(out).toMatch(/this is an AUCTION/i)
    expect(out).not.toContain('ON THE CLOCK:')
  })

  it('tells the user when their own next pick is', async () => {
    // Slot 1 in a 4-team snake: picks 1, then 8 (round 2 reversed).
    const out = await buildDraftContext('lg1', 'app-user-1')
    expect(out).toContain('THIS USER drafts at slot 1')
  })

  it('resolves the authenticated user through league ownership', async () => {
    const out = await buildDraftContext('lg1', 'app-user-1')
    expect(mocks.viewerRoster).toHaveBeenCalledWith('lg1', 'app-user-1')
    expect(out).toContain('their next pick is 2.04')
  })

  it('does not treat a roster ID supplied as a user ID as ownership', async () => {
    expect(await buildDraftContext('lg1', 'roster-1')).not.toContain('THIS USER drafts')
  })

  it('does not guess ownership when the lookup fails', async () => {
    mocks.viewerRoster.mockRejectedValueOnce(new Error('unavailable'))
    const out = await buildDraftContext('lg1', 'app-user-1')
    expect(out).toContain('ON THE CLOCK: Manager 3')
    expect(out).not.toContain('THIS USER drafts')
  })

  it('stays quiet about the user when they match no draft slot', async () => {
    const out = await buildDraftContext('lg1', 'somebody-else')
    expect(out).toMatch(/could not be matched to a draft slot/i)
  })

  it('describes a scheduled draft without recommending picks', async () => {
    mocks.sessionFindUnique.mockResolvedValue(session({ status: 'pre_draft' }))
    mocks.pickCount.mockResolvedValue(0)
    mocks.pickFindMany.mockResolvedValue([])

    const out = await buildDraftContext('lg1', 'app-user-1')

    expect(out).toContain('scheduled, NOT STARTED')
    expect(out).toContain('Draft order: 1. Manager 1')
    expect(out).toMatch(/Do NOT recommend specific picks/i)
  })

  it('will not suggest picks once the draft is over', async () => {
    mocks.sessionFindUnique.mockResolvedValue(session({ status: 'completed' }))
    const out = await buildDraftContext('lg1', 'app-user-1')

    expect(out).toContain('DRAFT: COMPLETED')
    expect(out).toMatch(/Do NOT suggest who to draft next/i)
  })

  it('does not name a clock when the draft order is missing', async () => {
    mocks.sessionFindUnique.mockResolvedValue(session({ slotOrder: [] }))
    const out = await buildDraftContext('lg1', 'app-user-1')

    expect(out).toMatch(/do NOT say who is on the clock/i)
  })

  it('returns null when the league has no draft session', async () => {
    mocks.sessionFindUnique.mockResolvedValue(null)
    expect(await buildDraftContext('lg1', 'app-user-1')).toBeNull()
  })
})

describe('Draft OS recommendation in the draft context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sessionFindUnique.mockResolvedValue(session())
    mocks.pickFindMany.mockResolvedValue([pick(2, 'Second Pick', 'Manager 2'), pick(1, 'First Pick', 'Manager 1')])
    mocks.pickCount.mockResolvedValue(2)
    mocks.viewerRoster.mockImplementation(async (_leagueId, userId) => userId === 'app-user-1' ? 'roster-1' : null)
    mocks.buildDraftDecisionContext.mockResolvedValue({ engineInput: { marker: 'engine-input' } })
    mocks.computeDraftRecommendation.mockReturnValue(recommendation())
  })

  it("gives Chimmy Draft OS's pick for the viewer's own roster, from the room's engine", async () => {
    const out = await buildDraftContext('lg1', 'app-user-1')
    expect(mocks.buildDraftDecisionContext).toHaveBeenCalledWith({ leagueId: 'lg1', rosterId: 'roster-1' })
    expect(mocks.computeDraftRecommendation).toHaveBeenCalledWith({ marker: 'engine-input' })
    expect(out).toContain('DRAFT OS RECOMMENDATION')
    expect(out).toContain('Bijan Robinson (RB, ATL, ADP 2.4)')
    expect(out).toContain('Alternatives: CeeDee Lamb')
    expect(out).toContain('Only 2 RB1s remain')
  })

  it('does not ask Draft OS for a viewer with no draft slot', async () => {
    const out = await buildDraftContext('lg1', 'someone-else')
    expect(mocks.buildDraftDecisionContext).not.toHaveBeenCalled()
    expect(out).not.toContain('DRAFT OS')
  })

  it('does not recommend in a paused draft, an auction, or one that has not started or has finished', async () => {
    for (const overrides of [{ status: 'paused' }, { draftType: 'auction' }, { status: 'pre_draft' }, { status: 'completed' }]) {
      mocks.sessionFindUnique.mockResolvedValue(session(overrides))
      const out = await buildDraftContext('lg1', 'app-user-1')
      expect(out).not.toContain('DRAFT OS')
    }
    expect(mocks.buildDraftDecisionContext).not.toHaveBeenCalled()
  })

  it('keeps the rest of the context when Draft OS fails', async () => {
    mocks.buildDraftDecisionContext.mockRejectedValue(new Error('No DraftSession exists'))
    const out = await buildDraftContext('lg1', 'app-user-1')
    expect(out).toContain('ON THE CLOCK: Manager 3')
    expect(out).not.toContain('DRAFT OS')
  })

  it('gives up after its time budget instead of holding the chat turn', async () => {
    const lines = await buildDraftOsRecommendationLines('lg1', 'roster-1', {
      buildContext: () => new Promise(() => {}),
      budgetMs: 20,
    })
    expect(lines).toBeNull()
  })

  it('says nothing when the engine has no recommendation', async () => {
    mocks.computeDraftRecommendation.mockReturnValue(recommendation({ recommendation: null }))
    expect(await buildDraftOsRecommendationLines('lg1', 'roster-1')).toBeNull()
  })

  it('forbids reach/value talk when the ADP behind the pick is not real market ADP', async () => {
    const rec = recommendation()
    rec.recommendation.adpIsReal = false
    mocks.computeDraftRecommendation.mockReturnValue(rec)
    const lines = (await buildDraftOsRecommendationLines('lg1', 'roster-1')) ?? []
    expect(lines.join(' ')).toContain('do not describe the pick as a reach or a value')
  })
})
