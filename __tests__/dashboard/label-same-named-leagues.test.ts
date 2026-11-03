import { describe, expect, it } from 'vitest'
import { labelSameNamedLeagues } from '@/lib/dashboard/labelSameNamedLeagues'

const row = (id: string, name: string, viewerTeamName: string | null, over: Record<string, unknown> = {}) => ({
  id, name, platform: 'fantrax', season: 2026, viewerTeamName, ...over,
})

describe('labelSameNamedLeagues', () => {
  it('two copies of one league (two teams in it) get the team name; others keep their name', () => {
    const out = labelSameNamedLeagues([
      row('a', 'Road To Glory NCAA Football', 'Ciege Tigers'),
      row('b', 'Road To Glory NCAA Football', 'Ciege Hawks'),
      row('c', 'Dynasty One', 'Ciege Tigers'),
    ])
    expect(out.map((r) => r.name)).toEqual([
      'Road To Glory NCAA Football · Ciege Tigers',
      'Road To Glory NCAA Football · Ciege Hawks',
      'Dynasty One',
    ])
  })

  it('keeps the input order and every other field', () => {
    const out = labelSameNamedLeagues([row('a', 'X', 'T1', { extra: 1 }), row('b', 'X', 'T2')])
    expect(out.map((r) => r.id)).toEqual(['a', 'b'])
    expect(out[0]).toMatchObject({ extra: 1, viewerTeamName: 'T1' })
  })

  it('leaves same-named leagues alone when the team names cannot tell them apart', () => {
    expect(labelSameNamedLeagues([row('a', 'X', 'T'), row('b', 'X', 't')]).map((r) => r.name)).toEqual(['X', 'X'])
    expect(labelSameNamedLeagues([row('a', 'X', null), row('b', 'X', null)]).map((r) => r.name)).toEqual(['X', 'X'])
  })

  it('a different platform or season is a different league, not a duplicate', () => {
    const out = labelSameNamedLeagues([row('a', 'X', 'T1'), row('b', 'X', 'T2', { platform: 'sleeper' }), row('c', 'X', 'T3', { season: 2025 })])
    expect(out.map((r) => r.name)).toEqual(['X', 'X', 'X'])
  })
})
