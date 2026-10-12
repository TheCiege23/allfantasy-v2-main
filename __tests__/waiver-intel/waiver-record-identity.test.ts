import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `resolveSportsPlayerRecord` / `resolveRecordForFreeAgent` — which `sports_players` row prices a
 * league player in waiver intelligence (drop candidates, roster needs, free-agent values).
 *
 * 🛑 It bound on NAME alone with an unordered `findFirst`, and record ids are `NFL:<sleeperId>`, so
 * a bare roster id never hit the direct lookup. `sports_players` holds WR Justin Jefferson
 * (`NFL:6794`, MIN) and LB Justin Jefferson (`NFL:13524`, CLE): either could price the receiver.
 * And `SportsPlayer` holds one row per source per Sleeper id — TheSportsDB's 11304 is G Elgton
 * Jenkins, not TE E.J. Jenkins.
 *
 * The Prisma double returns rows in the order an unordered Postgres scan could: the WRONG row
 * first, so a name-only `findFirst` or a first-row-wins pick fails here.
 */

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({ records: [] as Row[], players: [] as Row[] }))

function nameEq(row: Row, cond: unknown): boolean {
  if (cond && typeof cond === 'object' && 'equals' in (cond as Row)) {
    return String(row.name).toLowerCase() === String((cond as Row).equals).toLowerCase()
  }
  return row.name === cond
}

function playerMatches(row: Row, where: Row): boolean {
  if (where.sport && row.sport !== where.sport) return false
  if (Array.isArray(where.OR)) {
    return (where.OR as Row[]).some((w) => Object.entries(w).every(([k, v]) => row[k] === v))
  }
  for (const k of ['externalId', 'sleeperId', 'id']) if (k in where && row[k] !== where[k]) return false
  return true
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayerRecord: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => state.records.find((r) => r.id === args.where.id) ?? null),
      findFirst: vi.fn(async (args: { where: Row }) =>
        state.records.find((r) => r.sport === args.where.sport && nameEq(r, args.where.name)) ?? null,
      ),
      findMany: vi.fn(async (args: { where: Row }) =>
        state.records.filter((r) => r.sport === args.where.sport && nameEq(r, args.where.name)),
      ),
    },
    sportsPlayer: {
      findFirst: vi.fn(async (args: { where: Row }) => state.players.find((r) => playerMatches(r, args.where)) ?? null),
      findMany: vi.fn(async (args: { where: Row }) => state.players.filter((r) => playerMatches(r, args.where))),
    },
  },
}))

import { resolveRecordForFreeAgent, resolveSportsPlayerRecord } from '@/lib/ai-tools-waiver/waiver-intelligence'

const record = (over: Row): Row => ({
  sport: 'NFL',
  name: 'Nobody',
  team: 'FA',
  position: 'WR',
  stats: {},
  projections: {},
  dynastyValue: null,
  injuryStatus: null,
  ...over,
})
const player = (over: Row): Row => ({
  sport: 'NFL',
  externalId: 'x',
  sleeperId: null,
  name: 'Nobody',
  position: 'WR',
  team: null,
  age: null,
  imageUrl: null,
  source: 'sleeper',
  fetchedAt: new Date('2026-10-01'),
  ...over,
})
beforeEach(() => {
  state.records = [
    // The linebacker first: the row a name-only `findFirst` returns.
    record({ id: 'NFL:13524', name: 'Justin Jefferson', position: 'LB', team: 'CLE' }),
    record({ id: 'NFL:justin-jefferson-lb:CLE', name: 'Justin Jefferson', position: 'LB', team: 'CLE', dynastyValue: 20 }),
    record({ id: 'NFL:6794', name: 'Justin Jefferson', position: 'WR', team: 'MIN' }),
    record({ id: 'NFL:sleeper:6794', name: 'Justin Jefferson', position: 'WR', team: 'MIN' }),
    record({ id: 'NFL:justin-jefferson:MIN', name: 'Justin Jefferson', position: 'WR', team: 'MIN', dynastyValue: 120 }),
    // Elgton's record first, and E.J. has no own row.
    record({ id: 'NFL:elgton-jenkins:CLE', name: 'Elgton Jenkins', position: 'G', team: 'CLE', dynastyValue: 10 }),
    record({ id: 'NFL:ej-jenkins:PHI', name: 'E.J. Jenkins', position: 'TE', team: 'PHI', dynastyValue: 5 }),
  ]
  state.players = [
    player({ externalId: '34163931', sleeperId: '11304', source: 'thesportsdb', name: 'Elgton Jenkins', position: 'G', team: 'Cleveland Browns', fetchedAt: new Date('2026-10-11') }),
    player({ externalId: 'sleeper:11304', sleeperId: '11304', name: 'E.J. Jenkins', position: 'TE', team: 'Philadelphia Eagles' }),
  ]
})

describe('waiver record identity', () => {
  it('🛑 the id\'s own record answers first — never the namesake a name-only findFirst returns', async () => {
    const row = await resolveSportsPlayerRecord('NFL', '6794')
    expect(row).toMatchObject({ id: 'NFL:6794', position: 'WR', team: 'MIN' })
  })

  it('a free agent goes through the same id-first path', async () => {
    const row = await resolveRecordForFreeAgent('NFL', '13524')
    expect(row).toMatchObject({ id: 'NFL:13524', position: 'LB', team: 'CLE' })
  })

  it('🛑 with no own record, binds by name verified by position — one athlete\'s duplicates are not a collision', async () => {
    state.records = state.records.filter((r) => r.id !== 'NFL:6794')
    state.players = [
      player({ externalId: 'sleeper:6794', sleeperId: '6794', name: 'Justin Jefferson', position: 'WR', team: 'Minnesota Vikings' }),
    ]
    const row = await resolveSportsPlayerRecord('NFL', '6794')
    // `NFL:sleeper:6794` and the slug row are one athlete; the priced one speaks for him.
    expect(row).toMatchObject({ id: 'NFL:justin-jefferson:MIN', position: 'WR' })
  })

  it('🛑 with no own record, the Sleeper row names the player — not a fresher TheSportsDB namesake', async () => {
    const row = await resolveSportsPlayerRecord('NFL', '11304')
    expect(row).toMatchObject({ id: 'NFL:ej-jenkins:PHI', name: 'E.J. Jenkins', position: 'TE' })
  })

  it('🛑 a shared name binds by team when the feeds spell the position differently (CB vs DB)', async () => {
    state.records = [
      record({ id: 'NFL:byron-murphy:SEA', name: 'Byron Murphy', position: 'DT', team: 'SEA', dynastyValue: 40 }),
      record({ id: 'NFL:byron-murphy:MIN', name: 'Byron Murphy', position: 'DB', team: 'MIN' }),
    ]
    state.players = [
      player({ externalId: '34172144', sleeperId: '5864', source: 'thesportsdb', name: 'Byron Murphy', position: 'DT', team: 'Seattle Seahawks', fetchedAt: new Date('2026-10-11') }),
      player({ externalId: 'sleeper:5864', sleeperId: '5864', name: 'Byron Murphy', position: 'CB', team: 'Minnesota Vikings' }),
    ]
    const row = await resolveSportsPlayerRecord('NFL', '5864')
    expect(row?.id).toBe('NFL:byron-murphy:MIN')
  })

  it('refuses a name shared by two athletes when nothing tells them apart', async () => {
    state.records = [
      record({ id: 'NFL:a', name: 'Same Name', position: 'WR', team: 'MIN', dynastyValue: 10 }),
      record({ id: 'NFL:b', name: 'Same Name', position: 'WR', team: 'CLE', dynastyValue: 10 }),
    ]
    state.players = [player({ externalId: 'sleeper:42', sleeperId: '42', name: 'Same Name', position: null, team: null })]
    expect(await resolveSportsPlayerRecord('NFL', '42')).toBeNull()
  })
})
