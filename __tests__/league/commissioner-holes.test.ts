// @vitest-environment node
/**
 * The holes the 2026-11-16 permission census found, each now closed through the shared rule
 * (lib/league/commissionerAccess.ts). Each test records the need the route asked for, and refuses when the test says
 * the caller lacks it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const h = vi.hoisted(() => ({
  user: 'member' as string | null,
  allowed: new Set<string>(),
  asked: [] as string[],
  finalize: vi.fn(async () => ({ infectionCount: 0, serumAwards: 0, weaponAwards: 0 })),
  attach: vi.fn(async () => ({})),
  cut: vi.fn(async () => 0),
  assign: vi.fn(async () => ({ id: 'rec' })),
  inactive: vi.fn(async () => []),
  redraftRoster: { ownerId: 'owner-of-r1' } as { ownerId: string } | null,
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => (h.user ? { user: { id: h.user } } : null)) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/commissionerAccess', () => ({
  commissionerAccessResponse: vi.fn(async (_l: string, _u: string, need: string) => {
    h.asked.push(need)
    return h.allowed.has(need) ? null : NextResponse.json({ error: 'refused' }, { status: 403 })
  }),
}))
vi.mock('@/lib/zombie/ZombieLeagueConfig', () => ({ isZombieLeague: vi.fn(async () => true), upsertZombieLeagueConfig: vi.fn() }))
vi.mock('@/lib/zombie/ZombieResultFinalizationService', () => ({ finalizeWeek: h.finalize }))
vi.mock('@/lib/zombie/ZombieUniverseConfig', () => ({ attachLeagueToUniverse: h.attach }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/team-coowners/access', () => ({ isAcceptedCoOwnerForRedraftRoster: vi.fn(async () => false) }))
vi.mock('@/lib/idp/capEngine', () => ({
  assignDraftSalary: h.assign,
  getTeamCapSummary: vi.fn(),
  processExtension: vi.fn(),
  processFranchiseTag: vi.fn(),
  processPlayerCut: h.cut,
}))
vi.mock('@/lib/redraft/ai/requireAfSub', () => ({ requireAfSub: vi.fn(async () => h.user ?? NextResponse.json({}, { status: 401 })) }))
vi.mock('@/lib/redraft/ai/commissionerAssistant', () => ({
  detectInactiveManagers: h.inactive,
  generateRuleRecommendations: vi.fn(async () => []),
  moderateLeagueChat: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    zombieLeague: { findUnique: vi.fn(async () => ({ id: 'z', universeId: null })) },
    zombieUniverse: { findUnique: vi.fn(async () => ({ id: 'u' })) },
    redraftRoster: { findFirst: vi.fn(async () => h.redraftRoster) },
    iDPSalaryRecord: { findFirst: vi.fn(async () => ({ id: 'rec' })) },
    redraftSeason: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === 's1' ? { leagueId: 'L' } : null)) },
  },
}))

import { POST as finalizeWeekRoute } from '@/app/api/leagues/[leagueId]/zombie/finalize/route'
import { POST as attachUniverse } from '@/app/api/leagues/[leagueId]/zombie/attach-universe/route'
import { PATCH as capPatch, POST as capPost } from '@/app/api/idp/cap/route'
import { POST as commissionerAi } from '@/app/api/redraft/ai/commissioner/route'

const params = { params: Promise.resolve({ leagueId: 'L' }) }
const json = (body: unknown) => new Request('https://x', { method: 'POST', body: JSON.stringify(body) }) as never

beforeEach(() => {
  h.user = 'member'
  h.allowed = new Set()
  h.asked = []
  h.redraftRoster = { ownerId: 'owner-of-r1' }
  vi.clearAllMocks()
})

describe('zombie weekly finalize and universe attach are commissioner actions', () => {
  it('a member is refused and nothing runs; league setup lets it run', async () => {
    expect((await finalizeWeekRoute(json({ week: 3 }), params)).status).toBe(403)
    expect((await attachUniverse(json({ universeId: 'u', levelId: 'l' }) as never, params)).status).toBe(403)
    expect(h.finalize).not.toHaveBeenCalled()
    expect(h.attach).not.toHaveBeenCalled()
    expect(h.asked).toEqual(['league', 'league'])
    h.allowed.add('league')
    expect((await finalizeWeekRoute(json({ week: 3 }), params)).status).toBe(200)
    expect(h.finalize).toHaveBeenCalledTimes(1)
  })
})

describe('IDP cap writes are for your own team, or a commissioner with rosters', () => {
  const cut = { leagueId: 'L', rosterId: 'r1', action: 'cut', salaryRecordId: 'rec' }

  it('a member cutting a player on another team is refused, and nothing is cut', async () => {
    const res = await capPatch(json(cut) as never)
    expect(res.status).toBe(403)
    expect(h.asked).toEqual(['rosters'])
    expect(h.cut).not.toHaveBeenCalled()
  })

  it('the team\'s own manager may, without needing any commissioner area', async () => {
    h.user = 'owner-of-r1'
    expect((await capPatch(json(cut) as never)).status).toBe(200)
    expect(h.asked).toEqual([])
    expect(h.cut).toHaveBeenCalledTimes(1)
  })

  it('a commissioner with rosters may act on any team; a team not in the league is a 404', async () => {
    h.allowed.add('rosters')
    expect((await capPatch(json(cut) as never)).status).toBe(200)
    h.redraftRoster = null
    expect((await capPatch(json(cut) as never)).status).toBe(404)
  })

  it('setting a salary is a commissioner action, even for your own team', async () => {
    h.user = 'owner-of-r1'
    const body = { leagueId: 'L', rosterId: 'r1', playerId: 'p', salary: 1 }
    expect((await capPost(json(body) as never)).status).toBe(403)
    expect(h.assign).not.toHaveBeenCalled()
    h.allowed.add('rosters')
    expect((await capPost(json(body) as never)).status).toBe(200)
  })
})

describe('the commissioner AI reads only a league you run', () => {
  it('a subscriber who is not that league\'s commissioner gets nothing back', async () => {
    const res = await commissionerAi(json({ action: 'inactive', seasonId: 's1' }) as never)
    expect(res.status).toBe(403)
    expect(h.inactive).not.toHaveBeenCalled()
    h.allowed.add('league')
    expect((await commissionerAi(json({ action: 'inactive', seasonId: 's1' }) as never)).status).toBe(200)
  })

  it('moderation asks for chat; a season from another league is refused', async () => {
    await commissionerAi(json({ action: 'moderation', leagueId: 'L', message: 'hi' }) as never)
    expect(h.asked).toEqual(['chat'])
    expect((await commissionerAi(json({ action: 'inactive', seasonId: 's1', leagueId: 'OTHER' }) as never)).status).toBe(400)
    expect((await commissionerAi(json({ action: 'inactive', seasonId: 'nope' }) as never)).status).toBe(404)
  })
})
