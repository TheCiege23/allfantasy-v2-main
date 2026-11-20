/**
 * The commissioner's contract upload for an imported salary cap league
 * (app/api/leagues/[leagueId]/salary-cap/contracts/import/route.ts).
 *
 * What a commissioner must be able to rely on: a check saves nothing, only they can save, saving
 * replaces their earlier upload and nothing else, and a hosted league is refused.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: { user: { id: 'u-commish' } } as { user?: { id?: string } } | null,
  commissioner: true,
  capLeague: true,
  league: { platform: 'sleeper', sport: 'NFL' } as { platform: string; sport: string } | null,
  deleteMany: vi.fn(async (_args: unknown) => ({ count: 3 })),
  createMany: vi.fn(async (args: { data: unknown[] }) => ({ count: args.data.length })),
  logAction: vi.fn(async (_entry: unknown) => undefined),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => h.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/commissionerAccess', () => ({ canCommissionerAct: vi.fn(async () => h.commissioner) }))
vi.mock('@/lib/salary-cap/SalaryCapLeagueConfig', () => ({
  isSalaryCapLeague: vi.fn(async () => h.capLeague),
  getSalaryCapConfig: vi.fn(async () => ({ configId: 'cfg-1', startupCap: 100 })),
}))
vi.mock('@/server/services/auditService', () => ({ logAction: h.logAction }))
vi.mock('@/lib/prisma', () => {
  const tx = { playerContract: { deleteMany: h.deleteMany, createMany: h.createMany } }
  return {
    prisma: {
      league: { findUnique: vi.fn(async () => h.league) },
      roster: {
        findMany: vi.fn(async () => [
          { id: 'r1', platformUserId: 'o1', playerData: { players: ['p1', 'p2'] } },
          { id: 'r2', platformUserId: 'o2', playerData: { players: ['p3'] } },
        ]),
      },
      leagueTeam: {
        findMany: vi.fn(async () => [
          { teamName: 'Gridiron Kings', ownerName: 'Sam', platformUserId: 'o1' },
          { teamName: 'Cap Casualties', ownerName: 'Alex', platformUserId: 'o2' },
        ]),
      },
      sportsPlayerRecord: {
        findMany: vi.fn(async () => [
          { id: 'NFL:p1', name: 'Patrick Mahomes', position: 'QB' },
          { id: 'NFL:p2', name: 'Travis Kelce', position: 'TE' },
          { id: 'NFL:p3', name: 'Josh Allen', position: 'QB' },
        ]),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  }
})

import { POST } from '@/app/api/leagues/[leagueId]/salary-cap/contracts/import/route'

const SHEET = 'Team, Player, Salary, Years, Year\nGridiron Kings, Patrick Mahomes, 45, 4, 2\nCap Casualties, Josh Allen, 60, 3\nGridiron Kings, Nobody Real, 5, 1'

const post = async (body: unknown) => {
  const req = new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(body) })
  const res = await POST(req as never, { params: Promise.resolve({ leagueId: 'L1' }) })
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}

beforeEach(() => {
  h.session = { user: { id: 'u-commish' } }
  h.commissioner = true
  h.capLeague = true
  h.league = { platform: 'sleeper', sport: 'NFL' }
  h.deleteMany.mockClear()
  h.createMany.mockClear()
  h.logAction.mockClear()
})

describe('checking the sheet', () => {
  it('reports what matched and what did not, and saves nothing', async () => {
    const { status, json } = await post({ text: SHEET })
    expect(status).toBe(200)
    expect(json.saved).toBe(false)
    expect(json.matched.map((m: any) => m.playerName)).toEqual(['Patrick Mahomes', 'Josh Allen'])
    expect(json.problems).toHaveLength(1)
    expect(json.problems[0].line).toBe(4)
    expect(json.totals).toEqual([
      // biggest cap hit first
      expect.objectContaining({ rosterId: 'r2', contracts: 1, capHit: 60 }),
      expect.objectContaining({ rosterId: 'r1', contracts: 1, capHit: 45 }),
    ])
    expect(json.startupCap).toBe(100)
    expect(h.deleteMany).not.toHaveBeenCalled()
    expect(h.createMany).not.toHaveBeenCalled()
  })
})

describe('saving', () => {
  it('writes the matched rows and replaces only the commissioner’s earlier upload', async () => {
    const { status, json } = await post({ text: SHEET, confirm: true })
    expect(status).toBe(200)
    expect(json).toMatchObject({ saved: true, savedCount: 2, replacedCount: 3 })
    expect(h.deleteMany).toHaveBeenCalledWith({ where: { configId: 'cfg-1', source: 'commissioner_import' } })
    const rows = h.createMany.mock.calls[0][0].data as Array<Record<string, unknown>>
    const year = new Date().getFullYear()
    expect(rows).toEqual([
      expect.objectContaining({ leagueId: 'L1', configId: 'cfg-1', rosterId: 'r1', playerId: 'p1', salary: 45, yearsTotal: 4, contractYear: 2, yearSigned: year - 1, status: 'active', source: 'commissioner_import' }),
      expect.objectContaining({ rosterId: 'r2', playerId: 'p3', salary: 60, yearsTotal: 3, contractYear: 1, yearSigned: year, source: 'commissioner_import' }),
    ])
    expect(h.logAction).toHaveBeenCalledTimes(1)
  })

  it('saves nothing when no row matched', async () => {
    const { status, json } = await post({ text: 'Gridiron Kings, Nobody Real, 5, 1', confirm: true })
    expect(status).toBe(422)
    expect(json.error).toMatch(/nothing was saved/)
    expect(h.deleteMany).not.toHaveBeenCalled()
    expect(h.createMany).not.toHaveBeenCalled()
  })
})

describe('who and where', () => {
  it('a manager who is not the commissioner is refused', async () => {
    h.commissioner = false
    const { status } = await post({ text: SHEET, confirm: true })
    expect(status).toBe(403)
    expect(h.createMany).not.toHaveBeenCalled()
  })

  it('signed out is refused', async () => {
    h.session = null
    expect((await post({ text: SHEET })).status).toBe(401)
  })

  it('a league AllFantasy hosts is refused: its contracts come from the auction', async () => {
    h.league = { platform: 'manual', sport: 'NFL' }
    const { status } = await post({ text: SHEET, confirm: true })
    expect(status).toBe(409)
    expect(h.createMany).not.toHaveBeenCalled()
  })

  it('a league that is not salary cap is refused', async () => {
    h.capLeague = false
    expect((await post({ text: SHEET, confirm: true })).status).toBe(404)
  })

  it('an empty paste is refused', async () => {
    expect((await post({ text: '   ' })).status).toBe(400)
  })
})
