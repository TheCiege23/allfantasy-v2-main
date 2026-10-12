/**
 * `/player/[playerId]` must resolve ONE athlete, in ONE sport. The old lookup was an unscoped
 * `findFirst({ OR: [id, sleeperId, normalizedName] })`; on production `justin-jefferson` rendered the
 * NCAAF DL (Eastern Michigan) and `cam-ward` the NHL goalie. The fake table below is the real row set
 * for those names, measured 2026-10-12, and `findMany` honours `where.sport`, so dropping the sport
 * scope lets the college and hockey rows back in.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = {
  id: string
  canonicalName: string
  normalizedName: string
  position: string | null
  currentTeam: string | null
  sport: string
  sleeperId: string | null
  status: string | null
}

const row = (over: Partial<Row> & Pick<Row, 'id' | 'canonicalName' | 'sport'>): Row => ({
  normalizedName: over.canonicalName.toLowerCase(),
  position: null,
  currentTeam: null,
  sleeperId: null,
  status: null,
  ...over,
})

const TABLE: Row[] = [
  row({ id: 'jj-ncaaf-wr', canonicalName: 'Justin Jefferson', sport: 'NCAAF', position: 'WR', currentTeam: 'LOUISIANA STATE UNIVERSITY' }),
  row({ id: 'jj-ncaaf-dl', canonicalName: 'Justin Jefferson', sport: 'NCAAF', position: 'DL', currentTeam: 'EASTERN MICHIGAN UNIVERSITY' }),
  row({ id: 'jj-nfl-lb', canonicalName: 'Justin Jefferson', sport: 'NFL', position: 'LB', currentTeam: 'CLE', sleeperId: '9001' }),
  row({ id: 'jj-nfl-wr', canonicalName: 'Justin Jefferson', sport: 'NFL', position: 'WR', currentTeam: 'MIN', sleeperId: '6794' }),
  row({ id: 'cw-ncaab', canonicalName: 'Cam Ward', sport: 'NCAAB', position: 'F', currentTeam: 'MICHIGAN STATE UNIVERSITY' }),
  row({ id: 'cw-ncaaf', canonicalName: 'Cam Ward', sport: 'NCAAF', position: 'QB', currentTeam: 'University of Miami' }),
  row({ id: 'cw-nhl', canonicalName: 'Cam Ward', sport: 'NHL', position: 'G', currentTeam: 'CHICAGO BLACKHAWKS' }),
  // One NFL athlete, twice: a Sleeper-keyed row and a keyless duplicate (72 such groups on prod).
  row({ id: 'bt-a-keyless', canonicalName: 'Brian Thomas', sport: 'NFL', position: 'WR', currentTeam: 'JAX' }),
  row({ id: 'bt-b-keyed', canonicalName: 'Brian Thomas', sport: 'NFL', position: 'WR', currentTeam: 'JAX', sleeperId: '11632' }),
  // One NBA athlete ingested twice with identical name/position/team.
  row({ id: 'je-1', canonicalName: 'Jon Elmore', sport: 'NBA', position: 'SG', currentTeam: 'SAN ANTONIO SPURS' }),
  row({ id: 'je-2', canonicalName: 'Jon Elmore', sport: 'NBA', position: 'SG', currentTeam: 'SAN ANTONIO SPURS' }),
]

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: { playerIdentityMap: { findFirst: mocks.findFirst, findMany: mocks.findMany } },
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: mocks.notFound }))
vi.mock('@/app/player/[playerId]/PlayerProfileClient', () => ({ PlayerProfileClient: () => null }))
vi.mock('@/lib/injuries/currentInjuryDesignations', () => ({ resolveCurrentInjuryDesignations: vi.fn(async () => new Map()) }))

import {
  readPlayerPageLookup,
  resolvePlayerPageIdentity,
} from '@/app/player/[playerId]/resolvePlayerIdentity'
import PlayerProfilePage, { generateMetadata } from '@/app/player/[playerId]/page'

function matches(r: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
    TABLE.find((r) => matches(r, where)) ?? null,
  )
  mocks.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
    TABLE.filter((r) => matches(r, where)),
  )
})

const resolve = (slug: string, query: Record<string, string> = {}) =>
  resolvePlayerPageIdentity(slug, readPlayerPageLookup(query))

describe('player page identity — the name slug is scoped to one sport', () => {
  it('cam-ward with no sport defaults to NFL and finds nobody — not the NHL goalie', async () => {
    const r = await resolve('cam-ward')
    expect(r.identity).toBeNull()
    expect(r.reason).toBe('not_found')
    expect(mocks.findMany.mock.calls[0]![0].where.sport).toBe('NFL')
  })

  it('cam-ward?sport=NHL is the goalie', async () => {
    expect((await resolve('cam-ward', { sport: 'NHL' })).identity?.id).toBe('cw-nhl')
  })

  it('justin-jefferson with nothing to narrow is REFUSED, never the Eastern Michigan DL', async () => {
    const r = await resolve('justin-jefferson')
    expect(r.identity).toBeNull()
    expect(r.reason).toBe('ambiguous')
  })

  it('a position hint picks the WR', async () => {
    expect((await resolve('justin-jefferson', { position: 'WR' })).identity?.id).toBe('jj-nfl-wr')
  })

  it('a full team name (as injury alerts carry it) is folded to the abbreviation', async () => {
    expect((await resolve('justin-jefferson', { team: 'Minnesota Vikings' })).identity?.id).toBe('jj-nfl-wr')
  })

  it('NFL prefers the Sleeper-keyed row over its keyless duplicate', async () => {
    expect((await resolve('brian-thomas')).identity?.id).toBe('bt-b-keyed')
  })

  it('identical name/position/team rows are one athlete, not an ambiguity', async () => {
    expect((await resolve('jon-elmore', { sport: 'NBA' })).identity?.id).toBe('je-1')
  })

  it('an unknown sport parameter falls back to NFL rather than an unscoped query', () => {
    expect(readPlayerPageLookup({ sport: 'curling' }).sport).toBe('NFL')
    expect(readPlayerPageLookup({ sport: 'ncaafb' }).sport).toBe('NCAAF')
  })
})

describe('player page identity — exact ids win over a name', () => {
  it('an identity id resolves without consulting names', async () => {
    const r = await resolve('cw-nhl')
    expect(r).toMatchObject({ reason: 'id', identity: { id: 'cw-nhl' } })
    expect(mocks.findMany).not.toHaveBeenCalled()
  })

  it('a sleeperId resolves before names', async () => {
    const r = await resolve('6794')
    expect(r).toMatchObject({ reason: 'sleeper_id', identity: { id: 'jj-nfl-wr' } })
    expect(mocks.findMany).not.toHaveBeenCalled()
  })
})

describe('the page and its metadata share the resolver', () => {
  it('an ambiguous slug renders not-found', async () => {
    await expect(
      PlayerProfilePage({ params: Promise.resolve({ playerId: 'justin-jefferson' }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.notFound).toHaveBeenCalled()
  })

  it('a scoped slug renders that player', async () => {
    const el = (await PlayerProfilePage({
      params: Promise.resolve({ playerId: 'cam-ward' }),
      searchParams: Promise.resolve({ sport: 'NHL' }),
    })) as { props: { player: Record<string, unknown> } }
    expect(el.props.player).toMatchObject({ id: 'cw-nhl', sport: 'NHL', position: 'G' })
  })

  it('metadata names nobody for an ambiguous slug and the right player for a scoped one', async () => {
    const vague = await generateMetadata({ params: Promise.resolve({ playerId: 'justin-jefferson' }) })
    expect(vague.title).toMatch(/^Player /)
    const scoped = await generateMetadata({
      params: Promise.resolve({ playerId: 'justin-jefferson' }),
      searchParams: Promise.resolve({ position: 'WR' }),
    })
    expect(scoped.description).toMatch(/\(WR, MIN\)/)
  })
})
