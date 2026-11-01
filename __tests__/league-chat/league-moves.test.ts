import { describe, expect, it } from 'vitest'
import {
  LEAGUE_MOVES_WINDOW_DAYS,
  describeMove,
  mergeMovesIntoMessages,
  movesForChannel,
  readLeagueMoves,
  type LeagueMove,
} from '@/lib/league-chat/leagueMoves'

/*
 * League transactions as cards in league chat (2026-10-31): what survives the wire, and where a card
 * lands among messages.
 */
const NOW = new Date('2026-10-31T20:00:00Z')
const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3600_000).toISOString()
const player = (id: string, name: string) => ({ id, name, position: 'RB', team: 'TB', imageUrl: null, to: null })
const move = (id: string, hoursAgo: number, extra: Partial<LeagueMove> = {}): LeagueMove => ({
  id, kind: 'waiver', occurredAt: at(hoursAgo), teamName: 'Fitty SF', managerName: 'TheCiege24', avatarUrl: null,
  involvedTeams: ['Fitty SF'], adds: [player('p1', 'Bucky Irving')], drops: [], bid: null, picks: [], ...extra,
})
const msg = (id: string, hoursAgo: number, pending = false) => ({ id, createdAt: at(hoursAgo), ...(pending ? { pending: true } : {}) })
const asMsg = (mv: LeagueMove) => ({ id: `move:${mv.id}`, createdAt: mv.occurredAt })

describe('readLeagueMoves', () => {
  it('keeps well-formed moves and drops anything it cannot draw honestly', () => {
    const good = move('a', 1)
    const out = readLeagueMoves([
      good,
      { ...good, id: 'b', kind: 'mystery' },
      { ...good, id: 'c', occurredAt: 'not a date' },
      { ...good, id: 'd', adds: [], drops: [] },
      { ...good, id: 'e', adds: [{ id: 'x' }] },
      { ...good, id: 'f', bid: -3 },
      null,
      'junk',
    ])
    expect(out.map((m) => m.id)).toEqual(['a', 'f'])
    // A negative bid is not a bid: unknown, never a number.
    expect(out[1].bid).toBeNull()
    expect(readLeagueMoves({ moves: [] })).toEqual([])
  })
})

describe('describeMove', () => {
  it('names the bid only when there is one — unknown is not "$0"', () => {
    expect(describeMove(move('a', 1, { bid: 14 }))).toBe('Fitty SF made a waiver claim. Added Bucky Irving for $14.')
    expect(describeMove(move('a', 1))).toBe('Fitty SF made a waiver claim. Added Bucky Irving.')
  })

  it('leads a trade with both teams', () => {
    const trade = move('t', 1, { kind: 'trade', involvedTeams: ['Fitty SF', 'Versuz'], picks: ['2027 2nd'] })
    expect(describeMove(trade)).toBe('Fitty SF and Versuz made a trade. Added Bucky Irving. Picks: 2027 2nd.')
  })
})

describe('movesForChannel', () => {
  it('puts every move in the main view and #general, trades in #trades, the rest in #waivers, none in #trash-talk', () => {
    const all = [move('w', 1), move('f', 1, { kind: 'roster_move' }), move('t', 1, { kind: 'trade' })]
    const shown = (channel: string | null) => all.filter(movesForChannel(channel)).map((m) => m.id)
    expect(shown(null)).toEqual(['w', 'f', 't'])
    expect(shown('general')).toEqual(['w', 'f', 't'])
    expect(shown('trades')).toEqual(['t'])
    expect(shown('waivers')).toEqual(['w', 'f'])
    expect(shown('trash-talk')).toEqual([])
  })
})

describe('mergeMovesIntoMessages', () => {
  it('slots each card in by time, and keeps unsent messages last', () => {
    const out = mergeMovesIntoMessages(
      [msg('m1', 10), msg('m2', 2), msg('pending', 0, true)],
      [move('late', 1), move('mid', 5)],
      asMsg,
      NOW,
    )
    expect(out.map((m) => m.id)).toEqual(['m1', 'move:mid', 'm2', 'move:late', 'pending'])
  })

  it('leaves out moves older than the oldest loaded message, so a busy chat is not buried in cards', () => {
    const out = mergeMovesIntoMessages([msg('m1', 10)], [move('before', 20), move('after', 3)], asMsg, NOW)
    expect(out.map((m) => m.id)).toEqual(['m1', 'move:after'])
  })

  it(`shows ${LEAGUE_MOVES_WINDOW_DAYS} days of moves in an empty chat, and nothing older or in the future`, () => {
    const days = (d: number) => d * 24
    const out = mergeMovesIntoMessages(
      [],
      [move('recent', days(2)), move('edge', days(LEAGUE_MOVES_WINDOW_DAYS) - 1), move('stale', days(LEAGUE_MOVES_WINDOW_DAYS) + 1), move('future', -2)],
      asMsg,
      NOW,
    )
    expect(out.map((m) => m.id)).toEqual(['move:edge', 'move:recent'])
  })

  it('returns the messages untouched when there are no moves to add', () => {
    const messages = [msg('m1', 1)]
    expect(mergeMovesIntoMessages(messages, [], asMsg, NOW)).toBe(messages)
  })
})
