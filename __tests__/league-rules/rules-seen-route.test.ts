// @vitest-environment node
/** The rules a manager last saw, on /api/core/league-preferences (no new route file: route ceiling). */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  userId: 'u1' as string | null,
  getSeen: vi.fn(async () => null as unknown),
  setSeen: vi.fn(async () => undefined),
}))
vi.mock('@/lib/auth-guard', () => ({
  requireAuth: async () => (h.userId ? { ok: true, userId: h.userId } : { ok: false, response: new Response('{}', { status: 401 }) }),
}))
vi.mock('@/lib/core-app/leaguePreferencesStore', () => ({ setLeaguePreference: vi.fn(), getLeaguePreferences: vi.fn(async () => ({})) }))
vi.mock('@/lib/league-rules/rulesSeenStore', () => ({ getRulesSeen: h.getSeen, setRulesSeen: h.setSeen }))
vi.mock('@/lib/rate-limit', () => ({ consumeRateLimit: () => ({ success: true, retryAfterSec: 0 }), buildRateLimit429: () => ({}) }))

import { GET, POST } from '@/app/api/core/league-preferences/route'
import { RULEBOOK_SNAPSHOT_VERSION } from '@/lib/league-rules/rulesSnapshot'

const snapshot = { v: RULEBOOK_SNAPSHOT_VERSION, rules: { waivers: { label: 'Waivers', value: 'FAAB · $100' } } }
const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/core/league-preferences', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
const get = (q: string) => GET(new NextRequest(`http://localhost/api/core/league-preferences${q}`))

beforeEach(() => {
  h.userId = 'u1'
  vi.clearAllMocks()
})

describe('rulesSeen on the league preferences route', () => {
  it('reads the caller’s own snapshot for one league', async () => {
    h.getSeen.mockResolvedValue(snapshot)
    const res = await get('?rulesSeen=lg_1')
    expect(await res.json()).toEqual({ rulesSeen: snapshot })
    expect(h.getSeen).toHaveBeenCalledWith('u1', 'lg_1')
  })

  it('saves a snapshot, checked and bounded, for the caller only', async () => {
    expect((await post({ field: 'rulesSeen', leagueId: 'lg_1', snapshot })).status).toBe(200)
    expect(h.setSeen).toHaveBeenCalledWith('u1', 'lg_1', snapshot)
  })

  it('refuses a bad league id or a snapshot it cannot read', async () => {
    expect((await get('?rulesSeen=' + encodeURIComponent('../x'))).status).toBe(400)
    expect((await post({ field: 'rulesSeen', leagueId: 'lg 1', snapshot })).status).toBe(400)
    expect((await post({ field: 'rulesSeen', leagueId: 'lg_1', snapshot: { v: 0, rules: {} } })).status).toBe(400)
    expect(h.setSeen).not.toHaveBeenCalled()
    expect(h.getSeen).not.toHaveBeenCalled()
  })

  it('needs a session', async () => {
    h.userId = null
    expect((await get('?rulesSeen=lg_1')).status).toBe(401)
    expect((await post({ field: 'rulesSeen', leagueId: 'lg_1', snapshot })).status).toBe(401)
  })
})
