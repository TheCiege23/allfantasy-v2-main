// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { id: string; userId: string; platform: string; platformLeagueId: string; settings: Record<string, unknown> }
const h = vi.hoisted(() => ({
  leagues: {} as Record<string, Row>,
  teams: [] as Array<{ leagueId: string; externalId: string; teamName: string; ownerName: string | null; claimedByUserId: string | null }>,
  snapshots: {} as Record<string, { standings: Array<{ team: string; fantraxTeamId: string }> }>,
  head: false,
  own: null as unknown,
  resolve: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async (q: { where: { id: string } }) => h.leagues[q.where.id] ?? null),
      findMany: vi.fn(async (q: { where: { id: { in: string[] } } }) => q.where.id.in.map((id) => h.leagues[id]).filter(Boolean)),
      count: vi.fn(async (q: { where: { id: { in: string[] }; userId: string } }) =>
        q.where.id.in.filter((id) => h.leagues[id]?.userId === q.where.userId).length),
      update: vi.fn(async (q: { where: { id: string }; data: { settings: Record<string, unknown> } }) => {
        h.leagues[q.where.id]!.settings = q.data.settings
        return h.leagues[q.where.id]
      }),
    },
    leagueTeam: {
      findMany: vi.fn(async (q: { where: { leagueId: string | { in: string[] }; claimedByUserId?: string } }) =>
        h.teams.filter((t) =>
          (typeof q.where.leagueId === 'string' ? t.leagueId === q.where.leagueId : q.where.leagueId.in.includes(t.leagueId)) &&
          (q.where.claimedByUserId === undefined || t.claimedByUserId === q.where.claimedByUserId))),
    },
    fantraxLeague: { findUnique: vi.fn(async (q: { where: { id: string } }) => h.snapshots[q.where.id] ?? null) },
  },
}))
vi.mock('@/lib/league/commissionerAccess', () => ({ canCommissionerAct: vi.fn(async () => h.head) }))
vi.mock('@/lib/core-app/leaguePairing', () => ({ resolvePairedHalf: h.resolve }))

import { readLeaguePair, recordLeaguePair, resolveCollegeProPair } from '@/lib/league/collegePro/leaguePair'

const PEACH = 'peach'
const CREAM = 'cream'

beforeEach(() => {
  h.head = false
  h.own = null
  h.leagues = {
    [PEACH]: { id: PEACH, userId: 'commish', platform: 'sleeper', platformLeagueId: 'sl-1', settings: {} },
    [CREAM]: { id: CREAM, userId: 'commish', platform: 'fantrax', platformLeagueId: 'snap-cream', settings: {} },
  }
  // Peach Bowl (Sleeper): externalId is the Sleeper roster id. Cream Bowl's claim rows carry the import's own id.
  h.teams = [
    { leagueId: PEACH, externalId: '8', teamName: '(F) SF TEP', ownerName: 'TheCiege24', claimedByUserId: 'commish' },
    { leagueId: PEACH, externalId: '5', teamName: 'Connor0488', ownerName: 'Connor0488', claimedByUserId: 'connor' },
    { leagueId: PEACH, externalId: '11', teamName: 'GrindingFFB', ownerName: 'GrindingFFB', claimedByUserId: null },
    { leagueId: CREAM, externalId: '789336590', teamName: 'Ciege82', ownerName: null, claimedByUserId: 'commish' },
    { leagueId: CREAM, externalId: '555', teamName: 'Grindingffb', ownerName: null, claimedByUserId: 'grinder' },
  ]
  h.snapshots = {
    'snap-cream': { standings: [
      { team: 'Ciege82', fantraxTeamId: 'ciege' }, { team: 'Connor0488', fantraxTeamId: 'conn' }, { team: 'Grindingffb', fantraxTeamId: 'grind' },
    ] },
  }
  h.resolve.mockReset().mockImplementation(async (_leagueId: string, owner: string) => (owner === 'commish-own' ? h.own : h.own))
})

describe('recording a pair on the league', () => {
  it('the person who imported both halves makes it the league’s, on both rows', async () => {
    expect(await recordLeaguePair({ proLeagueId: PEACH, collegeLeagueId: CREAM, linkedByUserId: 'commish' })).toBe('recorded')
    expect(readLeaguePair(h.leagues[PEACH]!.settings)).toMatchObject({ role: 'pro', otherLeagueId: CREAM, linkedByUserId: 'commish' })
    expect(readLeaguePair(h.leagues[CREAM]!.settings)).toMatchObject({ role: 'college', otherLeagueId: PEACH })
    expect(await recordLeaguePair({ proLeagueId: PEACH, collegeLeagueId: CREAM, linkedByUserId: 'commish' })).toBe('unchanged')
  })

  it('anyone else cannot make a pair the league’s', async () => {
    expect(await recordLeaguePair({ proLeagueId: PEACH, collegeLeagueId: CREAM, linkedByUserId: 'connor' })).toBe('refused')
    expect(readLeaguePair(h.leagues[PEACH]!.settings)).toBeNull()
  })

  it('a head commissioner who did not import both may', async () => {
    h.leagues[CREAM]!.userId = 'someone-else'
    h.head = true
    expect(await recordLeaguePair({ proLeagueId: PEACH, collegeLeagueId: CREAM, linkedByUserId: 'commish' })).toBe('recorded')
  })
})

describe('every member sees the league as one', () => {
  beforeEach(async () => {
    await recordLeaguePair({ proLeagueId: PEACH, collegeLeagueId: CREAM, linkedByUserId: 'commish' })
    h.resolve.mockReset().mockImplementation(async (_leagueId: string, owner: string) => (owner === 'commish' ? { sides: [] } : null))
  })

  const teamForOf = () => {
    const call = h.resolve.mock.calls.find((c) => (c[2] as { viewer?: unknown } | undefined)?.viewer)
    expect(call?.[1]).toBe('commish') // the linker's link and data...
    const viewer = (call![2] as { viewer: { userId: string; teamFor: (m: { role: string; platform: string; leagueId: string }) => string | null } }).viewer
    return viewer
  }

  it('a manager who claimed only their Sleeper team gets their Fantrax team from the automatic match', async () => {
    expect(await resolveCollegeProPair(PEACH, 'connor')).toEqual({ sides: [] })
    const viewer = teamForOf()
    expect(viewer.userId).toBe('connor') // ...described for them
    expect(viewer.teamFor({ role: 'pro', platform: 'sleeper', leagueId: PEACH })).toBe('5')
    expect(viewer.teamFor({ role: 'college', platform: 'fantrax', leagueId: 'snap-cream' })).toBe('Connor0488')
  })

  it('a manager who claimed only their Fantrax team gets their Sleeper team through the same match, reversed', async () => {
    await resolveCollegeProPair(CREAM, 'grinder')
    const viewer = teamForOf()
    expect(viewer.teamFor({ role: 'college', platform: 'fantrax', leagueId: 'snap-cream' })).toBe('Grindingffb')
    expect(viewer.teamFor({ role: 'pro', platform: 'sleeper', leagueId: PEACH })).toBe('11')
  })

  it("a commissioner's saved choice decides a member's other team over the automatic match", async () => {
    h.leagues[PEACH]!.settings = { ...h.leagues[PEACH]!.settings, collegeProTeamMap: { '5': 'grind' } }
    await resolveCollegeProPair(PEACH, 'connor')
    expect(teamForOf().teamFor({ role: 'college', platform: 'fantrax', leagueId: 'snap-cream' })).toBe('Grindingffb')
  })

  it('someone with a team in neither half sees no pair', async () => {
    expect(await resolveCollegeProPair(PEACH, 'stranger')).toBeNull()
    expect(h.resolve.mock.calls.some((c) => (c[2] as { viewer?: unknown } | undefined)?.viewer)).toBe(false)
  })
})

describe('existing pairs reach everyone with no new setup', () => {
  it("the linker opening their own pair quietly makes it the league's", async () => {
    h.resolve.mockReset().mockResolvedValue({ sides: [{ role: 'pro', leagueId: PEACH }, { role: 'college', leagueId: CREAM }] })
    await resolveCollegeProPair(PEACH, 'commish')
    expect(readLeaguePair(h.leagues[PEACH]!.settings)?.otherLeagueId).toBe(CREAM)
  })
})
