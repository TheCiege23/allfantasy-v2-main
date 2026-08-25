import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sessionFindUnique: vi.fn(),
  pickFindMany: vi.fn(),
  pickCount: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findUnique: mocks.sessionFindUnique },
    draftPick: { findMany: mocks.pickFindMany, count: mocks.pickCount },
  },
}))

import { buildDraftContext } from '@/lib/chimmy/draftGrounding'

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
  })

  it('says the draft is live and who is on the clock', async () => {
    const out = await buildDraftContext('lg1', 'roster-1')

    expect(out).toContain('DRAFT IS LIVE RIGHT NOW')
    // 4 teams, 2 picks made -> overall 3 -> round 1 slot 3.
    expect(out).toContain('ON THE CLOCK: Manager 3')
    expect(out).toContain('1.03')
  })

  it('lists recent picks with the manager who made them', async () => {
    const out = await buildDraftContext('lg1', 'roster-1')
    expect(out).toContain('Manager 2 — Second Pick')
  })

  /* Paused means nobody is on the clock, and saying otherwise invents urgency. */
  it('reports a paused draft as having nobody on the clock', async () => {
    mocks.sessionFindUnique.mockResolvedValue(session({ status: 'paused' }))
    const out = await buildDraftContext('lg1', 'roster-1')

    expect(out).toContain('DRAFT IS PAUSED')
    expect(out).toMatch(/nobody is on the clock/i)
    expect(out).not.toContain('ON THE CLOCK:')
  })

  /*
   * A serpentine board does not describe an auction; there is no clock to be on.
   */
  it('refuses to name a clock for an auction', async () => {
    mocks.sessionFindUnique.mockResolvedValue(session({ draftType: 'auction' }))
    const out = await buildDraftContext('lg1', 'roster-1')

    expect(out).toMatch(/this is an AUCTION/i)
    expect(out).not.toContain('ON THE CLOCK:')
  })

  it('tells the user when their own next pick is', async () => {
    // Slot 1 in a 4-team snake: picks 1, then 8 (round 2 reversed).
    const out = await buildDraftContext('lg1', 'roster-1')
    expect(out).toContain('THIS USER drafts at slot 1')
  })

  it('stays quiet about the user when they match no draft slot', async () => {
    const out = await buildDraftContext('lg1', 'somebody-else')
    expect(out).toMatch(/could not be matched to a draft slot/i)
  })

  it('describes a scheduled draft without recommending picks', async () => {
    mocks.sessionFindUnique.mockResolvedValue(session({ status: 'pre_draft' }))
    mocks.pickCount.mockResolvedValue(0)
    mocks.pickFindMany.mockResolvedValue([])

    const out = await buildDraftContext('lg1', 'roster-1')

    expect(out).toContain('scheduled, NOT STARTED')
    expect(out).toContain('Draft order: 1. Manager 1')
    expect(out).toMatch(/Do NOT recommend specific picks/i)
  })

  it('will not suggest picks once the draft is over', async () => {
    mocks.sessionFindUnique.mockResolvedValue(session({ status: 'completed' }))
    const out = await buildDraftContext('lg1', 'roster-1')

    expect(out).toContain('DRAFT: COMPLETED')
    expect(out).toMatch(/Do NOT suggest who to draft next/i)
  })

  it('does not name a clock when the draft order is missing', async () => {
    mocks.sessionFindUnique.mockResolvedValue(session({ slotOrder: [] }))
    const out = await buildDraftContext('lg1', 'roster-1')

    expect(out).toMatch(/do NOT say who is on the clock/i)
  })

  it('returns null when the league has no draft session', async () => {
    mocks.sessionFindUnique.mockResolvedValue(null)
    expect(await buildDraftContext('lg1', 'roster-1')).toBeNull()
  })
})
