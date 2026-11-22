// @vitest-environment node
/** Which queue or watchlist a manager is on: their own id with one team, the team's own key with several. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ rosters: [] as Array<Record<string, any>>, onClock: null as string | null, remembered: [] as string[] }))
vi.mock('@/lib/prisma', () => {
  const managed = (where: any, r: any) =>
    (!where.leagueId || r.leagueId === where.leagueId) &&
    (!where.id || r.id === where.id) &&
    (!where.OR || where.OR.some((alt: any) => Object.entries(alt).every(([k, v]) => r[k] === v))) &&
    (!where.platformUserId || r.platformUserId === where.platformUserId)
  return {
    prisma: {
      roster: {
        findMany: async ({ where }: any) => h.rosters.filter((r) => managed(where, r)).sort((a, b) => a.id.localeCompare(b.id)),
        findFirst: async ({ where }: any) => h.rosters.find((r) => managed(where, r)) ?? null,
        findUnique: async ({ where }: any) => h.rosters.find((r) => r.id === where.id) ?? null,
      },
      draftSession: { findUnique: async () => ({ leagueId: 'L1' }) },
    },
  }
})
vi.mock('@/lib/team-coowners/access', () => ({ acceptedCoOwnerRosterId: async () => null, isAcceptedCoOwnerForRoster: async () => false }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: async () => false }))
vi.mock('@/lib/live-draft-engine/onClockRoster', async (original) => ({
  ...(await original<object>()),
  resolveOnClockRosterIdForLeague: async () => h.onClock,
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (h.remembered.length ? { value: h.remembered.join('.') } : undefined) }) }))

import { draftQueueKeyForRoster, draftQueueKeyForSession, draftQueueKeyForUser, watchlistKeyForUser } from '@/lib/league/teamScopedKey'

const FIRST = { id: 'roster-aaaa1', leagueId: 'L1', platformUserId: 'u1', managerUserId: 'u1', redraftRosterId: null }
const SECOND = { id: 'roster-bbbb2', leagueId: 'L1', platformUserId: 'mgr:u1:roster-bbbb2', managerUserId: 'u1', redraftRosterId: null }

beforeEach(() => { h.rosters = [FIRST]; h.onClock = null; h.remembered = [] })

describe('with one team', () => {
  it('the queue and the watchlist stay under the manager\'s own id', async () => {
    expect(await draftQueueKeyForUser('L1', 'u1')).toBe('u1')
    expect(await watchlistKeyForUser('L1', 'u1')).toBe('u1')
    expect(await draftQueueKeyForSession('session-1', 'u1')).toBe('u1')
  })
})

describe('with two teams', () => {
  beforeEach(() => { h.rosters = [FIRST, SECOND] })

  it('the draft queue is the queue of their team on the clock', async () => {
    h.onClock = SECOND.id
    expect(await draftQueueKeyForUser('L1', 'u1')).toBe('team:roster-bbbb2')
    h.onClock = FIRST.id
    expect(await draftQueueKeyForUser('L1', 'u1')).toBe('u1')
  })

  it('with someone else on the clock, it is the team they switched to, else their first', async () => {
    h.onClock = 'someone-elses'
    h.remembered = [SECOND.id]
    expect(await draftQueueKeyForUser('L1', 'u1')).toBe('team:roster-bbbb2')
    h.remembered = []
    expect(await draftQueueKeyForUser('L1', 'u1')).toBe('u1')
  })

  it('the watchlist follows the team named, else the team they switched to', async () => {
    expect(await watchlistKeyForUser('L1', 'u1', SECOND.id)).toBe('team:roster-bbbb2')
    expect(await watchlistKeyForUser('L1', 'u1', FIRST.id)).toBe('u1')
    h.remembered = [SECOND.id]
    expect(await watchlistKeyForUser('L1', 'u1')).toBe('team:roster-bbbb2')
  })

  it('the draft engine reads the on-the-clock team\'s own queue', async () => {
    expect(await draftQueueKeyForRoster(FIRST.id)).toBe('u1')
    expect(await draftQueueKeyForRoster(SECOND.id)).toBe('team:roster-bbbb2')
    expect(await draftQueueKeyForRoster('missing')).toBeNull()
  })
})
