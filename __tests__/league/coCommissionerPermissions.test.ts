import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Co-commissioner permissions at the gate (lib/league/permissions.ts): a co-commissioner the head
 * commissioner limited is refused outside the granted areas, everywhere `requireCommissionerRole` /
 * `hasLeagueCommissionerRights` is called with a scope. Prisma is a fake that filters by the `where`
 * actually sent.
 */

const m = vi.hoisted(() => ({
  league: { findFirst: vi.fn() },
  leagueTeam: { findFirst: vi.fn(), findMany: vi.fn() },
  roster: { findFirst: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: m }))

import { hasLeagueCommissionerRights, requireCommissionerRole } from '@/lib/league/permissions'
import { CO_COMMISSIONER_SCOPES_KEY } from '@/lib/league/coCommissionerScopes'

type Team = { id: string; claimedByUserId: string; isCommissioner: boolean; isCoCommissioner: boolean; role: string }
let settings: Record<string, unknown>
let teams: Team[]

beforeEach(() => {
  vi.clearAllMocks()
  settings = {}
  teams = [
    { id: 'tCo', claimedByUserId: 'co', isCommissioner: false, isCoCommissioner: true, role: 'member' },
    { id: 'tMem', claimedByUserId: 'mem', isCommissioner: false, isCoCommissioner: false, role: 'member' },
  ]
  m.league.findFirst.mockImplementation(async ({ where, select }: { where: { id: string }; select?: Record<string, unknown> }) => {
    if (where.id !== 'L') return null
    const row: Record<string, unknown> = { userId: 'owner', settings }
    if (select && 'teams' in select) {
      const uid = (select.teams as { where: { claimedByUserId: string } }).where.claimedByUserId
      row.teams = teams.filter((t) => t.claimedByUserId === uid)
    }
    return row
  })
  m.leagueTeam.findFirst.mockImplementation(async ({ where }: { where: { leagueId: string; claimedByUserId: string } }) =>
    where.leagueId === 'L' ? teams.find((t) => t.claimedByUserId === where.claimedByUserId) ?? null : null)
  m.leagueTeam.findMany.mockImplementation(async ({ where }: { where: { leagueId: string; claimedByUserId: string; isCoCommissioner: boolean } }) =>
    teams.filter((t) => where.leagueId === 'L' && t.claimedByUserId === where.claimedByUserId && t.isCoCommissioner === where.isCoCommissioner))
  m.roster.findFirst.mockResolvedValue(null)
})

async function gate(userId: string, scope?: Parameters<typeof requireCommissionerRole>[2]) {
  try {
    await requireCommissionerRole('L', userId, scope)
    return { status: 200 as number, body: null as null | Record<string, unknown> }
  } catch (e) {
    const r = e as Response
    return { status: r.status, body: (await r.json()) as Record<string, unknown> }
  }
}

describe('requireCommissionerRole with a scope', () => {
  it('an unconfigured co-commissioner keeps every area (no regression for existing leagues)', async () => {
    expect((await gate('co', 'money')).status).toBe(200)
    expect((await gate('co', ['trades', 'scoring'])).status).toBe(200)
  })

  it('a limited co-commissioner is refused outside the grant, and told which area', async () => {
    settings = { [CO_COMMISSIONER_SCOPES_KEY]: { tCo: ['trades'] } }
    expect((await gate('co', 'trades')).status).toBe(200)
    const refused = await gate('co', 'money')
    expect(refused.status).toBe(403)
    expect(refused.body).toMatchObject({ missingScopes: ['money'] })
    expect(String(refused.body?.error)).toContain('money')
    // a multi-area change needs every area; only the missing one is named
    expect((await gate('co', ['trades', 'rosters'])).body).toMatchObject({ missingScopes: ['rosters'] })
  })

  it('with no scope named, any co-commissioner still passes (reads and unscoped routes)', async () => {
    settings = { [CO_COMMISSIONER_SCOPES_KEY]: { tCo: [] } }
    expect((await gate('co')).status).toBe(200)
    expect((await gate('co', 'league')).status).toBe(403)
  })

  it('the head commissioner is never limited', async () => {
    settings = { [CO_COMMISSIONER_SCOPES_KEY]: { tCo: [] } }
    expect((await gate('owner', ['money', 'chat'])).status).toBe(200)
    expect(m.leagueTeam.findMany).not.toHaveBeenCalled()
  })

  it('a member is still refused, scope or not', async () => {
    expect((await gate('mem', 'trades')).status).toBe(403)
    expect((await gate('mem')).status).toBe(403)
  })

  it('a tournament-granted co-commissioner (no team) holds every area', async () => {
    settings = { tournamentCoCommissionerIds: ['tourn'], [CO_COMMISSIONER_SCOPES_KEY]: { tCo: [] } }
    expect((await gate('tourn', 'money')).status).toBe(200)
  })
})

describe('hasLeagueCommissionerRights with a scope', () => {
  it('limits a configured co-commissioner team and nobody else', async () => {
    settings = { [CO_COMMISSIONER_SCOPES_KEY]: { tCo: ['rosters'] } }
    expect(await hasLeagueCommissionerRights('L', 'co', 'rosters')).toBe(true)
    expect(await hasLeagueCommissionerRights('L', 'co', 'trades')).toBe(false)
    expect(await hasLeagueCommissionerRights('L', 'co')).toBe(true)
    expect(await hasLeagueCommissionerRights('L', 'owner', 'trades')).toBe(true)
    expect(await hasLeagueCommissionerRights('L', 'mem', 'trades')).toBe(false)
  })

  it('a team flagged isCommissioner (imported head) is never limited', async () => {
    teams[0].isCommissioner = true
    settings = { [CO_COMMISSIONER_SCOPES_KEY]: { tCo: [] } }
    expect(await hasLeagueCommissionerRights('L', 'co', 'money')).toBe(true)
  })
})
