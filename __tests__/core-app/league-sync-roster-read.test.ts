// @vitest-environment node
/**
 * The Sync screen reads the five-minute rosters/transactions lane, not only the full pass.
 *
 * That lane keeps its own state row (`<runKey>:active`). Reading only the full row showed
 * "rosters last changed 7h ago" for a roster checked minutes earlier and found unchanged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  states: {} as Record<string, Record<string, unknown> | null>,
  rosterUpdatedAt: null as Date | null,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueSyncState: {
      findUnique: vi.fn(async (args: { where: { runKey: string } }) => h.states[args.where.runKey] ?? null),
    },
    roster: {
      findFirst: vi.fn(async () => (h.rosterUpdatedAt ? { updatedAt: h.rosterUpdatedAt } : null)),
    },
    weeklyMatchup: { findFirst: vi.fn(async () => null) },
    matchupFact: { findMany: vi.fn(async () => []) },
    syncJobRun: { findFirst: vi.fn(async () => null) },
  },
}))
vi.mock('@/lib/core-app/syncPreferences', () => ({ getPausedSyncKeys: vi.fn(async () => new Set<string>()) }))

import { getLeagueSync } from '@/lib/core-app/leagueSync'
import type { LeagueContext } from '@/lib/core-app/leagueContext'

const NOW = new Date('2026-09-27T18:00:00Z')
const L = 'league-1'
const U = 'user-1'
const FULL = 'sleeper:SL1:2026'
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)

function ctx(): LeagueContext {
  return {
    leagueId: L,
    userId: U,
    league: vi.fn(async () => ({
      id: L,
      name: 'Test League',
      platform: 'sleeper',
      platformLeagueId: 'SL1',
      season: 2026,
      lastSyncedAt: minsAgo(4),
      createdAt: new Date('2026-08-01T00:00:00Z'),
    })),
    claimedTeam: vi.fn(async () => ({ id: 'team-1' })),
    claimedTeams: vi.fn(async () => []),
  } as unknown as LeagueContext
}

async function load() {
  const result = await getLeagueSync(L, U, NOW, ctx())
  if (!result.available) throw new Error(`unavailable: ${result.reason}`)
  return result
}

const row = (r: Awaited<ReturnType<typeof load>>, key: string) => r.rows.find((x) => x.key === key)!.state

beforeEach(() => {
  h.states = {}
  h.rosterUpdatedAt = null
})

describe('Sync screen: the five-minute rosters/transactions read', () => {
  it('shows when the lane last read rosters, next to the full read', async () => {
    h.states[FULL] = { lastSuccessfulSyncAt: minsAgo(200), lastAttemptedSyncAt: minsAgo(200), consecutiveFailures: 0 }
    h.states[`${FULL}:active`] = { lastSuccessfulSyncAt: minsAgo(4) }

    const r = await load()
    expect(r.lastReadAt).toEqual(minsAgo(200))
    expect(r.rostersReadAt).toEqual(minsAgo(4))
  })

  it('a roster unchanged for hours but checked minutes ago reads as checked, not stale', async () => {
    h.states[FULL] = { lastSuccessfulSyncAt: minsAgo(200), lastAttemptedSyncAt: minsAgo(200), consecutiveFailures: 0 }
    h.states[`${FULL}:active`] = { lastSuccessfulSyncAt: minsAgo(4) }
    h.rosterUpdatedAt = minsAgo(7 * 60)

    const r = await load()
    expect(row(r, 'rosters')).toEqual({ kind: 'fresh', detail: 'checked 4m ago' })
    expect(row(r, 'transactions')).toEqual({ kind: 'fresh', detail: 'checked 4m ago' })
  })

  it('a roster that changed after the lane read keeps its own, newer timestamp', async () => {
    h.states[FULL] = { lastSuccessfulSyncAt: minsAgo(30), lastAttemptedSyncAt: minsAgo(30), consecutiveFailures: 0 }
    h.states[`${FULL}:active`] = { lastSuccessfulSyncAt: minsAgo(20) }
    h.rosterUpdatedAt = minsAgo(2)

    const r = await load()
    expect(row(r, 'rosters')).toEqual({ kind: 'fresh', detail: 'updated 2m ago' })
  })

  it("a later lane read clears the full pass's incomplete marker; an earlier one does not", async () => {
    h.states[FULL] = {
      lastSuccessfulSyncAt: minsAgo(300),
      lastAttemptedSyncAt: minsAgo(60),
      consecutiveFailures: 0,
      incompleteScopes: ['teams_rosters'],
    }
    h.states[`${FULL}:active`] = { lastSuccessfulSyncAt: minsAgo(5) }
    expect(row(await load(), 'rosters')).toEqual({ kind: 'fresh', detail: 'checked 5m ago' })

    h.states[`${FULL}:active`] = { lastSuccessfulSyncAt: minsAgo(90) }
    expect(row(await load(), 'rosters')).toEqual({ kind: 'stale', detail: 'did not complete on the last run' })
  })

  it('with no lane read there is no lane time, and the rows are exactly as before', async () => {
    h.states[FULL] = { lastSuccessfulSyncAt: minsAgo(200), lastAttemptedSyncAt: minsAgo(200), consecutiveFailures: 0 }
    h.rosterUpdatedAt = minsAgo(7 * 60)

    const r = await load()
    expect(r.rostersReadAt).toBeNull()
    expect(row(r, 'rosters')).toEqual({ kind: 'stale', detail: 'last changed 7h ago' })
  })

  it('a lane read older than six hours still reads as stale', async () => {
    h.states[FULL] = { lastSuccessfulSyncAt: minsAgo(600), lastAttemptedSyncAt: minsAgo(600), consecutiveFailures: 0 }
    h.states[`${FULL}:active`] = { lastSuccessfulSyncAt: minsAgo(8 * 60) }

    expect(row(await load(), 'transactions')).toEqual({ kind: 'stale', detail: 'last checked 8h ago' })
  })
})
