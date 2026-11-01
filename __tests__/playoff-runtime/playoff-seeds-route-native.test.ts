/**
 * GET /api/leagues/[id]/scoring/playoff-seeds: a native season answers with the playoff runtime's own
 * seeds (lib/playoff-runtime/playoffSeedPreview.ts), flagged `projected` until the bracket exists; a
 * league without one keeps reading the stored `FantasyStanding.playoffSeed` rows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  preview: null as null | { locked: boolean; seeds: Array<Record<string, unknown>> },
  stored: [] as Array<Record<string, unknown>>,
  all: [] as Array<Record<string, unknown>>,
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
  h.all = [{ rosterId: 'generic-rt-west', wins: 8, pointsFor: 1440 }]
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
