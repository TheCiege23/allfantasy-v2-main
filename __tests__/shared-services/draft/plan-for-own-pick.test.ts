/**
 * A pick before the draft, and a pick for your own turn (re-score build item 8, 2026-11-19).
 *
 * The decision used to rank the pool at the pick on the clock — before the draft that is overall pick 1, so a
 * manager drafting tenth was told to take the one player certain to be gone. Off the clock it now plans for the
 * roster's next turn, with the players ADP has going in the picks before it left out.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  league: vi.fn(),
  session: vi.fn(),
  roster: vi.fn(),
  picks: vi.fn(),
  adp: vi.fn(),
  template: vi.fn(),
  pool: vi.fn(),
  idp: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: m.league },
    draftSession: { findUnique: m.session, findFirst: m.session },
    roster: { findUnique: m.roster },
    draftPick: { findMany: m.picks },
  },
}))
vi.mock('@/lib/adp/readSnapshotForLeague', () => ({ readAllFantasyAdpForLeague: m.adp }))
vi.mock('@/lib/multi-sport/RosterTemplateService', () => ({ getRosterTemplate: m.template }))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({ getPlayerPoolForLeague: m.pool }))
vi.mock('@/lib/idp', () => ({ isIdpLeague: m.idp }))

import { buildDraftDecisionContext } from '@/lib/shared-services/draft/DraftContextAssembler'
import { ownDraftSlot, planOwnNextPick, poolAtPlannedPick, slotAtOverall } from '@/lib/shared-services/draft/planForOwnPick'
import { runDraftPickDecision } from '@/lib/decision-os/draft'
import { plannedForLine } from '@/components/app/draft-room/DraftDecisionOsCard'

describe('ownDraftSlot', () => {
  it('reads the slot order, then falls back to one of the roster’s own picks', () => {
    const ids = new Set(['me', 'sleeper-me'])
    expect(ownDraftSlot({ slotOrder: [{ slot: 1, rosterId: 'a' }, { slot: 10, rosterId: 'me' }], ownIds: ids, picks: [] })).toBe(10)
    expect(ownDraftSlot({ slotOrder: [], ownIds: ids, picks: [{ rosterId: 'sleeper-me', slot: 4 }] })).toBe(4)
    expect(ownDraftSlot({ slotOrder: 'not an array', ownIds: ids, picks: [] })).toBeNull()
  })
})

describe('planOwnNextPick', () => {
  const base = { draftType: 'snake', totalTeams: 12, rounds: 15 }

  it('before the draft: the roster’s first pick, however far down the order it is', () => {
    expect(planOwnNextPick({ ...base, status: 'pre_draft', currentOverall: 1, ownSlot: 10 })).toEqual({
      overall: 10,
      round: 1,
      pickInRound: 10,
      picksAway: 9,
      fromOverall: 1,
    })
    // First up: still a plan (the draft has not started), with nobody picking before it.
    expect(planOwnNextPick({ ...base, status: 'pre_draft', currentOverall: 1, ownSlot: 1 })).toMatchObject({ overall: 1, picksAway: 0 })
  })

  it('mid-draft, off the clock: the next turn, by snake order', () => {
    // 12-team snake, slot 10: picks 10, 15, 34… On the clock: overall 13 (round 2, slot 12).
    expect(planOwnNextPick({ ...base, status: 'in_progress', currentOverall: 13, ownSlot: 10 })).toMatchObject({
      overall: 15,
      round: 2,
      pickInRound: 3,
      picksAway: 2,
    })
    // Linear: slot 10 again picks tenth in round 2.
    expect(planOwnNextPick({ ...base, draftType: 'linear', status: 'in_progress', currentOverall: 13, ownSlot: 10 })).toMatchObject({ overall: 22 })
  })

  it('stays on the pick being made when the roster is on the clock, and plans nothing it cannot', () => {
    expect(slotAtOverall(10, 12, true)).toBe(10)
    expect(planOwnNextPick({ ...base, status: 'in_progress', currentOverall: 10, ownSlot: 10 })).toBeNull()
    expect(planOwnNextPick({ ...base, status: 'completed', currentOverall: 180, ownSlot: 10 })).toBeNull()
    expect(planOwnNextPick({ ...base, draftType: 'auction', status: 'pre_draft', currentOverall: 1, ownSlot: 10 })).toBeNull()
    expect(planOwnNextPick({ ...base, status: 'pre_draft', currentOverall: 1, ownSlot: null })).toBeNull()
    // The last turn has passed: 2 rounds of 12, slot 10 already picked at 15; on the clock at 20.
    expect(planOwnNextPick({ ...base, rounds: 2, status: 'in_progress', currentOverall: 20, ownSlot: 10 })).toBeNull()
  })
})

describe('poolAtPlannedPick', () => {
  it('leaves out as many players as there are picks before yours, lowest real ADP first, and keeps the rest in order', () => {
    const pool = [
      { name: 'C', adp: 3 },
      { name: 'NoAdp', adp: null },
      { name: 'A', adp: 1 },
      { name: 'D', adp: 4 },
      { name: 'B', adp: 2 },
    ]
    const out = poolAtPlannedPick(pool, 2)
    expect(out.leftOut).toBe(2)
    expect(out.pool.map((p) => p.name)).toEqual(['C', 'NoAdp', 'D'])
    expect(poolAtPlannedPick(pool, 0).pool).toHaveLength(5)
    // Never more than the players with ADP: nobody can say when an unpriced player goes.
    expect(poolAtPlannedPick(pool, 9)).toMatchObject({ leftOut: 4 })
  })
})

describe('buildDraftDecisionContext — planForOwnTurn', () => {
  const entries = Array.from({ length: 12 }, (_, i) => ({ playerName: `Player ${i + 1}`, position: 'RB', team: null, adp: i + 1 }))

  beforeEach(() => {
    vi.clearAllMocks()
    m.league.mockResolvedValue({ sport: 'NFL', platform: 'native', isDynasty: false, settings: {}, starters: null, season: 2026 })
    m.roster.mockResolvedValue({ platformUserId: 'u1' })
    m.picks.mockResolvedValue([])
    m.adp.mockResolvedValue({ entries, totalDrafts: 40, computedAt: null, contextHash: '', draftMode: 'real' })
    m.template.mockResolvedValue({ slots: [{ slotName: 'RB', allowedPositions: ['RB'], starterCount: 2 }] })
    m.pool.mockResolvedValue([])
    m.idp.mockResolvedValue(false)
  })

  const preDraft = { id: 's1', status: 'pre_draft', draftType: 'snake', rounds: 15, teamCount: 12, nextOverallPick: 1, currentRoundNum: 1, devyConfig: null, slotOrder: [{ slot: 10, rosterId: 'roster-1' }] }

  it('before the draft, for a manager drafting tenth: ranks for pick 1.10, without the nine players ADP has going first', async () => {
    m.session.mockResolvedValue(preDraft)
    const ctx = await buildDraftDecisionContext({ leagueId: 'lg1', rosterId: 'roster-1', planForOwnTurn: true })
    expect(ctx.plannedFor).toEqual({ overall: 10, round: 1, pickInRound: 10, picksAway: 9, leftOut: 9, fromOverall: 1 })
    expect(ctx.pick).toBe(10)
    expect(ctx.engineInput.round).toBe(1)
    expect(ctx.engineInput.pick).toBe(10)
    expect(ctx.engineInput.available.map((p) => p.name)).toEqual(['Player 10', 'Player 11', 'Player 12'])
  })

  it('without the option — the pick outlook and the shadow compare — the pool is the board as it stands', async () => {
    m.session.mockResolvedValue(preDraft)
    const ctx = await buildDraftDecisionContext({ leagueId: 'lg1', rosterId: 'roster-1' })
    expect(ctx.plannedFor).toBeNull()
    expect(ctx.pick).toBe(1)
    expect(ctx.engineInput.available).toHaveLength(12)
  })

  it('on the clock, nothing is planned: the pick being made is the roster’s', async () => {
    m.session.mockResolvedValue({ ...preDraft, status: 'in_progress', nextOverallPick: 10 })
    const ctx = await buildDraftDecisionContext({ leagueId: 'lg1', rosterId: 'roster-1', planForOwnTurn: true })
    expect(ctx.plannedFor).toBeNull()
    expect(ctx.pick).toBe(10)
    expect(ctx.engineInput.available).toHaveLength(12)
  })
})

describe('the decision says which pick it is for', () => {
  const snapshot = { id: 's1', status: 'pre_draft', draftType: 'snake', rounds: 15, teamCount: 12, picks: [], currentPick: null } as never
  const recommend = () => ({
    recommendation: { player: { name: 'Player 10', position: 'RB', team: null, adp: 10 }, reason: 'Best left', confidence: 80, needScore: 1, adpEdge: 0, adpIsReal: true },
    alternatives: [],
    reachWarning: null, valueWarning: null, scarcityInsight: null, stackInsight: null, correlationInsight: null, formatInsight: null, byeNote: null,
    explanation: '', evidence: [], caveats: [], uncertainty: null,
  })
  const run = (plannedOverall: number | null) =>
    runDraftPickDecision(
      {
        worldInput: { snapshot, rosterId: 'me', picksUntilTurn: 9, plannedOverall },
        userId: 'u1',
        leagueId: 'lg1',
        sport: 'NFL',
        engineInput: { available: [], teamRoster: [], round: 1, pick: 10, totalTeams: 12, sport: 'NFL' } as never,
        coverage: { availablePoolSize: 3, adpSampleTotal: 40, rosterPickCount: 0, unresolvedPlayerIdCount: 0 } as never,
      },
      { recommend: recommend as never, ruleDeps: { validateRosterFit: async () => ({ valid: true }) } },
    )

  it('names the planned pick, and that the draft has not started', async () => {
    const { decision } = await run(10)
    expect(decision.four_answers.what_happened).toContain('ranked for your pick 10')
    expect(decision.four_answers.what_to_do).toBe('The draft has not started yet. Queue Player 10 for then.')
  })

  it('without a plan it reads as before', async () => {
    const { decision } = await run(null)
    expect(decision.four_answers.what_happened).toContain('ranked for your next pick')
  })
})

describe('the card’s line', () => {
  it('says the pick, how far away it is, and what was left out', () => {
    expect(plannedForLine({ overall: 10, round: 1, pickInRound: 10, picksAway: 9, leftOut: 9 })).toBe(
      'Planned for your next pick, 1.10 (overall 10) — 9 picks away. Left out: the 9 players ADP has going in the picks before yours.',
    )
    expect(plannedForLine({ overall: 1, round: 1, pickInRound: 1, picksAway: 0, leftOut: 0 })).toBe('Planned for your next pick, 1.01 (overall 1).')
  })
})
