/**
 * A pick penalty needs the league's future picks. In a redraft league "Lose a draft pick" — the default — could
 * never apply: a confirmed strike only told the manager "the commissioner will decide" (redraft simulation,
 * 2026-11-09). There the only penalty offered, accepted and stored is FAAB.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

const m = vi.hoisted(() => {
  const leagueUpdate = vi.fn(async () => ({}))
  const league = { platform: 'manual', leagueType: 'redraft', isDynasty: false }
  const tx = {
    $queryRaw: vi.fn(async () => []),
    league: { findUnique: vi.fn(async () => ({ settings: {} })), update: leagueUpdate },
  }
  return {
    league,
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
vi.mock('@/lib/league-rules-explainer/publishRuleChanges', () => ({ publishRuleChangesEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueIntegritySettings: { upsert: m.upsert },
    $transaction: m.transaction,
    league: { findUnique: vi.fn(async () => ({ userId: 'commish', settings: {}, ...m.league })) },
  },
}))

import { PUT } from '@/app/api/leagues/[leagueId]/integrity/handler'

const put = (body: unknown) =>
  PUT(createMockNextRequest('http://x/api/leagues/L/integrity', { method: 'PUT', body }) as never, { params: Promise.resolve({ leagueId: 'L' }) })
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(m.league, { platform: 'manual', leagueType: 'redraft', isDynasty: false })
})

describe('tanking penalties in a league with no future picks (redraft)', () => {
  it.each(['forfeit_pick', 'lottery_odds'])('refuses %s, and writes nothing', async (penalty) => {
    const res = await put({ tankingPenalties: { enabled: true, penalty } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/future picks/)
    expect(m.leagueUpdate).not.toHaveBeenCalled()
    expect(m.upsert).not.toHaveBeenCalled()
  })

  it('switching penalties on without a choice stores the FAAB penalty, not the pick default', async () => {
    const res = await put({ tankingPenalties: { enabled: true } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.settings.tankingPickPenaltiesSupported).toBe(false)
    expect(body.settings.tankingPenalties).toMatchObject({ enabled: true, penalty: 'faab' })
  })

  it('accepts the FAAB penalty', async () => {
    const res = await put({ tankingPenalties: { enabled: true, penalty: 'faab', faabPercent: 25 } })
    expect(res.status).toBe(200)
    expect((await res.json()).settings.tankingPenalties).toMatchObject({ penalty: 'faab', faabPercent: 25 })
  })
})

describe('a dynasty league run here keeps every penalty', () => {
  it('accepts losing a draft pick', async () => {
    Object.assign(m.league, { platform: 'manual', leagueType: 'dynasty', isDynasty: true })
    const res = await put({ tankingPenalties: { enabled: true, penalty: 'forfeit_pick', pickRound: 1 } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.settings.tankingPickPenaltiesSupported).toBe(true)
    expect(body.settings.tankingPenalties).toMatchObject({ penalty: 'forfeit_pick' })
  })
})

