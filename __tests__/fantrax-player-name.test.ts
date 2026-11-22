import { describe, expect, it } from 'vitest'
import { fantraxDisplayName, withFantraxDisplayNames } from '@/lib/league-import/fantrax/fantraxPlayerName'

describe('Fantrax player names', () => {
  it(`reads Fantrax's "Last, First" as "First Last"`, () => {
    // As captured in tests/fixtures/fantrax/nba-player-ids-public.json.
    expect(fantraxDisplayName('Walter, JaKobe')).toBe('JaKobe Walter')
  })

  it('keeps a suffix with the surname', () => {
    expect(fantraxDisplayName('Smith Jr., Odell')).toBe('Odell Smith Jr.')
  })

  it('leaves a name with no comma, or with more than one, as it is', () => {
    expect(fantraxDisplayName('Buffalo Bills')).toBe('Buffalo Bills')
    expect(fantraxDisplayName('A, B, C')).toBe('A, B, C')
  })

  it('is the same run twice as once', () => {
    expect(fantraxDisplayName(fantraxDisplayName('Walter, JaKobe'))).toBe('JaKobe Walter')
  })

  it('changes only the names in a directory', () => {
    const ref = { fantraxId: '06mkb', name: 'Walter, JaKobe', team: 'TOR', position: 'SG', rotowireId: 6261 }
    expect(withFantraxDisplayNames({ '06mkb': ref })).toEqual({ '06mkb': { ...ref, name: 'JaKobe Walter' } })
    expect(ref.name).toBe('Walter, JaKobe')
  })
})
