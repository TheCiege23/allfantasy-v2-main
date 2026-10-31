import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  redraftSeason: { findFirst: vi.fn() },
  league: { findUnique: vi.fn() },
  redraftWaiverClaim: { findMany: vi.fn(async () => []) },
  guillotineRosterState: { findFirst: vi.fn(async () => null) },
  survivorGameState: { findUnique: vi.fn(async () => null) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const { processWaiverWindow } = await import('@/lib/redraft/waiverEngine')
const { getChopHoldStart, getWaiverBlindWindowStart } = await import('@/lib/guillotine/sportConfig')

const whereOf = () => prismaMock.redraftWaiverClaim.findMany.mock.calls[0][0].where

describe('guillotine blind waiver window', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.redraftSeason.findFirst.mockResolvedValue({ id: 'season-1', leagueId: 'league-1' })
  })

  it('NFL: the window opens 36h before the Wednesday 12:00 UTC run and covers the Tuesday chop', () => {
    // Run: Wed 2026-10-28 12:00 UTC → window opens Tue 2026-10-27 00:00 UTC (Mon 8pm ET).
    expect(getWaiverBlindWindowStart('NFL', new Date('2026-10-27T23:00:00Z'))?.toISOString()).toBe('2026-10-27T00:00:00.000Z')
    expect(getWaiverBlindWindowStart('NFL', new Date('2026-10-28T11:59:00Z'))?.toISOString()).toBe('2026-10-27T00:00:00.000Z')
    // Outside the window: Sunday morning, and the hour the run fires.
    expect(getWaiverBlindWindowStart('NFL', new Date('2026-11-01T15:00:00Z'))).toBeNull()
    expect(getWaiverBlindWindowStart('NFL', new Date('2026-10-28T12:10:00Z'))).toBeNull()
  })

  it('NBA: the window runs Wednesday 00:00 UTC to the Thursday 12:00 UTC run', () => {
    expect(getWaiverBlindWindowStart('NBA', new Date('2026-10-28T03:00:00Z'))?.toISOString()).toBe('2026-10-28T00:00:00.000Z')
    expect(getWaiverBlindWindowStart('NBA', new Date('2026-10-27T23:00:00Z'))).toBeNull()
  })

  /*
   * NHL weeks run Tuesday–Monday from its Tuesday opener, exactly like NBA, so it has NBA's window.
   * MLB weeks run Wednesday–Tuesday (2026 and 2027 openers are Wednesdays): its run is Friday 11:00 UTC
   * and the window opens Wednesday 23:00 UTC (7pm ET), before a chop that lands Wednesday night ET.
   */
  it('NHL: the window runs Wednesday 00:00 UTC to the Thursday 12:00 UTC run, as NBA', () => {
    expect(getWaiverBlindWindowStart('NHL', new Date('2026-10-28T03:00:00Z'))?.toISOString()).toBe('2026-10-28T00:00:00.000Z')
    expect(getWaiverBlindWindowStart('NHL', new Date('2026-10-29T11:59:00Z'))?.toISOString()).toBe('2026-10-28T00:00:00.000Z')
    expect(getWaiverBlindWindowStart('NHL', new Date('2026-10-27T23:00:00Z'))).toBeNull()
    expect(getWaiverBlindWindowStart('NHL', new Date('2026-10-29T12:10:00Z'))).toBeNull()
  })

  it('MLB: the window opens Wednesday 23:00 UTC and runs to the Friday 11:00 UTC run, covering the chop', () => {
    // Week Wed 2027-04-07 – Tue 2027-04-13; the chop lands Wednesday night ET (Thursday ~02:00 UTC).
    expect(getWaiverBlindWindowStart('MLB', new Date('2027-04-15T02:00:00Z'))?.toISOString()).toBe('2027-04-14T23:00:00.000Z')
    expect(getWaiverBlindWindowStart('MLB', new Date('2027-04-16T10:59:00Z'))?.toISOString()).toBe('2027-04-14T23:00:00.000Z')
    expect(getWaiverBlindWindowStart('MLB', new Date('2027-04-14T22:00:00Z'))).toBeNull()
    expect(getWaiverBlindWindowStart('MLB', new Date('2027-04-16T11:10:00Z'))).toBeNull()
  })

  it('MLB/NHL: a chop that lands before the window still holds its claims until the run', () => {
    // An early MLB chop (Wednesday 20:00 UTC, before the 23:00 window) is anchored on the chop itself.
    const early = new Date('2027-04-14T20:00:00Z')
    expect(getChopHoldStart('MLB', early, new Date('2027-04-14T21:00:00Z'))).toEqual(early)
    expect(getChopHoldStart('MLB', early, new Date('2027-04-16T11:30:00Z'))).toBeNull()
    const nhlEarly = new Date('2026-10-27T20:00:00Z')
    expect(getChopHoldStart('NHL', nhlEarly, new Date('2026-10-27T22:00:00Z'))).toEqual(nhlEarly)
  })

  it('inside the window a Guilly league holds claims submitted after it opened', async () => {
    for (const sport of ['NFL', 'NBA', 'NHL', 'MLB']) {
      prismaMock.redraftWaiverClaim.findMany.mockClear()
      prismaMock.league.findUnique.mockResolvedValueOnce({ sport, guillotineMode: true, leagueVariant: null })
      const now =
        sport === 'NFL' ? new Date('2026-10-27T23:00:00Z') : sport === 'MLB' ? new Date('2027-04-15T02:00:00Z') : new Date('2026-10-28T03:00:00Z')
      await processWaiverWindow('league-1', 'season-1', now)
      expect(whereOf()).toEqual({
        leagueId: 'league-1',
        seasonId: 'season-1',
        status: 'pending',
        submittedAt: { lt: getWaiverBlindWindowStart(sport, now) },
      })
    }
  })

  it('outside the window, and for other leagues, every pending claim settles', async () => {
    const sunday = new Date('2026-11-01T15:00:00Z')
    expect(getWaiverBlindWindowStart('NCAAF', sunday)).not.toBeNull() // so the NCAAF case below tests the sport list
    const insideNfl = new Date('2026-10-27T23:00:00Z')
    for (const [league, now] of [
      [{ sport: 'NFL', guillotineMode: true, leagueVariant: null }, sunday],
      [{ sport: 'NFL', guillotineMode: false, leagueVariant: 'redraft' }, insideNfl],
      // A sport whose schedule has not been checked still settles every run — on a Sunday, inside its own window.
      [{ sport: 'NCAAF', guillotineMode: true, leagueVariant: 'guillotine' }, sunday],
    ] as const) {
      prismaMock.redraftWaiverClaim.findMany.mockClear()
      prismaMock.league.findUnique.mockResolvedValueOnce(league)
      await processWaiverWindow('league-1', 'season-1', now)
      expect(whereOf()).not.toHaveProperty('submittedAt')
    }
  })

  describe('holds anchored on the chop itself', () => {
    // NBA runs Thursdays 12:00 UTC. A week with no Monday games chops Tuesday morning UTC, a day before
    // the calendar window opens; late stats can push a chop past Thursday's run.
    const earlyChop = new Date('2026-10-27T03:00:00Z') // Tue, last run Thu 10-22
    const lateChop = new Date('2026-10-29T15:00:00Z') // Thu, 3h after the 10-29 run

    it('an early chop holds claims from the chop until the scheduled run', () => {
      expect(getChopHoldStart('NBA', earlyChop, new Date('2026-10-27T10:00:00Z'))).toEqual(earlyChop)
      expect(getWaiverBlindWindowStart('NBA', new Date('2026-10-27T10:00:00Z'))).toBeNull()
      // Settled by the run: the next cycle starts clean.
      expect(getChopHoldStart('NBA', earlyChop, new Date('2026-10-29T12:30:00Z'))).toBeNull()
    })

    it('a late chop holds its players for 24h, then releases them', () => {
      expect(getChopHoldStart('NBA', lateChop, new Date('2026-10-30T10:00:00Z'))).toEqual(lateChop)
      expect(getChopHoldStart('NBA', lateChop, new Date('2026-10-30T15:30:00Z'))).toBeNull()
    })

    it('the engine holds claims submitted after an early chop even outside the calendar window', async () => {
      prismaMock.league.findUnique.mockResolvedValueOnce({ sport: 'NBA', guillotineMode: true, leagueVariant: null })
      prismaMock.guillotineRosterState.findFirst.mockResolvedValueOnce({ choppedAt: earlyChop })
      await processWaiverWindow('league-1', 'season-1', new Date('2026-10-27T10:00:00Z'))
      expect(whereOf().submittedAt).toEqual({ lt: earlyChop })
    })

    it('inside the calendar window the earlier of the two starts wins', async () => {
      const now = new Date('2026-10-28T03:00:00Z') // window opened Wed 00:00 UTC
      prismaMock.league.findUnique.mockResolvedValueOnce({ sport: 'NBA', guillotineMode: true, leagueVariant: null })
      prismaMock.guillotineRosterState.findFirst.mockResolvedValueOnce({ choppedAt: earlyChop })
      await processWaiverWindow('league-1', 'season-1', now)
      expect(whereOf().submittedAt).toEqual({ lt: earlyChop })
    })
  })
})
