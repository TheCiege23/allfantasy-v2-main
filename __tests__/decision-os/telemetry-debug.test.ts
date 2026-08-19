import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'
import { emitDecisionTelemetry } from '@/lib/decision-os/core/telemetry'
import {
  clearDecisionTelemetryDebugEvents,
  listDecisionTelemetryDebugEvents,
} from '@/lib/decision-os/core/telemetryDebugStore'
import {
  isDecisionTelemetryDebugSurfaceEnabled,
} from '@/lib/decision-os/core/telemetryDebugAccess'

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  isDevAdminUserId: vi.fn(),
}))

vi.mock('@/lib/get-current-user', () => ({
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock('@/lib/dev-admin/access', () => ({
  isDevAdminUserId: mocks.isDevAdminUserId,
}))

describe('Decision OS telemetry debug store', () => {
  const originalEnabled = process.env.DECISION_OS_DEBUG_TELEMETRY
  const originalLimit = process.env.DECISION_OS_DEBUG_TELEMETRY_LIMIT
  const originalNodeEnv = process.env.NODE_ENV
  const originalVercelEnv = process.env.VERCEL_ENV
  const originalAppEnv = process.env.APP_ENV

  afterEach(() => {
    process.env.DECISION_OS_DEBUG_TELEMETRY = originalEnabled
    process.env.DECISION_OS_DEBUG_TELEMETRY_LIMIT = originalLimit
    process.env.NODE_ENV = originalNodeEnv
    process.env.VERCEL_ENV = originalVercelEnv
    process.env.APP_ENV = originalAppEnv
    clearDecisionTelemetryDebugEvents()
    mocks.getCurrentUser.mockReset()
    mocks.isDevAdminUserId.mockReset()
  })

  it('captures emitted telemetry and filters by user, league, and decision id', () => {
    process.env.DECISION_OS_DEBUG_TELEMETRY = 'true'

    emitDecisionTelemetry(
      'decision.issued',
      'commissioner.league.health',
      { userId: 'user-1', leagueId: 'league-1' },
      'dec-1',
    )
    emitDecisionTelemetry(
      'decision.shadow_parity',
      'manager.waiver.claim',
      { userId: 'user-2', leagueId: 'league-2' },
      'dec-2',
    )

    expect(listDecisionTelemetryDebugEvents({ userId: 'user-1' })).toHaveLength(1)
    expect(listDecisionTelemetryDebugEvents({ leagueId: 'league-2' })).toHaveLength(1)
    expect(listDecisionTelemetryDebugEvents({ decisionId: 'dec-1' })).toHaveLength(1)
    expect(listDecisionTelemetryDebugEvents({ event: 'decision.shadow_parity' })[0]?.decision_id).toBe('dec-2')
  })

  it('enforces the configured ring-buffer limit', () => {
    process.env.DECISION_OS_DEBUG_TELEMETRY = 'true'
    process.env.DECISION_OS_DEBUG_TELEMETRY_LIMIT = '2'

    emitDecisionTelemetry('decision.issued', 'manager.lineup.set', { userId: 'user-1', leagueId: 'league-1' }, 'dec-1')
    emitDecisionTelemetry('decision.issued', 'manager.waiver.claim', { userId: 'user-1', leagueId: 'league-1' }, 'dec-2')
    emitDecisionTelemetry('decision.issued', 'commissioner.league.health', { userId: 'user-1', leagueId: 'league-1' }, 'dec-3')

    const events = listDecisionTelemetryDebugEvents()
    expect(events).toHaveLength(2)
    expect(events.map((event) => event.decision_id)).toEqual(['dec-3', 'dec-2'])
  })

  it('enables the browser-safe debug surface in development and preview-style envs only', () => {
    process.env.DECISION_OS_DEBUG_TELEMETRY = 'true'

    process.env.NODE_ENV = 'development'
    expect(isDecisionTelemetryDebugSurfaceEnabled()).toBe(true)

    process.env.NODE_ENV = 'production'
    process.env.VERCEL_ENV = 'preview'
    expect(isDecisionTelemetryDebugSurfaceEnabled()).toBe(true)

    process.env.VERCEL_ENV = 'production'
    process.env.APP_ENV = 'staging'
    expect(isDecisionTelemetryDebugSurfaceEnabled()).toBe(true)

    process.env.APP_ENV = 'production'
    expect(isDecisionTelemetryDebugSurfaceEnabled()).toBe(false)
  })

  it('keeps the dev telemetry proxy closed when the debug surface is disabled', async () => {
    process.env.DECISION_OS_DEBUG_TELEMETRY = 'true'
    process.env.NODE_ENV = 'production'
    process.env.VERCEL_ENV = 'production'

    const { GET } = await import('@/app/api/dev/decision-os/telemetry/route')
    const res = await GET(createMockNextRequest('http://localhost/api/dev/decision-os/telemetry'))

    expect(res.status).toBe(404)
  })

  it('POST seeds a sample shadow event and redirects to the viewer', async () => {
    process.env.DECISION_OS_DEBUG_TELEMETRY = 'true'
    process.env.NODE_ENV = 'development'
    mocks.getCurrentUser.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' })
    mocks.isDevAdminUserId.mockReturnValue(true)

    const { POST } = await import('@/app/api/dev/decision-os/telemetry/route')
    const res = await POST(createMockNextRequest('http://localhost/api/dev/decision-os/telemetry', { method: 'POST' }))

    expect(res.status).toBe(303)
    const events = listDecisionTelemetryDebugEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      event: 'decision.shadow_parity',
      decision_type: 'commissioner.league.health',
    })
  })

  it('POST seed is blocked when the debug surface is disabled in production', async () => {
    process.env.DECISION_OS_DEBUG_TELEMETRY = 'true'
    process.env.NODE_ENV = 'production'
    process.env.VERCEL_ENV = 'production'

    const { POST } = await import('@/app/api/dev/decision-os/telemetry/route')
    const res = await POST(createMockNextRequest('http://localhost/api/dev/decision-os/telemetry', { method: 'POST' }))

    expect(res.status).toBe(404)
    expect(listDecisionTelemetryDebugEvents()).toHaveLength(0)
  })

  it('returns filtered telemetry events through the dev proxy for admin users', async () => {
    process.env.DECISION_OS_DEBUG_TELEMETRY = 'true'
    process.env.NODE_ENV = 'development'
    mocks.getCurrentUser.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' })
    mocks.isDevAdminUserId.mockReturnValue(true)

    emitDecisionTelemetry(
      'decision.issued',
      'commissioner.league.health',
      { userId: 'user-1', leagueId: 'league-1' },
      'dec-1',
    )
    emitDecisionTelemetry(
      'decision.shadow_parity',
      'manager.waiver.claim',
      { userId: 'user-2', leagueId: 'league-2', parity_passed: true },
      'dec-2',
    )

    const { GET } = await import('@/app/api/dev/decision-os/telemetry/route')
    const res = await GET(
      createMockNextRequest(
        'http://localhost/api/dev/decision-os/telemetry?event=decision.shadow_parity&leagueId=league-2',
      ),
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      count: 1,
      filters: {
        event: 'decision.shadow_parity',
        leagueId: 'league-2',
      },
      events: [
        expect.objectContaining({
          event: 'decision.shadow_parity',
          decision_id: 'dec-2',
          userId: 'user-2',
          leagueId: 'league-2',
        }),
      ],
    })
  })
})
