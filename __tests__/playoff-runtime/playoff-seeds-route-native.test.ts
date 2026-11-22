/**
 * GET /api/leagues/[id]/scoring/playoff-seeds: a native season answers with the playoff runtime's own
 * seeds (lib/playoff-runtime/playoffSeedPreview.ts), flagged `projected` until the bracket exists; a
 * league without one keeps reading the stored `FantasyStanding.playoffSeed` rows.
 *
 * A native seed's wins and points come from the season's own roster row (`RedraftRoster`), keyed by the
 * seed's season roster id. `FantasyStanding` is not written for a points league that plays here, so
 * reading it there showed every seed at 0 wins and 0.0.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  preview: null as null | { locked: boolean; seeds: Array<Record<string, unknown>> },
  stored: [] as Array<Record<string, unknown>>,
  all: [] as Array<Record<string, unknown>>,
  seasonRosters: [] as Array<Record<string, unknown>>,
  seasonRosterWhere: null as unknown,
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'user-rt-1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async () => ({ isMember: true })) }))
vi.mock('@/lib/scoring-engine/resolveTeamLabels', () => ({
  buildRosterLabelMap: vi.fn(async () => new Map([['generic-rt-west', 'West Winners'], ['generic-rt-old', 'Stored Team']])),
}))
vi.mock('@/server/services/leagueActionGate', () => ({ assertLeagueActionGate: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/server/services/playoffEngine', () => ({ computePlayoffSeeds: vi.fn(async () => []) }))
vi.mock('@/lib/playoff-runtime/playoffSeedPreview', () => ({ loadNativePlayoffSeedPreview: vi.fn(async () => h.preview) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: vi.fn(async () => ({ id: 'league-rt-1', season: 2026 })) },
    fantasyStanding: {
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) => ('playoffSeed' in args.where ? h.stored : h.all)),
    },
    redraftRoster: {
      findMany: vi.fn(async (args: { where: unknown }) => {
        h.seasonRosterWhere = args.where
        return h.seasonRosters
      }),
    },
  },
}))

import { GET } from '@/app/api/leagues/[leagueId]/scoring/playoff-seeds/route'

const call = async () => {
  const res = await GET(new NextRequest('http://localhost/api/leagues/league-rt-1/scoring/playoff-seeds?season=2026'), {
    params: Promise.resolve({ leagueId: 'league-rt-1' }),
  })
  return (await res.json()) as Record<string, any>
}

beforeEach(() => {
  h.preview = null
  h.stored = [{ rosterId: 'generic-rt-old', playoffSeed: 1, wins: 3, pointsFor: 400 }]
  // What the old read would have returned for this team: a native seed must NOT show these.
  h.all = [{ rosterId: 'generic-rt-west', wins: 0, pointsFor: 0 }]
  h.seasonRosters = [{ id: 'rr-rt-west', wins: 8, pointsFor: 1440 }]
  h.seasonRosterWhere = null
})

describe('playoff-seeds route', () => {
  it('native season: the runtime seeds, projected until the bracket exists', async () => {
    h.preview = {
      locked: false,
      seeds: [{ rosterId: 'generic-rt-west', redraftRosterId: 'rr-rt-west', seed: 2, displayName: 'Team W', qualifiedBy: 'division' }],
    }
    const body = await call()
    expect(body).toMatchObject({ source: 'playoff_runtime', projected: true })
    expect(body.seeds).toEqual([{ rosterId: 'generic-rt-west', seed: 2, teamName: 'West Winners', qualifiedBy: 'division', wins: 8, pointsFor: 1440 }])
    // Asked of the season's rosters, by the seed's season roster id.
    expect(h.seasonRosterWhere).toEqual({ id: { in: ['rr-rt-west'] } })
  })

  it('a seed whose season roster cannot be read shows 0, never another table’s numbers', async () => {
    h.preview = { locked: false, seeds: [{ rosterId: 'generic-rt-west', redraftRosterId: 'rr-rt-west', seed: 2, displayName: 'Team W', qualifiedBy: 'division' }] }
    h.all = [{ rosterId: 'generic-rt-west', wins: 99, pointsFor: 9999 }]
    h.seasonRosters = []
    const body = await call()
    expect(body.seeds[0]).toMatchObject({ wins: 0, pointsFor: 0 })
  })

  it('a generated bracket: not projected', async () => {
    h.preview = { locked: true, seeds: [{ rosterId: 'generic-rt-west', redraftRosterId: 'rr-rt-west', seed: 1, displayName: 'Team W', qualifiedBy: 'division' }] }
    expect(await call()).toMatchObject({ projected: false })
  })

  it('no native season: the stored FantasyStanding seeds, as before', async () => {
    const body = await call()
    expect(body.source).toBeUndefined()
    expect(body.seeds).toEqual([{ rosterId: 'generic-rt-old', seed: 1, teamName: 'Stored Team', wins: 3, pointsFor: 400 }])
  })
})
