import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Chimmy's quick value answer prices a league on the SAME chart as the player card (2026-11-17):
 * `loadLeagueValueFormat` → `valueBookFor`, not the old `/dynasty|keeper/i` read off the rules.
 */

const h = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  loadRules: vi.fn(),
  values: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: h.leagueFindUnique } } }))
vi.mock('@/lib/decision-os/league-os', () => ({ createLeagueOsLoaders: () => ({ loadRules: h.loadRules }) }))
vi.mock('@/lib/fantasycalc-db', () => ({ getFantasyCalcValuesDbFirst: h.values }))
vi.mock('@/lib/fantasycalc', () => ({
  findPlayerByName: (players: Array<{ player: { name: string } }>, name: string) =>
    players.find((r) => r.player.name.toLowerCase() === name.toLowerCase()) ?? null,
  getValueTier: () => 'high',
}))

import { buildFantasyCalcValueAnswer } from '@/lib/ai/deterministic'

const MAHOMES = [{ player: { name: 'Patrick Mahomes', position: 'QB', maybeTeam: 'KC' }, value: 6200, overallRank: 18, positionRank: 3, trend30Day: 0 }]

beforeEach(() => {
  vi.clearAllMocks()
  h.values.mockResolvedValue(MAHOMES)
  h.loadRules.mockResolvedValue({ general: { format: 'keeper', teamCount: 12 }, roster: { starters: ['QB', 'OP'] }, scoring: { activeRules: [] } })
})

describe('buildFantasyCalcValueAnswer — the league chart', () => {
  it('🛑 a keeper league that keeps 2 of 16 is priced on the REDRAFT chart, superflex for an ESPN OP slot', async () => {
    h.leagueFindUnique.mockResolvedValue({
      leagueType: 'keeper',
      settings: { max_keepers: 2, roster_positions: ['QB:1', 'OP:1', 'RB:2', 'WR:3', 'TE:1', 'FLEX:1', 'BN:7'] },
    })
    const answer = await buildFantasyCalcValueAnswer('What is Patrick Mahomes worth?', 'lg1')
    expect(answer).toContain('Patrick Mahomes')
    expect(h.leagueFindUnique).toHaveBeenCalledWith({ where: { id: 'lg1' }, select: { settings: true, leagueType: true } })
    expect(h.values).toHaveBeenCalledWith(expect.objectContaining({ isDynasty: false, numQbs: 2 }))
  })

  it('a dynasty superflex league is priced on the dynasty superflex chart', async () => {
    h.leagueFindUnique.mockResolvedValue({ leagueType: 'dynasty', settings: { roster_positions: ['QB', 'RB', 'WR', 'SUPER_FLEX'] } })
    await buildFantasyCalcValueAnswer('What is Patrick Mahomes worth?', 'lg1')
    expect(h.values).toHaveBeenCalledWith(expect.objectContaining({ isDynasty: true, numQbs: 2 }))
  })

  it('no league named reads no league row', async () => {
    await buildFantasyCalcValueAnswer('What is Patrick Mahomes worth?', null)
    expect(h.leagueFindUnique).not.toHaveBeenCalled()
  })
})
