// @vitest-environment node
/**
 * Commissioner edit of the guillotine first chop week (2026-10-18): the PATCH handler on the
 * existing guillotine summary route, and its rules in lib/guillotine/guillotineFirstChopWeek.ts.
 * No DB — every delegate is a stub.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: vi.fn(),
  assertCommissioner: vi.fn(),
  isG: vi.fn(),
  update: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: vi.fn() }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: h.assertCommissioner }))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({
  isGuillotineLeague: h.isG,
  getGuillotineConfig: vi.fn(),
  upsertGuillotineConfig: vi.fn(),
}))
vi.mock('@/lib/guillotine/GuillotineWeeklySummaryService', () => ({ buildWeeklySummary: vi.fn() }))
vi.mock('@/lib/share/guillotineEscape', () => ({ getGuillotineEscapesForUser: vi.fn() }))
vi.mock('@/lib/guillotine/guillotineCurrentWeek', () => ({ resolveGuillotineCurrentWeek: vi.fn(), findViewerRosterId: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/leagues/[leagueId]/guillotine/summary/route'
import type { FirstChopDeps } from '@/lib/guillotine/guillotineFirstChopWeek'

const routeModule = await import('@/lib/guillotine/guillotineFirstChopWeek')
const { validateFirstChopWeek, hasFirstChopHappened, updateGuillotineFirstChopWeek } =
  await vi.importActual<typeof import('@/lib/guillotine/guillotineFirstChopWeek')>('@/lib/guillotine/guillotineFirstChopWeek')

const patch = (body: unknown) =>
  PATCH(
    new NextRequest('https://allfantasy.test/api/leagues/lg1/guillotine/summary', {
      method: 'PATCH',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ leagueId: 'lg1' }) },
  )

const baseConfig = {
  leagueId: 'lg1',
  sport: 'NBA' as const,
  eliminationStartWeek: 1,
  eliminationEndWeek: 24,
  teamsPerChop: 1,
  correctionWindow: 'after_stat_corrections' as const,
  customCutoffDayOfWeek: null,
  customCutoffTimeUtc: null,
  statCorrectionHours: 24,
  tiebreakerOrder: ['bench_points' as const],
  dangerMarginPoints: 10,
  rosterReleaseTiming: 'next_waiver_run' as const,
  commissionerOverride: true,
}

function makeDeps(opts: { chops?: [number, number, number]; row?: boolean; config?: typeof baseConfig | null } = {}) {
  const [events, states, elims] = opts.chops ?? [0, 0, 0]
  const upsert = vi.fn(async (_id: string, input: { eliminationStartWeek?: number }) => ({
    ...baseConfig,
    eliminationStartWeek: input.eliminationStartWeek ?? 1,
  }))
  const deps = {
    db: {
      guillotineEventLog: { count: vi.fn(async () => events) },
      guillotineRosterState: { count: vi.fn(async () => states) },
      guillotineElimination: { count: vi.fn(async () => elims) },
      guillotineLeagueConfig: { findUnique: vi.fn(async () => (opts.row === false ? null : { id: 'cfg' })) },
    },
    getConfig: vi.fn(async () => (opts.config === undefined ? baseConfig : opts.config)),
    upsert,
  }
  return deps as unknown as FirstChopDeps & { upsert: typeof upsert }
}

describe('validateFirstChopWeek', () => {
  it('accepts 1..endWeek inclusive', () => {
    expect(validateFirstChopWeek(1, 24)).toEqual({ ok: true, week: 1 })
    expect(validateFirstChopWeek(24, 24)).toEqual({ ok: true, week: 24 })
    expect(validateFirstChopWeek('10', 24)).toEqual({ ok: true, week: 10 })
  })
  it('refuses below 1, after the end week, and non-integers', () => {
    expect(validateFirstChopWeek(0, 24).ok).toBe(false)
    expect(validateFirstChopWeek(25, 24).ok).toBe(false)
    expect(validateFirstChopWeek(2.5, 24).ok).toBe(false)
    expect(validateFirstChopWeek('abc', 24).ok).toBe(false)
    expect(validateFirstChopWeek(null, 24).ok).toBe(false)
  })
})

describe('hasFirstChopHappened — any of the three chop records counts', () => {
  it.each([
    [[0, 0, 0], false],
    [[1, 0, 0], true],
    [[0, 1, 0], true],
    [[0, 0, 1], true],
  ] as const)('counts %j → %s', async (chops, expected) => {
    const deps = makeDeps({ chops: [...chops] as [number, number, number] })
    expect(await hasFirstChopHappened('lg1', deps.db)).toBe(expected)
  })
})

describe('updateGuillotineFirstChopWeek', () => {
  it('saves a valid week when no chop has happened', async () => {
    const deps = makeDeps()
    const res = await updateGuillotineFirstChopWeek('lg1', 10, deps)
    expect(res).toEqual({ ok: true, eliminationStartWeek: 10, eliminationEndWeek: 24 })
    expect(deps.upsert).toHaveBeenCalledWith('lg1', { eliminationStartWeek: 10 })
  })

  it('🛑 refuses (409) once the first chop happened, and writes nothing', async () => {
    const deps = makeDeps({ chops: [0, 0, 1] })
    const res = await updateGuillotineFirstChopWeek('lg1', 10, deps)
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(deps.upsert).not.toHaveBeenCalled()
  })

  it('refuses (400) a week after the configured end week', async () => {
    const deps = makeDeps()
    expect(await updateGuillotineFirstChopWeek('lg1', 30, deps)).toMatchObject({ ok: false, status: 400 })
    expect(deps.upsert).not.toHaveBeenCalled()
  })

  it('404s a league with no Guilly config', async () => {
    const deps = makeDeps({ config: null })
    expect(await updateGuillotineFirstChopWeek('lg1', 3, deps)).toMatchObject({ ok: false, status: 404 })
  })

  it('⚠ with no config row yet, writes the whole derived config so other fields keep their values', async () => {
    const deps = makeDeps({ row: false, config: { ...baseConfig, teamsPerChop: 2, eliminationEndWeek: 20 } })
    await updateGuillotineFirstChopWeek('lg1', 5, deps)
    expect(deps.upsert).toHaveBeenCalledWith('lg1', expect.objectContaining({ eliminationStartWeek: 5, teamsPerChop: 2, eliminationEndWeek: 20 }))
  })
})

describe('PATCH /api/leagues/[leagueId]/guillotine/summary', () => {
  let spy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    for (const f of Object.values(h)) f.mockReset()
    h.session.mockResolvedValue({ user: { id: 'u1' } })
    h.assertCommissioner.mockResolvedValue({ league: { id: 'lg1' } })
    h.isG.mockResolvedValue(true)
    spy?.mockRestore()
    spy = vi.spyOn(routeModule, 'updateGuillotineFirstChopWeek')
  })

  it('401 when signed out', async () => {
    h.session.mockResolvedValue(null)
    expect((await patch({ eliminationStartWeek: 3 })).status).toBe(401)
  })

  it('🛑 403 for a non-commissioner, before any write', async () => {
    h.assertCommissioner.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }))
    const res = await patch({ eliminationStartWeek: 3 })
    expect(res.status).toBe(403)
    expect(spy).not.toHaveBeenCalled()
  })

  it('404 for a non-guillotine league', async () => {
    h.isG.mockResolvedValue(false)
    expect((await patch({ eliminationStartWeek: 3 })).status).toBe(404)
  })

  it('400 without eliminationStartWeek', async () => {
    expect((await patch({})).status).toBe(400)
    expect((await patch('not json')).status).toBe(400)
  })

  it('passes the result through: 200 on success, the rule status on refusal', async () => {
    spy.mockResolvedValueOnce({ ok: true, eliminationStartWeek: 10, eliminationEndWeek: 24 })
    const ok = await patch({ eliminationStartWeek: 10 })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true, config: { eliminationStartWeek: 10, eliminationEndWeek: 24 } })
    expect(spy).toHaveBeenCalledWith('lg1', 10)

    spy.mockResolvedValueOnce({ ok: false, status: 409, error: 'already chopped' })
    const refused = await patch({ eliminationStartWeek: 10 })
    expect(refused.status).toBe(409)
    expect((await refused.json()).error).toBe('already chopped')
  })
})
