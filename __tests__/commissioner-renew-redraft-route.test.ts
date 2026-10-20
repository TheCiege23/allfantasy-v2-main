import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The renew route for a REDRAFT league runs the unified renew (roster reset + next season + next
 * draft) before any of its own writes, and refuses a second renew into the same season.
 */

const m = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  notify: vi.fn(),
  rating: vi.fn(),
  leagueFindUnique: vi.fn(),
  leagueUpdate: vi.fn(),
  leagueSeasonUpsert: vi.fn(),
  leagueTeamUpdateMany: vi.fn(),
  leagueTeamCount: vi.fn(),
  rosterUpdateMany: vi.fn(),
  renew: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/CommissionerChangeNotifier', () => ({ notifyCommissionerChange: m.notify }))
vi.mock('@/lib/commissioner/CommissionerRatingTrigger', () => ({ checkAndTriggerRatingIfOffseason: m.rating }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: m.leagueFindUnique, update: m.leagueUpdate },
    leagueSeason: { upsert: m.leagueSeasonUpsert, findUnique: vi.fn().mockResolvedValue(null) },
    redraftSeason: { findFirst: vi.fn().mockResolvedValue(null) },
    leagueTeam: { updateMany: m.leagueTeamUpdateMany, count: m.leagueTeamCount },
    roster: { updateMany: m.rosterUpdateMany },
    findLeagueListing: { upsert: vi.fn() },
    legacyTournamentLeague: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}))
vi.mock('@/lib/redraft/offseason/renewRedraftLeague', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/redraft/offseason/renewRedraftLeague')>()),
  renewRedraftLeague: m.renew,
}))

function redraftLeague(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'commish',
    season: 2026,
    settings: {},
    leagueVariant: 'redraft',
    platform: 'manual',
    isDynasty: false,
    sport: 'NBA',
    name: 'Hoops',
    scoring: 'points',
    waiverBudget: 100,
    status: 'complete',
    lifecycleState: 'offseason',
    teams: [
      { id: 't1', teamName: 'One', ownerName: 'A', isOrphan: false, isCommissioner: true, wins: 10, losses: 4, pointsFor: 1500, platformUserId: 'u1', currentRank: 1 },
    ],
    ...overrides,
  }
}

async function post(body: unknown) {
  const { POST } = await import('@/app/api/commissioner/leagues/[leagueId]/renew/route')
  const req = new Request('http://localhost/api/commissioner/leagues/L1/renew', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req as never, { params: Promise.resolve({ leagueId: 'L1' }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  m.getServerSession.mockResolvedValue({ user: { id: 'commish' } })
  m.notify.mockResolvedValue(undefined)
  m.rating.mockResolvedValue(undefined)
  m.leagueSeasonUpsert.mockResolvedValue({})
  m.leagueTeamUpdateMany.mockResolvedValue({ count: 0 })
  m.leagueTeamCount.mockResolvedValue(0)
  m.rosterUpdateMany.mockResolvedValue({ count: 0 })
  m.leagueUpdate.mockResolvedValue({})
  m.leagueFindUnique.mockResolvedValue(redraftLeague())
  m.renew.mockResolvedValue({
    ok: true,
    sessionId: 'draft-2',
    seasonId: 'season-2',
    season: 2027,
    orderMode: 'manual',
    slotOrder: [{ slot: 1, rosterId: 'R-1', displayName: 'One' }],
    rostersReset: 1,
    waiverClaimsCancelled: 2,
    tradesCancelled: 1,
  })
})

describe('POST renew — redraft', () => {
  it('runs the unified renew with the commissioner’s order and returns the new draft', async () => {
    const res = await post({ draftOrder: 'manual', manualOrder: ['R-1'] })
    expect(res.status).toBe(200)
    expect(m.renew).toHaveBeenCalledWith('L1', 'commish', { draftOrder: 'manual', manualOrder: ['R-1'] })
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, nextSeason: 2027, draft: { sessionId: 'draft-2', orderMode: 'manual' } })
    // The unified renew did the roster reset inside its transaction; the legacy reset does not run again.
    expect(m.rosterUpdateMany).not.toHaveBeenCalled()
    const last = m.leagueUpdate.mock.calls.at(-1)![0]
    expect(last.data).toMatchObject({ season: 2027, status: 'pre_draft' })
    expect(last.data.settings.renewal_completed_for_season).toBe(2027)
  })

  it('a refused renew (bad manual order) writes NOTHING — not even last season’s history', async () => {
    m.renew.mockResolvedValue({ ok: false, code: 'INVALID_MANUAL_ORDER', message: 'list each team once' })
    const res = await post({ draftOrder: 'manual', manualOrder: [] })
    expect(res.status).toBe(400)
    expect(m.leagueSeasonUpsert).not.toHaveBeenCalled()
    expect(m.leagueTeamUpdateMany).not.toHaveBeenCalled()
    expect(m.leagueUpdate).not.toHaveBeenCalled()
  })

  it('🛑 a second renew into the same season is refused before any write', async () => {
    // What the first renew left behind: season advanced, marker + timestamp set, league pre-draft.
    // The unified renew stamps `lastTransitionAt` INSIDE the renew — before the route writes
    // `renewal_completed_at` — so it must not read as "the season has moved on since".
    m.leagueFindUnique.mockResolvedValue(
      redraftLeague({
        season: 2027,
        status: 'pre_draft',
        lifecycleState: 'pre_draft',
        lifecycleMetadata: { lastTransitionAt: '2026-12-01T10:00:00.000Z', renewedIntoSeason: 2027 },
        settings: { renewal_completed_for_season: 2027, renewal_completed_at: '2026-12-01T10:00:00.250Z', season_phase: 'pre_season' },
      }),
    )
    const res = await post({ draftOrder: 'random' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('already_renewed')
    expect(m.renew).not.toHaveBeenCalled()
    expect(m.leagueSeasonUpsert).not.toHaveBeenCalled()
    expect(m.leagueTeamUpdateMany).not.toHaveBeenCalled()
    expect(m.leagueUpdate).not.toHaveBeenCalled()
  })

  it('the unified renew’s own ALREADY_RENEWED is surfaced as 409 already_renewed', async () => {
    m.renew.mockResolvedValue({ ok: false, code: 'ALREADY_RENEWED', message: 'already' })
    const res = await post({ draftOrder: 'random' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('already_renewed')
    expect(m.leagueUpdate).not.toHaveBeenCalled()
  })

  it('next offseason, with the marked season played out, renewing is allowed again', async () => {
    m.leagueFindUnique.mockResolvedValue(
      redraftLeague({
        season: 2027,
        status: 'complete',
        lifecycleState: 'offseason',
        lifecycleMetadata: { lastTransitionAt: '2027-12-20T00:00:00.000Z' },
        settings: { renewal_completed_for_season: 2027, renewal_completed_at: '2026-12-01T10:00:00.250Z' },
      }),
    )
    m.renew.mockResolvedValue({ ok: true, sessionId: 'd3', seasonId: 's3', season: 2028, orderMode: 'random', slotOrder: [], rostersReset: 1, waiverClaimsCancelled: 0, tradesCancelled: 0 })
    const res = await post({ draftOrder: 'random' })
    expect(res.status).toBe(200)
    expect((await res.json()).nextSeason).toBe(2028)
  })

  it('the renew stamps a timestamp that the route guard reads on the next POST', async () => {
    await post({ draftOrder: 'random' })
    const written = m.leagueUpdate.mock.calls.at(-1)![0].data.settings
    expect(written.renewal_completed_for_season).toBe(2027)
    expect(typeof written.renewal_completed_at).toBe('string')
  })

  it('a league with no RedraftSeason keeps the legacy roster-only reset', async () => {
    m.renew.mockResolvedValue({ ok: false, code: 'NO_SEASON', message: 'no season' })
    const res = await post({})
    expect(res.status).toBe(200)
    expect(m.rosterUpdateMany).toHaveBeenCalledTimes(1)
    expect((await res.json()).draft).toBeNull()
  })

  it('a dynasty renew never runs the redraft reset', async () => {
    m.leagueFindUnique.mockResolvedValue(redraftLeague({ leagueVariant: 'dynasty', isDynasty: true }))
    const res = await post({})
    expect(res.status).toBe(200)
    expect(m.renew).not.toHaveBeenCalled()
  })
})
