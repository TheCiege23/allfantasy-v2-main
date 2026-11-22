// @vitest-environment node
/**
 * `POST /api/import-espn { mode: 'team_code' }` — the phone path's two calls.
 *
 *   no `check`    → this user's code, with no ESPN request and nothing written;
 *   `check: true` → one ESPN read, and whether the code is on a team yet.
 *
 * The real route and the real ESPN fetch, against the real NFL capture; only auth, the saved-cookie
 * lookup and the database are replaced. Nothing here is authorization — the gate re-proves the code
 * on every preview and import (see `__tests__/league-import/espn-team-code.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from '../contracts/espn/fixtures/fantasy-league.NFL.2026.json'

const { requireUserMock, upsertMock, gateMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  upsertMock: vi.fn(),
  gateMock: vi.fn(),
}))

vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: requireUserMock, requireAgeConfirmedUser: requireUserMock }))
vi.mock('@/lib/league-sync-core', () => ({ getDecryptedAuth: vi.fn(async () => null) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueAuth: { upsert: upsertMock },
    playerIdentityMap: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/league-import/commissionerGate', () => ({
  assertImportCommissioner: gateMock,
  recordImportAttestation: vi.fn(),
}))

import { POST } from '@/app/api/import-espn/route'
import { espnTeamCodeFor } from '@/lib/league-import/espn/espnTeamCode'

function post(body: Record<string, unknown>) {
  return new Request('http://localhost/api/import-espn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function serve(league: unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/communication/')) return json({ messages: ['not authorized'] }, 401)
    if (/\/seasons\/2026\//.test(url)) return json(league)
    return json({ messages: ['not found'] }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')
  requireUserMock.mockResolvedValue({ ok: true, userId: 'u1' })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('POST /api/import-espn mode team_code', () => {
  it('returns this user’s code for the league — no ESPN request, nothing written, no gate', async () => {
    const fetchMock = serve(fixture)
    const res = await POST(post({ mode: 'team_code', leagueId: 'https://fantasy.espn.com/football/league?leagueId=123456&seasonId=2026' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, code: espnTeamCodeFor('u1', '123456'), leagueId: '123456' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(upsertMock).not.toHaveBeenCalled()
    expect(gateMock).not.toHaveBeenCalled()
  })

  it('check: not on any team yet (control)', async () => {
    serve(fixture)
    const res = await POST(post({ mode: 'team_code', leagueId: '2026:123456', check: true }))
    const body = await res.json()
    expect(body.found).toBe(false)
    expect(body.code).toBe(espnTeamCodeFor('u1', '123456'))
  })

  it('check: found once it is the team’s abbreviation, and names the team', async () => {
    const league = JSON.parse(JSON.stringify(fixture)) as any
    league.teams.find((t: any) => t.id === 4).abbrev = espnTeamCodeFor('u1', '123456')
    serve(league)
    const res = await POST(post({ mode: 'team_code', leagueId: '2026:123456', check: true }))
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, found: true, proof: 'team_code', teamName: 'Fixture Team 4' })
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('check: a private league says so instead of "not found yet"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ messages: ['not authorized'] }, 401)))
    const res = await POST(post({ mode: 'team_code', leagueId: '2026:123456', check: true }))
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, found: false, reason: 'private' })
    expect(body.message).toMatch(/Make League Viewable to Public/)
  })

  it('refuses input that is not an ESPN league', async () => {
    const res = await POST(post({ mode: 'team_code', leagueId: 'not a league' }))
    expect(res.status).toBe(400)
  })
})
