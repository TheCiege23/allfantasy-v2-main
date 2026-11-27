/** Soccer surfaces show the club, not Rolling Insights' numeric club id (lib/soccer/soccerClubNames.ts). */
import { describe, expect, it, vi } from 'vitest'

const findMany = vi.fn()
vi.mock('@/lib/prisma', () => ({ prisma: { sportsTeam: { findMany: (...a: unknown[]) => findMany(...a) } } }))

import { hasNumericSoccerTeam, loadSoccerClubNames, soccerClubFor } from '@/lib/soccer/soccerClubNames'

const clubs = new Map([['17', { name: 'Tottenham Hotspur', shortName: 'TOT' }]])

describe('soccerClubFor', () => {
  it('names a numeric id, and leaves a named team alone', () => {
    expect(soccerClubFor('17', clubs)).toEqual({ name: 'Tottenham Hotspur', shortName: 'TOT' })
    expect(soccerClubFor(' 17 ', clubs)?.shortName).toBe('TOT')
    expect(soccerClubFor('Arsenal', clubs)).toBeNull()
    expect(soccerClubFor('99', clubs)).toBeNull()
    expect(soccerClubFor(null, clubs)).toBeNull()
  })
})

describe('hasNumericSoccerTeam', () => {
  it('only soccer rows with a numeric team count', () => {
    expect(hasNumericSoccerTeam([{ sport: 'SOCCER', team: '17' }])).toBe(true)
    expect(hasNumericSoccerTeam([{ sport: 'SOCCER', team: 'Arsenal' }, { sport: 'NBA', team: '17' }])).toBe(false)
  })
})

describe('loadSoccerClubNames', () => {
  it('reads the Rolling Insights team rows, and does not remember an empty read', async () => {
    findMany.mockResolvedValueOnce([])
    expect((await loadSoccerClubNames(1)).size).toBe(0)
    findMany.mockResolvedValueOnce([{ externalId: '17', name: 'Tottenham Hotspur', shortName: 'TOT' }])
    expect((await loadSoccerClubNames(2)).get('17')?.name).toBe('Tottenham Hotspur')
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { sport: 'SOCCER', source: 'rolling_insights' } }))
  })
})
