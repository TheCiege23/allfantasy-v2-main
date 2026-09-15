// @vitest-environment node
/**
 * Weekly awards as shareable moments (2026-09-14): who holds which award, and how each renders —
 * shared by the home and the card route so they cannot disagree.
 */
import { describe, expect, it } from 'vitest'

import { AWARD_KINDS, awardView, awardsWonBy, isAwardKind } from '@/lib/share/weeklyAwardCard'

const managers = [
  { ownerId: 'me', name: 'TheCiege', teamName: 'Ice Kings FC', avatar: 'av1' },
  { ownerId: 'rival', name: 'Gooby', teamName: null, avatar: null },
] as never

const awards = {
  season: '2026',
  week: 2,
  topScore: { ownerId: 'me', points: 162.44, season: '2026', week: 2 },
  lowScore: { ownerId: 'rival', points: 71.2, season: '2026', week: 2 },
  narrowEscape: { winnerOwnerId: 'me', loserOwnerId: 'rival', margin: 0.84, season: '2026', week: 2 },
  biggestBlowout: { winnerOwnerId: 'rival', loserOwnerId: 'me', margin: 61.5, season: '2026', week: 2 },
}

describe('awardsWonBy', () => {
  it('🛑 score awards go to their owner; game awards to the WINNER, never the loser', () => {
    expect(awardsWonBy(awards, 'me')).toEqual(['topScore', 'narrowEscape'])
    expect(awardsWonBy(awards, 'rival')).toEqual(['lowScore', 'biggestBlowout'])
  })

  it('nothing for no awards, no owner, or a manager with none', () => {
    expect(awardsWonBy(null, 'me')).toEqual([])
    expect(awardsWonBy(awards, null)).toEqual([])
    // An unknown owner must not "win" an empty award slot (undefined === undefined).
    expect(awardsWonBy({ ...awards, lowScore: null, biggestBlowout: null }, undefined)).toEqual([])
    expect(awardsWonBy(awards, 'someone')).toEqual([])
    expect(awardsWonBy({ ...awards, topScore: null, narrowEscape: null }, 'me')).toEqual([])
  })
})

describe('awardView', () => {
  it('a score award: the manager, the points, no opponent', () => {
    expect(awardView({ managers, latestWeekAwards: awards }, 'topScore')).toEqual({
      kind: 'topScore',
      label: 'Top score',
      season: '2026',
      week: 2,
      ownerId: 'me',
      name: 'TheCiege',
      teamName: 'Ice Kings FC',
      avatar: 'av1',
      value: 162.44,
      unit: 'pts',
      opponentName: null,
    })
  })

  it('a game award: the winner, the margin, and who they beat', () => {
    expect(awardView({ managers, latestWeekAwards: awards }, 'narrowEscape')).toMatchObject({
      label: 'Narrow escape',
      ownerId: 'me',
      name: 'TheCiege',
      value: 0.84,
      unit: 'margin',
      opponentName: 'Gooby',
    })
    expect(awardView({ managers, latestWeekAwards: awards }, 'biggestBlowout')).toMatchObject({ ownerId: 'rival', name: 'Gooby', opponentName: 'TheCiege' })
  })

  it('🛑 no award that week, or a manager missing from the payload, is null — never an unnamed card', () => {
    expect(awardView({ managers, latestWeekAwards: null }, 'topScore')).toBeNull()
    expect(awardView({ managers, latestWeekAwards: { ...awards, lowScore: null } }, 'lowScore')).toBeNull()
    expect(awardView({ managers: [], latestWeekAwards: awards }, 'topScore')).toBeNull()
    expect(awardView({ managers: [], latestWeekAwards: awards }, 'narrowEscape')).toBeNull()
    // An unknown loser still names the winner, without an opponent.
    expect(awardView({ managers: [managers[0]] as never, latestWeekAwards: awards }, 'narrowEscape')).toMatchObject({ name: 'TheCiege', opponentName: null })
  })

  it('isAwardKind accepts exactly the four kinds', () => {
    for (const k of AWARD_KINDS) expect(isAwardKind(k)).toBe(true)
    expect(isAwardKind('mvp')).toBe(false)
    expect(isAwardKind(undefined)).toBe(false)
  })
})
