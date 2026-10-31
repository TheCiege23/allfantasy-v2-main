/** PUT /api/leagues/[leagueId]/integrity — the "hold flagged trades" choice, and refusing before writing. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

const m = vi.hoisted(() => {
  const leagueUpdate = vi.fn(async () => ({}))
  const tx = {
    $queryRaw: vi.fn(async () => []),
    league: { findUnique: vi.fn(async () => ({ settings: { other: 1 } })), update: leagueUpdate },
  }
  return {
    leagueUpdate,
    upsert: vi.fn(async () => ({ leagueId: 'L', collusionSensitivity: 'medium' })),
    transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  }
})
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/subscription/requireEntitlement', () => ({ requireEntitlement: vi.fn(async () => 'commish') }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: vi.fn(async () => undefined) }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: vi.fn() }))
vi.mock('@/lib/integrity/coverage', () => ({ buildIntegrityCoverage: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { leagueIntegritySettings: { upsert: m.upsert }, $transaction: m.transaction, league: { findUnique: vi.fn() } },
}))

import { PUT } from '@/app/api/leagues/[leagueId]/integrity/handler'

const put = (body: unknown) =>
  PUT(createMockNextRequest('http://x/api/leagues/L/integrity', { method: 'PUT', body }) as never, { params: Promise.resolve({ leagueId: 'L' }) })

beforeEach(() => vi.clearAllMocks())

describe('PUT integrity settings: hold flagged trades', () => {
  it('stores the chosen mode and returns it', async () => {
    const res = await put({ holdFlaggedTradesMode: 'all' })
    expect(res.status).toBe(200)
    expect(m.leagueUpdate).toHaveBeenCalledWith({ where: { id: 'L' }, data: { settings: { other: 1, integrity_hold_flagged_trades: 'all' } } })
    expect((await res.json()).settings).toMatchObject({ holdFlaggedTradesMode: 'all', holdFlaggedTrades: true })
  })

  it('still takes the older on/off switch', async () => {
    await put({ holdFlaggedTrades: false })
    expect(m.leagueUpdate).toHaveBeenCalledWith({ where: { id: 'L' }, data: { settings: { other: 1, integrity_hold_flagged_trades: 'off' } } })
  })

  it('refuses an unknown choice and writes nothing at all', async () => {
    const res = await put({ holdFlaggedTradesMode: 'sometimes', collusionSensitivity: 'high' })
    expect(res.status).toBe(400)
    expect(m.upsert).not.toHaveBeenCalled()
    expect(m.leagueUpdate).not.toHaveBeenCalled()
  })

  it('a bad tanking penalty edit also writes nothing at all', async () => {
    const res = await put({ tankingPenalties: { pickRound: 99 }, collusionSensitivity: 'high' })
    expect(res.status).toBe(400)
    expect(m.upsert).not.toHaveBeenCalled()
  })
})
