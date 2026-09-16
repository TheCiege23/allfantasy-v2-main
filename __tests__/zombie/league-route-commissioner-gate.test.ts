// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/zombie/league reconfigures a league: it forces snake drafts, clears the playoff weeks and
 * creates the ZombieLeague row that makes the league count as a Zombie league. It used to require
 * only a session, so any signed-in user could do that to any league.
 *
 * The permission module is NOT mocked here. These tests run the real `requireCommissionerOnly` /
 * `getLeagueRole` against a mocked Prisma, so they pin who may act — not merely that a helper was
 * called. A test that mocked the helper would stay green if the helper allowed everyone.
 */

const OWNER = 'user-owner'
const LEAGUE = 'league-1'

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  leagueFindFirst: vi.fn(),
  leagueTeamFindFirst: vi.fn(),
  rosterFindFirst: vi.fn(),
  leagueUpdate: vi.fn(),
  leagueSettingsUpdateMany: vi.fn(),
  createZombieLeague: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: h.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: h.leagueFindFirst, update: h.leagueUpdate },
    leagueTeam: { findFirst: h.leagueTeamFindFirst },
    roster: { findFirst: h.rosterFindFirst },
    leagueSettings: { updateMany: h.leagueSettingsUpdateMany },
  },
}))
vi.mock('@/lib/zombie/setupEngine', () => ({ createZombieLeague: h.createZombieLeague }))
vi.mock('@/lib/sport-scope', () => ({ normalizeToSupportedSport: (s: string) => s }))
vi.mock('@/lib/zombie/zombie-sport-eligibility', () => ({ isZombieEligibleLeagueSport: () => true }))
vi.mock('@/lib/zombie/zombieBackgroundThemes', () => ({ getRandomZombieTheme: () => 'default' }))
vi.mock('@/lib/zombie/ZombieHordeSitOutEngine', () => ({ getZombieHordeSitOutStateForWeek: vi.fn() }))
vi.mock('@/lib/zombie/whispererViewer', () => ({ resolveWhispererViewer: vi.fn() }))
vi.mock('@/lib/zombie/whispererRedaction', () => ({
  redactWhispererRecord: vi.fn(),
  redactZombieEvent: vi.fn(),
  redactZombieTeam: vi.fn(),
}))

function post(body: Record<string, unknown> = { leagueId: LEAGUE, sport: 'NFL', teamCount: 12 }) {
  return new Request('http://localhost/api/zombie/league', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function callAs(userId: string | null, body?: Record<string, unknown>) {
  h.getServerSession.mockResolvedValue(userId ? { user: { id: userId } } : null)
  const { POST } = await import('@/app/api/zombie/league/route')
  return POST(post(body))
}

function expectNothingWritten() {
  expect(h.leagueUpdate).not.toHaveBeenCalled()
  expect(h.leagueSettingsUpdateMany).not.toHaveBeenCalled()
  expect(h.createZombieLeague).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  h.leagueFindFirst.mockResolvedValue({ userId: OWNER })
  h.leagueTeamFindFirst.mockResolvedValue(null)
  h.rosterFindFirst.mockResolvedValue(null)
  h.leagueUpdate.mockResolvedValue({})
  h.leagueSettingsUpdateMany.mockResolvedValue({ count: 1 })
  h.createZombieLeague.mockResolvedValue({ id: 'zl-1', leagueId: LEAGUE, themeLabel: 'default' })
})

describe('POST /api/zombie/league — who may reconfigure a league', () => {
  it('401 without a session, and writes nothing', async () => {
    const res = await callAs(null)

    expect(res.status).toBe(401)
    expectNothingWritten()
  })

  it('403 for a signed-in member of the league, and writes nothing', async () => {
    h.rosterFindFirst.mockResolvedValue({ id: 'roster-7' })

    const res = await callAs('user-member')

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Only the head commissioner can perform this action.' })
    expectNothingWritten()
  })

  it('403 for a signed-in user with no relation to the league, and writes nothing', async () => {
    const res = await callAs('user-stranger')

    expect(res.status).toBe(403)
    expectNothingWritten()
  })

  it('403 for a co-commissioner — this is a head-commissioner action', async () => {
    h.leagueTeamFindFirst.mockResolvedValue({ isCommissioner: false, isCoCommissioner: true, role: 'member' })

    const res = await callAs('user-co-commish')

    expect(res.status).toBe(403)
    expectNothingWritten()
  })

  it('403, not 404, when the league does not exist — no existence oracle', async () => {
    h.leagueFindFirst.mockResolvedValue(null)

    const res = await callAs('user-stranger')

    expect(res.status).toBe(403)
    expectNothingWritten()
  })

  it('checks authority before validating the body, so a stranger gets 403 rather than a 400 hint', async () => {
    const res = await callAs('user-stranger', { leagueId: LEAGUE, sport: 'NFL', teamCount: 7 })

    expect(res.status).toBe(403)
    expectNothingWritten()
  })

  /*
   * ⚠ A THROWN Response IS A 500 IN NEXT 14 unless the route catches it. Calling the handler directly
   * would not show that — so this pins that the handler RETURNS the 403 instead of throwing it.
   */
  it('returns the denial rather than throwing it', async () => {
    h.getServerSession.mockResolvedValue({ user: { id: 'user-stranger' } })
    const { POST } = await import('@/app/api/zombie/league/route')

    await expect(POST(post())).resolves.toBeInstanceOf(Response)
  })

  it('200 for the league owner, who reconfigures the league and creates the zombie row', async () => {
    const res = await callAs(OWNER)

    expect(res.status).toBe(200)
    expect(h.leagueSettingsUpdateMany).toHaveBeenCalledWith({ where: { leagueId: LEAGUE }, data: { draftType: 'snake' } })
    expect(h.leagueUpdate).toHaveBeenCalledWith({
      where: { id: LEAGUE },
      data: { playoffStartWeek: null, playoffWeeksPerRound: null },
    })
    expect(h.createZombieLeague).toHaveBeenCalledTimes(1)
    expect(h.createZombieLeague.mock.calls[0][0]).toMatchObject({ leagueId: LEAGUE, teamCount: 12 })
  })

  it("200 for an imported league's commissioner who claimed a team flagged commissioner", async () => {
    h.leagueTeamFindFirst.mockResolvedValue({ isCommissioner: true, isCoCommissioner: false, role: 'member' })

    const res = await callAs('user-sleeper-commish')

    expect(res.status).toBe(200)
    expect(h.createZombieLeague).toHaveBeenCalledTimes(1)
  })
})
