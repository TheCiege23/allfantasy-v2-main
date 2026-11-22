import { describe, expect, it } from 'vitest'
import { getGuillotineDraftRecommendation, type DraftPlayer } from '@/lib/guillotine/ai/draftAssistant'
import { computeDraftRecommendation } from '@/lib/draft-helper/RecommendationEngine'

/*
 * Guillotine draft advice goes through the one draft engine (2026-11-14). It used to return
 * availablePlayers[0..2] with canned sentences, so the pinned property is: the order the CALLER
 * sends no longer decides the pick — the engine does — and every reason is the engine's own.
 */

const POOL: DraftPlayer[] = [
  // Listed first, but a kicker at pick 3 is exactly what a ranking should not suggest.
  { playerId: 'k1', name: 'Kicker One', pos: 'K', team: 'AAA', adp: 180 },
  { playerId: 'rb1', name: 'Back One', pos: 'RB', team: 'BBB', adp: 2 },
  { playerId: 'wr1', name: 'Receiver One', pos: 'WR', team: 'CCC', adp: 4 },
  { playerId: 'rb2', name: 'Back Two', pos: 'RB', team: 'DDD', adp: 9 },
  { playerId: 'wr2', name: 'Receiver Two', pos: 'WR', team: 'EEE', adp: 11 },
  { playerId: 'qb1', name: 'Passer One', pos: 'QB', team: 'FFF', adp: 30 },
]

describe('getGuillotineDraftRecommendation', () => {
  it('ranks through the engine instead of returning the first players sent', async () => {
    const rec = await getGuillotineDraftRecommendation([], POOL, 'NFL', 3, 3, 12)
    expect(rec.survivalPick.playerId).not.toBe('k1')

    const engine = computeDraftRecommendation({
      available: POOL.map((p) => ({ name: p.name, position: p.pos, team: p.team, adp: p.adp })),
      teamRoster: [],
      round: 1,
      pick: 3,
      totalTeams: 12,
      sport: 'NFL',
      mode: 'needs',
    })
    expect(rec.survivalPick.name).toBe(engine.recommendation?.player.name)
    expect(rec.survivalPick.reasoning).toContain(engine.recommendation!.reason)
  })

  it('names three different players and never a canned reason', async () => {
    const rec = await getGuillotineDraftRecommendation([], POOL, 'NFL', 3, 3, 12)
    const ids = [rec.survivalPick.playerId, rec.depthPick.playerId, rec.ceilingPick.playerId]
    expect(new Set(ids).size).toBe(3)
    expect(ids).not.toContain('x')
    for (const r of [rec.survivalPick, rec.depthPick, rec.ceilingPick]) {
      expect(r.reasoning).not.toMatch(/^(Highest floor option for survival format\.|Adds injury insurance\.)$/)
    }
  })

  it('answers honestly for an empty pool', async () => {
    const rec = await getGuillotineDraftRecommendation([], [], 'NFL', 1, 1, 12)
    expect(rec.survivalPick).toMatchObject({ playerId: 'x', name: '—' })
    expect(rec.byeWeekAlert).toBeNull()
  })
})
