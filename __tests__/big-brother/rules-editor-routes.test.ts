// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Both Big Brother rules write paths — the config PATCH (the editor) and the admin `update_config` action — go
 * through one validator, the "Format rules" lock and the league log.
 */

const m = vi.hoisted(() => ({
  userId: 'u-comm' as string | null,
  commissioner: true,
  evictions: 0,
  locked: false,
  upserts: [] as unknown[],
  logs: [] as Array<{ fields?: string[] }>,
  adminCalls: [] as unknown[],
  config: {
    configId: 'cfg', sport: 'NFL', juryStartMode: 'after_eliminations', juryStartAfterEliminations: 7, juryStartWhenRemaining: null, juryStartWeek: null,
    evictionTieBreakMode: 'season_points', premiumEngineSpec: null,
  } as Record<string, unknown>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: async () => (m.userId ? { user: { id: m.userId } } : null) }))
vi.mock('@/lib/league/commissionerAccess', () => ({ canCommissionerAct: async () => m.commissioner }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: async () => true }))
vi.mock('@/lib/big-brother/BigBrotherLeagueConfig', () => ({
  isBigBrotherLeague: async () => true,
  getBigBrotherConfig: async () => m.config,
  upsertBigBrotherConfig: vi.fn(async (_id: string, input: Record<string, unknown>) => { m.upserts.push(input); return { ...m.config, ...input } }),
}))
vi.mock('@/lib/league/formatRulesGuard', () => ({
  formatRulesLockedResponse: async () => (m.locked ? new Response(JSON.stringify({ error: 'locked' }), { status: 423 }) : null),
  logFormatRulesChange: async (input: { fields?: string[] }) => { m.logs.push(input) },
}))
vi.mock('@/lib/big-brother/BigBrotherAdminService', () => ({
  runBigBrotherAdminAction: vi.fn(async (input: unknown) => { m.adminCalls.push(input); return { ok: true, message: 'Config updated' } }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    bigBrotherCycle: { count: vi.fn(async () => m.evictions) },
    league: { findUnique: vi.fn(async () => ({ userId: 'u-comm' })) },
  },
}))

import { GET, PATCH } from '@/app/api/leagues/[leagueId]/big-brother/config/route'
import { POST as ADMIN } from '@/app/api/leagues/[leagueId]/big-brother/admin/route'

const ctx = { params: Promise.resolve({ leagueId: 'lg-1' }) }
const req = (body: unknown, method = 'PATCH') => new Request('http://x/api', { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) as never

beforeEach(() => {
  m.userId = 'u-comm'
  m.commissioner = true
  m.evictions = 0
  m.locked = false
  m.upserts.length = 0
  m.logs.length = 0
  m.adminCalls.length = 0
})

describe('PATCH /big-brother/config', () => {
  it('saves the validated change and logs exactly the fields changed', async () => {
    const res = await PATCH(req({ evictionTieBreakMode: 'commissioner', nominationDeadlineTimeUtc: '20:00' }), ctx)
    expect(res.status).toBe(200)
    expect(m.upserts).toEqual([{ evictionTieBreakMode: 'commissioner', nominationDeadlineTimeUtc: '20:00' }])
    expect(m.logs[0].fields).toEqual(['evictionTieBreakMode', 'nominationDeadlineTimeUtc'])
  })

  it('writes the validated values, not the raw request (a jury number sent as text is stored as a number)', async () => {
    const res = await PATCH(req({ juryStartAfterEliminations: '5' }), ctx)
    expect(res.status).toBe(200)
    expect(m.upserts).toEqual([{ juryStartAfterEliminations: 5 }])
  })

  it('a bad value is a 400 naming the setting, and nothing is written or logged', async () => {
    const res = await PATCH(req({ nominationDeadlineDayOfWeek: 9 }), ctx)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ field: 'nominationDeadlineDayOfWeek' })
    expect(m.upserts).toEqual([])
    expect(m.logs).toEqual([])
  })

  it('jury and finale after the first eviction are a 409', async () => {
    m.evictions = 1
    const res = await PATCH(req({ finaleFormat: 'final_3' }), ctx)
    expect(res.status).toBe(409)
    expect(m.upserts).toEqual([])
  })

  it('the Format rules lock and the commissioner check still come first', async () => {
    m.locked = true
    expect((await PATCH(req({ challengeMode: 'hybrid' }), ctx)).status).toBe(423)
    m.locked = false
    m.commissioner = false
    expect((await PATCH(req({ challengeMode: 'hybrid' }), ctx)).status).toBe(403)
    expect(m.upserts).toEqual([])
  })
})

describe('GET /big-brother/config', () => {
  it('tells the editor whether jury and finale are still open', async () => {
    expect(await (await GET(req(undefined, 'GET'), ctx)).json()).toMatchObject({ juryAndFinaleOpen: true })
    m.evictions = 3
    expect(await (await GET(req(undefined, 'GET'), ctx)).json()).toMatchObject({ juryAndFinaleOpen: false })
  })
})

describe('POST /big-brother/admin update_config', () => {
  it('is refused while Format rules are locked, before the service runs', async () => {
    m.locked = true
    const res = await ADMIN(req({ action: 'update_config', params: { challengeMode: 'hybrid' } }, 'POST'), ctx)
    expect(res.status).toBe(423)
    expect(m.adminCalls).toEqual([])
  })

  it('is logged like the editor once it succeeds; other admin actions are not rules changes', async () => {
    await ADMIN(req({ action: 'update_config', params: { challengeMode: 'hybrid' } }, 'POST'), ctx)
    expect(m.logs).toEqual([expect.objectContaining({ format: 'big_brother', fields: ['challengeMode'] })])
    m.locked = true
    const pause = await ADMIN(req({ action: 'pause_week' }, 'POST'), ctx)
    expect(pause.status).toBe(200)
    expect(m.logs).toHaveLength(1)
  })
})
