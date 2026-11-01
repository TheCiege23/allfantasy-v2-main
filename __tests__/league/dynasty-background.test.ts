import { describe, expect, it } from 'vitest'
import { usesDynastyBackground } from '@/lib/league-media/dynastyBackground'

describe('dynasty background selection', () => {
  it.each([
    [{ leagueType: 'dynasty' }, true],
    [{ isDynasty: true, format: 'NFL' }, true],
    [{ leagueVariant: 'merged_devy_c2c' }, true],
    [{ leagueType: 'redraft' }, false],
    [{ isDynasty: true, guillotineMode: true }, false],
    [{ isDynasty: true, leagueVariant: 'survivor' }, false],
  ])('uses the dynasty art for %j: %s', (league, expected) => {
    expect(usesDynastyBackground(league)).toBe(expected)
  })
})
