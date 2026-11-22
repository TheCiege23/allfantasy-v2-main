/**
 * Handing a league to its main commissioner (owner's rule, 2026-11-22): it works for an imported
 * league, where people are seated by a claimed team rather than a roster, and the person handing
 * over stays on as co-commissioner.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  league: null as Record<string, any> | null,
  roster: null as { id: string } | null,
  team: null as { id: string } | null,
  refused: null as unknown,
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'first' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/commissionerAccess', () => ({ commissionerAccessResponse: vi.fn(async () => h.refused) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async () => (h.league ? { ...h.league } : null)),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.league = { ...h.league!, ...data }
        return h.league
      }),
    },
    roster: { findFirst: vi.fn(async () => h.roster) },
    leagueTeam: { findFirst: vi.fn(async () => h.team) },
  },
}))

import { POST } from '@/app/api/commissioner/leagues/[leagueId]/transfer/route'

const send = (body: unknown) =>
  POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ leagueId: 'L1' }) })

beforeEach(() => {
  h.league = { id: 'L1', userId: 'first', settings: { keep: 1 } }
  h.roster = null
  h.team = null
  h.refused = null
})

describe('POST commissioner transfer', () => {
  it('hands an imported league to someone who claimed a team, and keeps the old owner as co-commissioner', async () => {
    h.team = { id: 'T9' }
    const res = await send({ newCommissionerUserId: 'main', confirm: true })
    expect(res.status).toBe(200)
    expect(h.league!.userId).toBe('main')
    expect(h.league!.settings).toEqual({ keep: 1, importCoCommissionerIds: ['first'] })
  })

  it('takes the new commissioner off the co-commissioner list', async () => {
    h.league!.settings = { importCoCommissionerIds: ['main', 'other'] }
    const res = await send({ newCommissionerUserId: 'main', confirm: true })
    expect(res.status).toBe(200)
    expect(h.league!.settings.importCoCommissionerIds).toEqual(['first', 'other'])
  })

  it('still accepts a hosted league roster', async () => {
    h.roster = { id: 'R1' }
    expect((await send({ newCommissionerUserId: 'main', confirm: true })).status).toBe(200)
  })

  it('refuses someone who is not in the league, and changes nothing', async () => {
    const res = await send({ newCommissionerUserId: 'stranger', confirm: true })
    expect(res.status).toBe(400)
    expect(h.league!.userId).toBe('first')
  })
})
