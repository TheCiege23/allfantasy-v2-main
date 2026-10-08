// @vitest-environment node
/**
 * "First kickoff" on the home names a Top-25 college game, never an unranked one (founder, 2026-10-08).
 * Live on 10-08 it read "Sam Houston at Liberty" over Bucs–Cowboys because the unranked Thursday game
 * kicked off first.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
vi.mock('@/lib/injuries/injurySyncState', () => ({ readInjurySyncFreshness: async () => null }))
vi.mock('@/lib/player-values/latestPlayerValueSnapshots', () => ({
  loadLatestPlayerValueSnapshots: vi.fn(async () => []),
}))

const { db, rows } = vi.hoisted(() => ({
  db: { book: null as unknown },
  rows: (list: unknown[]) => ({ findMany: vi.fn(async () => list) }),
}))

const SOON = new Date(Date.now() + 2 * 3_600_000)
const LATER = new Date(Date.now() + 5 * 3_600_000)

vi.mock('@/lib/prisma', () => ({
  prisma: {
    guillotineRosterState: rows([]),
    guillotineElimination: rows([]),
    leagueTeam: rows([]),
    sportsGame: rows([
      { sport: 'NCAAF', startTime: SOON, week: 6, season: 2026, homeTeam: 'Liberty', awayTeam: 'Sam Houston', seasonType: 'regular' },
      { sport: 'NFL', startTime: LATER, week: 5, season: 2026, homeTeam: 'DAL', awayTeam: 'TB', seasonType: 'regular' },
    ]),
    roster: rows([]),
    sportsPlayer: rows([]),
    sportsInjury: rows([]),
    league: rows([]),
    weeklyMatchup: rows([]),
    sportsDataCache: { findUnique: vi.fn(async () => (db.book ? { data: db.book } : null)) },
  },
}))

import { getDash34Data } from '@/lib/core-app/dash34'

const LEAGUES = [
  { id: 'L1', name: 'Cream Bowl', sport: 'NCAAF', status: 'in_season', hasUnifiedRecord: true, lastSyncedAt: null },
  { id: 'L2', name: 'NFL League', sport: 'NFL', status: 'in_season', hasUnifiedRecord: true, lastSyncedAt: null },
]
const BOOK = { updatedAt: new Date().toISOString(), teams: { 'ab:UGA': { rank: 2, seenAt: new Date().toISOString() } } }

beforeEach(() => {
  vi.clearAllMocks()
  db.book = BOOK
})

describe('getDash34Data — first kickoff skips unranked college games', () => {
  it('🛑 names the NFL game, not an unranked college game that kicks off first', { timeout: 60_000 }, async () => {
    const result = await getDash34Data('u1', LEAGUES, new Date())
    expect(JSON.stringify(result.firstLock)).toContain('TB at DAL')
    expect(JSON.stringify(result.firstLock)).not.toContain('Sam Houston')
  })

  it('CONTROL: with no poll held yet it fails open and names the college game', { timeout: 60_000 }, async () => {
    db.book = null
    const result = await getDash34Data('u1', LEAGUES, new Date())
    expect(JSON.stringify(result.firstLock)).toContain('Sam Houston at Liberty')
  })
})
