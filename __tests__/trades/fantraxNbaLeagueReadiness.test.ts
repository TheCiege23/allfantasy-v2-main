import { describe, expect, it } from 'vitest'

const { statComplete, fantraxNameKey } = require('../../scripts/audits/fantrax-nba-league-readiness.cjs')

describe('Fantrax NBA league readiness audit', () => {
  it('accepts measured NBA stat aliases, including zero and negative turnovers', () => {
    expect(statComplete({ points: 0, total_rebounds: 10, assists: 4, steals: 0,
      blocks: 2, turnovers: -1 }, ['pts', 'reb', 'ast', 'stl', 'blk', 'to'])).toBe(true)
    expect(statComplete({ points: 15, total_rebounds: 10, assists: 4, steals: 0,
      turnovers: 2 }, ['pts', 'reb', 'ast', 'stl', 'blk', 'to'])).toBe(false)
  })

  it('compares Fantrax last-first names in the registry order', () => {
    expect(fantraxNameKey('James, LeBron')).toBe('lebronjames')
    expect(fantraxNameKey('LeBron James')).toBe('lebronjames')
  })
})
