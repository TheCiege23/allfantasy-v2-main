import { describe, expect, it } from 'vitest'

import type { ManagerPresence, PresenceManager } from '@/lib/core-app/managerPresence'
import { anyMovedToday, hoursToWindow, rankTradeWindows } from '@/lib/core-app/tradeWindows'

/*
 * Cross-league trade windows: one row per league where someone else has him,
 * most reachable first. `now` is Saturday 2026-10-24 10:30 ET (14:30Z).
 */

const NOW = new Date('2026-10-24T14:30:00.000Z')

function owner(over: Partial<PresenceManager> = {}): PresenceManager {
  return {
    role: 'owner',
    teamName: 'T',
    ownerName: 'someone',
    avatarUrl: null,
    externalId: '1',
    record: '4-2',
    rank: 3,
    need: null,
    startsHim: true,
    window: null,
    lastMove: null,
    moves: 0,
    ...over,
  }
}

function presence(leagueId: string, leagueName: string, m: PresenceManager | null, over: Partial<ManagerPresence> = {}): ManagerPresence {
  return {
    leagueId,
    leagueName,
    platform: 'sleeper',
    platformLeagueId: '1',
    season: 2026,
    timeZone: 'America/New_York',
    zone: 'ET',
    player: { sleeperId: '10236', position: 'TE' },
    holder: 'other',
    managers: m ? [m] : [],
    activityIngested: true,
    newestMove: null,
    unattributed: 0,
    ...over,
  }
}

const win = (weekday: number, startHour: number, endHour: number, daypart: 'morning' | 'midday' | 'afternoon' | 'evening' | 'late') => ({
  weekday,
  startHour,
  endHour,
  daypart,
  precision: 'window' as const,
  share: 0.7,
  sample: 12,
  zone: 'ET',
})

describe('hoursToWindow', () => {
  it('is 0 inside the block, counts hours to a later block today, and rolls a passed block to next week', () => {
    expect(hoursToWindow(win(6, 10, 12, 'morning'), NOW, 'America/New_York')).toBe(0)
    expect(hoursToWindow(win(6, 18, 20, 'evening'), NOW, 'America/New_York')).toBe(8)
    expect(hoursToWindow(win(6, 6, 8, 'morning'), NOW, 'America/New_York')).toBe(7 * 24 + (6 - 10))
    expect(hoursToWindow(win(0, 10, 12, 'morning'), NOW, 'America/New_York')).toBe(24)
  })
})

describe('rankTradeWindows', () => {
  const inWindowNow = presence('L-a', 'Alpha', owner({ ownerName: 'nowGuy', window: win(6, 10, 12, 'morning') }))
  const tonight = presence('L-c', 'Charlie', owner({ ownerName: 'tonightGuy', window: win(6, 18, 20, 'evening') }))
  const tomorrow = presence('L-b', 'Bravo', owner({ ownerName: 'sundayGuy', window: win(0, 10, 12, 'morning') }))
  // 12.5 hours before NOW: inside the one-day rule for the dot.
  const noWindowRecent = presence('L-d', 'Delta', owner({ ownerName: 'recentGuy', moves: 3, lastMove: { at: '2026-10-24T02:00:00.000Z', kind: 'waiver' } }))
  const notIngested = presence('L-e', 'Echo', owner({ ownerName: 'quietGuy' }), { activityIngested: false })
  const yours = presence('L-y', 'Yours', owner({ role: 'buyer', ownerName: 'buyerGuy' }), { holder: 'yours' })

  it('orders: in the window now, then soonest window, then no window by most recent move', () => {
    const rows = rankTradeWindows({ presences: [notIngested, tomorrow, noWindowRecent, yours, tonight, inWindowNow], playerName: 'Dalton Kincaid', now: NOW, pkg: null })
    expect(rows.map((r) => r.leagueName)).toEqual(['Alpha', 'Charlie', 'Bravo', 'Delta', 'Echo'])
    expect(rows.map((r) => r.line.timing)).toEqual(['now', 'later', 'later', 'unknown', 'unknown'])
    expect(rows.map((r) => r.hoursToWindow)).toEqual([0, 8, 24, null, null])
  })

  it('keeps the single-league grammar per row and names the league on each', () => {
    const rows = rankTradeWindows({ presences: [inWindowNow, notIngested], playerName: 'Dalton Kincaid', now: NOW, pkg: null })
    expect(rows[0].line.lead).toBe('@nowGuy usually moves Sat 10a–12p ET')
    expect(rows[0].line.body).toBe('They start Kincaid in Alpha. Ask what it takes. Pitch now — this is their window.')
    expect(rows[1].line.lead).toBe('@quietGuy — no Sleeper moves ingested yet')
    expect(rows[1].platform).toBe('sleeper')
  })

  it('leaves out leagues where he is yours and leagues with no owner row', () => {
    const rows = rankTradeWindows({ presences: [yours, presence('L-z', 'Zulu', null)], playerName: 'Dalton Kincaid', now: NOW, pkg: null })
    expect(rows).toEqual([])
  })

  it('reports a move in the last day for the dot, and nothing older', () => {
    const rows = rankTradeWindows({ presences: [noWindowRecent, tonight], playerName: 'Dalton Kincaid', now: NOW, pkg: null })
    expect(anyMovedToday(rows, NOW)).toBe(true)
    expect(anyMovedToday(rankTradeWindows({ presences: [tonight], playerName: 'Dalton Kincaid', now: NOW, pkg: null }), NOW)).toBe(false)
  })
})
