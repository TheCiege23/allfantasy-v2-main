/**
 * POST /api/leagues/[leagueId]/draft/autopick/me
 *
 * Tests the canonical LiveDraftAutopickPreference write endpoint.
 * Legacy DraftAutopickSetting is never touched.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const getServerSessionMock = vi.hoisted(() => vi.fn(async () => null as null | { user?: { id?: string } }))
const canAccessLeagueDraftMock = vi.hoisted(() => vi.fn(async () => true))
const setViewerAutopickPreferenceMock = vi.hoisted(() =>
  vi.fn(async () => ({
    enabled: false,
    mode: 'standard' as const,
    isProEligible: false,
    updatedAt: null as string | null,
  })),
)
const entitlementResolveForUserMock = vi.hoisted(() => vi.fn(async () => ({ hasAccess: false })))
const draftSessionFindUniqueMock = vi.hoisted(() =>
  vi.fn(async () => ({ id: 'session-1' } as { id: string } | null)),
)
const draftAutopickSettingUpsertMock = vi.hoisted(() => vi.fn(async () => ({})))

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSessionMock(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: (...a: [string, string]) => canAccessLeagueDraftMock(...a),
}))
vi.mock('@/lib/live-draft-engine/LiveDraftAutopickPreferenceService', () => ({
  setViewerAutopickPreference: (...a: Parameters<typeof setViewerAutopickPreferenceMock>) =>
    setViewerAutopickPreferenceMock(...a),
}))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    resolveForUser(...a: [string, string]) {
      return entitlementResolveForUserMock(...a)
    }
  },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findUnique: (...a: unknown[]) => draftSessionFindUniqueMock(...a) },
    // Confirm legacy table accessor is never called
    draftAutopickSetting: { upsert: (...a: unknown[]) => draftAutopickSettingUpsertMock(...a) },
  },
}))

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

const { POST } = await import(
  '@/app/api/leagues/[leagueId]/draft/autopick/me/route'
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/leagues/league-1/draft/autopick/me', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeCtx(leagueId = 'league-1') {
  return { params: Promise.resolve({ leagueId }) }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/leagues/[leagueId]/draft/autopick/me', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    canAccessLeagueDraftMock.mockResolvedValue(true)
    draftSessionFindUniqueMock.mockResolvedValue({ id: 'session-1' })
    entitlementResolveForUserMock.mockResolvedValue({ hasAccess: false })
    setViewerAutopickPreferenceMock.mockResolvedValue({
      enabled: false,
      mode: 'standard',
      isProEligible: false,
      updatedAt: null,
    })
  })

  it('returns 401 when unauthenticated', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const res = await POST(makeRequest({ enabled: false }), makeCtx())
    expect(res.status).toBe(401)
  })

  it('returns 403 when user is not a league member', async () => {
    canAccessLeagueDraftMock.mockResolvedValue(false)
    const res = await POST(makeRequest({ enabled: false }), makeCtx())
    expect(res.status).toBe(403)
  })

  it('returns 404 when no draft session exists for the league', async () => {
    draftSessionFindUniqueMock.mockResolvedValue(null)
    const res = await POST(makeRequest({ enabled: false }), makeCtx())
    expect(res.status).toBe(404)
  })

  it('returns 400 when enabled is missing from body', async () => {
    const res = await POST(makeRequest({ mode: 'standard' }), makeCtx())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/enabled/)
  })

  it('returns 400 for invalid mode value', async () => {
    const res = await POST(makeRequest({ enabled: true, mode: 'robot_overlord' }), makeCtx())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Invalid mode/)
  })

  it('defaults mode to "standard" when enabled=true and mode is omitted', async () => {
    setViewerAutopickPreferenceMock.mockResolvedValue({
      enabled: true,
      mode: 'standard',
      isProEligible: false,
      updatedAt: '2026-05-09T01:00:00.000Z',
    })
    const res = await POST(makeRequest({ enabled: true }), makeCtx())
    expect(res.status).toBe(200)
    expect(setViewerAutopickPreferenceMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, mode: 'standard' }),
    )
  })

  it('forces mode to "standard" when enabled=false, even if caller passes ai_queue', async () => {
    const res = await POST(makeRequest({ enabled: false, mode: 'ai_queue' }), makeCtx())
    // mode=ai_queue with enabled=false: no Pro check needed, helper coerces
    expect(res.status).toBe(200)
    expect(setViewerAutopickPreferenceMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    )
    // route passes undefined for mode when enabled=false (helper coerces to standard)
    const call = setViewerAutopickPreferenceMock.mock.calls[0][0]
    expect(call.mode).toBeUndefined()
  })

  it('allows mode="standard" for a non-Pro user', async () => {
    entitlementResolveForUserMock.mockResolvedValue({ hasAccess: false })
    setViewerAutopickPreferenceMock.mockResolvedValue({
      enabled: true,
      mode: 'standard',
      isProEligible: false,
      updatedAt: null,
    })
    const res = await POST(makeRequest({ enabled: true, mode: 'standard' }), makeCtx())
    expect(res.status).toBe(200)
    // Entitlement was never called (standard path skips Pro check)
    expect(entitlementResolveForUserMock).not.toHaveBeenCalled()
  })

  it('returns 403 when mode="ai_queue" but user lacks pro_draft_ai', async () => {
    entitlementResolveForUserMock.mockResolvedValue({ hasAccess: false })
    const res = await POST(makeRequest({ enabled: true, mode: 'ai_queue' }), makeCtx())
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/AF Pro/)
    expect(setViewerAutopickPreferenceMock).not.toHaveBeenCalled()
  })

  it('succeeds when mode="ai_queue" and user has pro_draft_ai', async () => {
    entitlementResolveForUserMock.mockResolvedValue({ hasAccess: true })
    setViewerAutopickPreferenceMock.mockResolvedValue({
      enabled: true,
      mode: 'ai_queue',
      isProEligible: true,
      updatedAt: '2026-05-09T02:00:00.000Z',
    })
    const res = await POST(makeRequest({ enabled: true, mode: 'ai_queue' }), makeCtx())
    expect(res.status).toBe(200)
    expect(entitlementResolveForUserMock).toHaveBeenCalledWith('user-1', 'pro_draft_ai')
    expect(setViewerAutopickPreferenceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        draftSessionId: 'session-1',
        viewerUserId: 'user-1',
        enabled: true,
        mode: 'ai_queue',
      }),
    )
  })

  it('returns the viewerAutopick shape from the read helper', async () => {
    const expected = {
      enabled: true,
      mode: 'standard',
      isProEligible: false,
      updatedAt: '2026-05-09T03:00:00.000Z',
    }
    setViewerAutopickPreferenceMock.mockResolvedValue(expected)
    const res = await POST(makeRequest({ enabled: true }), makeCtx())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ viewerAutopick: expected })
  })

  it('always uses the authenticated userId — body userId is ignored', async () => {
    await POST(makeRequest({ enabled: true, userId: 'attacker-user-id' }), makeCtx())
    expect(setViewerAutopickPreferenceMock).toHaveBeenCalledWith(
      expect.objectContaining({ viewerUserId: 'user-1' }),
    )
    // Attacker userId never passed to write helper
    const call = setViewerAutopickPreferenceMock.mock.calls[0][0]
    expect(call.viewerUserId).toBe('user-1')
    expect(call.viewerUserId).not.toBe('attacker-user-id')
  })

  it('never touches the legacy DraftAutopickSetting table', async () => {
    await POST(makeRequest({ enabled: true }), makeCtx())
    expect(draftAutopickSettingUpsertMock).not.toHaveBeenCalled()
  })
})
