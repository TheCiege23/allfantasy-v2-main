import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const findMirror = vi.fn()
const findSnaps = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    fantasyProjection: { findMany: (...a: unknown[]) => findMirror(...a) },
    aFProjectionSnapshot: { findMany: (...a: unknown[]) => findSnaps(...a) },
  },
}))

import { afEngineForLeague } from '@/lib/core-app/afEngineCarry'
import { lookupAfEngineProjections } from '@/lib/core-app/playerProjections'

/*
 * Measured 2026-10-02 on KBFL (solo 2, assist 1, pass defended 4, TFL 2): eight IDP starters
 * read 45.2 AF against 86.2 from the provider, because the engine scores every defender under
 * its canonical `balanced` preset and the carry returned that unscaled. Rescored from the
 * snapshot's stored component amounts under KBFL's rules they land within 0.8 of the provider.
 */
const KBFL_RULES = { idp_tkl_solo: 2, idp_tkl_ast: 1, idp_sack: 4, idp_tkl_loss: 2, idp_pass_def: 4, rec: 1, pass_td: 6 }
// 3*2 + 2*1 + 0.5*4 + 0.5*2 + 0.3*4 = 12.2 under KBFL
const AMOUNTS = { soloTackle: 3, assistTackle: 2, sack: 0.5, tackleForLoss: 0.5, passDefended: 0.3 }
const factors = (balancedPoints: number) => ({
  basis: 'sleeper_weekly_idp_projection',
  idpPreset: 'balanced',
  idp: { points: balancedPoints, componentAmounts: AMOUNTS },
})

describe('afEngineForLeague — a defender is rescored under the league’s own IDP rules', () => {
  it('rescores the stored components instead of returning the balanced-preset number', () => {
    const row = { projectedPoints: 5, basis: 'sleeper_weekly_idp_projection', position: 'LB', idpFactors: factors(5) }
    expect(afEngineForLeague(row, 0.84, 15.1, KBFL_RULES)).toBe(12.2)
  })

  it("keeps the engine's own adjustments: engine/stored ratio carries onto the rescore", () => {
    // Engine applied +20% (matchup etc.) on top of its 5.0 baseline.
    const row = { projectedPoints: 6, basis: 'weekly_idp_components', position: 'DL', idpFactors: factors(5) }
    expect(afEngineForLeague(row, null, null, KBFL_RULES)).toBe(14.64)
  })

  it('falls back to the engine number, unscaled, without factors or without league rules', () => {
    expect(afEngineForLeague({ projectedPoints: 5, position: 'LB' }, 0.84, 15.1, KBFL_RULES)).toBe(5)
    expect(afEngineForLeague({ projectedPoints: 5, position: 'LB', idpFactors: factors(5) }, 0.84, 15.1, null)).toBe(5)
    expect(afEngineForLeague({ projectedPoints: 5, position: 'LB', idpFactors: factors(5) }, 0.84, 15.1)).toBe(5)
    // A league that scores no IDP at all has nothing to rescore against.
    expect(afEngineForLeague({ projectedPoints: 5, position: 'LB', idpFactors: factors(5) }, 0.84, 15.1, { rec: 1 })).toBe(5)
  })

  it('never feeds league rules into an offensive carry', () => {
    const row = { projectedPoints: 20, basis: 'sleeper_weekly_projection', position: 'QB', idpFactors: factors(5) }
    expect(afEngineForLeague(row, 18, 22.5, KBFL_RULES)).toBe(25)
  })
})

describe('lookupAfEngineProjections — carries the stored IDP block for defenders only', () => {
  beforeEach(() => {
    findMirror.mockReset()
    findSnaps.mockReset()
  })

  it('attaches the newest snapshot factors to a defender, and skips offence entirely', async () => {
    findMirror.mockResolvedValue([
      { playerId: '12578', projectedPoints: 8.2, stats: { basis: 'sleeper_weekly_idp_projection', position: 'LB', canonicalPlayerId: 'af-lb' } },
      { playerId: '11576', projectedPoints: 20.2, stats: { basis: 'sleeper_weekly_projection', position: 'RB', canonicalPlayerId: 'af-rb' } },
    ])
    findSnaps.mockResolvedValue([
      { playerId: 'af-lb', adjustmentFactors: factors(8.2) }, // newest first (orderBy computedAt desc)
      { playerId: 'af-lb', adjustmentFactors: factors(1) },
    ])
    const out = await lookupAfEngineProjections(['12578', '11576'], { season: '2026', week: 4 })
    expect(findSnaps).toHaveBeenCalledTimes(1)
    expect(findSnaps.mock.calls[0][0].where).toMatchObject({ playerId: { in: ['af-lb'] }, season: 2026, week: 4 })
    expect(out.get('12578')?.idpFactors?.idp).toMatchObject({ points: 8.2 })
    expect(out.get('11576')?.idpFactors).toBeUndefined()
  })

  it('makes no snapshot read for a lineup with no defenders, and survives a failed one', async () => {
    findMirror.mockResolvedValue([
      { playerId: '11576', projectedPoints: 20.2, stats: { basis: 'sleeper_weekly_projection', position: 'RB', canonicalPlayerId: 'af-rb' } },
    ])
    await lookupAfEngineProjections(['11576'], { season: '2026', week: 4 })
    expect(findSnaps).not.toHaveBeenCalled()

    findMirror.mockResolvedValue([
      { playerId: '12578', projectedPoints: 8.2, stats: { basis: 'sleeper_weekly_idp_projection', position: 'LB', canonicalPlayerId: 'af-lb' } },
    ])
    findSnaps.mockRejectedValue(new Error('db down'))
    const out = await lookupAfEngineProjections(['12578'], { season: '2026', week: 4 })
    expect(out.get('12578')?.projectedPoints).toBe(8.2)
    expect(out.get('12578')?.idpFactors).toBeUndefined()
  })
})
