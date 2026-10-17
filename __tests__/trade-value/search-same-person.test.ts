/**
 * The analyzer's player search shows each athlete once. `sports_players` holds a player once per source,
 * so searching "Skubal" listed three Tarik Skubals — two at LAD, one at DETROIT TIGERS (2026-10-11).
 * `collapseSamePersonRows` collapses rows to one per person when `PlayerIdentityMap` holds exactly one
 * athlete by that name, and leaves namesakes alone. Rows below are production's for these names that day.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { normalizePlayerName } from '@/lib/team-abbrev'

type Row = { id: string; name: string; team: string; position: string; sport: string; dataSource: string }
const db = vi.hoisted(() => ({
  rows: [] as Row[],
  people: [] as Array<{ sport: string; normalizedName: string; rollingInsightsId: string | null }>,
  identityFails: false,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: {
      findMany: vi.fn(async ({ where }: { where: { sport: string; normalizedName: { in: string[] } } }) => {
        if (db.identityFails) throw new Error('db down')
        return db.people.filter((p) => p.sport === where.sport && where.normalizedName.in.includes(p.normalizedName))
      }),
    },
  },
}))
vi.mock('@/lib/data/players', () => ({
  // In the order given: the real search returns the newest rows first.
  searchPlayers: vi.fn(async (q: string, sport: string) => db.rows.filter((r) => r.sport === sport && r.name.toLowerCase().includes(q.toLowerCase()))),
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => ({ success: true }), getClientIp: () => 'test' }))
vi.mock('@/lib/fantasycalc-db', () => ({ getFantasyCalcValuesDbFirst: vi.fn(async () => []) }))
vi.mock('@/lib/draft-sports-models/player-asset-resolver', () => ({ resolveHeadshotUrl: () => null }))
vi.mock('@/lib/trade-value-console/league-loader', () => ({ loadLeagueForTrade: vi.fn() }))
vi.mock('@/lib/trade-value-console/leagueTradePricing', () => ({ resolveLeagueTradeChart: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { collapseSamePersonRows } from '@/lib/data/samePersonRows'
import { GET } from '@/app/api/trade-value/player-search/route'

function row(id: string, name: string, team: string, position: string) {
  const r = { id, name, team, position, sport: 'MLB', dataSource: 'cache' }
  db.rows.push(r)
  return r
}
function person(name: string, rollingInsightsId: string | null) {
  db.people.push({ sport: 'MLB', normalizedName: normalizePlayerName(name), rollingInsightsId })
}
const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id)

beforeEach(() => {
  db.rows = []
  db.people = []
  db.identityFails = false
  vi.mocked(prisma.playerIdentityMap.findMany).mockClear()
})

function skubal() {
  row('MLB:tarik-skubal:DETROIT TIGERS', 'Tarik Skubal', 'DETROIT TIGERS', 'P')
  row('MLB:tsdb_34185498', 'Tarik Skubal', 'LAD', 'P')
  row('MLB:4037', 'Tarik Skubal', 'LAD', 'P')
  person('Tarik Skubal', '4037')
}
function willSmith() {
  row('MLB:will-smith:KANSAS CITY ROYALS', 'Will Smith', 'KC', 'P')
  row('MLB:2728', 'Will Smith', 'LAD', 'C')
  row('MLB:tsdb_34179489', 'Will Smith', 'LAD', 'P')
  person('Will Smith', '2728')
  person('Will Smith', '215')
}

describe('collapseSamePersonRows', () => {
  it('keeps one row for one athlete under three sources: his Rolling Insights row, in his first row’s place', async () => {
    row('MLB:1', 'Someone Before', 'NYY', 'SS')
    skubal()
    row('MLB:2', 'Someone After', 'BOS', 'P')
    expect(ids(await collapseSamePersonRows(db.rows, 'MLB'))).toEqual(['MLB:1', 'MLB:4037', 'MLB:2'])
  })

  it('keeps a soccer player’s Rolling Insights row but names his club from a copy that does', async () => {
    // Production: soccer's RI rows carry a club NUMBER ("13"); the TheSportsDB copy says "MNC".
    const rows = [
      { id: 'SOCCER:erling-haaland:13', name: 'Erling Haaland', team: '13', position: 'FORWARD' },
      { id: 'SOCCER:tsdb_34169116', name: 'Erling Haaland', team: 'MNC', position: 'CENTRE-FORWARD' },
      { id: 'SOCCER:1529', name: 'Erling Haaland', team: '13', position: 'FORWARD' },
    ]
    db.people.push({ sport: 'SOCCER', normalizedName: normalizePlayerName('Erling Haaland'), rollingInsightsId: '1529' })
    expect(await collapseSamePersonRows(rows, 'SOCCER')).toEqual([{ id: 'SOCCER:1529', name: 'Erling Haaland', team: 'MNC', position: 'FORWARD' }])
  })

  it('leaves namesakes as they are', async () => {
    willSmith()
    expect(ids(await collapseSamePersonRows(db.rows, 'MLB'))).toEqual(ids(db.rows))
  })

  it('collapses one name and not another in the same list', async () => {
    willSmith()
    row('MLB:jd-a', 'John Smith', 'SEA', 'P')
    row('MLB:jd-b', 'John Smith', 'SEA', 'P')
    person('John Smith', null)
    expect(ids(await collapseSamePersonRows(db.rows, 'MLB'))).toEqual([
      'MLB:will-smith:KANSAS CITY ROYALS', 'MLB:2728', 'MLB:tsdb_34179489', 'MLB:jd-a',
    ])
  })

  it('leaves rows alone when nobody by that name is on the map, or the map cannot be read', async () => {
    row('MLB:a', 'Copy Name', 'SEA', 'P')
    row('MLB:b', 'Copy Name', 'SEA', 'P')
    expect(ids(await collapseSamePersonRows(db.rows, 'MLB'))).toEqual(['MLB:a', 'MLB:b'])
    person('Copy Name', 'a')
    db.identityFails = true
    expect(ids(await collapseSamePersonRows(db.rows, 'MLB'))).toEqual(['MLB:a', 'MLB:b'])
  })

  it('does not ask the map when every name is on one row', async () => {
    row('MLB:1', 'Only Once', 'SEA', 'P')
    row('MLB:2', 'Also Once', 'SEA', 'P')
    expect(ids(await collapseSamePersonRows(db.rows, 'MLB'))).toEqual(['MLB:1', 'MLB:2'])
    expect(prisma.playerIdentityMap.findMany).not.toHaveBeenCalled()
  })

  it('asks for the shared names only, in one query', async () => {
    skubal()
    willSmith()
    row('MLB:9', 'Only Once', 'SEA', 'P')
    await collapseSamePersonRows(db.rows, 'MLB')
    expect(prisma.playerIdentityMap.findMany).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prisma.playerIdentityMap.findMany).mock.calls[0]![0]).toMatchObject({
      where: { sport: 'MLB', normalizedName: { in: [normalizePlayerName('Tarik Skubal'), normalizePlayerName('Will Smith')] } },
    })
  })
})

describe('the analyzer’s player search', () => {
  const search = (q: string, sport: string) => GET(new NextRequest(`http://localhost/api/trade-value/player-search?q=${encodeURIComponent(q)}&sport=${sport}`))

  it('lists Tarik Skubal once, on his current club', async () => {
    skubal()
    const body = await (await search('Skubal', 'MLB')).json()
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ playerId: 'MLB:4037', name: 'Tarik Skubal', team: 'LAD', value: null })
  })

  it('still lists both Will Smiths', async () => {
    willSmith()
    const body = await (await search('Will Smith', 'MLB')).json()
    expect(body.map((r: { playerId: string }) => r.playerId)).toEqual(ids(db.rows))
  })

  it('collapses in the all-sports search too', async () => {
    skubal()
    const body = await (await search('Skubal', 'ALL')).json()
    expect(body.filter((r: { name: string }) => r.name === 'Tarik Skubal')).toHaveLength(1)
  })
})
