import { describe, it, expect } from 'vitest'
import { primaryCoachBySchool, type CFBCoach } from '@/lib/cfb-player-data'

/*
 * `/coaches?year=` returns MORE ROWS THAN SCHOOLS — measured 161 against ~134
 * FBS programmes on year=2025 — because a school that changes coach mid-season
 * returns both men. Collapsing that to one coach per school is the only logic in
 * this feature, so it is the only thing worth testing directly.
 */
function coach(name: string, seasons: Array<[string, number, number | null]>): CFBCoach {
  return {
    id: null,
    name,
    hireDate: null,
    seasons: seasons.map(([school, year, games]) => ({ school, year, games, spOffense: null })),
  }
}

describe('primaryCoachBySchool', () => {
  it('picks the coach with the most games, not the first in the array', () => {
    /*
     * The real 2025 shape: Oregon State's interim was hired in October and
     * sorts FIRST alphabetically (Akey). A reader taking the first row gets the
     * man who coached 5 of 13 games.
     */
    const map = primaryCoachBySchool(
      [
        coach('Robb Akey', [['Oregon State', 2025, 5]]),
        coach('Trent Bray', [['Oregon State', 2025, 8]]),
      ],
      2025,
    )
    expect(map.get('Oregon State')?.name).toBe('Trent Bray')
  })

  it('names nobody when a season splits evenly', () => {
    // Picking either would report a coaching change, or its absence, that
    // nothing measured. Absent from the map means the consumer writes null.
    const map = primaryCoachBySchool(
      [
        coach('A Coach', [['Rice', 2025, 6]]),
        coach('B Coach', [['Rice', 2025, 6]]),
      ],
      2025,
    )
    expect(map.has('Rice')).toBe(false)
  })

  it('ignores seasons from other years', () => {
    const map = primaryCoachBySchool([coach('Old Guy', [['Rice', 2024, 12]])], 2025)
    expect(map.has('Rice')).toBe(false)
  })

  it('ignores rows carrying no game count', () => {
    // Without games there is no way to rank two coaches, so the row cannot
    // contribute to a "who led this school" answer.
    const map = primaryCoachBySchool([coach('Ghost', [['Rice', 2025, null]])], 2025)
    expect(map.has('Rice')).toBe(false)
  })

  it('carries the hire date through for the chosen coach', () => {
    const c = coach('Scott Abell', [['Rice', 2025, 13]])
    c.hireDate = '2024-11-26T00:00:00.000Z'
    const map = primaryCoachBySchool([c], 2025)
    expect(map.get('Rice')?.hireDate).toBe('2024-11-26T00:00:00.000Z')
  })

  it('handles a single uncontested coach', () => {
    const map = primaryCoachBySchool([coach('Solo', [['Rice', 2025, 13]])], 2025)
    expect(map.get('Rice')).toEqual({ name: 'Solo', games: 13, hireDate: null })
  })
})
