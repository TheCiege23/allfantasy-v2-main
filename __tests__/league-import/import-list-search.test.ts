import { describe, expect, it } from 'vitest'

import { matchesImportSearch } from '@/lib/league-import/importListSearch'

describe('matchesImportSearch', () => {
  const row = ['Road To Glory 14', 'José Peña', 2026]

  it('an empty search shows every row', () => {
    expect(matchesImportSearch('', row)).toBe(true)
    expect(matchesImportSearch('   ', row)).toBe(true)
  })

  it('finds a row by team name or by manager name', () => {
    expect(matchesImportSearch('glory', row)).toBe(true)
    expect(matchesImportSearch('pena', row)).toBe(true)
  })

  it('ignores case and accents, and takes words in any order', () => {
    expect(matchesImportSearch('JOSE road', row)).toBe(true)
    expect(matchesImportSearch('14 glory', row)).toBe(true)
  })

  it('every word typed has to be there', () => {
    expect(matchesImportSearch('glory smith', row)).toBe(false)
    expect(matchesImportSearch('zzz', row)).toBe(false)
  })

  it('a row with missing fields is still searchable', () => {
    expect(matchesImportSearch('glory', ['Road To Glory', null, undefined])).toBe(true)
    expect(matchesImportSearch('glory', [null])).toBe(false)
  })
})
