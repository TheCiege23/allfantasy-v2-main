import { describe, expect, it } from 'vitest'

import {
  auctionAdviceLines,
  auctionRoomLines,
  classifyByAdp,
  formatDuration,
  pickClockLines,
  pickOutlookLines,
  viewerNextOverall,
  viewerPicksLine,
  viewerQueueLine,
} from '@/lib/chimmy/draftViewerFacts'

/*
 * The viewer's side of a live draft (owner's spec, 2026-11-16): picks so far, queue, time left on the
 * clock with a short pick-first answer when time is low, the auction room, and (AF Pro) who is likely
 * gone before their next pick. Pure — no database.
 */

const NOW = new Date('2026-11-16T20:00:00Z')
const inSeconds = (s: number) => new Date(NOW.getTime() + s * 1000)

describe('formatDuration', () => {
  it('reads like a person would say it', () => {
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(134)).toBe('2m 14s')
    expect(formatDuration(120)).toBe('2m')
    expect(formatDuration(3900)).toBe('1h 5m')
    expect(formatDuration(8 * 3600)).toBe('8h')
    expect(formatDuration(2 * 86_400 + 3 * 3600)).toBe('2d 3h')
    expect(formatDuration(-5)).toBe('0s')
  })
})

describe('the pick clock', () => {
  const base = { status: 'in_progress', timerSeconds: 90, pausedRemainingSeconds: null, overnightFrozenPickSeconds: null, now: NOW }

  it('says how long is left on the pick, for anyone on the clock', () => {
    expect(pickClockLines({ ...base, timerEndAt: inSeconds(74), viewerOnClock: false })).toEqual(['PICK CLOCK: 1m 14s left on this pick (1m 30s per pick).'])
  })

  it('🛑 tells Chimmy to answer pick-first in one line when THEY are on the clock with a minute or less', () => {
    const lines = pickClockLines({ ...base, timerEndAt: inSeconds(37), viewerOnClock: true })
    expect(lines[1]).toMatch(/^🛑 THIS USER IS ON THE CLOCK WITH 37s LEFT/)
    expect(lines[1]).toContain('"Take <player>. Backup: <player>."')
  })

  it('leads with the pick, but does not cut it to one line, with more time', () => {
    expect(pickClockLines({ ...base, timerEndAt: inSeconds(61), viewerOnClock: true })[1]).toBe('THIS USER IS ON THE CLOCK NOW: lead with the pick, then the reason.')
  })

  it('never gives the short-answer rule when someone ELSE is on the clock', () => {
    expect(pickClockLines({ ...base, timerEndAt: inSeconds(10), viewerOnClock: false }).join(' ')).not.toContain('THIS USER IS ON THE CLOCK')
  })

  it('calls a long clock a slow draft — the same draft, a longer clock', () => {
    expect(pickClockLines({ ...base, timerSeconds: 8 * 3600, timerEndAt: inSeconds(3 * 3600 + 120), viewerOnClock: false })[0])
      .toBe('PICK CLOCK: 3h 2m left on this pick (8h per pick — a slow draft).')
  })

  it('reports a paused clock, the overnight freeze, and a run-out clock without inventing a deadline', () => {
    expect(pickClockLines({ ...base, status: 'paused', timerEndAt: null, pausedRemainingSeconds: 40, viewerOnClock: true })).toEqual(['PICK CLOCK: stopped while paused, with 40s left on the pick (1m 30s per pick).'])
    expect(pickClockLines({ ...base, timerEndAt: null, overnightFrozenPickSeconds: 5400, viewerOnClock: false })[0]).toMatch(/frozen for the league's overnight window; 1h 30m will be left/)
    expect(pickClockLines({ ...base, timerEndAt: inSeconds(-30), viewerOnClock: true })[0]).toBe('PICK CLOCK: time has run out on this pick (1m 30s per pick).')
    expect(pickClockLines({ ...base, timerEndAt: null, viewerOnClock: true })).toEqual([])
  })
})

describe('the viewer\'s next pick', () => {
  it('walks the snake with the room\'s own order math', () => {
    // 4 teams, slot 2: picks 2, 7 (round 2 reverses), 10.
    expect(viewerNextOverall({ fromOverall: 3, totalPicks: 12, slot: 2, teamCount: 4, draftType: 'snake', thirdRoundReversal: false })).toBe(7)
    expect(viewerNextOverall({ fromOverall: 11, totalPicks: 12, slot: 2, teamCount: 4, draftType: 'snake', thirdRoundReversal: false })).toBeNull()
    expect(viewerNextOverall({ fromOverall: 3, totalPicks: 12, slot: 2, teamCount: 4, draftType: 'linear', thirdRoundReversal: false })).toBe(6)
  })
})

describe('picks and queue', () => {
  it('lists their picks in order with what they still have no starter at', () => {
    expect(viewerPicksLine([{ overall: 7, playerName: 'Garrett Wilson', position: 'WR' }, { overall: 2, playerName: 'Bijan Robinson', position: 'RB' }], 4))
      .toBe("THIS USER'S PICKS SO FAR (2): 1.02 Bijan Robinson (RB), 2.03 Garrett Wilson (WR). This draft: RB, WR (2 picks) — no QB or TE yet.")
    expect(viewerPicksLine([], 12)).toBe("THIS USER'S PICKS SO FAR: none yet.")
  })

  it('shows their queue in their own order, eight at most', () => {
    const queue = Array.from({ length: 10 }, (_, i) => ({ playerName: `Player ${i + 1}`, position: 'WR', team: i === 0 ? 'MIA' : null }))
    const line = viewerQueueLine(queue)
    expect(line).toContain('1. Player 1 (WR, MIA); 2. Player 2 (WR)')
    expect(line).toContain('8. Player 8 (WR), +2 more.')
    expect(line).not.toContain('Player 9')
    expect(viewerQueueLine([])).toMatch(/empty/)
  })
})

describe('the auction room', () => {
  it('says who is on the block, the bid, and everyone\'s money', () => {
    const lines = auctionRoomLines({
      nomination: { playerName: 'Puka Nacua', position: 'WR', team: 'LAR' },
      currentBid: 41,
      highBidderName: 'Manager 3',
      minNextBid: 42,
      bidSecondsLeft: 12,
      teams: [
        { name: 'Manager 3', budget: 150, openSlots: 10, isViewer: false },
        { name: 'Me', budget: 120, openSlots: 12, isViewer: true },
      ],
      budgetsAssumed: false,
    })
    expect(lines[0]).toBe('ON THE BLOCK: Puka Nacua (WR, LAR), high bid $41 by Manager 3; next bid at least $42, 12s left on the bid clock.')
    expect(lines[1]).toBe('THIS USER: $120 left for 12 open roster spots.')
    expect(lines[2]).toBe('Money left: Manager 3 $150 (10 open).')
  })

  it('does not quote assumed budgets as fact', () => {
    expect(auctionRoomLines({ nomination: null, currentBid: 0, highBidderName: null, minNextBid: 1, bidSecondsLeft: null, teams: [], budgetsAssumed: true }).join(' '))
      .toMatch(/Nobody is on the block.*league default/)
  })

  it('turns the auction engine\'s advice into a call on the player up and a max bid', () => {
    const lines = auctionAdviceLines({
      maxLegalBid: 109,
      budgetEdge: 1.1,
      nominated: { playerName: 'Puka Nacua', position: 'WR', team: 'LAR', marketPrice: 44, yourPrice: 52, surplus: 8, reason: 'Fills your WR1.', currentBid: 41, verdict: 'bid', bidUpTo: 50 },
      targets: [{ playerName: 'Zay Flowers', position: 'WR', team: 'BAL', marketPrice: 9, yourPrice: 15, surplus: 6, reason: '' }],
      nominate: { playerName: 'Travis Kelce', position: 'TE', team: 'KC', marketPrice: 20, yourPrice: 8, surplus: -12, reason: 'You are set at TE.' },
      summary: '',
      caveats: ['Budgets are assumed.'],
    })
    expect(lines[0]).toContain('max legal bid right now $109')
    expect(lines[1]).toBe('Puka Nacua: worth about $52 to this user against roughly $44 to the room — bid up to $50. Fills your WR1.')
    expect(lines.join('\n')).toContain('NOMINATE so others spend: Travis Kelce')
    expect(lines.join('\n')).toContain('Caveat: Budgets are assumed.')
    expect(lines[lines.length - 1]).toMatch(/the user places every bid/)
  })
})

describe('AF Pro: who is likely gone before their pick', () => {
  it('judges by market ADP against their next pick, with a margin that grows with the room', () => {
    const at = (adp: number | null, adpIsReal = true, teamCount = 12) => classifyByAdp({ adp, adpIsReal, myNextOverall: 30, teamCount })
    expect(at(20)).toBe('likely_gone')
    expect(at(28)).toBe('toss_up')
    expect(at(33)).toBe('toss_up')
    expect(at(40)).toBe('likely_there')
    expect(at(26, true, 16)).toBe('toss_up') // 16 teams: a 4-pick margin
    expect(at(26, true, 8)).toBe('likely_gone') // 8 teams: a 2-pick margin
  })

  it('never judges a missing or synthetic ADP', () => {
    expect(classifyByAdp({ adp: null, adpIsReal: true, myNextOverall: 30, teamCount: 12 })).toBe('no_adp')
    expect(classifyByAdp({ adp: 15, adpIsReal: false, myNextOverall: 30, teamCount: 12 })).toBe('no_adp')
  })

  it('groups the targets, adds the open-slot facts and league history, and says it is a guide', () => {
    const lines = pickOutlookLines({
      targets: [
        { name: 'Jaylen Waddle', position: 'WR', team: 'MIA', adp: 22.4, adpIsReal: true, from: 'queue' },
        { name: 'Zay Flowers', position: 'WR', team: 'BAL', adp: 41, adpIsReal: true, from: 'draft_os' },
        { name: 'Deep Sleeper', position: 'TE', team: null, adp: null, adpIsReal: false, from: 'queue' },
      ],
      nextOverall: 25,
      myNextOverall: 30,
      teamCount: 12,
      openSlotsLine: '5 picks before your next turn: 4 of 5 still need a starting TE.',
      historyLines: ['Manager 7: Their first-round pick was at RB in 3 of 4 drafts.'],
    })
    expect(lines[0]).toBe("PICK OUTLOOK (AF Pro): this user's next pick is 3.06, 5 picks away. Judged by market ADP against that pick and the open starting slots of the teams picking first — a guide, not a promise.")
    expect(lines).toContain('Likely GONE before their pick: Jaylen Waddle (WR, ADP 22.4, queued).')
    expect(lines).toContain('Likely still THERE: Zay Flowers (WR, ADP 41).')
    expect(lines).toContain('No market ADP (cannot judge): Deep Sleeper (TE, queued).')
    expect(lines).toContain('5 picks before your next turn: 4 of 5 still need a starting TE.')
    expect(lines.join('\n')).toContain('never say what a manager WILL pick')
  })
})
