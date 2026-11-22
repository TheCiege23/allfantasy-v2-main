/** The pick ledger's narrowing and its one sentence (lib/dynasty-core/pickLedger.ts). */
import { describe, expect, it } from 'vitest'
import { buildLeaguePickBoard, type BoardPickInput } from '@/lib/dynasty-core/leaguePickBoard'
import { pickLedgerInsight, pickLedgerSeasons, pickLedgerTotals } from '@/lib/dynasty-core/pickLedger'

const own = (season: number, round: number, id: string): BoardPickInput => ({ season, round, ownerRosterId: id, originalRosterId: id })
const moved = (season: number, round: number, from: string, to: string): BoardPickInput => ({ season, round, ownerRosterId: to, originalRosterId: from })
const teams = [{ rosterId: 'a', name: 'Aces' }, { rosterId: 'b', name: 'Bears' }, { rosterId: 'c', name: 'Cats' }]

function board(picks: BoardPickInput[], seasons: number[], coverage: 'complete' | 'traded_only' = 'complete') {
  return buildLeaguePickBoard({ teams, picks, seasons, rounds: coverage === 'complete' ? 2 : null, coverage, viewerRosterId: null })
}

describe('pickLedgerSeasons', () => {
  it('keeps the earliest three drafts, in order', () => {
    expect(pickLedgerSeasons({ seasons: [2030, 2027, 2029, 2028] })).toEqual([2027, 2028, 2029])
    expect(pickLedgerSeasons({ seasons: [2028] })).toEqual([2028])
    expect(pickLedgerSeasons({ seasons: [] })).toEqual([])
  })
})

describe('pickLedgerTotals', () => {
  it('counts only picks inside the ledger’s drafts', () => {
    const b = board([own(2027, 1, 'a'), own(2027, 2, 'a'), own(2031, 1, 'a')], [2027, 2031])
    const aces = b.teams.find((t) => t.rosterId === 'a')!
    expect(pickLedgerTotals(aces, [2027])).toEqual({ held: 2, firsts: 1 })
    expect(pickLedgerTotals(aces, [2027, 2031])).toEqual({ held: 3, firsts: 2 })
  })
})

describe('pickLedgerInsight', () => {
  const seasons = [2027, 2028]
  const base = [own(2027, 1, 'a'), own(2028, 1, 'a'), own(2027, 1, 'c'), own(2028, 1, 'c')]

  it('names the one team that has gathered more firsts than its own', () => {
    const b = board([...base, moved(2027, 1, 'b', 'a'), own(2028, 1, 'b')], seasons)
    expect(pickLedgerInsight(b, seasons)).toEqual({ team: 'Aces', firsts: 3, drafts: 2 })
  })

  it('says nothing on a tie at the top', () => {
    const b = board([...base, moved(2027, 1, 'b', 'a'), moved(2028, 1, 'b', 'c')], seasons)
    expect(pickLedgerInsight(b, seasons)).toBeNull()
  })

  it('says nothing when the leader holds only its own firsts', () => {
    // Aces lead alone, but with exactly their own two firsts: nothing gathered, nothing to say.
    const b = board([own(2027, 1, 'a'), own(2028, 1, 'a'), own(2027, 1, 'b')], seasons)
    expect(pickLedgerInsight(b, seasons)).toBeNull()
  })

  it('says nothing when only traded picks are known', () => {
    const b = board([moved(2027, 1, 'b', 'a'), moved(2028, 1, 'c', 'a'), moved(2027, 1, 'c', 'a')], seasons, 'traded_only')
    expect(pickLedgerInsight(b, seasons)).toBeNull()
  })
})
