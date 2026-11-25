import { describe, expect, it } from 'vitest'

import { ncaabPoolRowImage, ncaabPoolRowVerdict, ncaabProductionPerGame } from '@/lib/sport-teams/ncaabPlayerPoolRules'

/**
 * Half a college basketball draft pool was former players (production, 2026-11-25: 643 of 1,431
 * `INACT`). The rule keeps a player the vendor marks inactive only when our own box scores show he
 * has played this season.
 */

const ESPN = 'https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/5241333.png'
const ri = (status: string | null, externalId = '100') => ({ source: 'rolling_insights', status, externalId })
const played = new Set(['100'])

describe('ncaabPoolRowVerdict', () => {
  it('keeps an active player whether or not he has played yet', () => {
    expect(ncaabPoolRowVerdict(ri('ACT', '999'), played)).toBe('keep')
    expect(ncaabPoolRowVerdict(ri(null, '999'), played)).toBe('keep')
  })

  it('keeps an inactive player who has played this season: injured is not gone', () => {
    expect(ncaabPoolRowVerdict(ri('INACT', '100'), played)).toBe('keep')
    expect(ncaabPoolRowVerdict(ri(' inact ', '100'), played)).toBe('keep')
  })

  it('never offers an inactive player with no game this season, but lets his photo through', () => {
    expect(ncaabPoolRowVerdict(ri('INACT', '200'), played)).toBe('photo_only')
    // The season has started and nobody on this list has played: every inactive row goes.
    expect(ncaabPoolRowVerdict(ri('INACT', '100'), new Set())).toBe('photo_only')
  })

  it('removes nobody when the box-score read failed', () => {
    expect(ncaabPoolRowVerdict(ri('INACT', '200'), null)).toBe('keep')
  })

  it('drops rows from any other source: they cannot be scored, and some are coaches', () => {
    expect(ncaabPoolRowVerdict({ source: 'thesportsdb', status: 'Coaching', externalId: '34160001' }, played)).toBe('drop')
    expect(ncaabPoolRowVerdict({ source: 'thesportsdb', status: 'Active', externalId: '34160002' }, played)).toBe('drop')
    expect(ncaabPoolRowVerdict({ source: null, status: 'ACT', externalId: '100' }, played)).toBe('drop')
  })
})

describe('ncaabPoolRowImage', () => {
  it('keeps an ESPN college basketball headshot and nothing else', () => {
    expect(ncaabPoolRowImage(ESPN)).toBe(ESPN)
    // The name-matched cutout that put a 2019 player's face on a current guard.
    expect(ncaabPoolRowImage('https://r2.thesportsdb.com/images/media/player/cutout/xg23dn1575307996.png')).toBeNull()
    // Another ESPN sport's headshot path is not this player's either.
    expect(ncaabPoolRowImage('https://a.espncdn.com/i/headshots/nba/players/full/1.png')).toBeNull()
    expect(ncaabPoolRowImage(null)).toBeNull()
    expect(ncaabPoolRowImage('')).toBeNull()
  })
})

describe('ncaabProductionPerGame', () => {
  it('adds points, rebounds, assists, steals and blocks', () => {
    expect(ncaabProductionPerGame({ points: 18, total_rebounds: 7, assists: 3, steals: 1.5, blocks: 0.5, minutes: 31, turnovers: 2 })).toBe(30)
  })

  it('is zero for a player with no line, and ignores junk', () => {
    expect(ncaabProductionPerGame(undefined)).toBe(0)
    expect(ncaabProductionPerGame({ points: Number.NaN, assists: -2 })).toBe(0)
  })
})
