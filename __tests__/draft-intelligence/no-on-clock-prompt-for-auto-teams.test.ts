/**
 * A team on auto is not asked to pick (2026-11-21): it picks by itself within seconds of coming on
 * the clock, so the "you're on the clock, draft X?" message, card and urgent notification go only to
 * managers who will actually pick.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  snapshot: vi.fn(),
  rosterFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ buildSessionSnapshot: m.snapshot }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findUnique: m.rosterFindUnique },
    appUser: { findUnique: m.userFindUnique },
  },
}))

import { publishDraftIntelForUpcomingManagers } from '@/lib/draft-intelligence/DraftLookaheadService'

const snapshot = (autoDraftRosterIds: string[]) => ({
  currentPick: { overall: 1 },
  teamCount: 2,
  rounds: 1,
  draftType: 'snake',
  thirdRoundReversal: false,
  tradedPicks: [],
  slotOrder: [{ slot: 1, rosterId: 'r1', displayName: 'A' }, { slot: 2, rosterId: 'r2', displayName: 'B' }],
  autoDraftRosterIds,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.rosterFindUnique.mockResolvedValue({ platformUserId: null })
})

describe('publishDraftIntelForUpcomingManagers', () => {
  it('never looks up the manager of a team on auto', async () => {
    m.snapshot.mockResolvedValue(snapshot(['r1', 'r2']))
    expect(await publishDraftIntelForUpcomingManagers({ leagueId: 'L', trigger: 'pick_update' })).toEqual([])
    expect(m.rosterFindUnique).not.toHaveBeenCalled()
  })

  it('still looks up the managers who pick for themselves', async () => {
    m.snapshot.mockResolvedValue(snapshot(['r1']))
    await publishDraftIntelForUpcomingManagers({ leagueId: 'L', trigger: 'pick_update' })
    expect(m.rosterFindUnique.mock.calls.map((c) => c[0].where.id)).toEqual(['r2'])
  })
})
