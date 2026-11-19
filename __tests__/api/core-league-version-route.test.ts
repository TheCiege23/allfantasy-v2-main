// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ session: null as null | { user: { id: string } }, queryRaw: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: () => Promise.resolve(h.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: h.queryRaw } }))

import { GET } from '@/app/api/core/league-version/route'

beforeEach(() => {
  h.session = { user: { id: 'u1' } }
  h.queryRaw.mockReset()
})

describe('GET /api/core/league-version', () => {
  it('refuses a signed-out caller', async () => {
    h.session = null
    expect((await GET()).status).toBe(401)
    expect(h.queryRaw).not.toHaveBeenCalled()
  })

  it('returns the fingerprint, uncached, scoped to the signed-in user', async () => {
    h.queryRaw.mockResolvedValue([{ version: 'abc123' }])
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ version: 'abc123' })
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    // The user id is a bound parameter of the tagged query, never spliced into the SQL text.
    const [, ...params] = h.queryRaw.mock.calls[0]
    expect(params).toContain('u1')
  })

  it('reports unavailable rather than inventing a version', async () => {
    h.queryRaw.mockResolvedValue([{ version: null }])
    expect((await GET()).status).toBe(503)
    h.queryRaw.mockRejectedValue(new Error('db down'))
    expect((await GET()).status).toBe(503)
  })
})
