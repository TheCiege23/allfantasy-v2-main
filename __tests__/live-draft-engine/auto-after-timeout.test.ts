/**
 * 2026-11-24, owner's rule for every sport and draft type: a team whose clock runs out and is picked
 * for by the system stays on auto for the rest of the draft.
 *   - a team with a manager: their "Auto-pick me" is switched on (they can switch it off again);
 *   - a seat with no manager (open seat, imported orphan, AI-manager seat): any automatic pick of
 *     theirs in this draft keeps them on auto.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hm = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  rosterFindUnique: vi.fn(),
  rosterFindMany: vi.fn(),
  prefFindUnique: vi.fn(),
  prefFindMany: vi.fn(),
  prefUpsert: vi.fn(),
  pickFindFirst: vi.fn(),
  pickFindMany: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: hm.leagueFindUnique },
    roster: { findUnique: hm.rosterFindUnique, findMany: hm.rosterFindMany },
    liveDraftAutopickPreference: { findUnique: hm.prefFindUnique, findMany: hm.prefFindMany, upsert: hm.prefUpsert },
    draftPick: { findFirst: hm.pickFindFirst, findMany: hm.pickFindMany },
  },
}))
vi.mock('@/lib/inactive-manager/chimmyPlayable', () => ({ readPlayableChimmyLineups: vi.fn(async () => ({})) }))

import { instantAutopickReason, listAutoDraftRosterIds, markTeamAutoAfterTimeout } from '@/lib/live-draft-engine/instantAutopick'

beforeEach(() => {
  vi.clearAllMocks()
  hm.leagueFindUnique.mockResolvedValue({ settings: {} })
  hm.prefFindUnique.mockResolvedValue(null)
  hm.prefFindMany.mockResolvedValue([])
  hm.pickFindFirst.mockResolvedValue(null)
  hm.pickFindMany.mockResolvedValue([])
})

describe('a seat with no manager', () => {
  it('waits for its clock until the system has picked for it once, then picks at once', async () => {
    hm.rosterFindUnique.mockResolvedValue({ platformUserId: null, managerUserId: null })
    expect(await instantAutopickReason({ leagueId: 'L', draftSessionId: 'ds', rosterId: 'open-3' })).toBeNull()

    hm.pickFindFirst.mockResolvedValue({ id: 'pk-1' })
    expect(await instantAutopickReason({ leagueId: 'L', draftSessionId: 'ds', rosterId: 'open-3' })).toBe('computer_timed_out')
    expect(hm.pickFindFirst).toHaveBeenLastCalledWith({
      where: { sessionId: 'ds', rosterId: 'open-3', source: 'auto' },
      select: { id: true },
    })
  })

  it('imported orphans and AI-manager seats follow the same rule', async () => {
    hm.pickFindFirst.mockResolvedValue({ id: 'pk-1' })
    for (const key of ['orphan-sleeper-7', 'ai-manager-2']) {
      hm.rosterFindUnique.mockResolvedValue({ platformUserId: key, managerUserId: null })
      expect(await instantAutopickReason({ leagueId: 'L', draftSessionId: 'ds', rosterId: 'r' })).toBe('computer_timed_out')
    }
  })

  it('shows AUTO on the board once it has been picked for', async () => {
    hm.rosterFindMany.mockResolvedValue([
      { id: 'open-3', platformUserId: null, managerUserId: null },
      { id: 'open-4', platformUserId: null, managerUserId: null },
      { id: 'human', platformUserId: 'u1', managerUserId: null },
    ])
    hm.pickFindMany.mockResolvedValue([{ rosterId: 'open-3' }, { rosterId: 'human' }])
    expect(await listAutoDraftRosterIds({ leagueId: 'L', draftSessionId: 'ds' })).toEqual(['open-3'])
  })
})

describe('a team with a manager', () => {
  it('is NOT put on auto by an earlier automatic pick alone — only its own switch counts', async () => {
    hm.rosterFindUnique.mockResolvedValue({ platformUserId: 'u1', managerUserId: null })
    hm.pickFindFirst.mockResolvedValue({ id: 'pk-1' })
    expect(await instantAutopickReason({ leagueId: 'L', draftSessionId: 'ds', rosterId: 'r1' })).toBeNull()
  })

  it('a missed clock switches "Auto-pick me" on, keeping the mode they chose', async () => {
    hm.rosterFindUnique.mockResolvedValue({ platformUserId: 'u1', managerUserId: 'mgr-1' })
    expect(await markTeamAutoAfterTimeout({ draftSessionId: 'ds', rosterId: 'r1' })).toBe(true)
    expect(hm.prefUpsert).toHaveBeenCalledWith({
      where: { draft_session_user_unique: { draftSessionId: 'ds', userId: 'mgr-1' } },
      create: { draftSessionId: 'ds', userId: 'mgr-1', enabled: true, mode: 'standard' },
      update: { enabled: true },
    })
  })

  it('stores nothing for a seat with no manager', async () => {
    hm.rosterFindUnique.mockResolvedValue({ platformUserId: 'orphan-x', managerUserId: null })
    expect(await markTeamAutoAfterTimeout({ draftSessionId: 'ds', rosterId: 'r1' })).toBe(false)
    expect(hm.prefUpsert).not.toHaveBeenCalled()
  })
})
