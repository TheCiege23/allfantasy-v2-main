/**
 * Specialty league settings: commish / co-commish only, and AF Commish OR a one-season token unlock.
 *
 * The paywall lives on the WRITE paths, so these drive the real access module, the real unlock /
 * Guillotine handler and the real shared settings patch against an in-memory League table. Only
 * auth, entitlements, the token middleware and post-save side effects are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type LeagueRow = {
  id: string
  userId: string
  season: number
  leagueSize: number
  settings: Record<string, unknown> | null
  teams: unknown[]
  leagueSettings: null
  guillotineEndgame?: string | null
  guillotineEndgameThreshold?: number | null
}

const h = vi.hoisted(() => {
  const state = {
    session: { id: 'u-head', email: null as string | null } as { id: string; email: string | null } | null,
    leagues: new Map<string, LeagueRow>(),
    roles: new Map<string, 'commissioner' | 'co_commissioner' | 'member' | null>(),
    /** Users holding AF Commish / Supreme. */
    planHolders: new Set<string>(),
    formats: [] as string[],
    gate: null as null | ((opts: Record<string, unknown>) => unknown),
    guillotineUpserts: [] as Array<Record<string, unknown>>,
  }
  const clone = <T,>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)))
  const prisma = {
    league: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => clone(state.leagues.get(where.id)) ?? null),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => clone(state.leagues.get(where.id)) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.leagues.get(where.id)!
        Object.assign(row, clone(data))
        return clone(row)
      }),
    },
    leagueSettings: { upsert: vi.fn() },
    salaryCapLeagueConfig: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : ops)),
  }
  return { state, prisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => (h.state.session ? { user: h.state.session } : null)) }))
vi.mock('@/lib/league/permissions', () => ({
  getLeagueRole: vi.fn(async (leagueId: string, userId: string) => h.state.roles.get(`${leagueId}:${userId}`) ?? null),
  isCommissionerRole: (r: string | null) => r === 'commissioner' || r === 'co_commissioner',
  requireCommissionerRole: vi.fn(async (leagueId: string, userId: string) => {
    const r = h.state.roles.get(`${leagueId}:${userId}`)
    if (r !== 'commissioner' && r !== 'co_commissioner') throw new Response('Forbidden', { status: 403 })
  }),
}))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.resolveForUser = vi.fn(async (userId: string, featureId: string) => ({
      hasAccess: featureId === 'commissioner_specialty_settings' && h.state.planHolders.has(userId),
    }))
  }),
}))
vi.mock('@/lib/subscription/entitlement-middleware', () => ({
  requireFeatureEntitlement: vi.fn(async (opts: Record<string, unknown>) => h.state.gate!(opts)),
}))
vi.mock('@/lib/specialty-league/registry', () => ({
  getSpecialtySpec: (id: string) => ({ detect: async () => h.state.formats.includes(id) }),
}))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({
  getGuillotineConfig: vi.fn(async () => ({ teamsPerChop: 1, eliminationStartWeek: 1, tiebreakerOrder: ['bench_points'] })),
  upsertGuillotineConfig: vi.fn(async (_id: string, input: Record<string, unknown>) => {
    h.state.guillotineUpserts.push(input)
    return { teamsPerChop: input.teamsPerChop ?? 1, eliminationStartWeek: 1, tiebreakerOrder: ['bench_points'] }
  }),
}))

// Post-save side effects of the shared patch — irrelevant to what is saved.
vi.mock('@/lib/league/league-settings-draft-sync', () => ({ syncDraftSessionFromLeagueSettings: vi.fn() }))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({ validateDraftRoundsFitRoster: vi.fn() }))
vi.mock('@/lib/league/commissioner-settings-derived-sync', () => ({ syncCommissionerDerivedLeagueState: vi.fn() }))
vi.mock('@/server/services/commissionerService', () => ({ assertSettingsEditAllowed: vi.fn() }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league/structuralSettingsLock', () => ({ structuralPatchRefusal: vi.fn(async () => null) }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn() }))

import {
  parseGuillotineSettingsPatch,
  readSpecialtyUnlock,
  resolveSpecialtySettingsAccess,
  specialtySettingsEditRefusal,
} from '@/lib/league/specialty-settings-access'

const L = 'L1'
const unlockFor = (season: number) => ({ season, unlockedByUserId: 'u-head', unlockedAt: '2026-10-01T00:00:00.000Z', tokenLedgerId: 'led-1' })

function req(method: string, body?: unknown) {
  return new Request(`http://localhost/api/leagues/${L}/specialty-settings`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never
}
const params = { params: { leagueId: L } }

beforeEach(() => {
  // Post-launch unless a test says otherwise: the gate is keyed to the ONE paywall launch constant.
  process.env.AF_PAYWALL_STARTS_AT = '2020-01-01T00:00:00.000Z'
  h.state.session = { id: 'u-head', email: null }
  h.state.leagues = new Map([[L, { id: L, userId: 'u-head', season: 2026, leagueSize: 12, settings: {}, teams: [], leagueSettings: null }]])
  h.state.roles = new Map([
    [`${L}:u-head`, 'commissioner'],
    [`${L}:u-co`, 'co_commissioner'],
    [`${L}:u-member`, 'member'],
  ])
  h.state.planHolders = new Set()
  h.state.formats = ['guillotine']
  h.state.guillotineUpserts = []
  h.state.gate = () => ({ ok: true, decision: {}, tokenSpend: { id: 'led-1' }, tokenPreview: {} })
})

afterEach(() => {
  delete process.env.AF_PAYWALL_STARTS_AT
})

describe('who may edit specialty settings', () => {
  it('a member never can, whatever is paid for', async () => {
    h.state.planHolders.add('u-member')
    h.state.leagues.get(L)!.settings = { specialty_settings_unlock: unlockFor(2026) }
    const a = await resolveSpecialtySettingsAccess(L, 'u-member')
    expect(a).toMatchObject({ isCommish: false, canEdit: false })
    expect((await specialtySettingsEditRefusal(L, 'u-member'))?.status).toBe(403)
  })

  it('a commish with no plan and no unlock is refused with 402 and the token price', async () => {
    const res = await specialtySettingsEditRefusal(L, 'u-head')
    expect(res?.status).toBe(402)
    const body = await res!.json()
    expect(body).toMatchObject({ code: 'specialty_settings_locked', featureId: 'commissioner_specialty_settings', tokenCost: 200 })
  })

  it("the head commish's plan covers a co-commish", async () => {
    h.state.planHolders.add('u-head')
    expect(await resolveSpecialtySettingsAccess(L, 'u-co')).toMatchObject({ coveredBySubscription: true, canEdit: true })
    expect(await specialtySettingsEditRefusal(L, 'u-co')).toBeNull()
  })

  it('a token unlock counts for its own season only', async () => {
    h.state.leagues.get(L)!.settings = { specialty_settings_unlock: unlockFor(2026) }
    expect((await resolveSpecialtySettingsAccess(L, 'u-co'))?.canEdit).toBe(true)
    h.state.leagues.get(L)!.settings = { specialty_settings_unlock: unlockFor(2025) }
    expect((await resolveSpecialtySettingsAccess(L, 'u-co'))?.canEdit).toBe(false)
    expect(readSpecialtyUnlock({ specialty_settings_unlock: { season: 2026 } }, 2026)).toBeNull() // malformed
  })
})

describe('before the paywall launch', () => {
  it('every commish edits free, a member still cannot, and nothing is sold', async () => {
    process.env.AF_PAYWALL_STARTS_AT = '2099-01-01T00:00:00.000Z'
    expect(await specialtySettingsEditRefusal(L, 'u-co')).toBeNull()
    expect((await specialtySettingsEditRefusal(L, 'u-member'))?.status).toBe(403)
    h.state.gate = () => {
      throw new Error('must not charge before launch')
    }
    const { POST } = await import('@/app/api/leagues/[leagueId]/specialty-settings/handler')
    expect(await (await POST(req('POST', { confirmTokenSpend: true }), params)).json()).toMatchObject({ ok: true, prelaunch: true })
    expect(h.state.leagues.get(L)!.settings).toEqual({})
  })
})

describe('POST /specialty-settings — the one-season token unlock', () => {
  it('charges once, idempotently, and records the unlock for this season', async () => {
    const { POST } = await import('@/app/api/leagues/[leagueId]/specialty-settings/handler')
    const res = await POST(req('POST', { confirmTokenSpend: true }), params)
    expect(res.status).toBe(200)
    const { requireFeatureEntitlement } = await import('@/lib/subscription/entitlement-middleware')
    expect(requireFeatureEntitlement).toHaveBeenLastCalledWith(
      expect.objectContaining({
        featureId: 'commissioner_specialty_settings',
        allowTokenFallback: true,
        confirmTokenSpend: true,
        tokenRuleCode: 'commissioner_specialty_settings_league_unlock',
        tokenIdempotencyKey: `specialty_settings_unlock:${L}:2026`,
      }),
    )
    expect(h.state.leagues.get(L)!.settings).toMatchObject({ specialty_settings_unlock: { season: 2026, tokenLedgerId: 'led-1' } })
    // …and the unlock now opens the write paths.
    expect(await specialtySettingsEditRefusal(L, 'u-head')).toBeNull()
  })

  it('passes the token gate refusal through untouched and records nothing', async () => {
    h.state.gate = () => ({ ok: false, response: new Response(JSON.stringify({ code: 'token_confirmation_required' }), { status: 409 }) })
    const { POST } = await import('@/app/api/leagues/[leagueId]/specialty-settings/handler')
    const res = await POST(req('POST', {}), params)
    expect(res.status).toBe(409)
    expect(h.state.leagues.get(L)!.settings).toEqual({})
  })

  it('never charges a commish whose plan already covers the league', async () => {
    h.state.planHolders.add('u-head')
    h.state.gate = () => {
      throw new Error('must not reach the token gate')
    }
    const { POST } = await import('@/app/api/leagues/[leagueId]/specialty-settings/handler')
    const res = await POST(req('POST', { confirmTokenSpend: true }), params)
    expect(await res.json()).toMatchObject({ ok: true, alreadyCovered: true })
  })

  it('refuses a member', async () => {
    h.state.session = { id: 'u-member', email: null }
    const { POST } = await import('@/app/api/leagues/[leagueId]/specialty-settings/handler')
    expect((await POST(req('POST', { confirmTokenSpend: true }), params)).status).toBe(403)
  })
})

describe('PATCH /specialty-settings — Guillotine rules', () => {
  it('is locked without access', async () => {
    const { PATCH } = await import('@/app/api/leagues/[leagueId]/specialty-settings/handler')
    const res = await PATCH(req('PATCH', { guillotine: { teamsPerChop: 2 } }), params)
    expect(res.status).toBe(402)
    expect(h.state.guillotineUpserts).toEqual([])
  })

  it('writes the engine config, and the endgame to BOTH places the engine reads', async () => {
    h.state.planHolders.add('u-head')
    const { PATCH } = await import('@/app/api/leagues/[leagueId]/specialty-settings/handler')
    const res = await PATCH(req('PATCH', { guillotine: { teamsPerChop: 2, endgame: 'final_three' } }), params)
    expect(res.status).toBe(200)
    expect(h.state.guillotineUpserts).toEqual([{ teamsPerChop: 2 }])
    const row = h.state.leagues.get(L)!
    expect(row.guillotineEndgame).toBe('final_three')
    expect(row.guillotineEndgameThreshold).toBe(3)
    expect(row.settings).toMatchObject({ guillotineEndgame: 'final_three' })
    expect((await res.json()).guillotine.endgame).toBe('final_three')
  })

  it('refuses a non-Guillotine league', async () => {
    h.state.planHolders.add('u-head')
    h.state.formats = ['survivor']
    const { PATCH } = await import('@/app/api/leagues/[leagueId]/specialty-settings/handler')
    expect((await PATCH(req('PATCH', { guillotine: { teamsPerChop: 2 } }), params)).status).toBe(409)
  })
})

describe('parseGuillotineSettingsPatch', () => {
  it('accepts the engine’s own values', () => {
    expect(
      parseGuillotineSettingsPatch({
        endgame: 'final_two',
        teamsPerChop: 2,
        eliminationStartWeek: 2,
        eliminationEndWeek: 14,
        correctionWindow: 'after_stat_corrections',
        statCorrectionHours: 48,
        tiebreakerOrder: ['season_points', 'random'],
        rosterReleaseTiming: 'immediate',
        commissionerOverride: false,
      }),
    ).toMatchObject({ ok: true })
  })
  it.each([
    [{ endgame: 'final_n_cumulative' }],
    [{ teamsPerChop: 0 }],
    [{ eliminationStartWeek: 10, eliminationEndWeek: 5 }],
    [{ tiebreakerOrder: [] }],
    [{ tiebreakerOrder: ['random', 'random'] }],
    [{ tiebreakerOrder: ['lowest_bench_points'] }],
    [{ commissionerOverride: 'yes' }],
  ])('refuses %j', (raw) => {
    expect(parseGuillotineSettingsPatch(raw as Record<string, unknown>).ok).toBe(false)
  })
})

describe('the shared settings patch', () => {
  it('never lets a merge forge the unlock record — even for a paying commish', async () => {
    h.state.planHolders.add('u-head')
    const { executeLeagueSettingsPatch } = await import('@/lib/league/execute-league-settings-patch')
    const res = await executeLeagueSettingsPatch('u-head', { leagueId: L, settingsMerge: { specialty_settings_unlock: unlockFor(2026) } })
    expect(res.status).toBe(400)
    expect(h.state.leagues.get(L)!.settings).toEqual({})
  })

  it('gates Devy config and specialty settings keys, and lets ordinary settings through', async () => {
    const { executeLeagueSettingsPatch } = await import('@/lib/league/execute-league-settings-patch')
    expect((await executeLeagueSettingsPatch('u-co', { leagueId: L, devyLeagueConfig: { slots: 4 } })).status).toBe(402)
    expect((await executeLeagueSettingsPatch('u-co', { leagueId: L, settingsMerge: { guillotineEndgame: 'final_two' } })).status).toBe(402)
    expect(h.state.leagues.get(L)!.settings).toEqual({})

    const ok = await executeLeagueSettingsPatch('u-co', { leagueId: L, settingsMerge: { leagueDescription: 'hi' } })
    expect(ok.status).toBe(200)

    h.state.leagues.get(L)!.settings = { specialty_settings_unlock: unlockFor(2026) }
    expect((await executeLeagueSettingsPatch('u-co', { leagueId: L, devyLeagueConfig: { slots: 4 } })).status).toBe(200)
  })
})
