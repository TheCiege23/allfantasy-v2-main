/**
 * POST /api/admin/leagues/[leagueId]/recovery
 *
 * 🛑 THE LOAD-BEARING ASSERTION IS `not.toHaveBeenCalled()`, NOT THE STATUS CODE. This endpoint
 * mutates arbitrary leagues — lifecycle state, job queues, a live draft. A route that returns 403
 * and performs the mutation anyway passes any test that only reads `response.status`, so every
 * refusal case here also asserts the service was never reached.
 *
 * The gate, the actor resolution and the schema are each pinned separately because they fail
 * independently: an ungated route, an unattributable audit row, and an unvalidated action are
 * three different defects.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  runAdminLeagueRecovery: vi.fn(),
  resolveAdminAuditActor: vi.fn(),
}))

vi.mock('@/lib/adminAuth', () => ({ requireAdmin: mocks.requireAdmin }))

vi.mock('@/lib/admin/recovery/adminRecoveryService', () => ({
  runAdminLeagueRecovery: mocks.runAdminLeagueRecovery,
}))

vi.mock('@/lib/admin-audit', () => ({
  resolveAdminAuditActor: mocks.resolveAdminAuditActor,
  logAdminAudit: vi.fn(),
}))

// Only the enum is needed, and mocking it keeps the real Prisma client out of the test — importing
// it populates process.env from `.env`, which points at production in this repo.
vi.mock('@prisma/client', () => ({
  LeagueLifecycleState: {
    setup: 'setup', pre_draft: 'pre_draft', drafting: 'drafting', post_draft: 'post_draft',
    in_season: 'in_season', playoffs: 'playoffs', completed: 'completed', offseason: 'offseason',
    renewal_pending: 'renewal_pending', archived: 'archived',
  },
}))

const PARAMS = { params: { leagueId: 'lg-1' } }

function req(body: unknown) {
  return new Request('http://localhost/api/admin/leagues/lg-1/recovery', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('/api/admin/leagues/[leagueId]/recovery', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.resolveAdminAuditActor.mockReturnValue('admin-actor-1')
    mocks.runAdminLeagueRecovery.mockResolvedValue({ ok: true, detail: { lifecycleState: 'in_season' } })
  })

  it('REFUSES a non-admin and never reaches the recovery service', async () => {
    mocks.requireAdmin.mockResolvedValueOnce({ ok: false, res: new Response('Forbidden', { status: 403 }) })
    const { POST } = await import('@/app/api/admin/leagues/[leagueId]/recovery/route')

    const res = await POST(req({ action: { type: 'enqueue_waiver_process' } }), PARAMS)

    expect(res.status).toBe(403)
    // The whole point: the mutation must not have happened.
    expect(mocks.runAdminLeagueRecovery).not.toHaveBeenCalled()
  })

  it('REFUSES an unauthenticated caller and never reaches the recovery service', async () => {
    mocks.requireAdmin.mockResolvedValueOnce({ ok: false, res: new Response('Unauthorized', { status: 401 }) })
    const { POST } = await import('@/app/api/admin/leagues/[leagueId]/recovery/route')

    const res = await POST(req({ action: { type: 'draft_pause', confirm: true } }), PARAMS)

    expect(res.status).toBe(401)
    expect(mocks.runAdminLeagueRecovery).not.toHaveBeenCalled()
  })

  it('runs the action for an admin and passes the RESOLVED audit actor, not a raw user id', async () => {
    // `user` deliberately carries no `id` — the case that would write an unattributable audit row
    // if the route used `gate.user.id` directly.
    mocks.requireAdmin.mockResolvedValueOnce({ ok: true, user: { email: 'ops@example.com' } })
    const { POST } = await import('@/app/api/admin/leagues/[leagueId]/recovery/route')

    const res = await POST(req({ action: { type: 'enqueue_waiver_process' } }), PARAMS)

    expect(res.status).toBe(200)
    expect(mocks.resolveAdminAuditActor).toHaveBeenCalledWith({ email: 'ops@example.com' })
    expect(mocks.runAdminLeagueRecovery).toHaveBeenCalledWith({
      leagueId: 'lg-1',
      adminUserId: 'admin-actor-1',
      action: { type: 'enqueue_waiver_process' },
    })
  })

  it('rejects an unknown action type without dispatching it', async () => {
    mocks.requireAdmin.mockResolvedValueOnce({ ok: true, user: { id: 'u1' } })
    const { POST } = await import('@/app/api/admin/leagues/[leagueId]/recovery/route')

    const res = await POST(req({ action: { type: 'delete_everything' } }), PARAMS)

    expect(res.status).toBe(400)
    expect(mocks.runAdminLeagueRecovery).not.toHaveBeenCalled()
  })

  it('rejects draft_pause without confirm:true — the guard on the most disruptive action', async () => {
    mocks.requireAdmin.mockResolvedValueOnce({ ok: true, user: { id: 'u1' } })
    const { POST } = await import('@/app/api/admin/leagues/[leagueId]/recovery/route')

    const res = await POST(req({ action: { type: 'draft_pause', confirm: false } }), PARAMS)

    expect(res.status).toBe(400)
    expect(mocks.runAdminLeagueRecovery).not.toHaveBeenCalled()
  })

  it('rejects a lifecycle state outside the schema enum', async () => {
    mocks.requireAdmin.mockResolvedValueOnce({ ok: true, user: { id: 'u1' } })
    const { POST } = await import('@/app/api/admin/leagues/[leagueId]/recovery/route')

    const res = await POST(req({ action: { type: 'lifecycle_transition', nextState: 'not_a_state' } }), PARAMS)

    expect(res.status).toBe(400)
    expect(mocks.runAdminLeagueRecovery).not.toHaveBeenCalled()
  })

  it('accepts a valid lifecycle transition and leaves transition-legality to the service', async () => {
    mocks.requireAdmin.mockResolvedValueOnce({ ok: true, user: { id: 'u1' } })
    const { POST } = await import('@/app/api/admin/leagues/[leagueId]/recovery/route')

    const res = await POST(
      req({ action: { type: 'lifecycle_transition', nextState: 'in_season', force: true } }),
      PARAMS,
    )

    expect(res.status).toBe(200)
    expect(mocks.runAdminLeagueRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        action: { type: 'lifecycle_transition', nextState: 'in_season', force: true },
      }),
    )
  })

  it('surfaces a service refusal as 400 rather than a 200 with ok:false', async () => {
    mocks.requireAdmin.mockResolvedValueOnce({ ok: true, user: { id: 'u1' } })
    mocks.runAdminLeagueRecovery.mockResolvedValueOnce({ ok: false, error: 'League not found' })
    const { POST } = await import('@/app/api/admin/leagues/[leagueId]/recovery/route')

    const res = await POST(req({ action: { type: 'enqueue_waiver_process' } }), PARAMS)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'League not found' })
  })

  it('rejects a non-JSON body before dispatching', async () => {
    mocks.requireAdmin.mockResolvedValueOnce({ ok: true, user: { id: 'u1' } })
    const { POST } = await import('@/app/api/admin/leagues/[leagueId]/recovery/route')

    const bad = new Request('http://localhost/api/admin/leagues/lg-1/recovery', {
      method: 'POST',
      body: 'not json',
    })
    const res = await POST(bad, PARAMS)

    expect(res.status).toBe(400)
    expect(mocks.runAdminLeagueRecovery).not.toHaveBeenCalled()
  })
})
