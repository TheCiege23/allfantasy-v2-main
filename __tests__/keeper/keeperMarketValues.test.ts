import { beforeEach, describe, expect, it, vi } from 'vitest'

const chart = vi.hoisted(() => vi.fn())
vi.mock('@/lib/fantasycalc-db', () => ({ getFantasyCalcValuesDbFirst: chart }))

import { loadKeeperMarketRanks } from '@/lib/keeper/keeperMarketValues'

beforeEach(() => {
  chart.mockReset()
  chart.mockResolvedValue([
    { player: { sleeperId: '4046', name: "Ja'Marr Chase", position: 'WR' }, overallRank: 2 },
    { player: { sleeperId: '9999', name: 'Bijan Robinson', position: 'RB' }, overallRank: 4 },
  ])
})

describe('keeper market ranks', () => {
  it('matches by Sleeper id first, then by normalized name and position', async () => {
    const rankOf = (await loadKeeperMarketRanks({ sport: 'NFL', leagueSize: 12 }, 12))!
    expect(rankOf({ playerId: '4046', name: 'anything', position: 'WR' })).toBe(2)
    expect(rankOf({ playerId: 'native-1', name: 'JaMarr Chase', position: 'WR' })).toBe(2)
    expect(rankOf({ playerId: 'native-2', name: 'Bijan Robinson', position: 'WR' })).toBeNull() // wrong position
    expect(rankOf({ playerId: 'native-3', name: 'Nobody', position: 'QB' })).toBeNull()
  })
  it('asks for a redraft superflex chart when the league plays superflex', async () => {
    await loadKeeperMarketRanks({ sport: 'NFL', leagueSize: 10, scoringPresetId: 'nfl_superflex_ppr' }, 10)
    expect(chart).toHaveBeenCalledWith({ isDynasty: false, numQbs: 2, numTeams: 10, ppr: 1 })
  })
  it('has nothing outside NFL, or when the chart is empty or unreadable', async () => {
    expect(await loadKeeperMarketRanks({ sport: 'NBA' }, 12)).toBeNull()
    expect(chart).not.toHaveBeenCalled()
    chart.mockResolvedValueOnce([])
    expect(await loadKeeperMarketRanks({ sport: 'NFL' }, 12)).toBeNull()
    chart.mockRejectedValueOnce(new Error('db'))
    expect(await loadKeeperMarketRanks({ sport: 'NFL' }, 12)).toBeNull()
  })
})
