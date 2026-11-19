/**
 * PUT /api/leagues/[leagueId]/waiver-budget — an imported league's waiver budget, set by its commissioner.
 *
 * Only where the platform's import records none (Fantrax, Yahoo); the save stamps `waiverBudgetSetAt` so a deliberate
 * 100 is trusted by the grader, and keeps every other settings key.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: vi.fn(),
  refused: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/commissionerAccess', () => ({ commissionerAccessResponse: h.refused }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: h.findUnique, update: h.update, findFirst: vi.fn() } } }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: async () => ({ ok: true }) }))

import { PUT } from '@/app/api/leagues/[leagueId]/waiver-budget/route'
import { hubCopy } from '@/lib/core-app/commissionerHubCopy'

const call = (body: unknown) =>
  PUT(new Request('http://x/api/leagues/lg/waiver-budget', { method: 'PUT', body: JSON.stringify(body) }) as never, {
    params: Promise.resolve({ leagueId: 'lg' }),
  })

beforeEach(() => {
  vi.resetAllMocks()
  h.session.mockResolvedValue({ user: { id: 'u1' } })
  h.refused.mockResolvedValue(null)
  h.findUnique.mockResolvedValue({ platform: 'fantrax', settings: { other: 1 } })
  h.update.mockResolvedValue({})
})

describe('PUT waiver-budget', () => {
  it('saves the budget on a Fantrax league, stamps it, and keeps the other settings', async () => {
    const res = await call({ waiverBudget: 99000 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ waiverBudget: 99000 })
    const data = h.update.mock.calls[0]![0].data
    expect(data.waiverBudget).toBe(99000)
    expect(data.settings.other).toBe(1)
    expect(typeof data.settings.waiverBudgetSetAt).toBe('string')
  })

  it('refuses anyone the commissioner check refuses, before reading or writing', async () => {
    h.refused.mockResolvedValue(new Response(JSON.stringify({ error: 'Only the commissioner can do this.' }), { status: 403 }))
    expect((await call({ waiverBudget: 500 })).status).toBe(403)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('refuses a platform whose import supplies the budget — a typed one would be overwritten on sync', async () => {
    h.findUnique.mockResolvedValue({ platform: 'sleeper', settings: {} })
    expect((await call({ waiverBudget: 500 })).status).toBe(409)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('refuses a budget that is not a whole number of at least 1', async () => {
    for (const waiverBudget of [0, -5, 12.5, 'abc', null, 99_000_000]) {
      expect((await call({ waiverBudget })).status, String(waiverBudget)).toBe(400)
    }
    expect(h.update).not.toHaveBeenCalled()
  })

  it('signed out is 401', async () => {
    h.session.mockResolvedValue(null)
    expect((await call({ waiverBudget: 500 })).status).toBe(401)
  })
})

describe('the control in Spanish', () => {
  it('reads «presupuesto de reclamos», never «waiver», and translates the saved value', () => {
    for (const english of [
      'Waiver budget',
      'Your platform does not send AllFantasy the waiver budget. Enter the budget each team starts the season with, so trades that moved budget can be graded.',
      'Not set: a trade that moved budget shows as not graded.',
      'Enter the budget as a whole number of at least 1.',
    ]) {
      const es = hubCopy(english, 'es')
      expect(es, english).not.toBe(english)
      expect(es.toLowerCase()).not.toContain('waiver')
    }
    expect(hubCopy('Set to 99,000.', 'es')).toBe('Configurado en 99,000.')
  })
})
