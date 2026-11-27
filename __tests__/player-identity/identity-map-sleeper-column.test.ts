// @vitest-environment node
/**
 * `PlayerIdentityMap` keeps Sleeper ids in a column PER SPORT — `sleeperId` NFL, `sleeperNbaId` NBA —
 * and the numbers collide (NFL 1466 Travis Kelce / NBA 1466 JaVale McGee). The helper picks the
 * column by sport and refuses a sport with none, so no caller can read the NFL column by accident.
 */
import { describe, expect, it } from 'vitest'

import {
  identityMapSleeperIdOf,
  identityMapSleeperWhere,
  identitySleeperColumn,
} from '@/lib/player-identity/identityMapSleeperColumn'

describe('identitySleeperColumn', () => {
  it('NFL is sleeperId, NBA is sleeperNbaId, in any case', () => {
    expect(identitySleeperColumn('NFL')).toBe('sleeperId')
    expect(identitySleeperColumn('nfl')).toBe('sleeperId')
    expect(identitySleeperColumn(' NBA ')).toBe('sleeperNbaId')
  })
  it('🛑 any other sport, or none, has no Sleeper column', () => {
    for (const s of ['MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER', '', null, undefined]) expect(identitySleeperColumn(s)).toBeNull()
  })
})

describe('identityMapSleeperWhere', () => {
  it('names the sport and that sport’s column', () => {
    expect(identityMapSleeperWhere(['1466', '4866', '1466', ' '], 'NBA')).toEqual({ sport: 'NBA', sleeperNbaId: { in: ['1466', '4866'] } })
    expect(identityMapSleeperWhere(['4984'], 'nfl')).toEqual({ sport: 'NFL', sleeperId: { in: ['4984'] } })
  })
  it('🛑 null — read nothing — for an unknown sport or no ids', () => {
    expect(identityMapSleeperWhere(['1466'], null)).toBeNull()
    expect(identityMapSleeperWhere(['1466'], 'MLB')).toBeNull()
    expect(identityMapSleeperWhere([], 'NFL')).toBeNull()
  })
  it('reads the id back from the column it asked', () => {
    const nba = { sleeperId: null, sleeperNbaId: '1466' }
    expect(identityMapSleeperIdOf(nba, 'NBA')).toBe('1466')
    expect(identityMapSleeperIdOf(nba, 'NFL')).toBeNull()
    expect(identityMapSleeperIdOf({ sleeperId: '1466', sleeperNbaId: null }, 'MLB')).toBeNull()
  })
})
