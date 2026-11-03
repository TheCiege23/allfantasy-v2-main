import { describe, expect, it } from 'vitest'
import { isDynastyLeague } from '@/lib/league/isDynastyLeague'
import { usesDynastyBackground } from '@/lib/league-media/dynastyBackground'

/**
 * Truth table across the three fields the four old checks read: isDynasty / leagueType / leagueVariant.
 * Every combination of the values below is checked, so a new case can not slip between rows.
 */
const IS_DYNASTY = [true, false, null, undefined] as const
const LEAGUE_TYPES = ['dynasty', 'DYNASTY', 'devy', 'c2c', 'redraft', 'keeper', 'guillotine', 'survivor', null] as const
const VARIANTS = ['dynasty', 'devy', 'c2c', 'devy_dynasty', 'merged_devy_c2c', 'DYNASTY_IDP', 'idp', 'survivor', 'guillotine', 'big_brother', null] as const

const DYNASTY_TYPES = new Set(['dynasty', 'devy', 'c2c'])
const DYNASTY_VARIANTS = new Set(['dynasty', 'devy', 'c2c', 'devy_dynasty', 'merged_devy_c2c', 'dynasty_idp'])
const SPECIALTY = new Set(['guillotine', 'survivor'])

function expected(isDynasty: boolean | null | undefined, leagueType: string | null, leagueVariant: string | null) {
  return Boolean(isDynasty) || DYNASTY_TYPES.has(String(leagueType ?? '').toLowerCase()) || DYNASTY_VARIANTS.has(String(leagueVariant ?? '').toLowerCase())
}

const rows = IS_DYNASTY.flatMap(isDynasty => LEAGUE_TYPES.flatMap(leagueType => VARIANTS.map(leagueVariant => ({ isDynasty, leagueType, leagueVariant }))))

describe('isDynastyLeague truth table', () => {
  it('covers every combination', () => {
    expect(rows).toHaveLength(IS_DYNASTY.length * LEAGUE_TYPES.length * VARIANTS.length)
  })

  it.each(rows)('%j', row => {
    expect(isDynastyLeague(row)).toBe(expected(row.isDynasty, row.leagueType, row.leagueVariant))
  })

  it('the dynasty background is the predicate minus the specialty formats', () => {
    for (const row of rows) {
      const specialty = SPECIALTY.has(String(row.leagueType ?? '').toLowerCase()) || SPECIALTY.has(String(row.leagueVariant ?? '').toLowerCase())
      expect(usesDynastyBackground(row), JSON.stringify(row)).toBe(!specialty && isDynastyLeague(row))
    }
  })

  it('reads UserLeague.format, which is leagueVariant ?? (isDynasty ? "dynasty" : "redraft")', () => {
    expect(isDynastyLeague({ format: 'dynasty' })).toBe(true)
    expect(isDynastyLeague({ format: 'Dynasty' })).toBe(true)
    expect(isDynastyLeague({ format: 'redraft' })).toBe(false)
    expect(isDynastyLeague({ format: 'keeper' })).toBe(false)
  })

  it('a specialty league that keeps its rosters is still dynasty; only the artwork stays off', () => {
    const survivorDynasty = { isDynasty: true, leagueVariant: 'survivor' }
    expect(isDynastyLeague(survivorDynasty)).toBe(true)
    expect(usesDynastyBackground(survivorDynasty)).toBe(false)
    expect(usesDynastyBackground({ isDynasty: true, guillotineMode: true })).toBe(false)
  })

  it('a missing league or an empty one is not dynasty', () => {
    expect(isDynastyLeague(null)).toBe(false)
    expect(isDynastyLeague(undefined)).toBe(false)
    expect(isDynastyLeague({})).toBe(false)
    expect(isDynastyLeague({ leagueType: '', leagueVariant: '', format: '' })).toBe(false)
  })
})
