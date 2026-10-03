// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { countdownText, nextWaiverRunMs } from '@/lib/core-app/waiverRunClock'
import { rosterNeeds } from '@/lib/waivers/rosterNeeds'
import { multiLeagueAdds, type WaiverBoardRow, type WaiverPlayer } from '@/lib/core-app/waiversBoard'
import { runsAtSchedule } from '@/lib/core-app/waiverRowMeta'
import { pickLineupSwap } from '@/lib/core-app/waiverSwap'

/* Wednesday 2026-09-30 06:00 UTC. */
const WED_0600 = Date.UTC(2026, 8, 30, 6, 0)

describe('nextWaiverRunMs', () => {
  it('later the same day', () => {
    expect(nextWaiverRunMs({ dayOfWeek: 3, timeUtc: '09:00' }, WED_0600)).toBe(Date.UTC(2026, 8, 30, 9, 0))
  })
  it('already passed today → a week out, never in the past', () => {
    expect(nextWaiverRunMs({ dayOfWeek: 3, timeUtc: '05:00' }, WED_0600)).toBe(Date.UTC(2026, 9, 7, 5, 0))
  })
  it('wraps across the week boundary', () => {
    expect(nextWaiverRunMs({ dayOfWeek: 1, timeUtc: '12:30' }, WED_0600)).toBe(Date.UTC(2026, 9, 5, 12, 30))
  })
  it('refuses an unreadable schedule rather than guessing', () => {
    expect(nextWaiverRunMs({ dayOfWeek: 3, timeUtc: '9am' }, WED_0600)).toBeNull()
    expect(nextWaiverRunMs({ dayOfWeek: 7, timeUtc: '09:00' }, WED_0600)).toBeNull()
  })
  it('countdown text', () => {
    expect(countdownText(12 * 60_000)).toBe('in 12m')
    expect(countdownText((14 * 60 + 5) * 60_000)).toBe('in 14h 05m')
    expect(countdownText((50 * 60) * 60_000)).toBe('in 2d 2h')
  })
})

describe('runsAtSchedule', () => {
  const w = { processingDayOfWeek: 3, processingTimeUtc: '09:00' }
  it('hands a countdown the schedule of a league that imported one', () => {
    expect(runsAtSchedule(w, 'manual')).toEqual({ dayOfWeek: 3, timeUtc: '09:00' })
  })
  it('never hands a Sleeper bootstrap default to a clock', () => {
    expect(runsAtSchedule(w, 'sleeper')).toBeNull()
  })
})

describe('rosterNeeds', () => {
  const players = [
    { id: 'q1', name: 'Q One', position: 'QB', team: 'KC', starter: true },
    { id: 'r1', name: 'R One', position: 'RB', team: 'BUF', starter: true },
    { id: 'r2', name: 'R Two', position: 'RB', team: 'DAL', starter: true },
    { id: 'w1', name: 'W One', position: 'WR', team: 'MIA', starter: true },
    { id: 'w2', name: 'W Two', position: 'WR', team: 'Kansas City Chiefs', starter: false },
  ]
  const slots = ['QB', 'RB', 'RB', 'WR', 'FLEX']

  it('flags a position whose starting slots use every player you roster there', () => {
    const n = rosterNeeds({ week: 5, slots, unfilled: [], players, teamsPlayingByWeek: new Map() })
    expect(n.noBackup).toEqual([
      { position: 'QB', rostered: 1, starting: 1 },
      { position: 'RB', rostered: 2, starting: 2 },
    ])
  })

  it('names byes from the schedule, normalising team spellings', () => {
    const n = rosterNeeds({
      week: 5,
      slots,
      unfilled: ['FLEX'],
      players,
      /* Week 5: KC and MIA do not play. */
      teamsPlayingByWeek: new Map([[5, new Set(['BUF', 'DAL', 'NYJ'])]]),
    })
    expect(n.emptySlots).toEqual(['FLEX'])
    expect(n.byes).toHaveLength(1)
    expect(n.byes[0].players.map((p) => p.id)).toEqual(['q1', 'w1', 'w2'])
  })

  it('skips a week with no games on file instead of putting everyone on bye', () => {
    const n = rosterNeeds({ week: 5, slots, unfilled: [], players, teamsPlayingByWeek: new Map([[6, new Set()]]) })
    expect(n.byes).toEqual([])
  })
})

describe('pickLineupSwap().ranked', () => {
  it('carries every lineup-improving add, best first, each against the lineup as it stands', () => {
    const swap = pickLineupSwap({
      roster: [
        { id: 'w1', position: 'WR', points: 12 },
        { id: 'w2', position: 'WR', points: 6 },
      ],
      starterIds: new Set(['w1', 'w2']),
      candidates: [
        { id: 'a', position: 'WR', points: 10 },
        { id: 'b', position: 'WR', points: 8 },
        { id: 'c', position: 'WR', points: 5 },
      ],
      slots: ['WR', 'WR'],
      dynasty: false,
    })
    expect(swap?.ranked).toEqual([
      { id: 'a', gain: 4, displacesId: 'w2' },
      { id: 'b', gain: 2, displacesId: 'w2' },
    ])
  })
})

describe('multiLeagueAdds', () => {
  const player = (id: string, projected: number): WaiverPlayer => ({
    playerId: id, name: id.toUpperCase(), position: 'WR', team: 'KC', imageUrl: null, projected, ownPct: null, startPct: null,
  })
  const row = (leagueId: string): WaiverBoardRow => ({
    leagueId, leagueName: `League ${leagueId}`, platform: 'sleeper', platformLeagueId: leagueId, logoUrl: null, format: null,
    netGain: 1, add: player('x', 1), drop: null, faabRemaining: null, runsAt: null, href: `/core/waivers?league=${leagueId}`, reasoning: '',
  })

  it('lists a free agent who starts for you in two or more KEPT leagues, by count then total', () => {
    const ranked = new Map([
      ['L1', [{ add: player('a', 10), gain: 4 }, { add: player('b', 9), gain: 1 }]],
      ['L2', [{ add: player('a', 11), gain: 2 }, { add: player('b', 9), gain: 3 }]],
      ['L3', [{ add: player('b', 9), gain: 1 }]],
      /* A twin of L1 the board collapsed: its wire must not count as a second league. */
      ['L1twin', [{ add: player('a', 10), gain: 4 }, { add: player('c', 7), gain: 1 }]],
    ])
    const out = multiLeagueAdds([row('L1'), row('L2'), row('L3')], ranked)
    expect(out.map((p) => [p.playerId, p.leagues.length, p.totalGain])).toEqual([
      ['b', 3, 5],
      ['a', 2, 6],
    ])
    expect(out[1].leagues.map((l) => l.leagueId)).toEqual(['L1', 'L2'])
    expect(JSON.stringify(out)).not.toContain('L1twin')
  })
})
