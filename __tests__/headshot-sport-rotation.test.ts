import { describe, it, expect } from 'vitest'
import { resolveSportList } from '@/app/api/cron/sync-player-images/route'

/**
 * One cron slot has to cover seven sports on a shared wall-clock budget, so
 * whichever sport runs last gets whatever time is left — sometimes none. A
 * fixed order would starve the same sport every night forever.
 */
describe('resolveSportList', () => {
  it('defaults to NFL when no sport is given, preserving the old behaviour', () => {
    expect(resolveSportList(null)).toEqual(['NFL'])
  })

  it('accepts a single sport', () => {
    expect(resolveSportList('nba')).toEqual(['NBA'])
  })

  it('accepts a comma-separated list, normalised', () => {
    expect(resolveSportList(' nhl , mlb ')).toEqual(['NHL', 'MLB'])
  })

  it('expands "all" to every sport', () => {
    const list = resolveSportList('all', new Date('2026-01-01T00:00:00Z'))
    expect(list).toHaveLength(7)
    expect([...list].sort()).toEqual(['MLB', 'NBA', 'NCAAB', 'NCAAF', 'NFL', 'NHL', 'SOCCER'])
  })

  it('rotates the starting sport day by day', () => {
    const firsts = new Set<string>()
    for (let d = 1; d <= 7; d += 1) {
      const day = new Date(Date.UTC(2026, 0, d))
      firsts.add(resolveSportList('ALL', day)[0])
    }
    // Seven consecutive days must each start on a different sport, or the
    // rotation is not actually rotating and the last sport starves.
    expect(firsts.size).toBe(7)
  })

  it('never drops a sport while rotating', () => {
    for (let d = 1; d <= 14; d += 1) {
      const list = resolveSportList('all', new Date(Date.UTC(2026, 5, d)))
      expect([...list].sort()).toEqual(['MLB', 'NBA', 'NCAAB', 'NCAAF', 'NFL', 'NHL', 'SOCCER'])
    }
  })

  it('puts the zero-coverage pro leagues ahead of the college long tail', () => {
    // NCAAF and NCAAB are 63k of the 78k missing headshots and are the least
    // likely to be carried by this provider at all. They should not sit in
    // front of NBA/NHL/MLB on the first pass.
    const base = resolveSportList('all', new Date(Date.UTC(2026, 0, 7))) // offset 0
    expect(base.slice(0, 3)).toEqual(['NBA', 'NHL', 'MLB'])
  })
})
