import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  transitionLeagueState: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'owner-1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/server/services/permissionService', () => ({
  isElevatedCommissioner: vi.fn(async () => true),
  isHeadCommissioner: vi.fn(async () => true),
}))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn() }))
vi.mock('@/server/services/leagueLifecycleService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/services/leagueLifecycleService')>()
  return { ...actual, transitionLeagueState: mocks.transitionLeagueState }
})

import { POST } from '@/app/api/leagues/[leagueId]/lifecycle/route'

describe('lifecycle mutation route', () => {
  beforeEach(() => mocks.transitionLeagueState.mockReset())

  it('rejects unknown input before mutation, events, audit, or notification fanout', async () => {
    const req = { json: vi.fn(async () => ({ nextState: 'not_a_state' })) }
    const response = await POST(req as never, { params: { leagueId: 'league-1' } })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Invalid lifecycle state',
      code: 'INVALID_LIFECYCLE_STATE',
    })
    expect(mocks.transitionLeagueState).not.toHaveBeenCalled()
  })

  it('passes a valid persisted state to the coordinator', async () => {
    mocks.transitionLeagueState.mockResolvedValue({
      ok: true,
      league: { lifecycleState: 'pre_draft', locked: false, emergencyPaused: false },
    })
    const req = { json: vi.fn(async () => ({ nextState: 'pre_draft' })) }
    const response = await POST(req as never, { params: { leagueId: 'league-1' } })

    expect(response.status).toBe(200)
    expect(mocks.transitionLeagueState).toHaveBeenCalledWith(
      'league-1',
      'pre_draft',
      'owner-1',
      { force: false },
    )
  })
})