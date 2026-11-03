import { describe, expect, it, vi } from 'vitest'
import { piratePlanPlayerData, searchPirateLineupPlan } from '@/lib/pirate/lineupPlans'
import { evaluatePirateLineup, type PirateLineupPlayer } from '@/lib/pirate/lineupLegality'

const config = { starterCapacities: new Map([['QB', 1], ['WR', 1]]), benchSlots: 3, irSlots: 2, taxiSlots: 2,
  maxRosterSize: 8, source: 'commissioner' as const }
const player = (id: string, position: string, slotType = 'WAIVER'): PirateLineupPlayer => ({ playerId: id,
  playerName: id, position, slotType, addableBeforeLock: slotType === 'WAIVER' || slotType === 'BENCH',
  activationBeforeLock: ['IR', 'IL', 'IL_PLUS', 'RESERVE', 'TAXI'].includes(slotType), lockedAtSnapshot: false })
const base = { sport: 'NFL', week: 8, eventAt: '2026-10-30T00:20:00Z', rosterConfig: config, roster: [] as PirateLineupPlayer[],
  waivers: [player('qb', 'QB'), player('wr', 'WR')], activeCount: 0, activeLimit: 2,
  now: () => new Date('2026-10-30T00:18:00Z') }

describe('bounded joint lineup repair plans', () => {
  it('requires one certified sequence for two pickups and distinct final starters', async () => {
    const certify = vi.fn().mockResolvedValue(true)
    const plan = await searchPirateLineupPlan({ ...base, certify })
    expect(plan?.steps).toHaveLength(2)
    expect(plan?.assignment.map((p) => p.playerId).sort()).toEqual(['qb', 'wr'])
    expect(certify).toHaveBeenCalledOnce()
    const input = { sport: 'NFL', week: 8, rosterConfig: config, roster: [], waivers: base.waivers,
      lineupAtLockCertified: true, availabilityAtLockCertified: true, waiverPoolCertified: false }
    expect(evaluatePirateLineup(input).decision).toBe('review')
    expect(evaluatePirateLineup({ ...input, certifiedPlans: [plan!] }).decision).toBe('forfeit')
  })
  it('supports three distinct pickups within the bounded plan', async () => {
    const plan = await searchPirateLineupPlan({ ...base, rosterConfig: { ...config, starterCapacities: new Map([['QB', 1], ['WR', 1], ['TE', 1]]) },
      waivers: [...base.waivers, player('te', 'TE')], activeLimit: 3, certify: async () => true })
    expect(plan?.steps).toHaveLength(3)
    expect(plan?.assignment.map((p) => p.playerId).sort()).toEqual(['qb', 'te', 'wr'])
  })
  it('keeps a pickup and a reserve promotion in the same ordered capacity proof', async () => {
    const reserve = player('reserve-qb', 'QB', 'IR')
    const plan = await searchPirateLineupPlan({ ...base, roster: [reserve], waivers: [player('wr', 'WR')], certify: async () => true })
    expect(plan?.steps.map((p) => p.kind)).toEqual(['pickup', 'activate'])
    expect(evaluatePirateLineup({ sport: 'NFL', week: 8, rosterConfig: config, roster: [reserve],
      waivers: [player('wr', 'WR')], lineupAtLockCertified: true, availabilityAtLockCertified: true,
      waiverPoolCertified: false, certifiedPlans: [plan!] }).decision).toBe('forfeit')
  })

  it.each(['IR', 'IL', 'IL_PLUS', 'RESERVE', 'TAXI'])('requires canonical certification before counting a %s activation', async (section) => {
    const roster = [player('reserve-qb', 'QB', section), player('bench-wr', 'WR', 'BENCH')]
    const input = { ...base, roster, waivers: [], activeCount: 1, activeLimit: 2 }
    expect(await searchPirateLineupPlan({ ...input, certify: async () => false })).toBeNull()
    const plan = await searchPirateLineupPlan({ ...input, certify: async () => true })
    expect(plan?.steps).toEqual([{ kind: 'activate', playerId: 'reserve-qb', fromSlot: section }])
    expect(evaluatePirateLineup({ sport: 'NFL', week: 8, rosterConfig: config, roster, waivers: [],
      lineupAtLockCertified: true, availabilityAtLockCertified: true, waiverPoolCertified: false }).decision).toBe('review')
  })

  it('cannot activate through a full roster or use locked, inactive, or off-day reserves', async () => {
    for (const change of [{ lockedAtSnapshot: true }, { injuryStatus: 'IR' }, { hasGameOnScoringDay: false }]) {
      expect(await searchPirateLineupPlan({ ...base, roster: [{ ...player('reserve', 'QB', 'IR'), ...change }, player('wr', 'WR', 'BENCH')],
        waivers: [], activeCount: 1, certify: async () => true })).toBeNull()
    }
    expect(await searchPirateLineupPlan({ ...base, roster: [player('reserve', 'QB', 'TAXI'), player('wr', 'WR', 'BENCH')],
      waivers: [], activeCount: 2, certify: async () => true })).toBeNull()
  })

  it('never reuses a shared drop or leaves a dropped player in the final lineup', async () => {
    const plan = await searchPirateLineupPlan({ ...base, roster: [player('drop-1', 'TE', 'BENCH'), player('drop-2', 'TE', 'BENCH')],
      activeCount: 2, certify: async () => true })
    expect(plan?.steps).toHaveLength(2)
    expect(new Set(plan?.steps.map((p) => p.dropPlayerId)).size).toBe(2)
    expect(plan?.assignment.map((p) => p.playerId).sort()).toEqual(['qb', 'wr'])
    expect(await searchPirateLineupPlan({ ...base, roster: [player('only-drop', 'TE', 'BENCH')], activeCount: 2,
      certify: async () => true })).toBeNull()
  })

  it('leaves a refused combined transaction or exhausted search for review', async () => {
    const certify = vi.fn().mockResolvedValue(false)
    expect(await searchPirateLineupPlan({ ...base, certify })).toBeNull()
    expect(certify.mock.calls.length).toBeLessThanOrEqual(12)
    expect(await searchPirateLineupPlan({ ...base, rosterConfig: { ...config, starterCapacities: new Map([['QB', 4]]) },
      waivers: Array.from({ length: 10 }, (_, i) => player(`qb-${i}`, 'QB')), activeLimit: 10, certify })).toBeNull()
  })

  it('constructs a complete bulk save with final slots and untouched reserves', async () => {
    const reserve = player('reserve-qb', 'QB', 'TAXI'), bench = player('bench-wr', 'WR', 'BENCH'), ir = { ...player('injured', 'RB', 'IR'), injuryStatus: 'IR' }
    const plan = await searchPirateLineupPlan({ ...base, roster: [reserve, bench, ir], waivers: [], activeCount: 1, certify: async () => true })
    const source = { players: ['reserve-qb', 'bench-wr', 'injured'], lineup_sections: { starters: [], bench: [{ id: 'bench-wr' }],
      taxi: [{ id: 'reserve-qb', years_exp: 1 }], ir: [{ id: 'injured', injuryStatus: 'IR' }] }, marker: 'keep' }
    const data = piratePlanPlayerData(source, [reserve, bench, ir], plan!, ['WR', 'QB'])!
    expect(data.marker).toBe('keep')
    expect(data.starters).toEqual(['bench-wr', 'reserve-qb'])
    expect(data.taxi).toEqual([])
    expect((data.lineup_sections as Record<string, unknown>).ir).toEqual([expect.objectContaining({ id: 'injured', injuryStatus: 'IR' })])
    expect(source.lineup_sections.taxi).toHaveLength(1)
  })
})
