/**
 * @vitest-environment node
 *
 * The readers of the chopped team's players (lib/guillotine/choppedReleases.ts): the league home's chop
 * moment marks a player picked up since as Claimed, and the war room's pool leaves him out.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  league: null as unknown,
  releases: [] as Array<Record<string, unknown>>,
  claimed: new Set<string>(),
}))

vi.mock('@/lib/prisma', () => {
  const models: Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>> = {
    guillotineWaiverRelease: { findMany: async () => state.releases },
    guillotineRosterState: { findMany: async () => [{ rosterId: 'R-b', choppedInPeriod: 3, choppedAt: new Date('2026-11-04') }] },
    guillotinePeriodScore: { findMany: async () => [{ rosterId: 'R-b', weekOrPeriod: 3, periodPoints: 61 }] },
  }
  const fallback = (method: string) => async () => (method === 'findMany' ? [] : method === 'findUnique' ? state.league : null)
  const model = (name: string) => new Proxy({}, { get: (_t, method: string) => models[name]?.[method] ?? fallback(method) })
  return { prisma: new Proxy({}, { get: (_t, name: string) => model(name) }) }
})
vi.mock('@/lib/guillotine/choppedReleases', () => ({ claimedPlayerIds: vi.fn(async () => state.claimed) }))
vi.mock('@/lib/guillotine/GuillotineDangerEngine', () => ({ getDangerTiers: vi.fn(async () => []) }))
vi.mock('@/lib/guillotine/rosterDisplayNames', () => ({ resolveRosterDisplayNames: vi.fn(async () => new Map([['R-b', 'Bricklayers']])) }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async () => ({ isMember: true, isCommissioner: false })) }))
vi.mock('@/lib/league/getEffectiveLeagueRosterTemplate', () => ({ getEffectiveLeagueRosterTemplate: vi.fn(async () => ({ template: { slots: [] } })) }))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({ getGuillotineConfig: vi.fn(async () => null) }))
vi.mock('@/lib/redraft-war-room/redraftFreeAgentPool', () => ({ fetchAdpByPlayerKey: vi.fn(async () => new Map()) }))
vi.mock('@/lib/redraft-war-room/redraftInjuryNews', () => ({
  fetchRedraftInjuryNews: vi.fn(async () => ({ injuryByName: new Map(), newsCount: 0, injuriesAsOf: null })),
  injuryNameKey: (n: string) => String(n ?? '').trim().toLowerCase(),
}))

import { buildGuillotineHomeExtras } from '@/lib/league-specialty/guillotineHome'
import { buildGuillotineWarRoomContext } from '@/lib/guillotine-war-room/guillotineWarRoomContext'

const release = (playerId: string) => ({
  playerId, playerName: playerId.toUpperCase(), position: 'pg', team: 'BOS', eliminatedRosterId: 'rr-b',
  availableAt: new Date('2026-11-04T05:00:00Z'), releaseStatus: 'pending',
})

beforeEach(() => {
  state.releases = [release('p1'), release('p2')]
  state.claimed = new Set(['p2'])
})

describe('the chopped team’s players, as members see them', () => {
  it('the home’s chop moment lists them, and one picked up since reads as Claimed', async () => {
    state.league = { season: 2026 }
    const home = await buildGuillotineHomeExtras('L1', 'NBA', 4)
    expect(home.lastChop?.releases.map((r) => [r.playerId, r.position, r.status])).toEqual([['p1', 'PG', 'pending'], ['p2', 'PG', 'claimed']])
  })

  it('the war room’s pool is who is still out there: a claimed player is left out', async () => {
    state.league = { sport: 'NBA', season: 2026, guillotineMode: true, leagueVariant: 'guillotine', settings: {}, rosters: [], teams: [] }
    const res = await buildGuillotineWarRoomContext({ leagueId: 'L1', userId: 'u' })
    if (!res.ok) throw new Error(res.error)
    expect(res.context.droppedPlayers.map((p) => p.playerId)).toEqual(['p1'])
  })
})
