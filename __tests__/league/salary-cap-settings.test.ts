/**
 * Salary Cap commish editor: the rules (lib/salary-cap/salaryCapSettingsPatch.ts) and the
 * Specialty settings handler's `salaryCap` read and save. The handler runs for real against an
 * in-memory config; the access check, format detection and cap-hit totals are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextResponse } from 'next/server'

const h = vi.hoisted(() => {
  const state = {
    refuse: false,
    formats: ['salary_cap'] as string[],
    contracts: 0,
    config: null as Record<string, unknown> | null,
    upserts: [] as Array<Record<string, unknown>>,
    events: [] as Array<Record<string, unknown>>,
    hits: new Map<string, { totalCapHit: number; deadMoneyHit: number }>(),
    rollover: [] as Array<{ rosterId: string; rolloverUsed: number }>,
  }
  const prisma = {
    playerContract: { count: vi.fn(async () => state.contracts) },
    roster: { findMany: vi.fn(async () => [{ id: 'r1' }, { id: 'r2' }]) },
    salaryCapTeamLedger: { findMany: vi.fn(async () => state.rollover) },
    salaryCapEventLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => state.events.push(data)) },
    league: { findUnique: vi.fn(async () => ({ settings: {} })), update: vi.fn() },
  }
  return { state, prisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u-head', email: null } })) }))
vi.mock('@/lib/subscription/entitlement-middleware', () => ({ requireFeatureEntitlement: vi.fn() }))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({ getGuillotineConfig: vi.fn(), upsertGuillotineConfig: vi.fn() }))
vi.mock('@/lib/scoring-engine/resolveTeamLabels', () => ({
  buildRosterLabelMap: vi.fn(async () => new Map([['r1', 'Alpha'], ['r2', 'Bravo']])),
}))
vi.mock('@/lib/league/specialty-settings-access', async (orig) => {
  const actual = await orig<typeof import('@/lib/league/specialty-settings-access')>()
  const { NextResponse } = await import('next/server')
  return {
    ...actual,
    detectGatedSpecialtyFormats: vi.fn(async () => h.state.formats),
    resolveSpecialtySettingsAccess: vi.fn(async () => ({
      isCommish: true, canEdit: true, coveredBySubscription: true, unlock: null, season: 2026,
      tokenCost: 200, paywallLive: true, paywallStartsAt: '2026-10-15',
    })),
    specialtySettingsEditRefusal: vi.fn(async () =>
      h.state.refuse ? NextResponse.json({ error: 'locked' }, { status: 402 }) : null),
  }
})
vi.mock('@/lib/salary-cap/SalaryCapLeagueConfig', () => ({
  getSalaryCapConfig: vi.fn(async () => (h.state.config ? { ...h.state.config } : null)),
  upsertSalaryCapConfig: vi.fn(async (_id: string, input: Record<string, unknown>) => {
    h.state.upserts.push(input)
    h.state.config = { ...h.state.config, ...input }
    return { ...h.state.config }
  }),
}))
vi.mock('@/lib/salary-cap/CapCalculationService', async (orig) => {
  const actual = await orig<typeof import('@/lib/salary-cap/CapCalculationService')>()
  return {
    ...actual,
    getCurrentCapYear: () => 2026,
    getTotalCapHitForRoster: vi.fn(async (_c: string, rosterId: string) => h.state.hits.get(rosterId) ?? { totalCapHit: 0, deadMoneyHit: 0 }),
  }
})

import {
  capComplianceRow,
  parseSalaryCapSettingsPatch,
  type SalaryCapSettingsValue,
} from '@/lib/salary-cap/salaryCapSettingsPatch'
import { GET, PATCH } from '@/app/api/leagues/[leagueId]/specialty-settings/handler'

const base: SalaryCapSettingsValue = {
  mode: 'dynasty',
  startupCap: 250,
  capGrowthPercent: 5,
  capFloorEnabled: false,
  capFloorAmount: null,
  contractMinYears: 1,
  contractMaxYears: 4,
  rookieContractYears: 3,
  minimumSalary: 1,
  deadMoneyEnabled: true,
  deadMoneyPercentPerYear: 25,
  rolloverEnabled: true,
  rolloverMax: 25,
  extensionsEnabled: true,
  franchiseTagEnabled: true,
  startupDraftType: 'auction',
  auctionHoldback: 50,
  futureDraftType: 'snake',
}
const open = { startupLocked: false }

describe('parseSalaryCapSettingsPatch', () => {
  it('accepts in-range values and keeps only what was sent', () => {
    const r = parseSalaryCapSettingsPatch({ startupCap: 300, capGrowthPercent: 2.5, extensionsEnabled: false }, base, open)
    expect(r).toEqual({ ok: true, patch: { startupCap: 300, capGrowthPercent: 2.5, extensionsEnabled: false } })
  })

  it('refuses out-of-range, fractional and wrongly-typed values', () => {
    expect(parseSalaryCapSettingsPatch({ startupCap: 20 }, base, open).ok).toBe(false)
    expect(parseSalaryCapSettingsPatch({ startupCap: 250.5 }, base, open).ok).toBe(false)
    expect(parseSalaryCapSettingsPatch({ capGrowthPercent: 2.3 }, base, open).ok).toBe(false)
    expect(parseSalaryCapSettingsPatch({ contractMaxYears: true }, base, open).ok).toBe(false)
    expect(parseSalaryCapSettingsPatch({ deadMoneyEnabled: 'yes' }, base, open).ok).toBe(false)
    expect(parseSalaryCapSettingsPatch({ futureDraftType: 'linear' }, base, open).ok).toBe(false)
  })

  it('judges one side of a pair against the saved other side', () => {
    // Max 4 saved: a minimum of 5 is longer than the longest contract.
    const r = parseSalaryCapSettingsPatch({ contractMinYears: 5 }, base, open)
    expect(r).toEqual({ ok: false, error: 'The shortest contract cannot be longer than the longest.' })
    expect(parseSalaryCapSettingsPatch({ contractMinYears: 5, contractMaxYears: 6 }, base, open).ok).toBe(true)
    expect(parseSalaryCapSettingsPatch({ minimumSalary: 50 }, { ...base, startupCap: 50 }, open).ok).toBe(false)
  })

  it('refuses a mode change but tolerates the unchanged mode being echoed back', () => {
    expect(parseSalaryCapSettingsPatch({ mode: 'bestball' }, base, open).ok).toBe(false)
    expect(parseSalaryCapSettingsPatch({ mode: 'dynasty' }, base, open)).toEqual({ ok: true, patch: {} })
  })

  it('freezes the startup draft once contracts exist', () => {
    const locked = { startupLocked: true }
    expect(parseSalaryCapSettingsPatch({ startupDraftType: 'snake' }, base, locked)).toEqual({
      ok: false,
      error: 'The startup draft has already happened, so its type cannot change.',
    })
    expect(parseSalaryCapSettingsPatch({ auctionHoldback: 10 }, base, locked).ok).toBe(false)
    // Echoing the saved values is not a change.
    expect(parseSalaryCapSettingsPatch({ startupDraftType: 'auction', auctionHoldback: 50 }, base, locked).ok).toBe(true)
    expect(parseSalaryCapSettingsPatch({ startupDraftType: 'snake', auctionHoldback: 10 }, base, open).ok).toBe(true)
  })

  it('starts a newly enabled floor at 80% of the cap and keeps it below the cap', () => {
    expect(parseSalaryCapSettingsPatch({ capFloorEnabled: true }, base, open)).toEqual({
      ok: true,
      patch: { capFloorEnabled: true, capFloorAmount: 200 },
    })
    const on = { ...base, capFloorEnabled: true, capFloorAmount: 200 }
    expect(parseSalaryCapSettingsPatch({ capFloorAmount: 250 }, on, open).ok).toBe(false)
    expect(parseSalaryCapSettingsPatch({ startupCap: 200 }, on, open)).toEqual({ ok: false, error: 'The cap floor must be below the cap.' })
  })

  it('keeps the lottery flag in step with the rookie draft type', () => {
    expect(parseSalaryCapSettingsPatch({ futureDraftType: 'weighted_lottery' }, base, open)).toEqual({
      ok: true,
      patch: { futureDraftType: 'weighted_lottery', weightedLotteryEnabled: true },
    })
    expect(parseSalaryCapSettingsPatch({ futureDraftType: 'auction' }, base, open)).toEqual({
      ok: true,
      patch: { futureDraftType: 'auction', weightedLotteryEnabled: false },
    })
  })
})

describe('capComplianceRow', () => {
  it('counts dead money toward both the cap and the floor', () => {
    expect(capComplianceRow({ rosterId: 'r', name: 'A', cap: 250, totalCapHit: 240, deadMoneyHit: 20, floor: null })).toMatchObject({
      capHit: 260, capSpace: -10, overCap: true, belowFloor: false,
    })
    // 180 salary + 25 dead clears a 200 floor.
    expect(capComplianceRow({ rosterId: 'r', name: 'A', cap: 250, totalCapHit: 180, deadMoneyHit: 25, floor: 200 }).belowFloor).toBe(false)
    expect(capComplianceRow({ rosterId: 'r', name: 'A', cap: 250, totalCapHit: 180, deadMoneyHit: 0, floor: 200 }).belowFloor).toBe(true)
  })
})

const L = 'L1'
const params = { params: { leagueId: L } }
function req(method: string, body?: unknown) {
  return new Request(`http://localhost/api/leagues/${L}/specialty-settings`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never
}
async function json(res: NextResponse | Response) {
  return { status: res.status, body: (await res.json()) as Record<string, any> }
}

describe('specialty-settings handler — salaryCap', () => {
  beforeEach(() => {
    h.state.refuse = false
    h.state.formats = ['salary_cap']
    h.state.contracts = 0
    h.state.upserts = []
    h.state.events = []
    h.state.hits = new Map([['r1', { totalCapHit: 230, deadMoneyHit: 0 }], ['r2', { totalCapHit: 100, deadMoneyHit: 0 }]])
    h.state.rollover = []
    h.state.config = { ...base, leagueId: L, configId: 'cfg-1', capStartYear: 2026, capFloorAmount: null }
  })

  it('GET returns the settings and every team’s cap position, tightest first', async () => {
    const { status, body } = await json(await GET(req('GET'), params))
    expect(status).toBe(200)
    expect(body.salaryCap.value.startupCap).toBe(250)
    expect(body.salaryCap.startupLocked).toBe(false)
    expect(body.salaryCap.teams.map((t: { name: string; capSpace: number }) => [t.name, t.capSpace])).toEqual([
      ['Alpha', 20],
      ['Bravo', 150],
    ])
  })

  it('PATCH saves, logs the change, and reports a team the new cap puts over', async () => {
    const { status, body } = await json(await PATCH(req('PATCH', { salaryCap: { startupCap: 200 } }), params))
    expect(status).toBe(200)
    expect(h.state.upserts).toEqual([{ startupCap: 200 }])
    expect(h.state.events).toEqual([
      expect.objectContaining({
        eventType: 'settings_changed',
        configId: 'cfg-1',
        metadata: { actorUserId: 'u-head', changes: { startupCap: { from: 250, to: 200 } } },
      }),
    ])
    const alpha = body.salaryCap.teams.find((t: { name: string }) => t.name === 'Alpha')
    expect(alpha).toMatchObject({ cap: 200, capHit: 230, overCap: true })
  })

  it('PATCH that changes nothing writes nothing', async () => {
    const { status } = await json(await PATCH(req('PATCH', { salaryCap: { startupCap: 250 } }), params))
    expect(status).toBe(200)
    expect(h.state.upserts).toEqual([])
    expect(h.state.events).toEqual([])
  })

  it('PATCH refuses a startup-draft change once contracts exist', async () => {
    h.state.contracts = 3
    const { status, body } = await json(await PATCH(req('PATCH', { salaryCap: { startupDraftType: 'snake' } }), params))
    expect(status).toBe(400)
    expect(body.error).toMatch(/startup draft has already happened/)
    expect(h.state.upserts).toEqual([])
  })

  it('PATCH is refused by the specialty gate and on a league that is not Salary Cap', async () => {
    h.state.refuse = true
    expect((await PATCH(req('PATCH', { salaryCap: { startupCap: 300 } }), params)).status).toBe(402)
    h.state.refuse = false
    h.state.formats = ['guillotine']
    expect((await PATCH(req('PATCH', { salaryCap: { startupCap: 300 } }), params)).status).toBe(409)
    expect(h.state.upserts).toEqual([])
  })
})
