/**
 * Unit tests for PATCH /api/bestball/settings
 * Covers: auth guard, non-BB league rejection, underdog enforcement, normalization round-trip, league-not-found.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getServerSessionMock,
  requireCommissionerRoleMock,
  leagueFindUniqueMock,
  leagueUpdateMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  requireCommissionerRoleMock: vi.fn(),
  leagueFindUniqueMock: vi.fn(),
  leagueUpdateMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

vi.mock('@/lib/league/permissions', () => ({
  requireCommissionerRole: requireCommissionerRoleMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: leagueFindUniqueMock,
      update: leagueUpdateMock,
    },
    // Pre-draft: no draft session has started and no season exists, so nothing is locked.
    draftSession: { findFirst: vi.fn(async () => null) },
    redraftSeason: { findFirst: vi.fn(async () => null) },
    leagueAuditLog: { create: vi.fn(async () => ({ id: 'audit-1' })) },
  },
}))
vi.mock('@/lib/league-rules-explainer/publishRuleChanges', () => ({ publishRuleChangesEvent: vi.fn(async () => undefined) }))

// ─── helpers ────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/bestball/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const BB_LEAGUE_BASE = {
  id: 'lg-bb-1',
  sport: 'NFL',
  bestBallMode: true,
  bbWaiversEnabled: false,
  bbTradesEnabled: false,
  bbFaEnabled: false,
  bbIrEnabled: false,
  bbTaxiEnabled: false,
  settings: {
    canonical_draft_mode: 'snake',
    timezone: null,
    language: null,
  },
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('PATCH /api/bestball/settings', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-commissioner' } })
    requireCommissionerRoleMock.mockResolvedValue(undefined)
    leagueFindUniqueMock.mockResolvedValue(BB_LEAGUE_BASE)
    leagueUpdateMock.mockImplementation(async ({ where, data }: any) => ({
      ...BB_LEAGUE_BASE,
      ...data,
      id: where.id,
    }))
  })

  it('returns 401 when no session', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const { PATCH } = await import('@/app/api/bestball/settings/route')
    const res = await PATCH(makeRequest({ leagueId: 'lg-bb-1' }) as any)
    expect(res.status).toBe(401)
  })

  it('returns 400 when leagueId is missing', async () => {
    const { PATCH } = await import('@/app/api/bestball/settings/route')
    const res = await PATCH(makeRequest({}) as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/leagueId/i)
  })

  it('returns 404 when league does not exist', async () => {
    leagueFindUniqueMock.mockResolvedValue(null)
    const { PATCH } = await import('@/app/api/bestball/settings/route')
    const res = await PATCH(makeRequest({ leagueId: 'no-such-league' }) as any)
    expect(res.status).toBe(404)
  })

  it('returns 400 when league is not a Best Ball league', async () => {
    leagueFindUniqueMock.mockResolvedValue({ ...BB_LEAGUE_BASE, bestBallMode: false })
    const { PATCH } = await import('@/app/api/bestball/settings/route')
    const res = await PATCH(makeRequest({ leagueId: 'lg-bb-1' }) as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/not a best ball league/i)
  })

  it('returns 400 for underdog mode with waivers enabled', async () => {
    const { PATCH } = await import('@/app/api/bestball/settings/route')
    const res = await PATCH(
      makeRequest({
        leagueId: 'lg-bb-1',
        bbWaiversEnabled: true,
        bestBall: { mode: 'underdog' },
      }) as any,
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/underdog/i)
  })

  it('returns 400 for underdog mode with trades enabled', async () => {
    const { PATCH } = await import('@/app/api/bestball/settings/route')
    const res = await PATCH(
      makeRequest({
        leagueId: 'lg-bb-1',
        bbTradesEnabled: true,
        bestBall: { mode: 'underdog' },
      }) as any,
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/underdog/i)
  })

  it('persists normalized settings on a happy-path PATCH', async () => {
    const { PATCH } = await import('@/app/api/bestball/settings/route')
    const res = await PATCH(
      makeRequest({
        leagueId: 'lg-bb-1',
        bbWaiversEnabled: false,
        bbTradesEnabled: false,
        bestBall: {
          mode: 'standard',
          contestStructure: 'weekly',
          matchupFormat: 'head_to_head',
        },
      }) as any,
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.league).toBeDefined()

    // update was called with normalized scalar columns
    const updateCall = leagueUpdateMock.mock.calls[0]?.[0]
    expect(updateCall?.where?.id).toBe('lg-bb-1')
    expect(updateCall?.data).toMatchObject({
      bbWaiversEnabled: false,
      bbTradesEnabled: false,
      bbMatchupFormat: expect.any(String),
    })

    // merged settings includes best_ball_settings block
    expect(updateCall?.data?.settings).toMatchObject({
      best_ball_settings: expect.objectContaining({
        mode: 'standard',
      }),
    })
  })

  it('carries through existing settings when no bestBall body key is provided', async () => {
    leagueFindUniqueMock.mockResolvedValue({
      ...BB_LEAGUE_BASE,
      settings: {
        canonical_draft_mode: 'snake',
        best_ball_settings: {
          mode: 'standard',
          contestStructure: 'sit_and_go',
          matchupFormat: 'head_to_head',
        },
      },
    })
    const { PATCH } = await import('@/app/api/bestball/settings/route')
    const res = await PATCH(
      makeRequest({
        leagueId: 'lg-bb-1',
        bbWaiversEnabled: false,
      }) as any,
    )
    expect(res.status).toBe(200)
    const updateCall = leagueUpdateMock.mock.calls[0]?.[0]
    // existing best_ball_settings.contestStructure should survive in merged output
    expect(updateCall?.data?.settings?.best_ball_settings).toMatchObject({
      contestStructure: 'sit_and_go',
    })
  })

  it('allows underdog mode with waivers and trades both disabled', async () => {
    const { PATCH } = await import('@/app/api/bestball/settings/route')
    const res = await PATCH(
      makeRequest({
        leagueId: 'lg-bb-1',
        bbWaiversEnabled: false,
        bbTradesEnabled: false,
        bestBall: { mode: 'underdog' },
      }) as any,
    )
    expect(res.status).toBe(200)
  })
})
