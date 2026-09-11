/**
 * `PATCH /api/discord/league` — one surface per write.
 *
 * 🛑 WHAT THIS REPLACES. The handler wrote `updateMany({ where: { leagueId } })`
 * with no surface clause. `@@unique([leagueId, surface])` permits four rows per
 * league, so once the other surfaces become mappable, setting League chat to
 * "Both ways" would also have written `{ syncEnabled: true, syncOutbound: true,
 * syncInbound: true }` onto `commissioner_notes` — flipping a surface whose
 * whole point is that it defaults to off, with no control for it and no signal.
 *
 * ⚠ IT IS LATENT TODAY, AND THAT IS WHY IT NEEDS A TEST RATHER THAN A FIX ALONE.
 * `getDiscordBridge` marks every non-`league_chat` surface `available: false`,
 * so nothing can currently send another surface. The guard has to exist BEFORE
 * `surfacesPending` goes false, because the commit that makes the feature work
 * is the commit that arms the bug.
 *
 * ⚠ THE LOAD-BEARING ASSERTION IS ON THE `where`, NOT THE RESPONSE. A handler
 * that wrote every row and still answered 200 would pass any status-only test —
 * the rows are the thing being protected.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  leagueFindFirst: vi.fn(),
  channelUpdateMany: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: mocks.leagueFindFirst },
    discordLeagueChannel: { updateMany: mocks.channelUpdateMany },
  },
}))
// The GET half of this route pulls the bot client; PATCH never touches it.
vi.mock('@/lib/api/require-league-access', () => ({ requireLeagueApiAccess: vi.fn() }))
vi.mock('@/lib/discord/bot', () => ({
  isBotConfigured: () => true,
  missingBotPermissions: vi.fn(),
  createOrReuseChannelInvite: vi.fn(),
}))
vi.mock('@/lib/discord/deepLinks', () => ({ channelLink: () => 'https://discord.com/channels/1/2' }))

import { PATCH } from '@/app/api/discord/league/route'

const OWNER = 'app-user-uuid-owner'
const LEAGUE_ID = 'league-under-test'

function patch(body: unknown) {
  return PATCH(
    new Request('http://localhost/api/discord/league', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

/** The `where` the handler actually sent to prisma. */
function sentWhere() {
  return mocks.channelUpdateMany.mock.calls[0]?.[0]?.where
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getServerSession.mockResolvedValue({ user: { id: OWNER } })
  mocks.leagueFindFirst.mockResolvedValue({ userId: OWNER })
  mocks.channelUpdateMany.mockResolvedValue({ count: 1 })
})

describe('scopes the write to one surface', () => {
  it('never writes every row for the league', async () => {
    const res = await patch({ leagueId: LEAGUE_ID, syncEnabled: true })
    expect(res.status).toBe(200)
    /*
     * 🛑 THE REGRESSION. `{ leagueId }` alone is the shipped defect; any `where`
     * without a surface writes all four rows.
     */
    expect(sentWhere()).toHaveProperty('surface')
    expect(sentWhere()).not.toEqual({ leagueId: LEAGUE_ID })
  })

  it('writes the surface the caller named', async () => {
    await patch({ leagueId: LEAGUE_ID, surface: 'commissioner_notes', syncEnabled: true })
    expect(sentWhere()).toEqual({ leagueId: LEAGUE_ID, surface: 'commissioner_notes' })
  })

  it('defaults to league_chat for callers that predate surfaces', async () => {
    /*
     * `DiscordLeagueSyncPanel.tsx` at /league/[leagueId] PATCHes one boolean and
     * sends no surface. Every row in the table is `league_chat` — the column
     * default, and the only creator never sets it — so this scopes those callers
     * to exactly the row they were already editing.
     */
    await patch({ leagueId: LEAGUE_ID, syncInbound: true })
    expect(sentWhere()).toEqual({ leagueId: LEAGUE_ID, surface: 'league_chat' })
  })

  it.each([
    ['an unknown surface', 'not_a_surface'],
    ['a SQL-ish string', "league_chat' OR '1'='1"],
    ['an empty-after-trim string is treated as absent, not invalid', '   '],
  ])('rejects or normalises %s', async (label, surface) => {
    const res = await patch({ leagueId: LEAGUE_ID, surface, syncEnabled: true })
    if (label.startsWith('an empty')) {
      expect(res.status).toBe(200)
      expect(sentWhere()).toEqual({ leagueId: LEAGUE_ID, surface: 'league_chat' })
    } else {
      expect(res.status).toBe(400)
      expect(mocks.channelUpdateMany, 'a bad surface reached the database').not.toHaveBeenCalled()
    }
  })

  it('accepts every surface the contract defines, and only those', async () => {
    /*
     * ⚠ PINNED AGAINST DIVERGENCE. The route imports `BRIDGE_SURFACES` rather
     * than hardcoding a list, so this asserts the two cannot drift: a surface
     * the UI offers must be one the route accepts.
     */
    const { BRIDGE_SURFACES } = await import('@/lib/core-app/discordBridgeContract')
    expect(BRIDGE_SURFACES.length).toBeGreaterThan(1)
    for (const s of BRIDGE_SURFACES) {
      vi.clearAllMocks()
      mocks.getServerSession.mockResolvedValue({ user: { id: OWNER } })
      mocks.leagueFindFirst.mockResolvedValue({ userId: OWNER })
      mocks.channelUpdateMany.mockResolvedValue({ count: 1 })
      const res = await patch({ leagueId: LEAGUE_ID, surface: s.id, syncEnabled: true })
      expect(res.status, `${s.id} was rejected`).toBe(200)
      expect(sentWhere()).toEqual({ leagueId: LEAGUE_ID, surface: s.id })
    }
  })
})

describe('reports a write that changed nothing', () => {
  it('404s instead of claiming success when no row matched', async () => {
    /*
     * Unscoped, a zero-row write only happened for a league with no channel at
     * all. Scoped, it also happens for a surface with no mapping — a state the
     * caller can now ask for. `{ ok: true }` there is the same shape of lie as
     * the direction collapse this bridge already shipped once.
     */
    mocks.channelUpdateMany.mockResolvedValue({ count: 0 })
    const res = await patch({ leagueId: LEAGUE_ID, surface: 'draft_room', syncEnabled: true })
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toHaveProperty('error')
  })

  it('reports the surface and row count on success', async () => {
    const res = await patch({ leagueId: LEAGUE_ID, surface: 'league_chat', syncEnabled: false })
    await expect(res.json()).resolves.toEqual({ ok: true, surface: 'league_chat', updated: 1 })
  })
})

describe('the authorization gate is unchanged', () => {
  it('401s an anonymous caller before reading anything', async () => {
    mocks.getServerSession.mockResolvedValue(null)
    const res = await patch({ leagueId: LEAGUE_ID, syncEnabled: true })
    expect(res.status).toBe(401)
    expect(mocks.leagueFindFirst).not.toHaveBeenCalled()
    expect(mocks.channelUpdateMany).not.toHaveBeenCalled()
  })

  it('403s a non-owner and writes nothing', async () => {
    mocks.leagueFindFirst.mockResolvedValue({ userId: 'someone-else' })
    const res = await patch({ leagueId: LEAGUE_ID, syncEnabled: true })
    expect(res.status).toBe(403)
    expect(mocks.channelUpdateMany, 'a non-owner reached the write').not.toHaveBeenCalled()
  })

  it('403s a missing league', async () => {
    mocks.leagueFindFirst.mockResolvedValue(null)
    const res = await patch({ leagueId: 'no-such-league', syncEnabled: true })
    expect(res.status).toBe(403)
    expect(mocks.channelUpdateMany).not.toHaveBeenCalled()
  })

  it('400s with no toggles, without writing', async () => {
    const res = await patch({ leagueId: LEAGUE_ID })
    expect(res.status).toBe(400)
    expect(mocks.channelUpdateMany).not.toHaveBeenCalled()
  })
})
