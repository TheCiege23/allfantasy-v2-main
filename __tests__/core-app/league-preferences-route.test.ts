// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/** POST /api/core/league-preferences — one whitelisted list per call, shape-checked ids. */

const h = vi.hoisted(() => ({
  userId: 'u1' as string | null,
  set: vi.fn(async () => undefined),
  get: vi.fn(async () => ({ favorites: null, hidden: ['x'], order: [] })),
}))

vi.mock('@/lib/auth-guard', () => ({
  requireAuth: async () =>
    h.userId ? { ok: true, userId: h.userId } : { ok: false, response: new Response('{}', { status: 401 }) },
}))
vi.mock('@/lib/core-app/leaguePreferencesStore', () => ({ setLeaguePreference: h.set, getLeaguePreferences: h.get }))
vi.mock('@/lib/rate-limit', () => ({
  consumeRateLimit: () => ({ success: true, retryAfterSec: 0 }),
  buildRateLimit429: () => ({}),
}))

import { GET, POST } from '@/app/api/core/league-preferences/route'

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/core/league-preferences', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  h.userId = 'u1'
  h.set.mockClear()
})

describe('league preferences route', () => {
  it('saves one list, normalised', async () => {
    const res = await post({ field: 'hidden', leagueIds: ['a', 'a', ' b ', 42] })
    expect(res.status).toBe(200)
    expect(h.set).toHaveBeenCalledWith('u1', 'hidden', ['a', 'b'])
  })

  it('refuses a field outside the whitelist — never a caller-chosen JSON key', async () => {
    expect((await post({ field: 'playerFinderLeagueIds', leagueIds: [] })).status).toBe(400)
    expect((await post({ field: '__proto__', leagueIds: [] })).status).toBe(400)
    expect((await post({ field: 'constructor', leagueIds: [] })).status).toBe(400)
    expect((await post({ field: 'toString', leagueIds: [] })).status).toBe(400)
    expect(h.set).not.toHaveBeenCalled()
  })

  it('refuses a missing list', async () => {
    expect((await post({ field: 'order' })).status).toBe(400)
  })

  it('needs a session', async () => {
    h.userId = null
    expect((await post({ field: 'order', leagueIds: [] })).status).toBe(401)
    expect((await GET()).status).toBe(401)
  })

  it('GET returns the stored preferences', async () => {
    const res = await GET()
    expect(await res.json()).toEqual({ favorites: null, hidden: ['x'], order: [] })
  })
})
