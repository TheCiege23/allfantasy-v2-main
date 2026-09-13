// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hm = vi.hoisted(() => ({
  zombieLeagueFindUnique: vi.fn(),
  rosterFindFirst: vi.fn(),
  zombieLeagueTeamFindMany: vi.fn(),
  getLeagueRole: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    zombieLeague: { findUnique: hm.zombieLeagueFindUnique },
    roster: { findFirst: hm.rosterFindFirst },
    zombieLeagueTeam: { findMany: hm.zombieLeagueTeamFindMany },
  },
}))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: hm.getLeagueRole }))

import { resolveWhispererViewer } from '@/lib/zombie/whispererViewer'

function league(overrides: Record<string, unknown> = {}) {
  return {
    whispererIsPublic: false,
    whispererRecord: { userId: 'user-whisperer', isPubliclyRevealed: true },
    ...overrides,
  }
}

describe('resolveWhispererViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.zombieLeagueFindUnique.mockResolvedValue(league())
    hm.getLeagueRole.mockResolvedValue('member')
    hm.rosterFindFirst.mockResolvedValue({ id: 'roster-member' })
    hm.zombieLeagueTeamFindMany.mockResolvedValue([{ rosterId: 'roster-whisperer' }])
  })

  it('hides the Whisperer from a member of a secret league and returns its identity', async () => {
    const viewer = await resolveWhispererViewer('league-1', 'user-member')
    expect(viewer.canSee).toBe(false)
    expect([...viewer.identity.rosterIds]).toEqual(['roster-whisperer'])
    expect([...viewer.identity.userIds]).toEqual(['user-whisperer'])
  })

  it('lets the head commissioner see', async () => {
    hm.getLeagueRole.mockResolvedValueOnce('commissioner')
    expect((await resolveWhispererViewer('league-1', 'user-comm')).canSee).toBe(true)
  })

  it('lets the Whisperer see, recognised by record', async () => {
    hm.rosterFindFirst.mockResolvedValueOnce(null)
    expect((await resolveWhispererViewer('league-1', 'user-whisperer')).canSee).toBe(true)
  })

  it('lets the Whisperer see, recognised by roster', async () => {
    hm.zombieLeagueFindUnique.mockResolvedValueOnce(league({ whispererRecord: null }))
    hm.rosterFindFirst.mockResolvedValueOnce({ id: 'roster-whisperer' })
    expect((await resolveWhispererViewer('league-1', 'user-other-id')).canSee).toBe(true)
  })

  it('lets a member of a public league see once revealed', async () => {
    hm.zombieLeagueFindUnique.mockResolvedValueOnce(league({ whispererIsPublic: true }))
    expect((await resolveWhispererViewer('league-1', 'user-member')).canSee).toBe(true)
  })

  it('fails closed when the database read throws', async () => {
    hm.zombieLeagueFindUnique.mockRejectedValueOnce(new Error('db down'))
    const viewer = await resolveWhispererViewer('league-1', 'user-member')
    expect(viewer.canSee).toBe(false)
    expect(viewer.identity.rosterIds.size).toBe(0)
  })
})
