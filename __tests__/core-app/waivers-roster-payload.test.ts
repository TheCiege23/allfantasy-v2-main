import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 `playerData` IS A WHOLE ROSTER, AND THIS SCREEN WANTED EXACTLY ONE OF THEM.
 *
 * `getWaiversData` read every roster in the league with `playerData` selected, and used that blob
 * for precisely one row — the caller's own, for the roster-load tile. The other columns
 * (`faabRemaining`, `waiverPriority`) genuinely are league-wide: they rank the caller on budget
 * and count the league. The blob is not.
 *
 * Measured on the test database: 1,187 bytes per roster, so a typical 13-roster league moved
 * 15,347 bytes to use 1,187 — 92% discarded — and the heaviest leagues in the set (32 rosters)
 * moved 48,741 bytes to use the same one, 96.9% discarded.
 *
 * ⚠ AND THE SAME SHAPE ONE FILE OVER IS **NOT** A DEFECT. `waiversBoard.ts` selects `playerData`
 * for every roster across every one of the caller's leagues and looks identical — but it walks
 * all of them to build `takenIds`, the set of players somebody already holds, which is the core
 * of a waiver board. "Fixing" it the way this file was fixed would silently offer rostered
 * players as free agents. That near-miss is why this test names the rule rather than just the
 * byte count.
 */

const prismaMock = vi.hoisted(() => ({
  roster: { findMany: vi.fn(), findUnique: vi.fn() },
  leagueWaiverSettings: { findUnique: vi.fn() },
  waiverClaim: { count: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('server-only', () => ({}))

const LEAGUE = {
  id: 'L1',
  name: 'Test League',
  platform: 'sleeper',
  leagueType: 'redraft',
}

vi.mock('@/lib/core-app/leagueContext', () => ({
  leagueContextFor: () => ({
    league: async () => LEAGUE,
    claimedTeam: async () => ({ platformUserId: 'me', externalId: '1' }),
  }),
}))

const MY_PLAYER_DATA = { players: ['p1', 'p2', 'p3', '0'], starters: ['p1', 'p2'], reserve: ['p3'] }

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.leagueWaiverSettings.findUnique.mockResolvedValue(null)
  prismaMock.waiverClaim.count.mockResolvedValue(0)
  prismaMock.roster.findMany.mockResolvedValue([
    { id: 'r-me', platformUserId: 'me', faabRemaining: 40, waiverPriority: 3 },
    { id: 'r-them', platformUserId: 'them', faabRemaining: 90, waiverPriority: 1 },
    { id: 'r-other', platformUserId: 'other', faabRemaining: 10, waiverPriority: 7 },
  ])
  prismaMock.roster.findUnique.mockResolvedValue({ playerData: MY_PLAYER_DATA })
})

describe('the Waivers read stops pulling every roster blob', () => {
  it('does not turn a provider default budget into FAAB for a rolling league', async () => {
    prismaMock.leagueWaiverSettings.findUnique.mockResolvedValue({ waiverType: 'rolling', faabBudget: 100 })
    const { getWaiversData } = await import('@/lib/core-app/waivers')
    const data = await getWaiversData('L1', 'me')
    expect(data?.budget).toMatchObject({ available: false, reason: 'This league does not use FAAB bidding.' })
    expect(data?.waiverPriority).toMatchObject({ available: true, data: { priority: 3 } })
  })
  it('does not select playerData on the league-wide read', async () => {
    const { getWaiversData } = await import('@/lib/core-app/waivers')
    await getWaiversData('L1', 'me')

    expect(prismaMock.roster.findMany).toHaveBeenCalledTimes(1)
    const args = prismaMock.roster.findMany.mock.calls[0][0]
    expect(args.select).not.toHaveProperty('playerData')
    /* …while the columns that ARE league-wide stay, or the FAAB rank breaks. */
    expect(args.select).toMatchObject({ faabRemaining: true, waiverPriority: true })
  })

  it('fetches the one blob it needs, by the row it already resolved', async () => {
    const { getWaiversData } = await import('@/lib/core-app/waivers')
    await getWaiversData('L1', 'me')

    expect(prismaMock.roster.findUnique).toHaveBeenCalledTimes(1)
    const args = prismaMock.roster.findUnique.mock.calls[0][0]
    /*
     * ⚠ BY ID, NOT BY A SECOND CANDIDATE MATCH. Re-deciding which roster is the caller's would
     * be a second resolution that can disagree with the first — and this repo has production
     * leagues carrying duplicate roster rows for one manager.
     */
    expect(args.where).toEqual({ id: 'r-me' })
    expect(args.select).toEqual({ playerData: true })
  })

  it('still produces the roster-load tile from that blob', async () => {
    const { getWaiversData } = await import('@/lib/core-app/waivers')
    const data = await getWaiversData('L1', 'me')

    expect(data?.rosterLoad).toMatchObject({
      available: true,
      data: { playersHeld: 3, starters: 2, bench: 1, reserve: 1 },
    })
  })

  it('still ranks the caller on budget against the whole league', async () => {
    const { getWaiversData } = await import('@/lib/core-app/waivers')
    const data = await getWaiversData('L1', 'me')

    expect(data?.budget).toMatchObject({ available: true })
    const budget = data?.budget as { data: { faabRemaining: number; leagueRosters: number } }
    expect(budget.data.faabRemaining).toBe(40)
    expect(budget.data.leagueRosters).toBe(3)
  })

  /*
   * ⚠ THE CONTROL FOR THE SKIP. No resolvable roster means no blob is worth fetching — and the
   * screen must still answer honestly rather than throw.
   */
  it('fetches no blob at all when it cannot tell which roster is the caller’s', async () => {
    prismaMock.roster.findMany.mockResolvedValueOnce([
      { id: 'r-them', platformUserId: 'them', faabRemaining: 90, waiverPriority: 1 },
    ])
    const { getWaiversData } = await import('@/lib/core-app/waivers')
    const data = await getWaiversData('L1', 'me')

    expect(prismaMock.roster.findUnique).not.toHaveBeenCalled()
    expect(data?.budget).toMatchObject({ available: false })
  })
})
