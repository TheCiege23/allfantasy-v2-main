import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sessionFindUnique: vi.fn(),
  pickFindMany: vi.fn(),
  pickCount: vi.fn(),
  viewerRoster: vi.fn(),
  buildDraftDecisionContext: vi.fn(),
  computeDraftRecommendation: vi.fn(),
  managersAhead: vi.fn(async () => null),
  snapshot: vi.fn(),
  fit: vi.fn(),
  auction: vi.fn(),
  // The viewer's side (2026-11-16): claimed team, saved queue, Sleeper user id. Null by default.
  teamFindFirst: vi.fn(async () => null),
  queueFindUnique: vi.fn(async () => null),
  profileFindUnique: vi.fn(async () => null),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findUnique: mocks.sessionFindUnique, findFirst: mocks.sessionFindUnique },
    draftPick: { findMany: mocks.pickFindMany, count: mocks.pickCount },
    leagueTeam: { findFirst: mocks.teamFindFirst },
    draftQueue: { findUnique: mocks.queueFindUnique },
    userProfile: { findUnique: mocks.profileFindUnique },
  },
}))

vi.mock('@/lib/live-draft-engine/auth', () => ({ getCurrentUserRosterIdForLeague: mocks.viewerRoster }))
vi.mock('@/lib/shared-services/draft/DraftContextAssembler', () => ({
  buildDraftDecisionContext: mocks.buildDraftDecisionContext,
}))
vi.mock('@/lib/draft-helper/RecommendationEngine', () => ({
  computeDraftRecommendation: mocks.computeDraftRecommendation,
}))

vi.mock('@/lib/competitive-edge/liveDraftManagers', () => ({ loadManagersAhead: mocks.managersAhead }))
// The draft card's sequence (lib/shared-services/draft/pickDecision.ts): the session snapshot and the live roster-fit rule.
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ buildSessionSnapshot: mocks.snapshot }))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({ validateRosterFitForDraftPick: mocks.fit }))
vi.mock('@/lib/shared-services/draft/auctionDecision', () => ({ buildAuctionDecision: mocks.auction }))

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

/** The live session snapshot the draft card's decision reads: this user is on the clock at 1.03. */
function liveSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    status: 'in_progress',
    draftType: 'snake',
    rounds: 3,
    teamCount: 4,
    picks: [],
    currentPick: { overall: 3, round: 1, slot: 1, rosterId: 'roster-1', displayName: 'Manager 1', pickLabel: '1.03' },
    ...overrides,
  }
}

describe('buildDraftContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sessionFindUnique.mockResolvedValue(session())
    mocks.pickFindMany.mockResolvedValue([pick(2, 'Second Pick', 'Manager 2'), pick(1, 'First Pick', 'Manager 1')])
    mocks.pickCount.mockResolvedValue(2)
    mocks.viewerRoster.mockImplementation(async (_leagueId, userId) => userId === 'app-user-1' ? 'roster-1' : null)
    mocks.buildDraftDecisionContext.mockResolvedValue({
      sport: 'NFL',
      engineInput: { marker: 'engine-input' },
      dataCompleteness: { availablePoolSize: 150, adpSampleTotal: 40, rosterPickCount: 0, unresolvedPlayerIdCount: 0 },
    })
    mocks.snapshot.mockResolvedValue(liveSnapshot())
    mocks.fit.mockResolvedValue({ valid: true })
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
    mocks.buildDraftDecisionContext.mockResolvedValue({
      sport: 'NFL',
      engineInput: { marker: 'engine-input' },
      dataCompleteness: { availablePoolSize: 150, adpSampleTotal: 40, rosterPickCount: 0, unresolvedPlayerIdCount: 0 },
    })
    mocks.snapshot.mockResolvedValue(liveSnapshot())
    mocks.fit.mockResolvedValue({ valid: true })
    mocks.computeDraftRecommendation.mockReturnValue(recommendation())
  })

  it("gives Chimmy Draft OS's pick for the viewer's own roster, from the room's engine", async () => {
    const out = await buildDraftContext('lg1', 'app-user-1')
    expect(mocks.buildDraftDecisionContext).toHaveBeenCalledWith({ leagueId: 'lg1', rosterId: 'roster-1', planForOwnTurn: true })
    expect(mocks.computeDraftRecommendation).toHaveBeenCalledWith({ marker: 'engine-input' })
    expect(out).toContain('DRAFT DECISION for THIS USER')
    expect(out).toContain('the same decision their draft room')
    expect(out).toContain('What to do: Draft Bijan Robinson.')
    expect(out).toContain('Ranked: 1. Bijan Robinson (RB, ATL, ADP 2.4)')
    expect(out).toContain('2. CeeDee Lamb (WR, DAL, ADP 3.1)')
    expect(out).toContain('Only 2 RB1s remain')
  })

  it('does not ask Draft OS for a viewer with no draft slot', async () => {
    const out = await buildDraftContext('lg1', 'someone-else')
    expect(mocks.buildDraftDecisionContext).not.toHaveBeenCalled()
    expect(out).not.toContain('DRAFT DECISION')
  })

  it('does not recommend in a paused draft, an auction, or one that has not started or has finished', async () => {
    for (const overrides of [{ status: 'paused' }, { status: 'pre_draft' }, { status: 'completed' }]) {
      mocks.sessionFindUnique.mockResolvedValue(session(overrides))
      const out = await buildDraftContext('lg1', 'app-user-1')
      expect(out).not.toContain('DRAFT DECISION')
    }
    expect(mocks.buildDraftDecisionContext).not.toHaveBeenCalled()
    /*
     * An auction gets no snake PICK recommendation. It may get the auction engine's own read
     * (2026-11-16), which builds the same decision context — so that mock is not asserted here.
     */
    mocks.sessionFindUnique.mockResolvedValue(session({ draftType: 'auction' }))
    expect(await buildDraftContext('lg1', 'app-user-1')).not.toContain('DRAFT DECISION')
  })

  it('keeps the rest of the context when Draft OS fails', async () => {
    mocks.buildDraftDecisionContext.mockRejectedValue(new Error('No DraftSession exists'))
    const out = await buildDraftContext('lg1', 'app-user-1')
    expect(out).toContain('ON THE CLOCK: Manager 3')
    expect(out).not.toContain('DRAFT DECISION')
  })

  it('a caller-shortened budget (the grounding packet’s) drops the pick line and keeps the board', async () => {
    mocks.buildDraftDecisionContext.mockImplementation(() => new Promise(() => {}))
    const started = Date.now()
    const out = await buildDraftContext('lg1', 'app-user-1', { draftOsBudgetMs: 20 })
    // Well under the default DRAFT_OS_BUDGET_MS (2,500 ms): the caller's budget, not the default, ended the wait.
    expect(Date.now() - started).toBeLessThan(1000)
    expect(out).toContain('ON THE CLOCK: Manager 3')
    expect(out).not.toContain('DRAFT DECISION')
  })

  it('gives up after its time budget instead of holding the chat turn', async () => {
    const lines = await buildDraftOsRecommendationLines('lg1', 'roster-1', {
      buildContext: () => new Promise(() => {}),
      budgetMs: 20,
    })
    expect(lines).toBeNull()
  })

  it('says nothing when the engine has no recommendation', async () => {
    // No top choice AND no alternatives: the card has nothing to recommend either.
    mocks.computeDraftRecommendation.mockReturnValue(recommendation({ recommendation: null, alternatives: [] }))
    expect(await buildDraftOsRecommendationLines('lg1', 'roster-1')).toBeNull()
  })

  it('🛑 relays the room\'s refusal: a top choice the roster rules reject is "skip", never "take"', async () => {
    mocks.fit.mockResolvedValue({ valid: false, error: 'No open RB slot remains on this roster.' })
    const out = (await buildDraftOsRecommendationLines('lg1', 'roster-1', { userId: 'app-user-1' }))!.join('\n')
    expect(out).toContain('What to do: Skip Bijan Robinson; consider CeeDee Lamb (WR, DAL) instead.')
    expect(out).toContain('The room would REFUSE Bijan Robinson')
    expect(out).toContain('Do NOT tell them to take Bijan Robinson')
    expect(mocks.fit).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'lg1', rosterId: 'roster-1', newPickPosition: 'RB' }))
  })

  it('says "queue", not "draft", when it is not this user\'s turn', async () => {
    mocks.snapshot.mockResolvedValue(liveSnapshot({ currentPick: { overall: 2, round: 1, slot: 2, rosterId: 'roster-2', displayName: 'Manager 2', pickLabel: '1.02' } }))
    const out = (await buildDraftOsRecommendationLines('lg1', 'roster-1', { userId: 'app-user-1' }))!.join('\n')
    expect(out).toContain('What to do: Queue Bijan Robinson')
  })

  it('forbids reach/value talk when the ADP behind the pick is not real market ADP', async () => {
    const rec = recommendation()
    rec.recommendation.adpIsReal = false
    mocks.computeDraftRecommendation.mockReturnValue(rec)
    const lines = (await buildDraftOsRecommendationLines('lg1', 'roster-1')) ?? []
    expect(lines.join(' ')).toContain('do not describe the pick as a reach or a value')
  })
})

describe('the managers before the user’s next pick (2026-11-14)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sessionFindUnique.mockResolvedValue(session())
    mocks.pickFindMany.mockResolvedValue([pick(2, 'Second Pick', 'Manager 2'), pick(1, 'First Pick', 'Manager 1')])
    mocks.pickCount.mockResolvedValue(2)
    mocks.viewerRoster.mockImplementation(async (_leagueId, userId) => userId === 'app-user-1' ? 'roster-1' : null)
    mocks.buildDraftDecisionContext.mockResolvedValue({
      sport: 'NFL',
      engineInput: { marker: 'engine-input' },
      dataCompleteness: { availablePoolSize: 150, adpSampleTotal: 40, rosterPickCount: 0, unresolvedPlayerIdCount: 0 },
    })
    mocks.snapshot.mockResolvedValue(liveSnapshot())
    mocks.fit.mockResolvedValue({ valid: true })
    mocks.computeDraftRecommendation.mockReturnValue(recommendation())
  })

  it('gives Chimmy each manager’s facts, and forbids labels and predictions', async () => {
    mocks.managersAhead.mockResolvedValueOnce({
      managers: [{ name: 'Manager 3', slot: 3, thisDraft: "Hasn't picked yet in this draft.", history: ['Their first-round pick was at RB in 2 of their 3 drafts.'] }],
      history: 'shown',
    })
    const out = await buildDraftContext('lg1', 'app-user-1')
    // The slot resolved once by viewerDraftIdentity, so a Sleeper-mirrored draft matches too.
    expect(mocks.managersAhead).toHaveBeenCalledWith({ leagueId: 'lg1', userId: 'app-user-1', viewerSlot: 1 })
    expect(out).toContain("MANAGERS PICKING BEFORE THIS USER'S NEXT TURN")
    expect(out).toContain('never label a manager')
    expect(out).toContain('Manager 3: Hasn\'t picked yet in this draft. Past drafts in this league: Their first-round pick was at RB')
  })

  it('🛑 tells Chimmy not to describe history the user’s plan does not include', async () => {
    mocks.managersAhead.mockResolvedValueOnce({
      managers: [{ name: 'Manager 3', slot: 3, thisDraft: "Hasn't picked yet in this draft.", history: [] }],
      history: 'locked',
    })
    const out = await buildDraftContext('lg1', 'app-user-1')
    expect(out).toContain('Competitive Edge, which this user')
    expect(out).not.toContain('Past drafts in this league')
  })

  it('keeps the rest of the context when the read fails', async () => {
    mocks.managersAhead.mockRejectedValueOnce(new Error('db down'))
    const out = await buildDraftContext('lg1', 'app-user-1')
    expect(out).toContain('ON THE CLOCK')
    expect(out).not.toContain('MANAGERS PICKING')
  })
})

/*
 * The viewer's side of the draft (owner's spec, 2026-11-16) — and the Sleeper-mirror slot match.
 *
 * 🛑 A SLEEPER-MIRRORED DRAFT FILES THINGS UNDER SLEEPER IDS. Its slot order holds Sleeper's roster
 * NUMBER and its picks the Sleeper USER id, so matching the AF Roster.id found nothing: no next pick,
 * no recommendation, no managers ahead, on every Sleeper draft. The claimed team's externalId is the
 * roster number (as Draft HQ already used it); its platformUserId is the Sleeper user id.
 */
describe("the viewer's side of a live draft", () => {
  const MIRROR_SLOTS = [
    { slot: 1, rosterId: '1', displayName: 'Alpha' },
    { slot: 2, rosterId: '2', displayName: 'Bravo' },
    { slot: 3, rosterId: '3', displayName: 'Charlie' },
    { slot: 4, rosterId: '4', displayName: 'Delta' },
  ]
  const ALL_PICKS = [
    { overall: 1, round: 1, slot: 1, rosterId: 'slp-alpha', displayName: 'Alpha', playerName: 'CeeDee Lamb', position: 'WR', team: 'DAL' },
    { overall: 2, round: 1, slot: 2, rosterId: 'slp-me', displayName: 'Bravo', playerName: 'Bijan Robinson', position: 'RB', team: 'ATL' },
    { overall: 3, round: 1, slot: 3, rosterId: 'slp-charlie', displayName: 'Charlie', playerName: 'Saquon Barkley', position: 'RB', team: 'PHI' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sessionFindUnique.mockResolvedValue(session({ slotOrder: MIRROR_SLOTS, sleeperDraftId: 'sleeper-draft-1', timerSeconds: 8 * 3600, timerEndAt: new Date(Date.now() + 2 * 3600 * 1000) }))
    mocks.pickFindMany.mockImplementation(async (args: { take?: number }) => (args?.take ? [...ALL_PICKS].reverse() : ALL_PICKS))
    mocks.pickCount.mockResolvedValue(3)
    mocks.viewerRoster.mockResolvedValue('af-roster-me')
    mocks.teamFindFirst.mockResolvedValue({ externalId: '2', platformUserId: 'slp-me' } as never)
    mocks.queueFindUnique.mockResolvedValue({ order: [
      { playerName: 'Saquon Barkley', position: 'RB' },
      { playerName: 'Puka Nacua', position: 'WR', team: 'LAR' },
    ] } as never)
    mocks.buildDraftDecisionContext.mockResolvedValue({
      sport: 'NFL',
      engineInput: { marker: 'engine-input' },
      dataCompleteness: { availablePoolSize: 150, adpSampleTotal: 40, rosterPickCount: 1, unresolvedPlayerIdCount: 0 },
    })
    mocks.computeDraftRecommendation.mockReturnValue(recommendation())
    // The draft card's sequence reads the session snapshot and the roster-fit rule.
    mocks.snapshot.mockResolvedValue(liveSnapshot())
    mocks.fit.mockResolvedValue({ valid: true })
  })

  it('finds the viewer in a Sleeper-mirrored draft by their claimed team, not by AF roster id', async () => {
    const out = (await buildDraftContext('lg1', 'app-user-1'))!
    expect(out).not.toContain('could not be matched to a draft slot')
    // 4 teams, snake, slot 2: 3 picks made, so next overall is 4; slot 2's next is 7 (2.03).
    expect(out).toContain('THIS USER drafts at slot 2; their next pick is 2.03 (3 picks away).')
    expect(mocks.managersAhead).toHaveBeenCalledWith({ leagueId: 'lg1', userId: 'app-user-1', viewerSlot: 2 })
    // Draft OS still takes the AF roster id.
    expect(mocks.buildDraftDecisionContext).toHaveBeenCalledWith({ leagueId: 'lg1', rosterId: 'af-roster-me', planForOwnTurn: true })
  })

  it('lists the picks filed under their Sleeper user id, and what they still have no starter at', async () => {
    const out = (await buildDraftContext('lg1', 'app-user-1'))!
    expect(out).toContain("THIS USER'S PICKS SO FAR (1): 1.02 Bijan Robinson (RB). This draft: RB (1 pick) — no QB or WR or TE yet.")
  })

  it('shows their queue with already-drafted players removed, and never writes it', async () => {
    const out = (await buildDraftContext('lg1', 'app-user-1'))!
    expect(out).toContain("THIS USER'S QUEUE (their own order, drafted players removed): 1. Puka Nacua (WR, LAR).")
    expect(out).not.toContain('1. Saquon Barkley')
  })

  it('says how long is left on a slow-draft pick', async () => {
    const out = (await buildDraftContext('lg1', 'app-user-1'))!
    expect(out).toMatch(/PICK CLOCK: (1h 59m|2h) left on this pick \(8h per pick — a slow draft\)\./)
  })

  it('🛑 tells Chimmy to answer in one line when THEY are on the clock with seconds left', async () => {
    mocks.pickCount.mockResolvedValue(1)
    mocks.pickFindMany.mockImplementation(async () => ALL_PICKS.slice(0, 1))
    mocks.sessionFindUnique.mockResolvedValue(session({ slotOrder: MIRROR_SLOTS, sleeperDraftId: 'sleeper-draft-1', timerSeconds: 90, timerEndAt: new Date(Date.now() + 30_000) }))
    const out = (await buildDraftContext('lg1', 'app-user-1'))!
    expect(out).toContain('ON THE CLOCK: THIS USER at 1.02.')
    expect(out).toMatch(/🛑 THIS USER IS ON THE CLOCK WITH \d+s LEFT\. Answer pick-first in ONE line/)
    // The pick decision — the draft card's own (lib/shared-services/draft/pickDecision.ts).
    expect(out).toContain('DRAFT DECISION for THIS USER')
  })

  it('a native draft still matches on the AF roster id first', async () => {
    mocks.sessionFindUnique.mockResolvedValue(session())
    mocks.pickFindMany.mockResolvedValue([])
    mocks.pickCount.mockResolvedValue(0)
    mocks.viewerRoster.mockResolvedValue('roster-3')
    mocks.teamFindFirst.mockResolvedValue({ externalId: '1', platformUserId: null } as never)
    const out = (await buildDraftContext('lg1', 'app-user-1'))!
    expect(out).toContain('THIS USER drafts at slot 3;')
  })

  it('a failed claimed-team or queue read leaves the rest of the board standing', async () => {
    mocks.teamFindFirst.mockRejectedValue(new Error('db down'))
    mocks.queueFindUnique.mockRejectedValue(new Error('db down'))
    const out = (await buildDraftContext('lg1', 'app-user-1'))!
    expect(out).toContain('DRAFT IS LIVE RIGHT NOW')
    expect(out).toContain('could not be matched to a draft slot')
    expect(out).not.toContain("THIS USER'S QUEUE")
  })
})

describe('the auction room', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.viewerRoster.mockResolvedValue('roster-2')
    mocks.pickFindMany.mockImplementation(async (args: { take?: number }) => (args?.take ? [] : [
      { overall: 1, rosterId: 'roster-2', playerName: 'Bijan Robinson', position: 'RB' },
      { overall: 2, rosterId: 'roster-1', playerName: 'CeeDee Lamb', position: 'WR' },
    ]))
    mocks.pickCount.mockResolvedValue(2)
  })

  it("says who is on the block, the bid, and everyone's money left", async () => {
    mocks.sessionFindUnique.mockResolvedValue(session({
      draftType: 'auction',
      rounds: 15,
      auctionBudgetPerTeam: 200,
      auctionBudgets: { 'roster-1': 140, 'roster-2': 155, 'roster-3': 200, 'roster-4': 200 },
      auctionState: { currentNomination: { playerName: 'Puka Nacua', position: 'WR', team: 'LAR', playerId: null }, currentBid: 31, currentBidderRosterId: 'roster-3', minNextBid: 32, bidTimerEndAt: null },
    }))
    const out = (await buildDraftContext('lg1', 'app-user-1'))!
    expect(out).toContain('ON THE BLOCK: Puka Nacua (WR, LAR), high bid $31 by Manager 3; next bid at least $32.')
    expect(out).toContain('THIS USER: $155 left for 14 open roster spots.')
    expect(out).toContain('Money left: Manager 3 $200 (15 open), Manager 4 $200 (15 open), Manager 1 $140 (14 open).')
    expect(out).not.toContain('ON THE CLOCK')
    expect(out).not.toContain('PICK CLOCK')
  })
})
