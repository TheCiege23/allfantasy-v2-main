// @vitest-environment node
/*
 * Node, not jsdom: this is a server route, and jsdom's File does not survive NextRequest's multipart
 * parse — every upload test returned 400 "Invalid request body", which the non-image test then read
 * as a pass. Measured 2026-10-02.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { checkTeamName, MAX_TEAM_NAME_LENGTH } from '@/lib/league/myTeamEdit'

/**
 * League → Edit Team (POST /api/leagues/[leagueId]/my-team).
 *
 * Until 2026-10-02 the member "Edit Team" panel's Save had no handler at all, so these tests pin
 * the three things that make the new write path safe: it edits only the caller's CLAIMED team,
 * only in a NATIVE league, and it reaches both tables that carry a team's name.
 */

const mocks = vi.hoisted(() => ({
  userId: 'user-1' as string | null,
  league: { platform: 'allfantasy' } as { platform: string } | null,
  team: { id: 'team-1' } as { id: string } | null,
  season: { id: 'season-9' } as { id: string } | null,
  leagueTeamUpdate: vi.fn((args: unknown) => ({ op: 'leagueTeam.update', args })),
  redraftRosterUpdateMany: vi.fn((args: unknown) => ({ op: 'redraftRoster.updateMany', args })),
  teamFindFirst: vi.fn(),
  transaction: vi.fn(async (ops: unknown[]) => ops),
  persist: vi.fn(async () => ({ url: 'https://blob.example/avatars/x.png' })),
}))

vi.mock('@/lib/auth-guard', () => ({
  requireAuth: async () =>
    mocks.userId
      ? { ok: true, userId: mocks.userId }
      : { ok: false, response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }) },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => mocks.league) },
    leagueTeam: {
      findFirst: mocks.teamFindFirst,
      update: mocks.leagueTeamUpdate,
    },
    redraftSeason: { findFirst: vi.fn(async () => mocks.season) },
    redraftRoster: { updateMany: mocks.redraftRosterUpdateMany },
    $transaction: mocks.transaction,
  },
}))
vi.mock('@/lib/blob/readWriteToken', () => ({ getBlobReadWriteToken: () => 'token' }))
vi.mock('@/lib/avatar/ProfileImageUploadStorageService', () => ({
  isAllowedProfileImageType: (t: string) => ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(t),
  MAX_PROFILE_IMAGE_BYTES: 5 * 1024 * 1024,
  persistProfileImageBytes: mocks.persist,
}))

import { POST } from '@/app/api/leagues/[leagueId]/my-team/handler'

const ctx = { params: Promise.resolve({ leagueId: 'league-1' }) }
const json = (body: unknown) =>
  new NextRequest('http://localhost/api/leagues/league-1/my-team', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  mocks.userId = 'user-1'
  mocks.league = { platform: 'allfantasy' }
  mocks.team = { id: 'team-1' }
  mocks.season = { id: 'season-9' }
  mocks.teamFindFirst.mockReset().mockImplementation(async () => mocks.team)
  mocks.leagueTeamUpdate.mockClear()
  mocks.redraftRosterUpdateMany.mockClear()
  mocks.transaction.mockClear()
  mocks.persist.mockClear()
})

describe('checkTeamName', () => {
  it('trims and collapses whitespace', () => {
    expect(checkTeamName('  The   Mahomes  Clause ')).toEqual({ ok: true, teamName: 'The Mahomes Clause' })
  })
  it('refuses blank and over-long names', () => {
    expect(checkTeamName('   ').ok).toBe(false)
    expect(checkTeamName('x'.repeat(MAX_TEAM_NAME_LENGTH + 1)).ok).toBe(false)
    expect(checkTeamName('x'.repeat(MAX_TEAM_NAME_LENGTH)).ok).toBe(true)
  })
  it('does not reject a real surname that contains a swear fragment (whole-word filter)', () => {
    expect(checkTeamName('Dickerson Dynasty').ok).toBe(true)
  })
})

describe('POST /api/leagues/[leagueId]/my-team', () => {
  it('renames the caller\'s claimed team and the current season roster, together', async () => {
    const res = await POST(json({ teamName: 'Gridiron Gang' }), ctx)
    expect(res.status).toBe(200)

    // Whose team: looked up by the CALLER's claim — never an id from the body.
    expect(mocks.teamFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: 'league-1', claimedByUserId: 'user-1' } }),
    )
    expect(mocks.leagueTeamUpdate).toHaveBeenCalledWith({ where: { id: 'team-1' }, data: { teamName: 'Gridiron Gang' } })
    // Current season only, this owner only.
    expect(mocks.redraftRosterUpdateMany).toHaveBeenCalledWith({
      where: { leagueId: 'league-1', seasonId: 'season-9', ownerId: 'user-1' },
      data: { teamName: 'Gridiron Gang' },
    })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
  })

  it('refuses an imported league with a code, and writes nothing', async () => {
    mocks.league = { platform: 'sleeper' }
    const res = await POST(json({ teamName: 'Gridiron Gang' }), ctx)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('IMPORTED_LEAGUE')
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('treats an UNKNOWN platform as imported (allowlist, not denylist)', async () => {
    mocks.league = { platform: 'some-future-host' }
    expect((await POST(json({ teamName: 'Gridiron Gang' }), ctx)).status).toBe(409)
  })

  it('404s when the caller holds no team in the league', async () => {
    mocks.team = null
    expect((await POST(json({ teamName: 'Gridiron Gang' }), ctx)).status).toBe(404)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('401s without a session', async () => {
    mocks.userId = null
    expect((await POST(json({ teamName: 'Gridiron Gang' }), ctx)).status).toBe(401)
  })

  it('rejects an invalid name without writing', async () => {
    expect((await POST(json({ teamName: '   ' }), ctx)).status).toBe(400)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('still renames when the league has no redraft season yet', async () => {
    mocks.season = null
    expect((await POST(json({ teamName: 'Gridiron Gang' }), ctx)).status).toBe(200)
    expect(mocks.redraftRosterUpdateMany).not.toHaveBeenCalled()
    expect(mocks.leagueTeamUpdate).toHaveBeenCalledTimes(1)
  })

  it('stores an uploaded avatar in the public image store and attaches it to the team', async () => {
    const form = new FormData()
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'me.png', { type: 'image/png' }))
    const req = new NextRequest('http://localhost/api/leagues/league-1/my-team', { method: 'POST', body: form })
    const res = await POST(req, ctx)
    expect(res.status).toBe(200)
    expect(mocks.persist).toHaveBeenCalledTimes(1)
    expect(mocks.leagueTeamUpdate).toHaveBeenCalledWith({
      where: { id: 'team-1' },
      data: { avatarUrl: 'https://blob.example/avatars/x.png' },
    })
  })

  it('refuses a non-image upload', async () => {
    const form = new FormData()
    form.set('file', new File(['x'], 'evil.svg', { type: 'image/svg+xml' }))
    const req = new NextRequest('http://localhost/api/leagues/league-1/my-team', { method: 'POST', body: form })
    const r2 = await POST(req, ctx)
    expect(r2.status).toBe(400)
    // The TYPE check refused it — not a body-parse failure that also happens to be a 400.
    expect((await r2.json()).error).not.toBe('Invalid request body')
    expect(mocks.persist).not.toHaveBeenCalled()
  })

  it('refuses an empty save', async () => {
    expect((await POST(json({}), ctx)).status).toBe(400)
  })
})
