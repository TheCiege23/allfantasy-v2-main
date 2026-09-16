import { describe, expect, it } from 'vitest'
import {
  applyHomeScope,
  FAVORITES_LIMIT,
  parseFavoriteIds,
  parseHomeScope,
  scopeLabel,
  scopeOptions,
  serializeFavoriteIds,
  serializeHomeScope,
} from '@/lib/core-app/homeScope'

const LEAGUES = [
  { id: 'a', name: 'Ice Kings', sport: 'NFL', platform: 'sleeper' },
  { id: 'b', name: 'Hoops', sport: 'NBA', platform: 'espn' },
  { id: 'c', name: 'Dynasty', sport: null, platform: 'Sleeper' },
  { id: 'd', name: 'Keeper', sport: 'nfl', platform: 'yahoo' },
]

describe('parseHomeScope / serializeHomeScope', () => {
  it('round-trips every scope, and absent or junk means all', () => {
    for (const raw of ['fav', 'sport:NFL', 'platform:sleeper']) {
      expect(serializeHomeScope(parseHomeScope(raw))).toBe(raw)
    }
    for (const junk of [undefined, null, '', 'all', 'sport:', 'sport:<script>', 'league:a', 'platform:a b', 'x'.repeat(40)]) {
      expect(parseHomeScope(junk)).toEqual({ kind: 'all' })
    }
    expect(serializeHomeScope({ kind: 'all' })).toBeNull()
  })

  it('normalises case and takes the first of a repeated parameter', () => {
    expect(parseHomeScope('sport:nba')).toEqual({ kind: 'sport', sport: 'NBA' })
    expect(parseHomeScope('platform:ESPN')).toEqual({ kind: 'platform', platform: 'espn' })
    expect(parseHomeScope(['fav', 'sport:NFL'])).toEqual({ kind: 'favorites' })
  })
})

describe('applyHomeScope', () => {
  it('all is the input itself', () => {
    expect(applyHomeScope(LEAGUES, { kind: 'all' }, new Set())).toBe(LEAGUES)
  })

  it('filters by sport (a missing sport is NFL, as everywhere else on /core) and by platform, case-blind', () => {
    expect(applyHomeScope(LEAGUES, { kind: 'sport', sport: 'NFL' }, new Set()).map((l) => l.id)).toEqual(['a', 'c', 'd'])
    expect(applyHomeScope(LEAGUES, { kind: 'platform', platform: 'sleeper' }, new Set()).map((l) => l.id)).toEqual(['a', 'c'])
  })

  it('favorites keeps only starred leagues, and a scope nobody plays matches nothing rather than everything', () => {
    expect(applyHomeScope(LEAGUES, { kind: 'favorites' }, new Set(['d', 'b'])).map((l) => l.id)).toEqual(['b', 'd'])
    expect(applyHomeScope(LEAGUES, { kind: 'sport', sport: 'MLB' }, new Set())).toEqual([])
  })
})

describe('the favorites cookie', () => {
  it('keeps only well-formed ids of leagues the viewer plays — a foreign id is dropped, not trusted', () => {
    const ids = parseFavoriteIds('a.b.not-mine.c%3Cx%3E..d', ['a', 'b', 'd'])
    expect([...ids]).toEqual(['a', 'b', 'd'])
  })

  it('survives a malformed encoding and caps the set', () => {
    expect(parseFavoriteIds('%E0%A4%A', ['a']).size).toBe(0)
    const many = Array.from({ length: FAVORITES_LIMIT + 10 }, (_, n) => `L${n}`)
    expect(parseFavoriteIds(many.join('.'), many).size).toBe(FAVORITES_LIMIT)
    expect(serializeFavoriteIds(many).split('.')).toHaveLength(FAVORITES_LIMIT)
  })

  it('serializes to what it parses', () => {
    expect([...parseFavoriteIds(serializeFavoriteIds(['a', 'a', 'd']), ['a', 'd'])]).toEqual(['a', 'd'])
  })
})

describe('scopeOptions / scopeLabel', () => {
  it('offers a sport or platform group only when there is a choice to make', () => {
    const options = scopeOptions(LEAGUES, new Set(['a']))
    expect(options[0]).toEqual({ value: null, label: 'All leagues', count: 4, group: 'all' })
    expect(options[1]).toEqual({ value: 'fav', label: 'Favorites', count: 1, group: 'favorites' })
    expect(options.filter((o) => o.group === 'sport').map((o) => [o.label, o.count])).toEqual([
      ['NFL', 3],
      ['NBA', 1],
    ])
    expect(options.filter((o) => o.group === 'platform').map((o) => o.label)).toEqual(['Sleeper', 'ESPN', 'Yahoo'])
    // Every option has a distinct value — the switcher keys its chips by it.
    expect(new Set(options.map((o) => o.value)).size).toBe(options.length)

    const oneSport = scopeOptions([LEAGUES[0], LEAGUES[2]], new Set())
    expect(oneSport.some((o) => o.group === 'sport')).toBe(false)
    expect(oneSport.some((o) => o.group === 'platform')).toBe(false)
  })

  it('puts every native spelling in ONE platform bucket, labelled once', () => {
    const natives = [
      { id: 'n1', sport: 'NFL', platform: 'manual' },
      { id: 'n2', sport: 'NFL', platform: 'allfantasy' },
      { id: 'n3', sport: 'NFL', platform: 'AF' },
      { id: 's1', sport: 'NFL', platform: 'sleeper' },
    ]
    const platforms = scopeOptions(natives, new Set()).filter((o) => o.group === 'platform')
    expect(platforms.map((o) => [o.value, o.label, o.count])).toEqual([
      ['platform:allfantasy', 'AllFantasy', 3],
      ['platform:sleeper', 'Sleeper', 1],
    ])
    expect(applyHomeScope(natives, parseHomeScope('platform:allfantasy'), new Set()).map((l) => l.id)).toEqual(['n1', 'n2', 'n3'])
  })

  it('always names the scope — a selected league wins, and nothing is ever blank', () => {
    expect(scopeLabel({ kind: 'all' }, null)).toBe('All leagues')
    expect(scopeLabel({ kind: 'sport', sport: 'NFL' }, 'Ice Kings')).toBe('Ice Kings')
    expect(scopeLabel({ kind: 'favorites' }, null)).toBe('Favorite leagues')
    expect(scopeLabel({ kind: 'platform', platform: 'espn' }, null)).toBe('ESPN leagues')
  })
})
