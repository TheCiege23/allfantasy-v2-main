/**
 * Phase 5E/5F — legacy draft HTTP routes must not accept `live:` session keys where
 * canonical league APIs own behavior; blocked hits emit structured telemetry.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

const logStructured = vi.hoisted(() => vi.fn())
const mockGetSession = vi.hoisted(() =>
  vi.fn(async () => ({ user: { id: 'test-user-1' }, expires: '2099-01-01' })),
)

vi.mock('@/lib/logging/structured', () => ({
  logStructured: (...args: unknown[]) => logStructured(...args),
}))

vi.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetSession(...args),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

import { POST as postWorker } from '@/app/api/draft/worker/route'
import { POST as postPickMake } from '@/app/api/draft/pick/make/route'
import { POST as postPicks } from '@/app/api/draft/picks/route'
import { POST as postCpuPick } from '@/app/api/draft/mock/cpu-pick/route'

describe('Phase 5E legacy draft route containment', () => {
  afterEach(() => {
    mockGetSession.mockClear()
    logStructured.mockClear()
  })

  it('POST /api/draft/worker rejects live: with 410 and logs telemetry', async () => {
    const req = new Request('http://localhost/api/draft/worker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'live:league-xyz' }),
    })
    const res = await postWorker(req)
    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.error).toBe('legacy_worker_live_blocked')
    expect(logStructured).toHaveBeenCalledWith(
      'warn',
      'draft_health',
      'legacy_draft_route_blocked',
      expect.objectContaining({
        route: '/api/draft/worker',
        reason: 'legacy_worker_live_blocked',
        httpMethod: 'POST',
        authenticated: true,
        sessionKeyShape: 'live',
        draftEvent: 'legacy_draft_route_blocked',
      }),
    )
  })

  it('POST /api/draft/pick/make rejects live: with 410 and logs telemetry', async () => {
    const req = new Request('http://localhost/api/draft/pick/make', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'live:league-xyz',
        playerId: 'p1',
        playerName: 'Test',
        position: 'RB',
        team: 'TST',
      }),
    })
    const res = await postPickMake(req)
    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.error).toBe('legacy_pick_make_blocked')
    expect(logStructured).toHaveBeenCalledWith(
      'warn',
      'draft_health',
      'legacy_draft_route_blocked',
      expect.objectContaining({
        route: '/api/draft/pick/make',
        reason: 'legacy_pick_make_blocked',
        sessionKeyShape: 'live',
      }),
    )
  })

  it('POST /api/draft/picks always returns 410 (deprecated) and logs telemetry', async () => {
    const req = new Request('http://localhost/api/draft/picks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draftId: 'any', playerId: 'x' }),
    })
    const res = await postPicks(req)
    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.error).toBe('legacy_draft_picks_route_deprecated')
    expect(logStructured).toHaveBeenCalledWith(
      'warn',
      'draft_health',
      'legacy_draft_route_blocked',
      expect.objectContaining({
        route: '/api/draft/picks',
        reason: 'legacy_draft_picks_route_deprecated',
        sessionKeyShape: 'none',
      }),
    )
  })

  it('POST /api/draft/mock/cpu-pick rejects live: with 410 and logs telemetry', async () => {
    const req = new Request('http://localhost/api/draft/mock/cpu-pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'live:league-xyz' }),
    })
    const res = await postCpuPick(req)
    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.error).toBe('legacy_cpu_pick_live_blocked')
    expect(logStructured).toHaveBeenCalledWith(
      'warn',
      'draft_health',
      'legacy_draft_route_blocked',
      expect.objectContaining({
        route: '/api/draft/mock/cpu-pick',
        reason: 'legacy_cpu_pick_live_blocked',
        sessionKeyShape: 'live',
      }),
    )
  })
})
