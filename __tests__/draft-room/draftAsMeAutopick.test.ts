/** Draft as me — the plan and commissioner switch, and the history it reads. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => ({
  league: vi.fn(),
  hasAccess: vi.fn(async () => ({ hasAccess: true })),
  pastPicks: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: m.league } } }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({ EntitlementResolver: class { resolveForUser = m.hasAccess } }))
vi.mock('@/lib/draft-room/managerHistoryReads', () => ({ loadManagerPastPicks: m.pastPicks }))

import { describeDraftStyle, tryDraftAsMePick } from '@/lib/draft-room/draftAsMeAutopick'

const history = Array.from({ length: 12 }, (_, i) => ({ overall: 20 + i * 10, adpAtPick: 26 + i * 10, position: i % 2 ? 'WR' : 'RB' }))
const board = [
  { playerName: 'A', position: 'RB', team: 'X', playerId: 'a', byeWeek: null, adp: 30 },
  { playerName: 'B', position: 'WR', team: 'X', playerId: 'b', byeWeek: null, adp: 36 },
  { playerName: 'C', position: 'QB', team: 'X', playerId: 'c', byeWeek: null, adp: 40 },
]
const args = { leagueId: 'L', rosterId: 'r1', overall: 30, board, ownPositions: [] as string[] }

beforeEach(() => {
  vi.clearAllMocks()
  m.league.mockResolvedValue({ userId: 'owner', settings: {} })
  m.hasAccess.mockResolvedValue({ hasAccess: true })
  m.pastPicks.mockResolvedValue(history)
})

describe('tryDraftAsMePick', () => {
  it('picks like the manager on the league owner\'s plan, and says why', async () => {
    const pick = await tryDraftAsMePick(args)
    // This manager reaches ~6 picks early on average, so at pick 30 they take the player at 36.
    expect(pick).toMatchObject({ playerName: 'B', reason: expect.stringContaining('6 picks before their ADP') })
    expect(m.hasAccess).toHaveBeenCalledWith('owner', 'commissioner_draft_as_me')
  })

  it('is off without the plan, when the commissioner switches it off, or without history', async () => {
    m.hasAccess.mockResolvedValueOnce({ hasAccess: false })
    expect(await tryDraftAsMePick(args)).toBeNull()
    m.league.mockResolvedValueOnce({ userId: 'owner', settings: { draft_as_me: false } })
    expect(await tryDraftAsMePick(args)).toBeNull()
    m.pastPicks.mockResolvedValueOnce(history.slice(0, 3))
    expect(await tryDraftAsMePick(args)).toBeNull()
  })
})

describe('describeDraftStyle', () => {
  it('reads as plain English', () => {
    expect(describeDraftStyle({ reachDelta: 7.4, positionShare: { RB: 0.6, WR: 0.4 }, sample: 12 })).toBe(
      'Picked the way you draft: you usually wait about 7 picks past ADP for value, and 60% of your picks are RBs.',
    )
  })
})
