import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/** The settings-lock API route, and one real area writer (NFL scoring) refusing while locked. */

const m = vi.hoisted(() => ({
  session: { user: { id: 'comm' } } as { user: { id: string } } | null,
  role: 'commissioner' as string | null,
  requireRole: vi.fn(),
  view: vi.fn(),
  setGroups: vi.fn(),
  startVote: vi.fn(),
  lockedGroups: vi.fn(),
  saveNfl: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => m.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/permissions', () => ({
  getLeagueRole: vi.fn(async () => m.role),
  isCommissionerRole: (r: string | null) => r === 'commissioner' || r === 'co_commissioner',
  requireCommissionerRole: m.requireRole,
}))
vi.mock('@/lib/league/settingsLockService', () => ({
  readLockView: m.view,
  setLockedGroups: m.setGroups,
  startUnlockVote: m.startVote,
  lockedGroups: m.lockedGroups,
  lockedGroupsForPatch: vi.fn(async () => []),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: vi.fn(async () => ({ userId: 'comm', sport: 'NFL' })) } } }))
vi.mock('@/lib/nfl-scoring', () => ({
  getLeagueNflScoringConfig: vi.fn(async () => ({})),
  saveLeagueNflScoringConfig: m.saveNfl,
  buildFullNflScoringConfig: vi.fn(() => ({})),
  NFL_SCORING_PRESETS: {},
}))
vi.mock('@/lib/subscription/FeatureGateService', () => ({
  FeatureGateService: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.evaluateUserFeatureAccess = vi.fn(async () => ({ allowed: true }))
  }),
}))

import { GET, POST, PUT } from '@/app/api/commissioner/leagues/[leagueId]/settings-lock/route'
import { PUT as putNfl } from '@/app/api/commissioner/leagues/[leagueId]/nfl-scoring/route'

const ctx = { params: Promise.resolve({ leagueId: 'L' }) }
const url = 'http://x/api/commissioner/leagues/L/settings-lock'
const req = (method: string, body?: unknown) => new NextRequest(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) })

beforeEach(() => {
  vi.clearAllMocks()
  m.session = { user: { id: 'comm' } }
  m.role = 'commissioner'
  m.requireRole.mockResolvedValue(undefined)
  m.view.mockResolvedValue({ season: 2026, seasonUnderway: true, groups: [], votes: [] })
  m.lockedGroups.mockResolvedValue([])
  m.saveNfl.mockResolvedValue(undefined)
})

describe('settings-lock route', () => {
  it('any member may read it; only commissioners get canEdit; outsiders are refused', async () => {
    m.role = 'member'
    expect(await (await GET(req('GET'), ctx)).json()).toMatchObject({ season: 2026, canEdit: false })
    m.role = 'co_commissioner'
    expect(await (await GET(req('GET'), ctx)).json()).toMatchObject({ canEdit: true })
    m.role = null
    expect((await GET(req('GET'), ctx)).status).toBe(403)
  })

  it('PUT validates the groups and turns a mid-season unlock into a 409 that says a vote is needed', async () => {
    expect((await PUT(req('PUT', { groups: ['scoring', 'admin'] }), ctx)).status).toBe(400)
    m.setGroups.mockResolvedValue({ ok: false, error: 'vote_required', groups: ['scoring'] })
    const res = await PUT(req('PUT', { groups: [] }), ctx)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/scoring can only be unlocked by a league vote/)
    m.setGroups.mockResolvedValue({ ok: true, groups: ['trades'] })
    expect(await (await PUT(req('PUT', { groups: ['trades'] }), ctx)).json()).toEqual({ groups: ['trades'] })
    expect(m.setGroups).toHaveBeenLastCalledWith('L', 'comm', ['trades'])
  })

  it('a non-commissioner cannot change the lock or start a vote', async () => {
    m.requireRole.mockRejectedValue(new Response(JSON.stringify({ error: 'no' }), { status: 403 }))
    expect((await PUT(req('PUT', { groups: [] }), ctx)).status).toBe(403)
    expect((await POST(req('POST', { group: 'scoring' }), ctx)).status).toBe(403)
    expect(m.setGroups).not.toHaveBeenCalled()
    expect(m.startVote).not.toHaveBeenCalled()
  })

  it('POST starts a vote and answers refusals in words', async () => {
    m.startVote.mockResolvedValue({ ok: false, error: 'already_voting' })
    const res = await POST(req('POST', { group: 'scoring' }), ctx)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already open/)
    m.startVote.mockResolvedValue({ ok: true, vote: { id: 'v' } })
    expect(await (await POST(req('POST', { group: 'scoring', days: 2 }), ctx)).json()).toEqual({ vote: { id: 'v' } })
  })
})

describe('an area writer while its area is locked', () => {
  it('🛑 NFL scoring: 423 and nothing saved; open: saved', async () => {
    m.lockedGroups.mockResolvedValue(['scoring'])
    const nflReq = () => new NextRequest('http://x/api/commissioner/leagues/L/nfl-scoring', { method: 'PUT', body: JSON.stringify({ presetKey: 'af_default' }) })
    const res = await putNfl(nflReq(), ctx)
    expect(res.status).toBe(423)
    expect(await res.json()).toMatchObject({ code: 'settings_locked', lockedGroups: ['scoring'] })
    expect(m.saveNfl).not.toHaveBeenCalled()
    expect(m.lockedGroups).toHaveBeenCalledWith('L', ['scoring'])
    m.lockedGroups.mockResolvedValue([])
    expect((await putNfl(nflReq(), ctx)).status).toBe(200)
    expect(m.saveNfl).toHaveBeenCalledTimes(1)
  })
})
