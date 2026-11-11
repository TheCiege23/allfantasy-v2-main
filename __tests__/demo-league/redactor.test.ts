import { describe, expect, it } from 'vitest'
import { DemoRedactor } from '@/lib/demo-league/redactor'
import { fakeManagerName, fakeTeamName, FAKE_POOL_SIZE } from '@/lib/demo-league/fakeNames'

describe('DemoRedactor', () => {
  const terms = [
    { value: 'Marcus Feldington', replacement: 'Demo Alex B.' },
    { value: 'feldy_dynasty', replacement: 'Demo Alex B.' },
    { value: 'marcus@example-real.com', replacement: '[hidden]' },
    { value: "Feldy's Fury", replacement: 'Gridiron Ghosts' },
    { value: 'Josh', replacement: 'Demo Jordan C.' },
  ]

  it('replaces whole values and substrings, longest term first', () => {
    const r = new DemoRedactor(terms, ['Josh Allen'])
    expect(r.scrubString("Feldy's Fury")).toBe('Gridiron Ghosts')
    expect(r.scrubString("Trade from Feldy's Fury (feldy_dynasty)")).toBe('Trade from Gridiron Ghosts (Demo Alex B.)')
    expect(r.scrubString('mail marcus@example-real.com now')).toBe('mail [hidden] now')
  })

  it('never corrupts a player name that contains a real first name', () => {
    const r = new DemoRedactor(terms, ['Josh Allen'])
    expect(r.scrubString('Josh Allen')).toBe('Josh Allen')
    expect(r.scrubString('Started Josh Allen at QB')).toBe('Started Josh Allen at QB')
    // ...but a value that IS the ambiguous term is still replaced.
    expect(r.scrubString('Josh')).toBe('Demo Jordan C.')
    expect(r.stats.ambiguousTerms).toBe(1)
  })

  it('scrubs deep, including object keys', () => {
    const r = new DemoRedactor(terms)
    const out = r.scrubDeep({ a: ['Marcus Feldington'], ['feldy_dynasty']: { n: "Feldy's Fury" } })
    expect(JSON.stringify(out)).not.toMatch(/Feldington|feldy_dynasty|Feldy's/i)
  })

  it('countLeaks finds a surviving term and reports zero after scrubbing', () => {
    const r = new DemoRedactor(terms, ['Josh Allen'])
    const dirty = JSON.stringify({ owner: 'Marcus Feldington', player: 'Josh Allen' })
    expect(r.countLeaks(dirty)).toBe(1)
    const clean = JSON.stringify(r.scrubDeep(JSON.parse(dirty)))
    expect(r.countLeaks(clean)).toBe(0)
  })
})

describe('fake name pools', () => {
  it('never repeats a team or manager name across a 32-team league', () => {
    const teams = new Set(Array.from({ length: 32 }, (_, i) => fakeTeamName(i)))
    const managers = new Set(Array.from({ length: 32 }, (_, i) => fakeManagerName(i)))
    expect(teams.size).toBe(32)
    expect(managers.size).toBe(32)
  })

  it('stays unique past the pool size by suffixing', () => {
    const n = FAKE_POOL_SIZE * 2 + 3
    expect(new Set(Array.from({ length: n }, (_, i) => fakeTeamName(i))).size).toBe(n)
    expect(new Set(Array.from({ length: n }, (_, i) => fakeManagerName(i))).size).toBe(n)
  })

  it('every fake manager name is visibly marked as demo', () => {
    for (let i = 0; i < 40; i++) expect(fakeManagerName(i).startsWith('Demo ')).toBe(true)
  })
})
