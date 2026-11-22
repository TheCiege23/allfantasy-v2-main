/**
 * Guilly's last-resort tiebreaks are reproducible: the `random` step and the "every step spent"
 * fallback both use a seeded order (GuillotineTiebreakResolver.seededOrder), so a retried chop, the
 * chop preview and an audit afterwards all name the same team.
 */
import { describe, expect, it, vi } from 'vitest'
import { resolveTiebreak, seededOrder } from '@/lib/guillotine/GuillotineTiebreakResolver'

const row = (rosterId: string, periodPoints = 80) => ({ rosterId, periodPoints, seasonPointsCumul: 500 })
const tied = ['r-a', 'r-b', 'r-c', 'r-d', 'r-e'].map((id) => row(id))

const resolve = (candidates = tied, seed = 'L1:2026', order: string[] = ['random'], week = 5) =>
  resolveTiebreak({
    candidates,
    tiebreakerOrder: order as never,
    teamsPerChop: 1,
    weekOrPeriod: week,
    draftSlotByRoster: new Map(),
    tiebreakSeed: seed,
  })

describe('Guilly last-resort tiebreak', () => {
  it('the random step chops the same team every time it is asked, whatever the input order', () => {
    const first = resolve().choppedRosterIds
    for (let i = 0; i < 20; i += 1) {
      expect(resolve([...tied].reverse()).choppedRosterIds).toEqual(first)
      expect(resolve([...tied].sort(() => 0.5 - Math.random())).choppedRosterIds).toEqual(first)
    }
    expect(resolve().stepUsed).toBe('random')
  })

  it('never consults Math.random', () => {
    const spy = vi.spyOn(Math, 'random')
    resolve()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('with every step spent, it is seeded too — never input (database) order', () => {
    const forward = resolve(tied, 'L1:2026', []).choppedRosterIds
    expect(resolve([...tied].reverse(), 'L1:2026', []).choppedRosterIds).toEqual(forward)
  })

  it('differs by league, season and week, so one roster is not always the unlucky one', () => {
    const picks = new Set<string>()
    for (const seed of ['L1:2026', 'L1:2027', 'L2:2026', 'L3:2026']) {
      for (const week of [3, 4, 5, 6]) picks.add(resolve(tied, seed, ['random'], week).choppedRosterIds[0]!)
    }
    expect(picks.size).toBeGreaterThan(1)
  })

  it('only decides genuine ties: the lowest score is still chopped outright', () => {
    const scores = [row('low', 60), ...tied]
    expect(resolve(scores).choppedRosterIds).toEqual(['low'])
  })

  it('seededOrder is a stable total order', () => {
    const a = seededOrder(tied, 'S', 1).map((r) => r.rosterId)
    expect(seededOrder([...tied].reverse(), 'S', 1).map((r) => r.rosterId)).toEqual(a)
    expect(new Set(a).size).toBe(tied.length)
  })
})
