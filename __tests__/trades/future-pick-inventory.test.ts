import { describe, expect, it } from 'vitest'
import {
  futurePickInventory,
  inventoryPickId,
  rookieRoundsFromDraftHistory,
  roundOrdinal,
  upcomingDraftSeasons,
} from '@/lib/league-trade-engine/futurePickInventory'

/**
 * The Trade Center listed no real picks: imported leagues keep theirs in `future_draft_picks`, and
 * that table holds only picks that were TRADED. These pin how a league's full pick list is rebuilt.
 */

const draft = (season: number, maxRound: number, picks: number) => ({ season, maxRound, picks })

describe('rookieRoundsFromDraftHistory', () => {
  it('reads the rookie size after the startup draft (WDTAZ: 25 rounds in 2020, then 3)', () => {
    const seasons = [draft(2020, 25, 300), draft(2021, 3, 36), draft(2022, 3, 36), draft(2026, 3, 36)]
    expect(rookieRoundsFromDraftHistory(seasons, 12)).toBe(3)
  })

  it('takes the LATEST complete draft when the size changed', () => {
    const seasons = [draft(2022, 34, 408), draft(2023, 4, 48), draft(2024, 2, 24), draft(2026, 1, 12)]
    expect(rookieRoundsFromDraftHistory(seasons, 12)).toBe(1)
  })

  it('skips an incomplete latest draft rather than trusting a partial count', () => {
    // 2026 recorded only 30 of 36 picks.
    const seasons = [draft(2021, 20, 240), draft(2025, 3, 36), draft(2026, 3, 30)]
    expect(rookieRoundsFromDraftHistory(seasons, 12)).toBe(3)
  })

  it('🛑 never reads the league\'s first recorded draft as a rookie draft when there are more', () => {
    // Only the startup is complete; the rest are partial. Unknown, not 25.
    const seasons = [draft(2020, 25, 300), draft(2021, 3, 20)]
    expect(rookieRoundsFromDraftHistory(seasons, 12)).toBeNull()
  })

  it('trusts a single draft only when it is complete and rookie-sized', () => {
    expect(rookieRoundsFromDraftHistory([draft(2026, 4, 48)], 12)).toBe(4)
    // A single 20-round draft is this league's startup.
    expect(rookieRoundsFromDraftHistory([draft(2026, 20, 480)], 24)).toBeNull()
    expect(rookieRoundsFromDraftHistory([draft(2026, 4, 40)], 12)).toBeNull()
  })

  it('is unknown with no history or no teams', () => {
    expect(rookieRoundsFromDraftHistory([], 12)).toBeNull()
    expect(rookieRoundsFromDraftHistory([draft(2026, 4, 48)], 0)).toBeNull()
  })
})

describe('upcomingDraftSeasons', () => {
  it('🛑 starts NEXT season once this season\'s draft is over', () => {
    // 111 of the staging leagues with stored picks are in_season: their 2026 picks were used.
    expect(upcomingDraftSeasons({ leagueSeason: 2026, status: 'in_season' })).toEqual([2027, 2028, 2029])
    expect(upcomingDraftSeasons({ leagueSeason: 2026, status: 'post_season' })).toEqual([2027, 2028, 2029])
  })

  it('includes this season while its draft has not happened', () => {
    expect(upcomingDraftSeasons({ leagueSeason: 2026, status: 'pre_draft' })).toEqual([2026, 2027, 2028])
    expect(upcomingDraftSeasons({ leagueSeason: 2026, status: 'drafting' })).toEqual([2026, 2027, 2028])
  })

  it('⚠ an unknown status is treated as a draft already held — never offer a pick that may be spent', () => {
    expect(upcomingDraftSeasons({ leagueSeason: 2026, status: null })).toEqual([2027, 2028, 2029])
  })
})

describe('futurePickInventory', () => {
  const teams = ['1', '2', '3']

  it('gives every team its own pick in every round of every upcoming draft', () => {
    const inv = futurePickInventory({ teamIds: teams, seasons: [2027, 2028], rounds: 2, stored: [] })
    expect(inv).toHaveLength(3 * 2 * 2)
    expect(inv.every((p) => p.ownerTeamId === p.originalTeamId && p.source === 'own')).toBe(true)
  })

  it('🛑 moves a traded pick to the team that holds it', () => {
    const inv = futurePickInventory({
      teamIds: teams,
      seasons: [2027],
      rounds: 2,
      stored: [{ pickSeason: 2027, round: 1, originalRosterId: '2', currentOwnerId: '3' }],
    })
    const moved = inv.find((p) => p.round === 1 && p.originalTeamId === '2')!
    expect(moved.ownerTeamId).toBe('3')
    expect(moved.source).toBe('stored')
    // Not listed twice.
    expect(inv.filter((p) => p.round === 1 && p.originalTeamId === '2')).toHaveLength(1)
    expect(inv).toHaveLength(3 * 2)
  })

  it('ignores a stored pick from a draft outside the horizon (a spent pick)', () => {
    const inv = futurePickInventory({
      teamIds: teams,
      seasons: [2027],
      rounds: 1,
      stored: [{ pickSeason: 2026, round: 1, originalRosterId: '1', currentOwnerId: '2' }],
    })
    expect(inv.some((p) => p.season === 2026)).toBe(false)
  })

  it('keeps a stored pick in a round past the known count', () => {
    const inv = futurePickInventory({
      teamIds: teams,
      seasons: [2027],
      rounds: 2,
      stored: [{ pickSeason: 2027, round: 5, originalRosterId: '1', currentOwnerId: '2' }],
    })
    expect(inv.find((p) => p.round === 5)).toMatchObject({ ownerTeamId: '2', originalTeamId: '1', source: 'stored' })
  })

  it('⚠ with the round count unknown, lists the stored picks and invents none', () => {
    const inv = futurePickInventory({
      teamIds: teams,
      seasons: [2027],
      rounds: null,
      stored: [{ pickSeason: 2027, round: 1, originalRosterId: '1', currentOwnerId: '2' }],
    })
    expect(inv).toEqual([{ season: 2027, round: 1, ownerTeamId: '2', originalTeamId: '1', source: 'stored' }])
  })

  it('orders by season, then round', () => {
    const inv = futurePickInventory({ teamIds: ['1'], seasons: [2028, 2027], rounds: 2, stored: [] })
    expect(inv.map((p) => `${p.season}:${p.round}`)).toEqual(['2027:1', '2027:2', '2028:1', '2028:2'])
  })
})

describe('labels and ids', () => {
  it('names rounds the way managers say them', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(roundOrdinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th',
    ])
  })

  it('gives a stable, namespaced id that cannot pass for a proposable pick id', () => {
    expect(inventoryPickId({ season: 2027, round: 1, originalTeamId: '4' })).toBe('fdp:2027:1:4')
  })
})
