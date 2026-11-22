import { describe, expect, it } from 'vitest'

import { parseFantraxCategoryTotals } from '@/lib/league-import/fantrax/fantraxApi'
import { fantraxCategoryPairs } from '@/lib/import-os/collector/fantraxCategorySnapshots'
import { fleaflickerRotoCategoryRows } from '@/lib/import-os/collector/fleaflickerRotoCategories'

describe('provider category totals', () => {
  it('accepts finite Fantrax category values and rejects blank or approximate values', () => {
    expect(parseFantraxCategoryTotals([
      { category: { id: 'G' }, value: { value: 7 } },
      { category: { id: 'A' }, value: '12.5' },
      { category: { id: 'S' }, value: '' },
      { category: { id: 'bad\nkey' }, value: 2 },
    ])).toEqual({ G: 7, A: 12.5 })
  })

  it('does not attach Fantrax categories to an unplayed or ambiguous team', () => {
    const period = { period: 3, matchups: [{
      away: { teamId: 'a', teamName: 'Away', score: 0, gamesPlayed: 1, categories: { G: 7, A: 11 } },
      home: { teamId: 'h', teamName: 'Home', score: 0, gamesPlayed: 1, categories: { G: 9, A: 12 } },
    }] }
    expect(fantraxCategoryPairs(period, [
      { externalId: '1', teamName: 'Away', ownerName: null },
      { externalId: '2', teamName: 'Home', ownerName: null },
    ])).toMatchObject([{ roster1: '1', roster2: '2' }])
    expect(fantraxCategoryPairs(period, [
      { externalId: '1', teamName: 'Away', ownerName: null },
      { externalId: '2', teamName: 'Home', ownerName: null },
      { externalId: '3', teamName: 'home', ownerName: null },
    ])).toEqual([])
    expect(fantraxCategoryPairs({ ...period, matchups: period.matchups.map((m) => ({
      away: { ...m.away, gamesPlayed: 0 }, home: { ...m.home, gamesPlayed: 0 },
    })) }, [
      { externalId: '1', teamName: 'Away', ownerName: null },
      { externalId: '2', teamName: 'Home', ownerName: null },
    ])).toEqual([])
  })

  it('keeps Fleaflicker roto season values distinct from rank points', () => {
    const rows = fleaflickerRotoCategoryRows({ season: 2026, league: { id: 1, name: 'Roto' },
      divisions: [{ id: 1, name: 'All', teams: [{ id: 2, name: 'Mine', roto: {
        overallRank: 3, statValues: [
          { category: { id: 1, abbreviation: 'HR' }, value: { value: 80 }, rank: 3,
            rotoPoints: { value: 7 } },
          { category: { id: 2, abbreviation: 'ERA' }, value: { value: 3.2 }, rank: 1,
            rotoPoints: { value: 10 } },
        ],
      } }] }] })
    expect(rows[0]).toMatchObject({ teamId: '2', rank: 3, categories: [
      { label: 'HR', value: 80, rankPoints: 7 }, { label: 'ERA', value: 3.2, rankPoints: 10 },
    ] })
  })
})
