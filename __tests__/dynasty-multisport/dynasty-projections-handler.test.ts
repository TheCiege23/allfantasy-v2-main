import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./handlerHarness')).prismaMock }))
vi.mock('@/lib/api/require-league-access', () => ({
  requireLeagueApiAccess: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/player-identity/findSportsPlayerByLeagueId', () => ({
  findSportsPlayersForLeague: vi.fn(async () => new Map()),
}))
vi.mock('@/lib/dynasty-engine/DynastyQueryService', () => ({
  getDynastyProjectionsForLeague: vi.fn(async () => []),
}))
vi.mock('@/lib/dynasty-engine/DynastyProjectionGenerator', async () => {
  const h = await import('./handlerHarness')
  return {
    generateDynastyProjection: vi.fn(async (input: any) => {
      h.state.generatedInputs.push(input)
      return {
        projectionId: `p-${input.teamId}`,
        teamId: input.teamId,
        leagueId: input.leagueId,
        sport: input.leagueContext.sport,
        championshipWindowScore: 50,
        rebuildProbability: 50,
        rosterStrength3Year: input.players.length,
        rosterStrength5Year: input.players.length,
        agingRiskScore: 0,
        futureAssetScore: 0,
        createdAt: new Date().toISOString(),
      }
    }),
  }
})

import { GET, POST } from '@/app/api/leagues/[leagueId]/dynasty-projections/handler'
import { ctx, makeReq, setLeague, state } from './handlerHarness'

const valueOf = (playerId: string) =>
  state.generatedInputs.flatMap((i: any) => i.players).find((p: any) => p.playerId === playerId)?.dynastyValue

describe('dynasty-projections handler', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-04-15T12:00:00Z'))
  })
  afterAll(() => vi.useRealTimers())

  it('does not fabricate players for an empty roster — the team is skipped and reported', async () => {
    setLeague('NHL', [
      { externalId: 'FULL', players: [{ id: 'n1', name: 'Center', position: 'C', birthYear: 2000 }] },
      { externalId: 'EMPTY', players: [] },
    ])
    const res = await GET(makeReq('refresh=1'), ctx)
    const body = await res.json()
    expect(res.status).toBe(200)

    const allPlayers = state.generatedInputs.flatMap((i: any) => i.players)
    expect(allPlayers.some((p: any) => String(p.playerId).startsWith('synthetic-'))).toBe(false)
    expect(state.generatedInputs.map((i: any) => i.teamId)).toEqual(['FULL'])
    expect(body.projections.map((p: any) => p.teamId)).toEqual(['FULL'])
    expect(body.skippedTeams).toEqual([{ teamId: 'EMPTY', reason: 'empty_roster' }])
    expect(body.playerValueSource).toBe('estimated')
  })

  it('an all-empty league returns an empty projection list (shape the panel already handles)', async () => {
    setLeague('MLB', [{ externalId: 'A', players: [] }, { externalId: 'B', players: [] }])
    const res = await POST({ json: async () => ({}) } as any, ctx)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.projections).toEqual([])
    expect(body.skippedTeams.map((t: any) => t.teamId)).toEqual(['A', 'B'])
    expect(state.generatedInputs).toEqual([])
  })

  it('"C" is priced per sport — MLB catcher, NBA center and NHL center no longer share one value', async () => {
    const values: Record<string, number> = {}
    for (const sport of ['MLB', 'NBA', 'NHL']) {
      setLeague(sport, [{ externalId: 'A', players: [{ id: `c-${sport}`, name: 'C', position: 'C', birthYear: 2000 }] }])
      await GET(makeReq('refresh=1'), ctx)
      values[sport] = valueOf(`c-${sport}`)
    }
    // Before: one table, "C" = 6300 x age for all three. A 27-year-old MLB catcher is not a premium center.
    expect(values.MLB).toBeLessThan(values.NBA)
    expect(values.MLB).toBeLessThan(values.NHL)
  })

  it('"G" is priced per sport — NBA guard vs NHL goalie', async () => {
    const values: Record<string, number> = {}
    for (const sport of ['NBA', 'NHL']) {
      setLeague(sport, [{ externalId: 'A', players: [{ id: `g-${sport}`, name: 'G', position: 'G', birthYear: 2000 }] }])
      await GET(makeReq('refresh=1'), ctx)
      values[sport] = valueOf(`g-${sport}`)
    }
    expect(values.NBA).not.toBe(values.NHL)
  })

  it('a soccer DEF is not priced as an NFL team defense', async () => {
    setLeague('SOCCER', [{ externalId: 'A', players: [{ id: 's-def', name: 'D', position: 'DEF', birthYear: 2000 }] }])
    await GET(makeReq('refresh=1'), ctx)
    const soccerDef = valueOf('s-def')
    setLeague('NFL', [{ externalId: 'A', players: [{ id: 'n-def', name: 'D', position: 'DEF', birthYear: 2000 }] }])
    await GET(makeReq('refresh=1'), ctx)
    const nflDef = valueOf('n-def')
    expect(soccerDef).toBeGreaterThan(nflDef)
  })

  it('unknown positions outside NFL take the sport floor, not a flat 5200', async () => {
    setLeague('NBA', [{ externalId: 'A', players: [{ id: 'x', name: 'X', position: 'ZZ', birthYear: 2000 }] }])
    await GET(makeReq('refresh=1'), ctx)
    expect(valueOf('x')).not.toBe(5200)
  })
})
