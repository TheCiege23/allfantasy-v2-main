/**
 * Draft like me learns only from picks the manager made (2026-11-21). One manager's history was 16
 * picks of which 14 were auto-picks, so Chimmy learned Chimmy's own RB-first picks and repeated them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  rosterFindFirst: vi.fn(),
  rosterFindMany: vi.fn(),
  sessionFindFirst: vi.fn(),
  sessionFindMany: vi.fn(),
  pickFindMany: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findFirst: m.rosterFindFirst, findMany: m.rosterFindMany },
    draftSession: { findFirst: m.sessionFindFirst, findMany: m.sessionFindMany },
    draftPick: { findMany: m.pickFindMany },
  },
}))
vi.mock('@/lib/draft-room/adpAtPick', () => ({ readLeaguePoolEntries: vi.fn(async () => []) }))
vi.mock('@/lib/draft-room/draftPlayerAges', () => ({ loadDraftPlayerAges: vi.fn(async () => new Map()), draftMeanAges: vi.fn(() => new Map()) }))

import { isOwnPick, loadManagerPastPicks } from '@/lib/draft-room/managerHistoryReads'

const pick = (overall: number, source: string | null, position = 'RB') => ({
  sessionId: 'old', overall, playerId: `p${overall}`, playerName: `P${overall}`, position, pickMetadata: { adpAtPick: overall + 2 }, source,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.rosterFindFirst.mockResolvedValue({ platformUserId: 'manager-1' })
  m.rosterFindMany.mockResolvedValue([{ id: 'r-old', leagueId: 'L-old' }])
  m.sessionFindFirst.mockResolvedValue({ id: 'now', sportType: 'NFL' })
  m.sessionFindMany.mockResolvedValue([{ id: 'old', leagueId: 'L-old', league: { name: 'Alpha League' } }])
})

describe('isOwnPick', () => {
  it("a person's pick in the app or on Sleeper, or a legacy row, counts; the clock's or a commissioner's does not", () => {
    expect(['user', 'sleeper-mirror', null, undefined, ''].map(isOwnPick)).toEqual([true, true, true, true, true])
    expect(['auto', 'strategy-autopick', 'commissioner'].map(isOwnPick)).toEqual([false, false, false])
  })
})

describe('loadManagerPastPicks', () => {
  it('drops auto-picks and commissioner picks, and names the draft each pick came from', async () => {
    m.pickFindMany.mockResolvedValueOnce([pick(1, 'user', 'WR'), pick(8, 'auto'), pick(9, 'auto'), pick(16, 'sleeper-mirror', 'QB'), pick(17, 'commissioner')])
    m.pickFindMany.mockResolvedValueOnce([])
    const past = await loadManagerPastPicks('L-now', 'r-now')
    expect(past.map((p) => [p.overall, p.position, p.leagueName])).toEqual([[1, 'WR', 'Alpha League'], [16, 'QB', 'Alpha League']])
    expect(m.pickFindMany.mock.calls[0][0].select).toMatchObject({ source: true })
  })
})
