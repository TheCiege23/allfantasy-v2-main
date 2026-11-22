// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Survivor rules writes honour the commissioner's "Format rules" lock and write the league log
 * (lib/league/formatRulesGuard.ts), and the config route refuses NaN-shaped numbers and bad times.
 */

const m = vi.hoisted(() => ({
  locked: false,
  logs: [] as Array<{ format: string; fields?: string[] }>,
  upserts: [] as unknown[],
  sideGameSaves: 0,
  strikes: 0,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'u-comm' } }) }))
vi.mock('@/lib/league/formatRulesGuard', () => ({
  formatRulesLockedResponse: async () => (m.locked ? new Response(JSON.stringify({ error: 'locked' }), { status: 423 }) : null),
  logFormatRulesChange: async (input: { format: string; fields?: string[] }) => { m.logs.push(input) },
}))
vi.mock('@/lib/league/commissionerAccess', () => ({ canCommissionerAct: async () => true }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: async () => undefined }))
vi.mock('@/lib/survivor/survivorHostGuard', () => ({ survivorHostGuard: async () => null, survivorFinaleControlGuard: async () => ({ error: null }) }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({
  isSurvivorLeague: async () => true,
  getSurvivorConfig: async () => null,
  upsertSurvivorConfig: vi.fn(async (_id: string, input: unknown) => { m.upserts.push(input); return { ok: true } }),
}))
vi.mock('@/lib/survivor/survivorGovernanceService', () => ({
  loadSurvivorGovernanceView: vi.fn(), setSurvivorCastawayExperience: vi.fn(),
  saveSurvivorGovernanceSettings: vi.fn(async () => ({ ok: true, patch: { allianceCap: 3 }, settings: {} })),
}))
vi.mock('@/lib/survivor/survivorConductService', () => ({
  issueSurvivorConductStrike: vi.fn(async () => { m.strikes += 1; return { ok: true, activeStrikes: 1 } }),
  revokeSurvivorConductStrike: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findFirst: vi.fn(async () => null) },
    survivorLeagueConfig: { findUnique: vi.fn(async () => null) },
    survivorCommissionerAction: { create: vi.fn(async () => ({})) },
    league: { findUnique: vi.fn(async () => ({ settings: {}, language: 'en' })), update: vi.fn(async () => ({})) },
  },
}))

import { PUT as CONFIG_PUT } from '@/server/api-route-modules/league-survivor/config/route'
import { POST as COMMISSIONER_POST } from '@/app/api/survivor/commissioner/route'

const ctx = { params: Promise.resolve({ leagueId: 'lg-1' }) }
const put = (body: unknown) => CONFIG_PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify(body) }) as never, ctx)
const post = (body: unknown) => COMMISSIONER_POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ leagueId: 'lg-1', ...(body as object) }) }) as never)

beforeEach(() => {
  m.locked = false
  m.logs.length = 0
  m.upserts.length = 0
  m.strikes = 0
})

describe('Survivor config PUT', () => {
  it('saves a valid change and logs the fields', async () => {
    const res = await put({ voteDeadlineDayOfWeek: 3, voteDeadlineTimeUtc: '23:00' })
    expect(res.status).toBe(200)
    expect(m.upserts).toHaveLength(1)
    expect(m.logs).toEqual([expect.objectContaining({ format: 'survivor', fields: ['voteDeadlineDayOfWeek', 'voteDeadlineTimeUtc'] })])
  })

  it('refuses a NaN-shaped number or a bad time, writing nothing', async () => {
    for (const body of [{ mergeWeek: 'abc' }, { juryStartAfterMerge: 1.5 }, { exileReturnTokens: -1 }, { voteDeadlineTimeUtc: '25:00' }, { tribeShuffleImbalanceThreshold: 'x' }]) {
      const res = await put(body)
      expect(res.status).toBe(400)
      expect((await res.json()).field).toBe(Object.keys(body)[0])
    }
    expect(m.upserts).toEqual([])
    expect(m.logs).toEqual([])
  })

  it('a decimal imbalance threshold is fine (its column is a Float)', async () => {
    expect((await put({ tribeShuffleImbalanceThreshold: 1.5 })).status).toBe(200)
  })

  it('is refused while Format rules are locked', async () => {
    m.locked = true
    expect((await put({ voteDeadlineDayOfWeek: 3 })).status).toBe(423)
    expect(m.upserts).toEqual([])
  })
})

describe('Survivor commissioner POST', () => {
  it('a rules action is refused while Format rules are locked, and logged when saved', async () => {
    m.locked = true
    expect((await post({ action: 'governance_settings', settings: { allianceCap: 3 } })).status).toBe(423)
    expect(m.logs).toEqual([])
    m.locked = false
    expect((await post({ action: 'governance_settings', settings: { allianceCap: 3 } })).status).toBe(200)
    expect(m.logs).toEqual([expect.objectContaining({ format: 'survivor', fields: ['allianceCap'] })])
  })

  it('a game action (a conduct strike) is not a rules change: the lock does not stop it and it is not logged as one', async () => {
    m.locked = true
    const res = await post({ action: 'issue_strike', userId: 'u2', reason: 'late' })
    expect(res.status).toBe(200)
    expect(m.strikes).toBe(1)
    expect(m.logs).toEqual([])
  })
})
