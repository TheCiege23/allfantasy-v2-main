import { describe, expect, it } from 'vitest'

import { getSportConfig } from '@/lib/sportConfig'
import {
  getSportAdapter,
  SUPPORTED_REDRAFT_ADAPTER_SPORTS,
  tryGetSportAdapter,
} from '@/lib/redraft/sportAdapters'
import { NFL_SCORING_CATEGORY_KEYS } from '@/lib/redraft/sportAdapters/nfl'
import { NBA_SCORING_CATEGORY_KEYS } from '@/lib/redraft/sportAdapters/nba'
import { MLB_SCORING_CATEGORY_KEYS } from '@/lib/redraft/sportAdapters/mlb'
import { NHL_SCORING_CATEGORY_KEYS } from '@/lib/redraft/sportAdapters/nhl'
import { SOCCER_SCORING_CATEGORY_KEYS } from '@/lib/redraft/sportAdapters/soccer'
import { NCAAF_SCORING_CATEGORY_KEYS } from '@/lib/redraft/sportAdapters/ncaaf'
import { NCAAB_SCORING_CATEGORY_KEYS } from '@/lib/redraft/sportAdapters/ncaab'

const adapterKeyMap: Record<string, string[]> = {
  NFL: NFL_SCORING_CATEGORY_KEYS,
  NBA: NBA_SCORING_CATEGORY_KEYS,
  MLB: MLB_SCORING_CATEGORY_KEYS,
  NHL: NHL_SCORING_CATEGORY_KEYS,
  SOCCER: SOCCER_SCORING_CATEGORY_KEYS,
  NCAAF: NCAAF_SCORING_CATEGORY_KEYS,
  NCAAB: NCAAB_SCORING_CATEGORY_KEYS,
}

describe('Redraft sport adapter parity', () => {
  it('provides adapters for all target redraft sports', () => {
    const targetSports = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER'] as const
    expect(SUPPORTED_REDRAFT_ADAPTER_SPORTS).toEqual(expect.arrayContaining(targetSports as unknown as string[]))

    for (const sport of targetSports) {
      const adapter = getSportAdapter(sport)
      expect(adapter).toBeTruthy()
      expect(typeof adapter.parseRawStats).toBe('function')
      expect(typeof adapter.getLineupLockTime).toBe('function')
    }
  })

  it('normalizes known aliases and returns adapters', () => {
    expect(tryGetSportAdapter('ncaafb')).toBeTruthy()
    expect(tryGetSportAdapter('NCAABB')).toBeTruthy()
  })

  it('covers canonical scoring keys per sport and aligns them with sport config categories', () => {
    const targetSports = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER'] as const

    for (const sport of targetSports) {
      const config = getSportConfig(sport)
      const adapter = getSportAdapter(sport)
      const parsed = adapter.parseRawStats({})
      const configKeys = new Set(config.scoringCategories.map((c) => c.key))
      // Team-defense (DST) categories score directly off raw team-defense stats
      // (counting stats + points/yards-allowed tiers via `tierStatKey`), not
      // through the per-player `SportAdapter.parseRawStats` parser — so they are
      // intentionally absent from `parsed`. They must still exist in the config.
      const teamDefenseKeys = new Set(
        config.scoringCategories.filter((c) => c.group === 'team_def').map((c) => c.key),
      )
      const adapterKeys = adapterKeyMap[sport]

      for (const key of adapterKeys) {
        expect(configKeys.has(key)).toBe(true)
        if (teamDefenseKeys.has(key)) continue
        expect(Object.prototype.hasOwnProperty.call(parsed, key)).toBe(true)
        expect(typeof parsed[key]).toBe('number')
      }
    }
  })
})
