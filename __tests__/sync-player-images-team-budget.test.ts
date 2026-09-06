import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 THE TEAM-LOGO PASS WAS THE ONE LOOP IN THIS ROUTE WITH NO DEADLINE.
 *
 * Everything else is bounded properly — the shared 240s budget is checked between sports AND per
 * player inside `resolveBatch`. `syncTeamLogos` took neither, and iterated every legacy team with
 * an unbounded `await` each. Measured from the slow-tier dispatcher log, 2026-09-06:
 *
 *     -> sync-player-images?sport=NFL   ... OK 200 (241034ms)
 *     -> sync-player-images?sport=NCAAF ... OK 200 (276282ms)
 *
 * Both finished UNDER the 300s platform edge, which is the only reason they were still returning
 * 200 rather than the 502s `import-players` and `import-schedules?riProfiles=1` were serving. NCAAF
 * carries 231 teams, which is why it overran the 240s budget by the wider margin.
 *
 * ⚠ THE TELL WAS ALREADY IN THE TYPE. `PassSummary.timedOut` was initialised `false` in this pass
 * and never assigned, while both player passes set it — a field that can only ever report one
 * value is a bound nobody wired.
 */

const { prismaMock, writePrimaryTeamImageMock } = vi.hoisted(() => ({
  prismaMock: {
    sportsTeam: { findMany: vi.fn() },
    teamProviderIdentity: { findMany: vi.fn() },
  },
  writePrimaryTeamImageMock: vi.fn().mockResolvedValue({ written: true }),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/sport-teams/teamImageStore', () => ({
  TEAM_IMAGE_TYPE_LOGO: 'logo',
  writePrimaryTeamImage: writePrimaryTeamImageMock,
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.resetModules()
})

/** `n` legacy teams, each with a canonical identity so every one is a real unit of work. */
function givenTeams(n: number) {
  const teams = Array.from({ length: n }, (_, i) => ({
    source: 'espn',
    externalId: `t${i}`,
    logo: `https://example.invalid/${i}.png`,
  }))
  prismaMock.sportsTeam.findMany.mockResolvedValue(teams)
  prismaMock.teamProviderIdentity.findMany.mockResolvedValue(
    teams.map((t) => ({ provider: t.source, providerTeamId: t.externalId, teamId: `canon-${t.externalId}` })),
  )
}

describe('syncTeamLogos honours the shared wall-clock budget', () => {
  it('writes every team when there is time — the default path is unchanged', async () => {
    givenTeams(5)
    const { syncTeamLogos } = await import('@/app/api/cron/sync-player-images/route')

    const res = await syncTeamLogos('NCAAF', false, Date.now() + 60_000)

    expect(res.resolved).toBe(5)
    expect(res.timedOut).toBe(false)
    expect(writePrimaryTeamImageMock).toHaveBeenCalledTimes(5)
  })

  /*
   * 🛑 THE LOAD-BEARING ASSERTION. With the deadline already gone the pass must stop at the first
   * team rather than working through all 231. This is the assertion that fails if the check is
   * removed from the loop.
   */
  it('stops immediately when the budget is already spent, and says so', async () => {
    givenTeams(200)
    const { syncTeamLogos } = await import('@/app/api/cron/sync-player-images/route')

    const res = await syncTeamLogos('NCAAF', false, Date.now() - 1)

    expect(writePrimaryTeamImageMock).not.toHaveBeenCalled()
    expect(res.timedOut).toBe(true)
    expect(res.resolved).toBe(0)
  })

  /*
   * Stopping part-way is safe and resumable: this backfills from rows already on disk, so teams
   * not reached are picked up next run. `considered` still reports the full candidate set, so a
   * truncated pass is legible rather than looking like a smaller universe.
   */
  it('stops mid-pass and still reports the full candidate count', async () => {
    givenTeams(50)
    let clock = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    // Each write burns 10s; the pass is given 25s.
    writePrimaryTeamImageMock.mockImplementation(async () => {
      clock += 10_000
      return { written: true }
    })
    const { syncTeamLogos } = await import('@/app/api/cron/sync-player-images/route')

    const res = await syncTeamLogos('NCAAF', false, clock + 25_000)

    expect(res.timedOut).toBe(true)
    expect(res.resolved).toBeLessThan(50)
    expect(res.considered).toBe(50)
  })

  it('a dry run does no work and cannot time out', async () => {
    givenTeams(200)
    const { syncTeamLogos } = await import('@/app/api/cron/sync-player-images/route')

    const res = await syncTeamLogos('NCAAF', true, Date.now() - 1)

    expect(writePrimaryTeamImageMock).not.toHaveBeenCalled()
    expect(res.timedOut).toBe(false)
    expect(res.considered).toBe(200)
  })
})
