// @vitest-environment node
/**
 * 🛑 Sleeper's own birthday — stored, promoted to the canonical player, and preferred by the linker.
 *
 * The Sleeper feed carries `birth_date` and the live writer threw it away (every `source: 'sleeper'`
 * row had `dob = NULL`, 2026-09-30). Canonical birthdays came only from TheSportsDB, which has
 * Justin Jefferson on 1999-01-16 (true 1999-06-16), Josh Allen on 1996-03-21 (1996-05-21) and Kyler
 * Murray on 1997-08-27 (1997-08-07) — so the ESPN linker, which corroborates a name with a birthday,
 * refused the right link for all three on every run. The mock database honours the query's `where`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type Where = Record<string, unknown>

function matches(row: Row, where: Where): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { in?: unknown[]; not?: unknown }
      if (c.in && !c.in.includes(row[key])) return false
      if ('not' in c && row[key] === c.not) return false
    } else if (row[key] !== cond) return false
  }
  return true
}

const h = vi.hoisted(() => ({
  feed: {} as Record<string, Record<string, unknown>>,
  sportsPlayers: [] as Row[],
  identities: [] as Row[],
  players: [] as Row[],
  updates: [] as Array<{ table: string; where: Row; data: Row }>,
  creates: [] as Row[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/sleeper-client', () => ({ getPlayersBySport: vi.fn(async () => h.feed) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayer: {
      findMany: vi.fn(async ({ where }: { where: Where }) => h.sportsPlayers.filter((r) => matches(r, where))),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        h.updates.push({ table: 'sportsPlayer', where, data })
        return {}
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        h.creates.push(data)
        return {}
      }),
    },
    playerProviderIdentity: {
      findMany: vi.fn(async ({ where }: { where: Where }) => h.identities.filter((r) => matches(r, where))),
    },
    player: {
      findMany: vi.fn(async ({ where }: { where: Where }) => h.players.filter((r) => matches(r, where))),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        h.updates.push({ table: 'player', where, data })
        return {}
      }),
    },
  },
}))

import { refreshSleeperPlayerRows } from '@/lib/sleeper/refreshSleeperPlayerRows'
import { promoteSleeperBirthdays } from '@/lib/player-identity/backfillCanonicalBirthdays'
import { buildSleeperDobMap } from '@/lib/espn/sleeperDobMap'

beforeEach(() => {
  h.feed = {}
  h.sportsPlayers = []
  h.identities = []
  h.players = []
  h.updates = []
  h.creates = []
})

describe('refreshSleeperPlayerRows — stores Sleeper’s birthday', () => {
  it('writes birth_date as dob on an existing row and on a new one; a malformed date is never written', async () => {
    h.feed = {
      '6794': { player_id: '6794', full_name: 'Justin Jefferson', position: 'WR', birth_date: '1999-06-16' },
      '4984': { player_id: '4984', full_name: 'Josh Allen', position: 'QB', birth_date: 'not a date' },
      '9999': { player_id: '9999', full_name: 'New Guy', position: 'RB', birth_date: '2003-02-11' },
    }
    h.sportsPlayers = [
      { id: 'sp-jj', sport: 'NFL', source: 'sleeper', sleeperId: '6794' },
      { id: 'sp-ja', sport: 'NFL', source: 'sleeper', sleeperId: '4984' },
    ]
    await refreshSleeperPlayerRows({ sport: 'NFL' })
    const byRow = new Map(h.updates.map((u) => [u.where.id, u.data]))
    expect(byRow.get('sp-jj')?.dob).toBe('1999-06-16')
    // Undefined, so Prisma leaves a stored birthday alone rather than blanking it.
    expect(byRow.get('sp-ja')?.dob).toBeUndefined()
    expect(h.creates.find((c) => c.sleeperId === '9999')?.dob).toBe('2003-02-11')
  })
})

describe('promoteSleeperBirthdays — Sleeper’s date is the canonical one', () => {
  beforeEach(() => {
    h.identities = [
      { provider: 'sleeper', sportKey: 'NFL', playerId: 'jj', providerPlayerId: '6794' }, // wrong TSDB date on file
      { provider: 'sleeper', sportKey: 'NFL', playerId: 'new', providerPlayerId: '9999' }, // no date on file
      { provider: 'sleeper', sportKey: 'NFL', playerId: 'ok', providerPlayerId: '5859' }, // already right
      { provider: 'sleeper', sportKey: 'NFL', playerId: 'twin', providerPlayerId: '100' }, // two Sleeper ids
      { provider: 'sleeper', sportKey: 'NFL', playerId: 'twin', providerPlayerId: '101' },
      { provider: 'sleeper', sportKey: 'NFL', playerId: 'filler', providerPlayerId: '200' }, // Jan-1 placeholder
      { provider: 'sleeper', sportKey: 'NFL', playerId: 'stamped', providerPlayerId: '300' }, // only a provider row has a date
    ]
    h.sportsPlayers = [
      { sport: 'NFL', source: 'sleeper', sleeperId: '6794', dob: '1999-06-16' },
      { sport: 'NFL', source: 'sleeper', sleeperId: '9999', dob: '2003-02-11' },
      { sport: 'NFL', source: 'sleeper', sleeperId: '5859', dob: '1997-06-30' },
      { sport: 'NFL', source: 'sleeper', sleeperId: '100', dob: '1990-05-05' },
      { sport: 'NFL', source: 'sleeper', sleeperId: '200', dob: '2001-01-01' },
      { sport: 'NFL', source: 'thesportsdb', sleeperId: '300', dob: '1980-03-03' },
    ]
    h.players = [
      { id: 'jj', birthDate: new Date('1999-01-16T00:00:00.000Z') },
      { id: 'new', birthDate: null },
      { id: 'ok', birthDate: new Date('1997-06-30T00:00:00.000Z') },
      { id: 'twin', birthDate: null },
      { id: 'filler', birthDate: null },
      { id: 'stamped', birthDate: null },
    ]
  })

  it('corrects a wrong birthday, fills a missing one, and leaves an agreeing one alone', async () => {
    const summary = await promoteSleeperBirthdays({ sport: 'NFL' })
    const written = new Map(h.updates.filter((u) => u.table === 'player').map((u) => [u.where.id, u.data]))
    expect((written.get('jj')?.birthDate as Date).toISOString().slice(0, 10)).toBe('1999-06-16')
    expect(written.get('jj')?.birthYear).toBe(1999)
    expect((written.get('new')?.birthDate as Date).toISOString().slice(0, 10)).toBe('2003-02-11')
    expect(written.has('ok')).toBe(false)
    expect(summary).toMatchObject({ corrected: 1, filled: 1, alreadyCorrect: 1, skippedAmbiguous: 1 })
  })

  it('never guesses: two Sleeper ids, a Jan-1 filler, or a date only a provider row carries writes nothing', async () => {
    await promoteSleeperBirthdays({ sport: 'NFL' })
    const written = new Set(h.updates.filter((u) => u.table === 'player').map((u) => u.where.id))
    expect(written.has('twin')).toBe(false)
    expect(written.has('filler')).toBe(false)
    expect(written.has('stamped')).toBe(false)
  })
})

describe('buildSleeperDobMap — Sleeper’s own row outranks a stamped provider row', () => {
  it('Kyler Murray: RI and TheSportsDB disagree, Sleeper decides — whatever order the rows arrive in', () => {
    const identities = [{ playerId: 'km', providerPlayerId: '5849' }]
    const rows = [
      { sleeperId: '5849', dob: '1997-08-27', source: 'thesportsdb' },
      { sleeperId: '5849', dob: '1997-08-07', source: 'sleeper' },
      { sleeperId: '5849', dob: '1997-08-07', source: 'rolling_insights' },
    ]
    expect(buildSleeperDobMap(identities, rows).get('km')).toBe('1997-08-07')
    expect(buildSleeperDobMap(identities, [...rows].reverse()).get('km')).toBe('1997-08-07')
  })
})
