import { describe, expect, it } from 'vitest'
import {
  isFollowedSide,
  mergeRankBook,
  pollIsKnown,
  rankOf,
  showCollegeGame,
  top25Rank,
  RANK_TTL_MS,
} from '@/lib/live/collegeTop25'

const NOW = new Date('2026-10-08T12:00:00Z')

describe('college Top 25 rank book', () => {
  it('reads ESPN curatedRank: 1–25 ranked, 99 unranked', () => {
    expect(top25Rank(5)).toBe(5)
    expect(top25Rank(25)).toBe(25)
    expect(top25Rank(99)).toBeNull()
    expect(top25Rank(undefined)).toBeNull()
  })

  it('ranks a team by id, abbreviation or school name, and drops one seen unranked', () => {
    const book = mergeRankBook(null, [
      { teamId: '333', abbrev: 'ALA', name: 'Alabama Crimson Tide', rank: 4 },
      { teamId: '221', abbrev: 'PITT', name: 'Pittsburgh Panthers', rank: 22 },
    ], NOW)!
    expect(rankOf(book, { abbrev: 'ALA' })).toBe(4)
    expect(rankOf(book, { teamId: '333' })).toBe(4)
    // A CFBD fixture row names only the school.
    expect(rankOf(book, { name: 'Pittsburgh' })).toBe(22)
    const next = mergeRankBook(book, [{ teamId: '221', abbrev: 'PITT', name: 'Pittsburgh Panthers', rank: null }], NOW)!
    expect(rankOf(next, { abbrev: 'PITT' })).toBeNull()
    expect(rankOf(next, { abbrev: 'ALA' })).toBe(4)
  })

  it('writes nothing for a feed that said nothing about rank, and ages ranks out', () => {
    expect(mergeRankBook(null, [{ abbrev: 'ALA', rank: undefined }], NOW)).toBeNull()
    const old = mergeRankBook(null, [{ abbrev: 'ALA', rank: 4 }], new Date(NOW.getTime() - RANK_TTL_MS - 1))!
    const later = mergeRankBook(old, [{ abbrev: 'UGA', rank: 2 }], NOW)!
    expect(rankOf(later, { abbrev: 'ALA' })).toBeNull()
    expect(rankOf(later, { abbrev: 'UGA' })).toBe(2)
  })
})

describe('which college games show', () => {
  const book = mergeRankBook(null, [{ abbrev: 'UGA', name: 'Georgia Bulldogs', rank: 2 }], NOW)
  const game = (home: string, away: string, yours = false) => ({ home: { abbrev: home, name: home }, away: { abbrev: away, name: away }, yours })

  it('shows a game with a ranked team and hides one between two unranked teams', () => {
    expect(showCollegeGame(game('UGA', 'VAN'), book, [], true)).toBe(true)
    expect(showCollegeGame(game('TEM', 'BUFF'), book, [], true)).toBe(false)
  })

  it("shows an unranked favorite team's game", () => {
    expect(showCollegeGame(game('TEM', 'BUFF'), book, [{ teamAbbr: 'TEM', teamName: 'Temple' }], true)).toBe(true)
    expect(isFollowedSide({ abbrev: 'X', name: 'Ohio State Buckeyes' }, [{ teamAbbr: 'OSU', teamName: 'Ohio State' }])).toBe(true)
  })

  it('keeps a game one of your players is in', () => {
    expect(showCollegeGame(game('TEM', 'BUFF', true), book, [], true)).toBe(true)
  })

  it('fails open when no poll is held yet', () => {
    expect(pollIsKnown(null, [])).toBe(false)
    expect(showCollegeGame(game('TEM', 'BUFF'), null, [], false)).toBe(true)
    expect(pollIsKnown(null, [{ homeRank: null, awayRank: 9 }])).toBe(true)
  })
})
