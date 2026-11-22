import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  session: vi.fn(), tournament: vi.fn(), world: vi.fn(), playoff: vi.fn(),
  read: vi.fn(), save: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  bracketEntry: { findFirst: mocks.tournament },
  worldCupBracketEntry: { findFirst: mocks.world },
  playoffBracketEntry: { findFirst: mocks.playoff },
} }))
vi.mock('@/lib/chimmy/bracketChangeAlerts', () => ({
  getBracketChangeAlertsEnabled: mocks.read,
  setBracketChangeAlertsEnabled: mocks.save,
}))

import { GET, POST } from '@/app/api/chimmy/bracket-alerts/route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'owner-1' } })
  mocks.tournament.mockResolvedValue(null)
  mocks.world.mockResolvedValue(null)
  mocks.playoff.mockResolvedValue(null)
  mocks.read.mockResolvedValue(false)
  mocks.save.mockResolvedValue(undefined)
})

describe('Chimmy bracket alert setting', () => {
  it('never reveals or changes another user’s entry setting', async () => {
    const request = { nextUrl: new URL('http://localhost/api/chimmy/bracket-alerts?format=tournament&entryId=g1') } as NextRequest
    const response = await GET(request)
    expect(response.status).toBe(404)
    expect(mocks.tournament).toHaveBeenCalledWith({ where: { id: 'g1', userId: 'owner-1' }, select: { id: true } })
    expect(mocks.read).not.toHaveBeenCalled()
    const post = await POST({ json: async () => ({ format: 'tournament', entryId: 'g1', enabled: true }) } as NextRequest)
    expect(post.status).toBe(404)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('saves an explicit opt-in and can turn it off for the same owner', async () => {
    mocks.world.mockResolvedValue({ id: 'w1' })
    mocks.read.mockResolvedValue(true)
    const loaded = await GET({ nextUrl: new URL('http://localhost/api/chimmy/bracket-alerts?format=world_cup&entryId=w1') } as NextRequest)
    expect(loaded.status).toBe(200)
    expect(await loaded.json()).toEqual({ enabled: true })
    const on = await POST({ json: async () => ({ format: 'world_cup', entryId: 'w1', enabled: true }) } as NextRequest)
    expect(on.status).toBe(200)
    expect(mocks.save).toHaveBeenCalledWith('owner-1', 'world_cup', 'w1', true)
    const off = await POST({ json: async () => ({ format: 'world_cup', entryId: 'w1', enabled: false }) } as NextRequest)
    expect(off.status).toBe(200)
    expect(mocks.save).toHaveBeenCalledWith('owner-1', 'world_cup', 'w1', false)
  })
})
