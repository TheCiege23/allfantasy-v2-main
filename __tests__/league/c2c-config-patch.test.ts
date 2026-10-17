/**
 * PATCH /api/leagues/[leagueId]/merged-devy-c2c/config — the C2C config league creation writes.
 * It used to coerce every value (`Number('abc')` → NaN into an Int column, `Boolean('false')` → true)
 * and was the one specialty write with no specialty gate. These pin both.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  commish: true,
  refuse: false,
  upserts: [] as Array<Record<string, unknown>>,
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u-head' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: vi.fn(async () => true) }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: vi.fn(async () => h.commish) }))
vi.mock('@/lib/merged-devy-c2c/C2CLeagueConfig', () => ({
  isC2CLeague: vi.fn(async () => true),
  getC2CConfig: vi.fn(async () => ({ leagueId: 'L1' })),
  upsertC2CConfig: vi.fn(async (_id: string, input: Record<string, unknown>) => {
    h.upserts.push(input)
    return { leagueId: 'L1', ...input }
  }),
}))
vi.mock('@/lib/league/specialty-settings-access', async () => {
  const { NextResponse } = await import('next/server')
  return {
    specialtySettingsEditRefusal: vi.fn(async () =>
      h.refuse ? NextResponse.json({ error: 'locked' }, { status: 402 }) : null),
  }
})

import { parseC2CConfigPatch } from '@/lib/merged-devy-c2c/c2cConfigPatch'
import { PATCH } from '@/app/api/leagues/[leagueId]/merged-devy-c2c/config/route'

const ctx = { params: Promise.resolve({ leagueId: 'L1' }) }
const patch = (body: unknown) =>
  PATCH(new Request('http://localhost/api/leagues/L1/merged-devy-c2c/config', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never, ctx)

describe('parseC2CConfigPatch', () => {
  it('passes well-typed values', () => {
    expect(parseC2CConfigPatch({ taxiSize: 5, bestBallPro: false, standingsModel: 'hybrid', collegeFAABBudget: null })).toEqual({
      ok: true,
      patch: { taxiSize: 5, bestBallPro: false, standingsModel: 'hybrid', collegeFAABBudget: null },
    })
  })

  it('refuses what the route used to coerce', () => {
    expect(parseC2CConfigPatch({ taxiSize: 'abc' }).ok).toBe(false)
    expect(parseC2CConfigPatch({ bestBallPro: 'false' }).ok).toBe(false)
    expect(parseC2CConfigPatch({ hybridProWeight: 140 }).ok).toBe(false)
    expect(parseC2CConfigPatch({ startupDraftType: 'third_round_reversal' }).ok).toBe(false)
    expect(parseC2CConfigPatch({ promotionTiming: 'Rollover; DROP' }).ok).toBe(false)
    expect(parseC2CConfigPatch({ proLineupSlots: { QB: 'one' } }).ok).toBe(false)
    expect(parseC2CConfigPatch({}).ok).toBe(false)
  })
})

describe('merged-devy-c2c config PATCH', () => {
  beforeEach(() => {
    h.commish = true
    h.refuse = false
    h.upserts = []
  })

  it('saves a valid change', async () => {
    const res = await patch({ taxiSize: 4, mergedRookieCollegeDraft: true })
    expect(res.status).toBe(200)
    expect(h.upserts).toEqual([{ taxiSize: 4, mergedRookieCollegeDraft: true }])
  })

  it('is behind the specialty gate', async () => {
    h.refuse = true
    expect((await patch({ taxiSize: 4 })).status).toBe(402)
    expect(h.upserts).toEqual([])
  })

  it('refuses a coerced value with a 400 instead of saving it', async () => {
    const res = await patch({ bestBallCollege: 'false' })
    expect(res.status).toBe(400)
    expect(h.upserts).toEqual([])
  })

  it('stays commish-only', async () => {
    h.commish = false
    expect((await patch({ taxiSize: 4 })).status).toBe(403)
  })
})
