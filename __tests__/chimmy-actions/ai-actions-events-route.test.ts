import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

const { getServerSessionMock, createActionEventMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  createActionEventMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/chimmy-actions/server-store', () => ({
  createActionEvent: createActionEventMock,
  listActionEvents: vi.fn(),
}))

function post(event: string) {
  return createMockNextRequest('http://localhost/api/ai/actions/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'evt-1',
      actionType: 'claim_player',
      surface: 'waiver_wire',
      userId: 'user-1',
      leagueId: 'league-1',
      event,
      timestamp: 1_700_000_000_000,
    }),
  })
}

describe('POST /api/ai/actions/events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    createActionEventMock.mockResolvedValue(undefined)
  })

  it('accepts and stores a staged event', async () => {
    const { POST } = await import('@/app/api/ai/actions/events/route')
    const res = await POST(post('staged') as any)

    expect(res.status).toBe(200)
    expect(createActionEventMock).toHaveBeenCalledWith(expect.objectContaining({ event: 'staged' }))
  })

  it('rejects an event outside the lifecycle', async () => {
    const { POST } = await import('@/app/api/ai/actions/events/route')
    const res = await POST(post('executed') as any)

    expect(res.status).toBe(400)
    expect(createActionEventMock).not.toHaveBeenCalled()
  })
})
