// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ session: vi.fn(), commish: vi.fn(), access: vi.fn(), paid: vi.fn(), league: vi.fn(), update: vi.fn(), season: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueCommissioner: h.commish }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: h.access }))
vi.mock('@/lib/guillotine/guillotineRulesSave', () => ({ viewerCanEditPaidGuillotineRules: h.paid }))
vi.mock('@/lib/survivor-guillotine/operations', () => ({}))
vi.mock('@/lib/prisma', () => {
  const tx = { $queryRaw: vi.fn(), league: { findUnique: h.league, update: h.update } }
  return { prisma: { ...tx, survivorGuillotineLeague: { findUnique: h.season }, $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } }
})

import { GET, POST } from '@/app/api/leagues/[leagueId]/survivor-guillotine/operations/route'

const ctx = { params: Promise.resolve({ leagueId: 'L' }) }
const post = (body: unknown) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as never, ctx)

beforeEach(() => {
  vi.clearAllMocks()
  h.session.mockResolvedValue({ user: { id: 'u' } })
  h.commish.mockResolvedValue({ ok: true })
  h.access.mockResolvedValue(true)
  h.league.mockResolvedValue({ settings: { other: 1 } })
  h.season.mockResolvedValue({ periodCalendar: {}, currentPeriod: 1, captainElectionDeadlineAt: null })
})

describe('Survivor Guilly: a chopped team\'s FAAB', () => {
  it('the commissioner view reports the rule and whether the paid option is open', async () => {
    h.paid.mockResolvedValue(false)
    const body = await (await GET(new Request('http://x') as never, ctx)).json()
    expect(body).toMatchObject({ faabOnChop: 'keep', canEditPaid: false })
  })

  it('"split" is AF Commissioner: refused without it, saved with it', async () => {
    h.paid.mockResolvedValue(false)
    expect((await post({ action: 'set_faab_on_chop', value: 'split' })).status).toBe(402)
    expect(h.update).not.toHaveBeenCalled()
    h.paid.mockResolvedValue(true)
    expect((await post({ action: 'set_faab_on_chop', value: 'split' })).status).toBe(200)
    expect(h.update.mock.calls[0]![0].data.settings).toEqual({ other: 1, guillotineFaabOnChop: 'split' })
  })

  it('"keep" is always allowed, and only a commissioner may change it', async () => {
    h.paid.mockResolvedValue(false)
    expect((await post({ action: 'set_faab_on_chop', value: 'keep' })).status).toBe(200)
    h.commish.mockResolvedValue({ ok: false, status: 403 })
    expect((await post({ action: 'set_faab_on_chop', value: 'keep' })).status).toBe(403)
  })
})
