/** Phase 6 (2026-10-27): the commissioner picks what a tanking strike costs — a pick, lottery odds, or FAAB. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activeLotteryOddsPenalties,
  applyLotteryOddsPenalties,
  describePenalty,
  faabPenaltyAmount,
  parseTankingPenaltyPolicyPatch,
  readLotteryOddsPenalties,
  readTankingPenaltyPolicy,
  tankingStepForStrike,
} from '@/lib/integrity/tankingPenalties'

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => ({
  flag: vi.fn(),
  strikes: vi.fn(),
  notify: vi.fn(async () => ({})),
  log: vi.fn(async () => ({ id: 'a' })),
  waivers: vi.fn(),
  leagueSettings: {} as Record<string, unknown>,
  leagueUpdate: vi.fn(async () => ({})),
  faabRemaining: 80 as number | null,
  rosterUpdate: vi.fn(async () => ({})),
  upsert: vi.fn(async () => ({})),
}))
vi.mock('@/lib/prisma', () => {
  const tx = {
    league: { findUnique: vi.fn(async () => ({ settings: m.leagueSettings })), update: m.leagueUpdate },
    roster: { findUnique: vi.fn(async () => ({ faabRemaining: m.faabRemaining })), update: m.rosterUpdate },
    futureDraftPick: { upsert: m.upsert },
  }
  return {
    prisma: {
      integrityFlag: { findUnique: m.flag, count: m.strikes },
      redraftSeason: { findFirst: vi.fn(async () => null) },
      roster: { findUnique: vi.fn(async () => ({ platformUserId: 'user-r1' })) },
      appUser: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })) },
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    },
  }
})
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.notify }))
vi.mock('@/server/services/auditService', () => ({ logAction: m.log }))
vi.mock('@/lib/league-trade-engine/nativeFuturePicks', () => ({ loadNativeFuturePicks: vi.fn(async () => ({ picks: [] })) }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ getEffectiveLeagueWaiverSettings: m.waivers }))

import { onTankingFlagConfirmed, onTankingFlagOpened, TANKING_FAAB_ACTION, TANKING_LOTTERY_ODDS_ACTION } from '@/lib/integrity/tankingPenaltyService'

describe('the policy', () => {
  it('defaults to a lost pick, and reads the other choices', () => {
    expect(readTankingPenaltyPolicy({})).toMatchObject({ penalty: 'forfeit_pick', lotteryOddsCutPct: 50, faabPercent: 25 })
    const p = readTankingPenaltyPolicy({ integrity_tanking_penalties: { penalty: 'lottery_odds', lotteryOddsCutPct: 100 } })
    expect(p).toMatchObject({ penalty: 'lottery_odds', lotteryOddsCutPct: 100, pickAtStrike: 2 })
    expect(tankingStepForStrike(p, 2)).toEqual({ kind: 'lottery_odds', strike: 2 })
    expect(tankingStepForStrike(p, 1)).toMatchObject({ kind: 'warning' })
  })

  it('ignores a stored value it does not offer, and refuses one in an edit', () => {
    expect(readTankingPenaltyPolicy({ integrity_tanking_penalties: { penalty: 'jail', faabPercent: 33 } })).toMatchObject({ penalty: 'forfeit_pick', faabPercent: 25 })
    expect(parseTankingPenaltyPolicyPatch({ penalty: 'jail' })).toBeNull()
    expect(parseTankingPenaltyPolicyPatch({ faabPercent: 33 })).toBeNull()
    expect(parseTankingPenaltyPolicyPatch({ penalty: 'faab', faabPercent: 50 })).toEqual({ penalty: 'faab', faabPercent: 50 })
  })

  it('reads plainly in a warning', () => {
    const base = readTankingPenaltyPolicy({})
    expect(describePenalty(base)).toBe('a draft pick')
    expect(describePenalty({ ...base, penalty: 'lottery_odds', lotteryOddsCutPct: 50 })).toBe('50% of its odds in the next rookie-draft lottery')
    expect(describePenalty({ ...base, penalty: 'lottery_odds', lotteryOddsCutPct: 100 })).toBe('its place in the next rookie-draft lottery')
    expect(describePenalty({ ...base, penalty: 'faab', faabPercent: 10 })).toBe('10% of its FAAB budget')
  })
})

describe('FAAB taken', () => {
  it('is a share of the season budget, never more than the team has left', () => {
    expect(faabPenaltyAmount(100, 80, 25)).toBe(25)
    expect(faabPenaltyAmount(100, 10, 25)).toBe(10)
    expect(faabPenaltyAmount(100, null, 25)).toBe(0)
    expect(faabPenaltyAmount(null, 80, 25)).toBe(0)
  })
})

describe('lottery penalties', () => {
  const team = (rosterId: string, weight: number) => ({ rosterId, weight })
  const pen = (rosterId: string, cutPct: number, at = '2026-11-01T00:00:00.000Z') => ({ rosterId, cutPct, at, flagId: 'f' })

  it('cut a team’s weight; two cuts compound; a full cut leaves the team out of the draw', () => {
    const pool = [team('a', 6), team('b', 4), team('c', 2)]
    expect(applyLotteryOddsPenalties(pool, [pen('a', 50)])).toEqual([team('a', 3), team('b', 4), team('c', 2)])
    expect(applyLotteryOddsPenalties(pool, [pen('a', 50), pen('a', 50)])[0]).toEqual(team('a', 1.5))
    expect(applyLotteryOddsPenalties(pool, [pen('b', 100)]).map((t) => t.rosterId)).toEqual(['a', 'c'])
  })

  it('count until a draft created after them is complete — one set up before them waits a year', () => {
    const p = [pen('a', 50, '2026-12-01T00:00:00.000Z')]
    // This year's draft was created (and its lottery drawn) before the penalty: it does not spend it.
    expect(activeLotteryOddsPenalties(p, [{ createdAt: new Date('2026-09-01') }])).toHaveLength(1)
    expect(activeLotteryOddsPenalties(p, [{ createdAt: new Date('2027-01-15') }])).toHaveLength(0)
  })

  it('reads only well-formed records', () => {
    expect(readLotteryOddsPenalties({ integrity_tanking_lottery_penalties: [pen('a', 50), { rosterId: 'b', cutPct: 0, at: 'x' }, 'junk'] })).toEqual([pen('a', 50)])
    expect(readLotteryOddsPenalties({})).toEqual([])
  })
})

describe('confirming the penalty strike', () => {
  const flagRow = (settings: Record<string, unknown>) => ({ leagueId: 'L', flagType: 'tanking', status: 'escalated', affectedRosterIds: ['r1'], league: { settings, platform: 'manual' } })
  beforeEach(() => {
    vi.clearAllMocks()
    m.leagueSettings = { other: 1 }
    m.faabRemaining = 80
    m.strikes.mockResolvedValue(2)
    m.waivers.mockResolvedValue({ normalizedWaiverType: 'faab', faabBudget: 100 })
  })

  it('lottery odds: the cut is recorded on the league, logged, and the manager told — no pick is taken', async () => {
    m.flag.mockResolvedValue(flagRow({ integrity_tanking_penalties: { penalty: 'lottery_odds', lotteryOddsCutPct: 75 } }))
    const r = await onTankingFlagConfirmed('f1', 'commish')
    expect(r[0]).toMatchObject({ step: { kind: 'lottery_odds' }, penalty: { label: '75% of its odds in the next rookie-draft lottery' } })
    const data = (m.leagueUpdate.mock.calls[0] as unknown as [{ data: { settings: Record<string, unknown> } }])[0].data.settings
    expect(data.other).toBe(1)
    expect(readLotteryOddsPenalties(data)).toEqual([expect.objectContaining({ rosterId: 'r1', cutPct: 75, flagId: 'f1' })])
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ actionType: TANKING_LOTTERY_ODDS_ACTION, entityId: 'r1' }))
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Tanking penalty applied' }))
    expect(m.upsert).not.toHaveBeenCalled()
  })

  it('FAAB: the share is taken from what the team has left', async () => {
    m.flag.mockResolvedValue(flagRow({ integrity_tanking_penalties: { penalty: 'faab', faabPercent: 25 } }))
    const r = await onTankingFlagConfirmed('f1', 'commish')
    expect(r[0]).toMatchObject({ step: { kind: 'faab' }, penalty: { label: '$25 of FAAB' } })
    expect(m.rosterUpdate).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { faabRemaining: { decrement: 25 } } })
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ actionType: TANKING_FAAB_ACTION, metadata: expect.objectContaining({ amount: 25, faabAfter: 55 }) }))
  })

  it('FAAB in a league without FAAB, or a team with none left: nothing is taken and the commissioner decides', async () => {
    m.flag.mockResolvedValue(flagRow({ integrity_tanking_penalties: { penalty: 'faab' } }))
    m.waivers.mockResolvedValue({ normalizedWaiverType: 'rolling', faabBudget: null })
    expect((await onTankingFlagConfirmed('f1', 'commish'))[0]).toMatchObject({ penalty: null })
    m.waivers.mockResolvedValue({ normalizedWaiverType: 'faab', faabBudget: 100 })
    m.faabRemaining = 0
    expect((await onTankingFlagConfirmed('f1', 'commish'))[0]).toMatchObject({ penalty: null })
    expect(m.rosterUpdate).not.toHaveBeenCalled()
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Tanking strike confirmed' }))
  })

  it('the warning on a new flag names the league’s penalty', async () => {
    m.flag.mockResolvedValue({ ...flagRow({ integrity_tanking_penalties: { penalty: 'faab', faabPercent: 50 } }), status: 'open' })
    m.strikes.mockResolvedValue(1)
    await onTankingFlagOpened('f1')
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining('your team loses 50% of its FAAB budget') }))
  })
})
