import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * What a league's SECOND draft does to rosters.
 *  - A rookie draft ADDS to a dynasty roster; it used to replace `draftPicks` (the roster
 *    fallback) with four rookies and leave them out of the lineup entirely.
 *  - A keeper league's year-two draft REBUILDS the lineup; "keep an existing lineup" used to keep
 *    last year's.
 */

const m = vi.hoisted(() => ({
  sessionFindFirst: vi.fn(),
  sessionCount: vi.fn(),
  rosterFindFirst: vi.fn(),
  rosterUpdate: vi.fn(),
  template: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findFirst: m.sessionFindFirst, count: m.sessionCount },
    roster: { findFirst: m.rosterFindFirst, update: m.rosterUpdate },
  },
}))
vi.mock('@/lib/league/league-draft-template-payload', () => ({ getLeagueDraftTemplatePayload: m.template }))

import { addFollowUpDraftPlayers, finalizeRosterAssignments } from '@/lib/live-draft-engine/RosterAssignmentService'

const template = {
  slots: [
    { slotName: 'QB', starterCount: 1, allowedPositions: ['QB'], slotOrder: 1 },
    { slotName: 'RB', starterCount: 1, allowedPositions: ['RB'], slotOrder: 2 },
  ],
}

const pick = (overall: number, playerId: string, position: string, rosterId = 'R-a') => ({
  overall,
  rosterId,
  playerId,
  playerName: `Player ${playerId}`,
  position,
  team: 'DAL',
  byeWeek: null,
  pickMetadata: null,
})

const lastYear = {
  players: ['q1', 'r1', 'r2'],
  starters: ['q1', 'r1'],
  lineup_sections: {
    starters: [
      { id: 'q1', name: 'Player q1', position: 'QB', team: 'DAL' },
      { id: 'r1', name: 'Player r1', position: 'RB', team: 'DAL' },
    ],
    bench: [{ id: 'r2', name: 'Player r2', position: 'RB', team: 'DAL' }],
    ir: [],
    taxi: [],
    devy: [],
  },
  draftPicks: [
    { playerId: 'q1', playerName: 'Player q1', position: 'QB' },
    { playerId: 'r1', playerName: 'Player r1', position: 'RB' },
    { playerId: 'r2', playerName: 'Player r2', position: 'RB' },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  m.template.mockResolvedValue({ template })
  m.rosterUpdate.mockResolvedValue({})
})

describe('a follow-up draft adds to rosters', () => {
  it('appends to draftPicks and the bench, keeps the lineup, and is idempotent', () => {
    const rookies = [
      { playerId: 'rk1', playerName: 'Rookie One', position: 'RB', team: 'NYG' },
      { playerId: 'rk2', playerName: 'Rookie Two', position: 'WR', team: 'SEA' },
    ]
    const once = addFollowUpDraftPlayers(lastYear, rookies, template as never)
    expect((once.draftPicks as unknown[]).length).toBe(5)
    expect(once.starters).toEqual(['q1', 'r1'])
    const bench = (once.lineup_sections as { bench: Array<{ id: string }> }).bench.map((p) => p.id)
    expect(bench).toEqual(['r2', 'rk1', 'rk2'])
    expect(once.players).toEqual(['q1', 'r1', 'r2', 'rk1', 'rk2'])

    const twice = addFollowUpDraftPlayers(once, rookies, template as never)
    expect(twice.draftPicks).toEqual(once.draftPicks)
    expect((twice.lineup_sections as { bench: unknown[] }).bench).toHaveLength(3)
  })

  it('finalizing a rookie draft goes through the add path, not the replace path', async () => {
    m.sessionFindFirst.mockResolvedValue({
      id: 'draft-2',
      status: 'completed',
      draftModeLabel: 'rookie',
      createdAt: new Date('2027-05-01'),
      picks: [pick(1, 'rk1', 'RB')],
    })
    m.sessionCount.mockResolvedValue(1)
    m.rosterFindFirst.mockResolvedValue({ id: 'R-a', playerData: lastYear })

    await finalizeRosterAssignments('L1')

    const written = m.rosterUpdate.mock.calls[0]![0].data.playerData as typeof lastYear
    expect(written.draftPicks.map((p) => p.playerId)).toEqual(['q1', 'r1', 'r2', 'rk1'])
    expect(written.starters).toEqual(['q1', 'r1'])
  })
})

describe("a full draft after another draft rebuilds the lineup", () => {
  const yearTwo = {
    id: 'draft-2',
    status: 'completed',
    draftModeLabel: 'standard',
    createdAt: new Date('2027-08-20'),
    picks: [pick(1, 'q9', 'QB'), pick(2, 'r9', 'RB')],
  }

  it("replaces last year's lineup (legacy roster with no marker, earlier draft exists)", async () => {
    m.sessionFindFirst.mockResolvedValue(yearTwo)
    m.sessionCount.mockResolvedValue(1)
    m.rosterFindFirst.mockResolvedValue({ id: 'R-a', playerData: lastYear })

    await finalizeRosterAssignments('L1')

    const written = m.rosterUpdate.mock.calls[0]![0].data.playerData as Record<string, unknown>
    expect(written.starters).toEqual(['q9', 'r9'])
    expect(written.lineup_draft_session_id).toBe('draft-2')
  })

  it('keeps a lineup this same draft built (a re-run must not clobber manual edits)', async () => {
    m.sessionFindFirst.mockResolvedValue(yearTwo)
    m.sessionCount.mockResolvedValue(1)
    const edited = { ...lastYear, starters: ['q9', 'bench-guy'], lineup_draft_session_id: 'draft-2' }
    m.rosterFindFirst.mockResolvedValue({ id: 'R-a', playerData: edited })

    await finalizeRosterAssignments('L1')

    const written = m.rosterUpdate.mock.calls[0]![0].data.playerData as Record<string, unknown>
    expect(written.starters).toEqual(['q9', 'bench-guy'])
  })

  it("keeps the first draft's own lineup on a re-run (no earlier draft)", async () => {
    m.sessionFindFirst.mockResolvedValue({ ...yearTwo, id: 'draft-1', createdAt: new Date('2026-08-20') })
    m.sessionCount.mockResolvedValue(0)
    m.rosterFindFirst.mockResolvedValue({ id: 'R-a', playerData: lastYear })

    await finalizeRosterAssignments('L1')

    const written = m.rosterUpdate.mock.calls[0]![0].data.playerData as Record<string, unknown>
    expect(written.starters).toEqual(['q1', 'r1'])
  })
})
