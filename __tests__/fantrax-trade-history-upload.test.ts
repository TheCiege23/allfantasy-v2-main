// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Fantrax trade-history upload: commissioner only, Fantrax leagues only, Postgres only, and the export's
 * trades reach the shared `LeagueTrade` writer with the league's own ids. Prisma and the writer are mocked.
 */
const m = vi.hoisted(() => ({
  userId: 'u-comm' as string | null,
  commissioner: true,
  league: { platform: 'fantrax', platformLeagueId: 'af-fx-1', sport: 'NFL' } as Record<string, unknown> | null,
  persisted: [] as Array<{ platformLeagueId: string; season: number; facts: unknown[]; owners: Map<string, string>; platform: string; sport: string }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: async () => (m.userId ? { user: { id: m.userId } } : null) }))
vi.mock('@/lib/league/commissionerAccess', () => ({ canCommissionerAct: async () => m.commissioner }))
vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (h: unknown) => h }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => m.league) },
    leagueTeam: {
      findMany: vi.fn(async () => [
        { externalId: '101', teamName: 'Harbor Owls', platformUserId: 'fantrax-user:owl' },
        { externalId: '202', teamName: 'Mesa Comets', platformUserId: 'fantrax-manager:mesa-comets' },
      ]),
    },
    playerIdentityMap: {
      findMany: vi.fn(async () => [{ fantraxId: 'fx-qb1', canonicalName: 'Quarterback One', currentTeam: 'PHI', position: 'QB' }]),
    },
  },
}))
vi.mock('@/lib/dynasty-import/normalize-historical', () => ({
  persistTradesForSeason: vi.fn(async (platformLeagueId: string, season: number, facts: unknown[], owners: Map<string, string>, platform: string, sport: string) => {
    m.persisted.push({ platformLeagueId, season, facts, owners, platform, sport })
    return facts.length * 2
  }),
}))

import { POST } from '@/server/api-route-modules/legacy/fantrax/trade-history/route'

const H = '"Player","Team","Position","From","To","# Obj","Date (EST)","Week"'
const GOOD = [
  H,
  '"2027 Draft Pick, Round 1 (#3 Harbor Owls)","","","#3 Harbor Owls","#9 Mesa Comets","0","Mon Nov 16, 2026, 7:57PM","10"',
  '"Budget Amount: $5000.00","","","#3 Harbor Owls","#9 Mesa Comets","0","Mon Nov 16, 2026, 7:57PM","10"',
  '"Quarterback One","PHI","SFX","#9 Mesa Comets","#3 Harbor Owls","0","Mon Nov 16, 2026, 7:57PM","10"',
  '"Unknown Player","KC","WR","#9 Mesa Comets","#3 Harbor Owls","0","Sun Oct 4, 2026, 1:00PM","5"',
  '"2027 Draft Pick, Round 2 (#3 Harbor Owls)","","","#3 Harbor Owls","#9 Mesa Comets","0","Sun Oct 4, 2026, 1:00PM","5"',
].join('\n')

const req = (fields: Record<string, string | Blob>) => {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return new Request('http://x/api/legacy/fantrax/trade-history', { method: 'POST', body: form }) as never
}
const call = (fields: Record<string, string | Blob>) => (POST as unknown as (r: never) => Promise<Response>)(req(fields))

beforeEach(() => {
  m.userId = 'u-comm'
  m.commissioner = true
  m.league = { platform: 'fantrax', platformLeagueId: 'af-fx-1', sport: 'NFL' }
  m.persisted.length = 0
})

describe('POST /api/legacy/fantrax/trade-history', () => {
  it('writes the trades it can place under the league ids, and reports the one it cannot', async () => {
    const res = await call({ leagueId: 'lg-1', file: new Blob([GOOD], { type: 'text/csv' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, imported: 1, rowsWritten: 2, skippedLines: [] })
    expect(body.refused).toHaveLength(1)
    expect(body.refused[0].reasons[0]).toMatch(/Unknown Player KC WR could not be matched/)
    expect(m.persisted).toHaveLength(1)
    const p = m.persisted[0]!
    expect([p.platformLeagueId, p.season, p.platform, p.sport]).toEqual(['af-fx-1', 2026, 'fantrax', 'nfl'])
    expect(p.facts[0]).toMatchObject({ adds: { 'fx-qb1': '101' }, waiverBudget: [{ sender: '101', receiver: '202', amount: 5000 }] })
    expect(p.owners.get('101')).toBe('fantrax-user:owl')
  })

  it('refuses before reading anything: signed out 401, not commissioner 403, no file 400', async () => {
    m.userId = null
    expect((await call({ leagueId: 'lg-1', file: new Blob([GOOD]) })).status).toBe(401)
    m.userId = 'u-member'
    m.commissioner = false
    expect((await call({ leagueId: 'lg-1', file: new Blob([GOOD]) })).status).toBe(403)
    m.commissioner = true
    expect((await call({ leagueId: 'lg-1' })).status).toBe(400)
    expect(m.persisted).toEqual([])
  })

  it('refuses a league that is not Fantrax, or has an unsupported sport, and a file that is not the export', async () => {
    m.league = { platform: 'sleeper', platformLeagueId: 'x', sport: 'NFL' }
    expect((await call({ leagueId: 'lg-1', file: new Blob([GOOD]) })).status).toBe(409)
    m.league = { platform: 'fantrax', platformLeagueId: 'x', sport: 'TENNIS' }
    expect((await call({ leagueId: 'lg-1', file: new Blob([GOOD]) })).status).toBe(409)
    m.league = { platform: 'fantrax', platformLeagueId: 'x', sport: 'NFL' }
    const bad = await call({ leagueId: 'lg-1', file: new Blob(['"Player","Team"\n"A","KC"']) })
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toMatch(/not a Fantrax trade history export/)
    expect(m.persisted).toEqual([])
  })
})
