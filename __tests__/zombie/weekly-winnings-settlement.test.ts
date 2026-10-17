import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 WEEKLY WINNINGS WERE NEVER PAID. Nothing set `ZombieInfectionEvent.winningsTransferred`, and only the
 * legacy finalizer (which a native league never runs) wrote the ledger, so every native zombie league
 * showed 0 winnings all season.
 *
 * Rules (decided 2026-10-15): every team banks its weekly score; an infected Survivor loses that whole
 * week to its infector; otherwise a mauling moves 50% of the loser's week, a bashing 25%.
 */

const h = vi.hoisted(() => ({
  results: vi.fn(),
  rosterFindMany: vi.fn(),
  infectionFindMany: vi.fn(),
  infectionUpdateMany: vi.fn(),
  teamUpdateMany: vi.fn(),
  recordWinnings: vi.fn(),
  totals: vi.fn(),
  rules: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findMany: h.rosterFindMany },
    zombieInfectionEvent: { findMany: h.infectionFindMany, updateMany: h.infectionUpdateMany },
    zombieLeagueTeam: { updateMany: h.teamUpdateMany },
  },
}))
vi.mock('@/lib/zombie/ZombieInfectionEngine', () => ({ loadNativeWeekResults: h.results }))
vi.mock('@/lib/zombie/ZombieWeeklyWinningsLedger', () => ({ recordWinnings: h.recordWinnings, getTotalWinningsByRoster: h.totals }))
vi.mock('@/lib/zombie/zombieRules', () => ({ getZombieRulesForSport: h.rules }))

import { computeWeeklyWinnings, settleWeeklyWinnings } from '@/lib/zombie/weeklyWinningsEngine'

const NBA = { bashingThreshold: 128, maulingThreshold: 211 }
const m = (id: string, home: string, away: string, homeScore: number, awayScore: number, final = true) => ({
  matchupId: id, homeRosterId: home, awayRosterId: away, homeScore, awayScore, final,
})
const netOf = (r: ReturnType<typeof computeWeeklyWinnings>) => Object.fromEntries(r.netByRoster)

describe('computeWeeklyWinnings', () => {
  it('every team banks its weekly score when nothing changes hands', () => {
    const r = computeWeeklyWinnings([m('m1', 'A', 'B', 1040, 1000)], [], NBA)
    expect(netOf(r)).toEqual({ A: 1040, B: 1000 })
    expect(r.transfers).toEqual([])
  })

  it('an infection moves the victim’s whole week to the infector', () => {
    const r = computeWeeklyWinnings([m('m1', 'Z', 'S', 1040, 910)], [{ victimRosterId: 'S', infectorRosterId: 'Z' }], NBA)
    expect(netOf(r)).toEqual({ Z: 1950, S: 0 })
    expect(r.transfers).toEqual([{ matchupId: 'm1', fromRosterId: 'S', toRosterId: 'Z', amount: 910, kind: 'infection' }])
  })

  it('an infection takes the week even when the margin is also a mauling — it does not stack', () => {
    const r = computeWeeklyWinnings([m('m1', 'Z', 'S', 1200, 900)], [{ victimRosterId: 'S', infectorRosterId: 'Z' }], NBA)
    expect(r.transfers).toHaveLength(1)
    expect(r.transfers[0]).toMatchObject({ kind: 'infection', amount: 900 })
  })

  it('a bashing (win by 128+) moves 25% of the loser’s week', () => {
    const r = computeWeeklyWinnings([m('m1', 'C', 'D', 900, 1040)], [], NBA)
    expect(r.transfers).toEqual([{ matchupId: 'm1', fromRosterId: 'C', toRosterId: 'D', amount: 225, kind: 'bashing' }])
    expect(netOf(r)).toEqual({ C: 675, D: 1265 })
  })

  it('a mauling (win by 211+) moves 50%', () => {
    const r = computeWeeklyWinnings([m('m1', 'C', 'D', 1250, 1000)], [], NBA)
    expect(r.transfers[0]).toMatchObject({ kind: 'mauling', fromRosterId: 'D', toRosterId: 'C', amount: 500 })
    expect(netOf(r)).toEqual({ C: 1750, D: 500 })
  })

  it('[control] a win just under the bashing line moves nothing', () => {
    const r = computeWeeklyWinnings([m('m1', 'C', 'D', 1127, 1000)], [], NBA)
    expect(r.transfers).toEqual([])
  })

  it('an infection recorded for someone else does not move this matchup’s week', () => {
    const r = computeWeeklyWinnings([m('m1', 'A', 'S', 1040, 1000)], [{ victimRosterId: 'S', infectorRosterId: 'Z' }], NBA)
    expect(r.transfers).toEqual([])
  })

  it('a tie banks both scores and moves nothing', () => {
    const r = computeWeeklyWinnings([m('m1', 'A', 'B', 950, 950)], [{ victimRosterId: 'B', infectorRosterId: 'A' }], NBA)
    expect(netOf(r)).toEqual({ A: 950, B: 950 })
    expect(r.transfers).toEqual([])
  })

  it('skips matchups that are not final or cannot be placed', () => {
    const r = computeWeeklyWinnings(
      [m('m1', 'A', 'B', 1000, 900, false), { ...m('m2', 'C', 'D', 1000, 900), awayRosterId: null }],
      [],
      NBA,
    )
    expect(netOf(r)).toEqual({})
  })

  it('rounds to cents', () => {
    const r = computeWeeklyWinnings([m('m1', 'C', 'D', 1000.37, 850.21)], [], NBA)
    expect(r.transfers[0].amount).toBe(212.55)
    expect(netOf(r)).toEqual({ C: 1212.92, D: 637.66 })
  })
})

describe('settleWeeklyWinnings', () => {
  const input = { zombieLeagueId: 'z1', leagueId: 'L1', season: 2026, sport: 'NBA', week: 5, infected: [] as Array<{ victimRosterId: string; infectorRosterId: string }> }

  beforeEach(() => {
    vi.clearAllMocks()
    h.rules.mockResolvedValue(NBA)
    h.results.mockResolvedValue([m('m1', 'rZ', 'rS', 1040, 910), m('m2', 'rC', 'rD', 900, 1040)])
    h.rosterFindMany.mockResolvedValue([
      { id: 'rZ', platformUserId: 'uZ' }, { id: 'rS', platformUserId: 'uS' },
      { id: 'rC', platformUserId: 'uC' }, { id: 'rD', platformUserId: 'uD' },
    ])
    h.infectionFindMany.mockResolvedValue([])
    h.totals.mockResolvedValue({ rZ: 3000, rS: 1500, rC: 2000, rD: 2500 })
  })

  it('writes the ledger, the teams’ weekly and total winnings, and the infection event', async () => {
    const r = await settleWeeklyWinnings({ ...input, infected: [{ victimRosterId: 'rS', infectorRosterId: 'rZ' }] })

    expect(r).toMatchObject({ teams: 4, totalTransferred: 1135 })
    expect(h.recordWinnings.mock.calls.map((c) => [c[1], c[3]])).toEqual([
      ['rZ', 1950], ['rS', 0], ['rC', 675], ['rD', 1265],
    ])
    expect(h.recordWinnings.mock.calls[0]).toEqual(['L1', 'rZ', 5, 1950, 'weekly_settlement', 'z1'])
    expect(h.teamUpdateMany).toHaveBeenCalledWith({ where: { leagueId: 'L1', rosterId: 'rZ' }, data: { weeklyWinnings: 1950, totalWinnings: 3000 } })
    expect(h.infectionUpdateMany).toHaveBeenCalledWith({
      where: { zombieLeagueId: 'z1', week: 5, victimUserId: 'uS', infectorUserId: 'uZ' },
      data: { winningsTransferred: 910, infectorScore: 1040, victimScore: 910, scoreDifference: 130 },
    })
  })

  /*
   * A replay (stat correction) re-resolves a week whose victims are already zombies, so infection finds
   * nothing new. The week's recorded events must still drive the transfer, or a replay would hand the
   * victim's week back.
   */
  it('a replay with no new infections still moves the week the recorded infection took', async () => {
    h.infectionFindMany.mockResolvedValue([{ victimUserId: 'uS', infectorUserId: 'uZ' }])
    const r = await settleWeeklyWinnings({ ...input, infected: [] })
    expect(r?.transfers).toContainEqual({ matchupId: 'm1', fromRosterId: 'rS', toRosterId: 'rZ', amount: 910, kind: 'infection' })
    expect(h.recordWinnings.mock.calls.find((c) => c[1] === 'rS')?.[3]).toBe(0)
  })

  it('does nothing for an imported league (no native season)', async () => {
    h.results.mockResolvedValue(null)
    await expect(settleWeeklyWinnings(input)).resolves.toBeNull()
    expect(h.recordWinnings).not.toHaveBeenCalled()
  })
})
