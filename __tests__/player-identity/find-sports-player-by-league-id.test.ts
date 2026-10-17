// @vitest-environment node
/**
 * 🛑 AutoCoach benches a starter on the status of the row this resolves to — so an unclaimed NFL
 * Sleeper id must resolve to NOBODY, never to Rolling Insights' player of the same number.
 *
 * The Sleeper space is asked first (unchanged). The fallback to `externalId` used to take every id
 * nothing claimed; an NFL Sleeper id with no Sleeper row then found RI's player of that number —
 * here RI 4444, OUT — and AutoCoach would bench the healthy man. Self-describing ids and other
 * sports' numbers must still resolve through that fallback. The mock database honours `where`.
 */
import { describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type Where = Record<string, unknown>

const ROWS: Row[] = [
  { id: 'a', sport: 'NFL', sleeperId: '9228', externalId: 'sleeper:9228', source: 'sleeper', status: 'Active', updatedAt: new Date(1) },
  // Sleeper 4444 has no Sleeper row; Rolling Insights' 4444 is somebody else, and is OUT.
  { id: 'b', sport: 'NFL', sleeperId: null, externalId: '4444', source: 'rolling_insights', status: 'Out', updatedAt: new Date(1) },
  { id: 'c', sport: 'NFL', sleeperId: null, externalId: 'name:Josh Allen:QB:BUF', source: 'backfill', status: 'Questionable', updatedAt: new Date(1) },
  { id: 'd', sport: 'NHL', sleeperId: null, externalId: '1086', source: 'rolling_insights', status: 'IR', updatedAt: new Date(1) },
]

function matches(row: Row, where: Where): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(cond as Where[]).some((c) => matches(row, c))) return false
    } else if (cond && typeof cond === 'object') {
      const c = cond as { in?: unknown[]; not?: unknown }
      if (c.in && !c.in.includes(row[key])) return false
      if ('not' in c && row[key] === c.not) return false
    } else if (row[key] !== cond) return false
  }
  return true
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayer: {
      findFirst: vi.fn(async ({ where }: { where: Where }) => ROWS.find((r) => matches(r, where)) ?? null),
      findMany: vi.fn(async ({ where }: { where: Where }) => ROWS.filter((r) => matches(r, where))),
    },
  },
}))

import { findSportsPlayerByLeagueId, findSportsPlayersByLeagueIds } from '@/lib/player-identity/findSportsPlayerByLeagueId'

describe('findSportsPlayerByLeagueId — the fallback never takes a Sleeper id', () => {
  it('an NFL Sleeper id with no Sleeper row resolves to nobody, not to RI’s OUT player of that number', async () => {
    expect(await findSportsPlayerByLeagueId('NFL', '4444')).toBeNull()
    const many = await findSportsPlayersByLeagueIds('NFL', ['4444', '9228'])
    expect(many.has('4444')).toBe(false)
    expect(many.get('9228')?.status).toBe('Active')
  })

  it('still resolves what the fallback exists for: a self-describing NFL id, and another sport’s numbers', async () => {
    expect((await findSportsPlayerByLeagueId('NFL', 'name:Josh Allen:QB:BUF'))?.status).toBe('Questionable')
    expect((await findSportsPlayerByLeagueId('nhl', '1086'))?.status).toBe('IR')
    const many = await findSportsPlayersByLeagueIds('NHL', ['1086'])
    expect(many.get('1086')?.status).toBe('IR')
  })
})
