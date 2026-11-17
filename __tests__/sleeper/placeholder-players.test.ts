// @vitest-environment node
/**
 * 🛑 Sleeper's placeholder entries were imported as players.
 *
 * Sleeper's map keeps retired-duplicate and voided ids under names like "Duplicate Player",
 * "Player Invalid" and "<real name> DUPLICATE", with a position, an age, an Inactive status and
 * sometimes a club. `refreshSleeperPlayerRows` took any entry with a name, so it created and
 * re-named 98 such rows in production (2026-11-17), and the draft pool read them like real players.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Row = Record<string, unknown>

const h = vi.hoisted(() => ({
  feed: {} as Record<string, Record<string, unknown>>,
  rows: [] as Row[],
  updates: [] as Array<{ where: Row; data: Row }>,
  creates: [] as Row[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/sleeper-client', () => ({ getPlayersBySport: vi.fn(async () => h.feed) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayer: {
      findMany: vi.fn(async () => h.rows),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        h.updates.push({ where, data })
        return {}
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        h.creates.push(data)
        return {}
      }),
    },
    sportsDataCache: { findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
    allFantasyAdpSnapshot: { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []) },
    playerIdentityMap: { findMany: vi.fn(async () => []) },
  },
}))

import { isSleeperPlaceholderName } from '@/lib/sleeper/placeholderPlayers'
import { refreshSleeperPlayerRows } from '@/lib/sleeper/refreshSleeperPlayerRows'
import { getPlayerPoolForSport } from '@/lib/sport-teams/SportPlayerPoolResolver'

beforeEach(() => {
  h.feed = {}
  h.rows = []
  h.updates = []
  h.creates = []
})

describe('what counts as a placeholder', () => {
  it("Sleeper's three shapes, as production holds them", () => {
    for (const name of ['Duplicate Player', 'Player Invalid', 'Matas Buzelis DUPLICATE', '  duplicate player ', 'PLAYER INVALID']) {
      expect(isSleeperPlaceholderName(name), name).toBe(true)
    }
  })

  it('never a real player', () => {
    for (const name of ['Josh Allen', 'Dupree Player', 'Duplicate', 'Jalen Duplicate-Smith', 'Matas Buzelis Duplicate', '', null, undefined]) {
      expect(isSleeperPlaceholderName(name as string), String(name)).toBe(false)
    }
  })
})

describe('the Sleeper refresher', () => {
  const real = { player_id: '4984', full_name: 'Josh Allen', position: 'QB', team: 'BUF' }

  it('never creates a placeholder row', async () => {
    h.feed = {
      '4984': real,
      '5282': { player_id: '5282', full_name: 'Duplicate Player', position: 'WR', team: 'CHI', status: 'Inactive', age: 24 },
      '7566': { player_id: '7566', first_name: 'Player', last_name: 'Invalid', position: 'WR' },
    }
    await refreshSleeperPlayerRows({ sport: 'NFL' })
    expect(h.creates.map((c) => c.name)).toEqual(['Josh Allen'])
  })

  it('never renames a row we hold into a placeholder', async () => {
    h.feed = { '2731': { player_id: '2731', full_name: 'Matas Buzelis DUPLICATE' } }
    h.rows = [{ id: 'sp-1', sleeperId: '2731' }]
    await refreshSleeperPlayerRows({ sport: 'NBA' })
    expect(h.updates).toEqual([])
  })

  it('the hand-run rookie script skips them too', () => {
    const script = readFileSync(resolve(process.cwd(), 'scripts/sync-rookies-from-sleeper.ts'), 'utf8')
    expect(script).toMatch(/^\s*if \(isSleeperPlaceholderName\(/m)
  })
})

describe('the draft pool', () => {
  const row = (over: Row) => ({
    id: 'x', name: 'Josh Allen', position: 'QB', team: 'Buffalo Bills', teamId: null, status: 'Active',
    sleeperId: '4984', externalId: 'sleeper:4984', age: 30, imageUrl: null, source: 'sleeper', yearsExp: 8,
    dob: null, fetchedAt: new Date(), expiresAt: new Date(), ...over,
  })

  it('leaves out placeholder rows already in the table', async () => {
    h.rows = [
      row({ id: 'a' }),
      row({ id: 'b', name: 'Duplicate Player', position: 'WR', team: 'Chicago Bears', status: 'Inactive', sleeperId: '5282', externalId: 'sleeper:5282' }),
      row({ id: 'c', name: 'Player Invalid', position: 'RB', team: null, status: 'Inactive', sleeperId: '7566', externalId: 'sleeper:7566' }),
    ]
    const pool = await getPlayerPoolForSport('NFL', { limit: 50 })
    const names = pool.map((p) => p.full_name)
    expect(names).toContain('Josh Allen')
    expect(names.filter(isSleeperPlaceholderName)).toEqual([])
  })
})
