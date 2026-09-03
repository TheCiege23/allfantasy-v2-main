/**
 * `POST /api/redraft/trade-value-preview` — the gate, mostly.
 *
 * 🛑 THE POINT OF THESE TESTS. This route is a READ, and the temptation with a read is to gate it
 * loosely because "it is only a preview". It is not: pricing a trade reads roster composition and
 * returns a per-asset breakdown, so a missing owner check lets any league member enumerate another
 * manager's roster by pricing trades they never send.
 *
 * So every refusal below is asserted by STATUS, and the ordering is asserted too — a route that
 * checks ownership before membership would leak whether a roster exists to a non-member.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  session: vi.fn(),
  member: vi.fn(),
  seasonFind: vi.fn(),
  rosterFind: vi.fn(),
  compute: vi.fn(),
  rl: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: h.member }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findFirst: h.seasonFind },
    redraftRoster: { findFirst: h.rosterFind },
  },
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.rl, getClientIp: () => '1.2.3.4' }))
vi.mock('@/lib/trade-value/captureSnapshot', () => ({
  computeRedraftTradeValueSnapshot: h.compute,
}))

import { POST } from '@/app/api/redraft/trade-value-preview/route'

const OK_BODY = {
  leagueId: 'l1',
  seasonId: 's1',
  proposerRosterId: 'r-mine',
  receiverRosterId: 'r-theirs',
  assets: [{ fromRosterId: 'r-mine', toRosterId: 'r-theirs', assetType: 'player', playerId: 'p1' }],
}

const req = (body: unknown = OK_BODY) =>
  ({ json: async () => body, headers: new Headers() }) as unknown as Parameters<typeof POST>[0]

beforeEach(() => {
  vi.resetAllMocks()
  h.rl.mockReturnValue({ success: true })
  h.session.mockResolvedValue({ user: { id: 'u1' } })
  h.member.mockResolvedValue({ ok: true })
  h.seasonFind.mockResolvedValue({ id: 's1', sport: 'NFL', season: 2026 })
  h.rosterFind.mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id === 'r-mine' ? { id: 'r-mine', ownerId: 'u1' } : { id: 'r-theirs', ownerId: 'u2' },
  )
  h.compute.mockResolvedValue({ version: '1.0', sides: [], grade: {}, context: {} })
})

describe('🛑 the gate', () => {
  it('401s without a session', async () => {
    h.session.mockResolvedValue(null)
    expect((await POST(req())).status).toBe(401)
    expect(h.compute).not.toHaveBeenCalled()
  })

  it('403s a non-member, and never reads a roster', async () => {
    h.member.mockResolvedValue({ ok: false, status: 403 })
    expect((await POST(req())).status).toBe(403)
    /*
     * ⚠ Ordering matters: reading rosters before the membership check would let a non-member
     * learn whether a roster id exists from the difference between 403 and 404.
     */
    expect(h.rosterFind).not.toHaveBeenCalled()
    expect(h.compute).not.toHaveBeenCalled()
  })

  it('🛑 403s a member pricing from SOMEBODY ELSE\'S roster', async () => {
    // The whole reason this test file exists. u1 is a member, but r-mine is owned by u2.
    h.rosterFind.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'r-mine' ? { id: 'r-mine', ownerId: 'someone-else' } : { id: 'r-theirs', ownerId: 'u2' },
    )
    const res = await POST(req())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Only the proposer roster owner can price this trade' })
    expect(h.compute).not.toHaveBeenCalled()
  })

  it('404s when a roster is not in this season/league', async () => {
    h.rosterFind.mockResolvedValue(null)
    expect((await POST(req())).status).toBe(404)
    expect(h.compute).not.toHaveBeenCalled()
  })

  it('404s an unknown season', async () => {
    h.seasonFind.mockResolvedValue(null)
    expect((await POST(req())).status).toBe(404)
  })

  it('429s when rate limited, before any database read', async () => {
    h.rl.mockReturnValue({ success: false })
    expect((await POST(req())).status).toBe(429)
    expect(h.seasonFind).not.toHaveBeenCalled()
  })
})

describe('input validation', () => {
  it('400s on missing ids', async () => {
    expect((await POST(req({ ...OK_BODY, seasonId: undefined }))).status).toBe(400)
    expect((await POST(req({ ...OK_BODY, leagueId: '  ' }))).status).toBe(400)
  })

  it('400s when both sides are the same roster', async () => {
    expect((await POST(req({ ...OK_BODY, receiverRosterId: 'r-mine' }))).status).toBe(400)
  })

  it('400s with no assets, and caps the number of them', async () => {
    expect((await POST(req({ ...OK_BODY, assets: [] }))).status).toBe(400)
    const many = Array.from({ length: 41 }, () => OK_BODY.assets[0])
    expect((await POST(req({ ...OK_BODY, assets: many }))).status).toBe(400)
  })

  it('400s on unparseable JSON rather than throwing', async () => {
    const bad = { json: async () => { throw new Error('nope') }, headers: new Headers() }
    expect((await POST(bad as never)).status).toBe(400)
  })
})

describe('the valuation itself', () => {
  it('passes the league id through — without it every value is standard-league', async () => {
    await POST(req())
    /*
     * ⚠ THE SINGLE MOST LOAD-BEARING ARGUMENT. `leagueId` is what lets the compute function read
     * real slots, team count, PPR and TE premium. Drop it and superflex and 32-team leagues are
     * priced as standard 12-team 1-QB — which is the defect this route was built to remove.
     */
    expect(h.compute).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'l1', seasonId: 's1' }))
  })

  it('🛑 forwards `metadata` — dropping it fails SILENTLY and prices everything wrong', async () => {
    /*
     * The compute function reads `position` and `team` from metadata (position drives the entire
     * scarcity multiplier), `label` for a pick, `amount` for FAAB, and `restOfSeasonProjection` as
     * the fallback when the resolver has nothing.
     *
     * The first version of this route forwarded only the top-level fields and invented a
     * `faabAmount` column that does not exist on `RawAsset`. Nothing would have thrown: every
     * player would have been priced at a 1.0 scarcity and every FAAB asset at zero, quietly.
     */
    const md = { position: 'WR', team: 'CIN', restOfSeasonProjection: 240 }
    await POST(req({
      ...OK_BODY,
      assets: [{ fromRosterId: 'r-mine', toRosterId: 'r-theirs', assetType: 'player', playerId: 'p1', metadata: md }],
    }))
    expect(h.compute).toHaveBeenCalledWith(
      expect.objectContaining({
        assets: [expect.objectContaining({ metadata: md })],
      }),
    )
  })

  it('forwards a FAAB asset\'s amount, which lives in metadata', async () => {
    await POST(req({
      ...OK_BODY,
      assets: [{ fromRosterId: 'r-mine', toRosterId: 'r-theirs', assetType: 'faab', metadata: { amount: 25 } }],
    }))
    const sent = h.compute.mock.calls[0][0].assets[0]
    expect(sent.assetType).toBe('faab')
    expect(sent.metadata).toEqual({ amount: 25 })
  })

  it('takes the sport from the season, not from the caller', async () => {
    h.seasonFind.mockResolvedValue({ id: 's1', sport: 'NCAAF', season: 2026 })
    await POST(req({ ...OK_BODY, sport: 'NFL' } as never))
    expect(h.compute).toHaveBeenCalledWith(
      expect.objectContaining({ sport: 'NCAAF', scoring: 'standard' }),
    )
  })

  it('returns the snapshot on success', async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ snapshot: { version: '1.0', sides: [], grade: {}, context: {} } })
  })

  it('🛑 500s on a failed valuation rather than returning a zeroed snapshot', async () => {
    /*
     * A zeroed snapshot is indistinguishable from a real one saying both sides are worthless. The
     * caller falls back to its own labelled estimate on a non-200, which is the honest degrade.
     */
    h.compute.mockRejectedValue(new Error('boom'))
    const res = await POST(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Could not price this trade' })
  })
})
