import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Commissioner Workspace — the inactive-managers detector must be able to see the managers who
 * did nothing.
 *
 * 🛑 WHAT WAS BROKEN. `readManagerActivity` builds its answer from imported activity rows, so a
 * manager with no move in the last two 14-day windows is not in it at all. The detector could only
 * ever name managers who moved 15–28 days ago; the ones who stopped longest ago were invisible.
 * Measured on production 2026-09-16: a 12-team league with 4 active managers had a stored task
 * reading "2 managers inactive" — it never saw the other 6.
 *
 * ⚠ THESE GO THROUGH `detectLeagueTasks`, the function the daily scan calls, not only the helper.
 * A helper test would stay green if the scan stopped calling it.
 */

const mocks = vi.hoisted(() => ({
  readActivityWindow: vi.fn(),
  readManagerActivity: vi.fn(),
  teamFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: mocks.teamFindMany },
  },
}))

vi.mock('@/lib/league-history/leagueWarehouseReads', () => ({
  readActivityWindow: mocks.readActivityWindow,
  readManagerActivity: mocks.readManagerActivity,
}))

import { detectLeagueTasks, withSilentManagers } from '@/lib/commissioner-workspace/taskSources'
import { readOrphanTeamCounts } from '@/lib/commissioner-workspace/rosterReads'

const NOW = new Date('2026-09-16T12:00:00.000Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

type Team = {
  teamName: string | null
  ownerName: string | null
  isOrphan: boolean | null
  claimedByUserId: string | null
  platformUserId: string | null
}
const owned = (teamName: string, platformUserId: string): Team => ({
  teamName,
  ownerName: `${teamName}-owner`,
  isOrphan: false,
  claimedByUserId: null,
  platformUserId,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.readActivityWindow.mockResolvedValue({ lastActivityAt: daysAgo(1), tradeCount: 3, waiverCount: 9, eventCount: 250 })
  mocks.readManagerActivity.mockResolvedValue([])
  mocks.teamFindMany.mockResolvedValue([])
})

describe('the inactive-managers task names managers with no moves at all', () => {
  it('names a manager the move read never listed', async () => {
    mocks.readManagerActivity.mockResolvedValue([
      { managerName: 'Ada', currentCount: 5, priorCount: 2 },
      // Moved 15–28 days ago: the only kind of idle manager the old detector could see.
      { managerName: 'Bea', currentCount: 0, priorCount: 3 },
    ])
    mocks.teamFindMany.mockResolvedValue([owned('Ada', 'p1'), owned('Bea', 'p2'), owned('Cy', 'p3')])

    const tasks = await detectLeagueTasks('lg-1', NOW)
    const inactive = tasks.find((t) => t.sourceKey === 'inactive-managers:v1')

    expect(inactive?.title).toBe('2 managers inactive for 14 days')
    expect(inactive?.description).toContain('Bea and Cy')
  })

  it('does not report the whole league idle when the move read could not map anyone', async () => {
    // A current feed with no mapped managers is a roster-snapshot gap, not twelve idle people.
    mocks.readManagerActivity.mockResolvedValue([])
    mocks.teamFindMany.mockResolvedValue([owned('Ada', 'p1'), owned('Bea', 'p2')])

    const tasks = await detectLeagueTasks('lg-1', NOW)

    expect(tasks.find((t) => t.sourceKey === 'inactive-managers:v1')).toBeUndefined()
  })

  it('never reads managers at all on a stale feed, supplement or not', async () => {
    mocks.readActivityWindow.mockResolvedValue({ lastActivityAt: daysAgo(20), tradeCount: 0, waiverCount: 0, eventCount: 250 })
    mocks.teamFindMany.mockResolvedValue([owned('Ada', 'p1'), owned('Bea', 'p2')])

    const tasks = await detectLeagueTasks('lg-1', NOW)

    expect(mocks.readManagerActivity).not.toHaveBeenCalled()
    expect(tasks.map((t) => t.sourceKey)).toEqual(['data-stale:v1'])
  })

  it('does not count an empty seat as a silent manager', async () => {
    mocks.readManagerActivity.mockResolvedValue([{ managerName: 'Ada', currentCount: 5, priorCount: 0 }])
    mocks.teamFindMany.mockResolvedValue([
      owned('Ada', 'p1'),
      { teamName: 'Unknown', ownerName: 'Unknown', isOrphan: true, claimedByUserId: null, platformUserId: null },
    ])

    const tasks = await detectLeagueTasks('lg-1', NOW)

    expect(tasks.find((t) => t.sourceKey === 'inactive-managers:v1')).toBeUndefined()
    expect(tasks.find((t) => t.sourceKey === 'orphan-teams:v1')?.title).toBe('One team has no manager')
  })
})

describe('empty seats', () => {
  it('an orphan flag on a team somebody holds is not an empty seat', async () => {
    // Production: a team flagged isOrphan was claimed by the league's own owner.
    mocks.teamFindMany.mockResolvedValue([
      { teamName: 'Mine', ownerName: 'me', isOrphan: true, claimedByUserId: 'u1', platformUserId: 'p1' },
      { teamName: 'Linked', ownerName: 'x', isOrphan: true, claimedByUserId: null, platformUserId: 'p2' },
      { teamName: 'Empty', ownerName: null, isOrphan: true, claimedByUserId: null, platformUserId: null },
      // NULL is "never decided", not "orphan".
      { teamName: 'Legacy', ownerName: null, isOrphan: null, claimedByUserId: null, platformUserId: null },
    ])

    const counts = await readOrphanTeamCounts('lg-1')

    expect(counts).toEqual({ totalTeams: 4, orphanCount: 1, ownedTeamNames: ['Mine', 'Linked', 'Legacy'] })
  })

  it('degrades to zeroes instead of failing the scan', async () => {
    mocks.teamFindMany.mockRejectedValue(new Error('db down'))
    await expect(readOrphanTeamCounts('lg-1')).resolves.toEqual({ totalTeams: 0, orphanCount: 0, ownedTeamNames: [] })
  })
})

describe('withSilentManagers', () => {
  it('adds owned teams missing from the move read, once, spelled as the read spells them', () => {
    const out = withSilentManagers(
      [
        { managerName: 'Ada', currentCount: 2 },
        { managerName: 'bea-owner', currentCount: 0 },
      ],
      ['Ada', 'bea-owner', 'Cy'],
    )
    expect(out).toEqual([
      { managerName: 'Ada', currentCount: 2 },
      { managerName: 'bea-owner', currentCount: 0 },
      { managerName: 'Cy', currentCount: 0 },
    ])
  })

  it('adds nobody when the move read named nobody', () => {
    expect(withSilentManagers([], ['Ada', 'Cy'])).toEqual([])
  })
})
