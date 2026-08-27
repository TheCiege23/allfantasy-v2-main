import { describe, expect, it, vi } from 'vitest'

import { loadActualWeeklyPoints } from '@/lib/idp-projections/actualWeeklyPoints'

/**
 * Actual weekly points — the number nothing computed, so surfaces either had no answer or wrote
 * a zero. `lib/ai/sim/groundedTradeDelta.ts` still hardcodes `actualPoints: 0` in two places.
 */

const prismaWith = (rows: Array<{ playerId: string; normalizedStatMap: unknown }>) =>
  ({ playerGameStat: { findMany: vi.fn(async () => rows) } }) as never

const IDP_SCORING = { idp_tkl_solo: 1, idp_tkl_ast: 0.5, idp_sack: 4, idp_int: 6 }

describe('loadActualWeeklyPoints', () => {
  it('scores a real line with the league’s own weights', async () => {
    const res = await loadActualWeeklyPoints({
      prisma: prismaWith([{ playerId: '1', normalizedStatMap: { idp_tkl_solo: 6, idp_tkl_ast: 2, idp_sack: 1 } }]),
      season: 2025,
      week: 18,
      playerIds: ['1'],
      scoring: IDP_SCORING,
    })
    const r = res.get('1')
    // 6*1 + 2*0.5 + 1*4 = 11
    expect(r?.scored && r.points).toBe(11)
  })

  it('separates "no game on file" from a zero', async () => {
    /*
     * A bye, an inactive, or a week we have not ingested. Rendered as 0.0 it tells a manager his
     * starter blanked, which is a different and much more actionable claim than "we don't know".
     */
    const res = await loadActualWeeklyPoints({
      prisma: prismaWith([]),
      season: 2025,
      week: 18,
      playerIds: ['1'],
      scoring: IDP_SCORING,
    })
    expect(res.get('1')).toEqual({ scored: false, reason: 'no_game' })
  })

  it('reports how thin an unscored line was, because it names a different culprit', async () => {
    /*
     * A line holding only snap columns is an INGEST gap — he recorded tackles, we do not hold
     * them. A rich line this league prices at nothing is a SETTINGS answer. Measured on
     * production the first is the common case, and conflating them sends a manager to change
     * settings that were never the problem.
     */
    const res = await loadActualWeeklyPoints({
      prisma: prismaWith([{ playerId: '1', normalizedStatMap: { def_snp: 58, tm_def_snp: 70 } }]),
      season: 2025,
      week: 18,
      playerIds: ['1'],
      scoring: IDP_SCORING,
    })
    const r = res.get('1')
    expect(r?.scored).toBe(false)
    expect(r?.scored === false && r.reason).toBe('unscored')
    expect(r?.scored === false && r.lineKeys).toBe(2)
  })

  it('refuses everything when the league has no scoring settings', async () => {
    // Scoring someone against another league's weights is worse than returning nothing.
    const res = await loadActualWeeklyPoints({
      prisma: prismaWith([{ playerId: '1', normalizedStatMap: { idp_tkl_solo: 9 } }]),
      season: 2025,
      week: 18,
      playerIds: ['1'],
      scoring: null,
    })
    expect(res.get('1')?.scored).toBe(false)
  })

  it('answers for every player asked about, not only the ones with rows', async () => {
    const res = await loadActualWeeklyPoints({
      prisma: prismaWith([{ playerId: 'has', normalizedStatMap: { idp_tkl_solo: 4 } }]),
      season: 2025,
      week: 18,
      playerIds: ['has', 'missing'],
      scoring: IDP_SCORING,
    })
    expect(res.size).toBe(2)
    expect(res.get('missing')?.scored).toBe(false)
  })
})
