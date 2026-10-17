// @vitest-environment node
/**
 * 🛑 A player id means something only in its league's id space, so the resolver is told which one.
 *
 * Sleeper, ESPN, Rolling Insights and the backfill all write small numbers, and the same number is a
 * different person in each. The resolver used to ask every table and every provider column at once
 * and keep the first name back, so a Sleeper id with no Sleeper row was named after the Rolling
 * Insights player of that number, and an ESPN id was named after the SLEEPER player of that number.
 *
 * The native cases are the other half: those rosters legitimately hold `name:` backfill ids and
 * (NHL) Rolling Insights numbers, named only through `externalId` — the fix must not blank them.
 * Real shapes from production, 2026-09-29. The mock database honours the query's `where`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, string | null>
type Where = Record<string, unknown>

const SPORTS_PLAYERS: Row[] = [
  { sport: 'NFL', sleeperId: '9228', externalId: 'sleeper:9228', source: 'sleeper', name: 'Bryce Young' },
  // Sleeper 4444 has no Sleeper row; Rolling Insights' 4444 is somebody else.
  { sport: 'NFL', sleeperId: null, externalId: '4444', source: 'rolling_insights', name: 'RI Stranger' },
  { sport: 'NFL', sleeperId: null, externalId: 'name:Josh Allen:QB:BUF', source: 'backfill', name: 'Josh Allen' },
  { sport: 'NHL', sleeperId: null, externalId: '1086', source: 'rolling_insights', name: 'Aaron Dell' },
]
const IDENTITY_MAP: Row[] = [
  // Listed first on purpose: the old resolver kept the first name it was handed.
  { sport: 'NFL', canonicalName: 'Sleeper Eleven', sleeperId: '1111', espnId: null },
  { sport: 'NFL', canonicalName: 'ESPN Eleven', sleeperId: null, espnId: '1111' },
]
const CANONICAL: Record<string, string> = { '9228': 'Bryce Young', '1111': 'Sleeper Eleven' }

const h = vi.hoisted(() => ({ reads: 0 }))

function matches(row: Row, where: Where): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(cond as Where[]).some((c) => matches(row, c))) return false
    } else if (cond && typeof cond === 'object') {
      const c = cond as { in?: string[]; not?: string }
      if (c.in && !c.in.includes(row[key] as string)) return false
      if ('not' in c && row[key] === c.not) return false
    } else if (row[key] !== cond) return false
  }
  return true
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: {
      findMany: vi.fn(async ({ where }: { where: Where }) => {
        h.reads++
        return IDENTITY_MAP.filter((r) => matches(r, where))
      }),
    },
    sportsPlayer: {
      findMany: vi.fn(async ({ where }: { where: Where }) => {
        h.reads++
        return SPORTS_PLAYERS.filter((r) => matches(r, where))
      }),
    },
  },
}))
vi.mock('@/lib/canonical/getCanonicalPlayer', () => ({
  getCanonicalPlayersBySleeperIds: vi.fn(async (ids: string[]) => {
    h.reads++
    return new Map(ids.filter((id) => CANONICAL[id]).map((id) => [id, { name: CANONICAL[id] }]))
  }),
}))

import { resolvePlayerNamesForSport } from '@/lib/roster/resolvePlayerNames'
import { nonSleeperExternalIdWhere } from '@/lib/player-identity/externalIdNamespace'

beforeEach(() => {
  h.reads = 0
})

describe('resolvePlayerNamesForSport — each league asks only its own id space', () => {
  it('Sleeper league: a Sleeper id with no Sleeper row stays unnamed, never the RI player of that number', async () => {
    const names = await resolvePlayerNamesForSport(['9228', '4444'], 'NFL', 'sleeper')
    expect(names.get('9228')).toBe('Bryce Young')
    expect(names.get('4444')).toBe('Player 4444')
  })

  it('native NFL: a bare number is a Sleeper id; a self-describing backfill id is still named', async () => {
    const names = await resolvePlayerNamesForSport(['4444', 'name:Josh Allen:QB:BUF'], 'NFL', 'manual')
    expect(names.get('4444')).toBe('Player 4444')
    expect(names.get('name:Josh Allen:QB:BUF')).toBe('Josh Allen')
  })

  it('native NHL: Rolling Insights numbers are named — Sleeper has no NHL ids to collide with', async () => {
    const names = await resolvePlayerNamesForSport(['1086'], 'NHL', 'manual')
    expect(names.get('1086')).toBe('Aaron Dell')
  })

  it('ESPN league: an ESPN id is named from the ESPN column, not as the Sleeper player of that number', async () => {
    const names = await resolvePlayerNamesForSport(['1111'], 'NFL', 'espn')
    expect(names.get('1111')).toBe('ESPN Eleven')
  })

  it('a platform with no identity column (Yahoo) names nobody rather than a stranger', async () => {
    const names = await resolvePlayerNamesForSport(['9228'], 'NFL', 'yahoo')
    expect(names.get('9228')).toBe('Player 9228')
    expect(h.reads).toBe(0)
  })
})

describe('nonSleeperExternalIdWhere — its own promise, for callers that do not pre-split', () => {
  it('drops an NFL bare number (a Sleeper id) and keeps self-describing ids', () => {
    expect(nonSleeperExternalIdWhere(['4444', 'name:Josh Allen:QB:BUF', 'tsdb_34415964'], 'nfl').externalId.in).toEqual([
      'name:Josh Allen:QB:BUF',
      'tsdb_34415964',
    ])
  })

  it('keeps bare numbers in a sport with no Sleeper ids', () => {
    expect(nonSleeperExternalIdWhere(['1086'], 'NHL').externalId.in).toEqual(['1086'])
  })
})
