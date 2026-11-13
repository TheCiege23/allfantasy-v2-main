import { describe, expect, it } from 'vitest'
import { liveChips, liveMoment, nextKickoff, orderSportTabs, PLAYS_SHOWN } from '@/lib/live/liveGuide'
import { liveGuideMessages } from '@/lib/core-app/messages/liveGuide'

const NOW = Date.parse('2026-11-13T04:00:00.000Z')
const impact = (over: Partial<{ livePlayers: number; finishedPlayers: number; upNext: { playerName: string; matchup: string; startTime: string }[] }> = {}) => ({
  livePlayers: 0,
  finishedPlayers: 0,
  upNext: [],
  ...over,
})
const glance = (behind: number, close: number) => ({ counts: { ahead: 3, behind, level: 0, close, pending: 1 } })

describe('nextKickoff', () => {
  it('prefers your own next starter from today’s slate over the sport’s next game', () => {
    const at = nextKickoff(
      [{ startTime: '2026-11-13T21:00:00.000Z' }, { startTime: '2026-11-13T18:00:00.000Z' }],
      '2026-11-15T18:00:00.000Z',
      NOW,
    )
    expect(at).toBe('2026-11-13T18:00:00.000Z')
  })

  it('falls back to the sport’s next kickoff, and never calls a past or broken instant "next"', () => {
    expect(nextKickoff([{ startTime: '2026-11-12T18:00:00.000Z' }], '2026-11-15T18:00:00.000Z', NOW)).toBe('2026-11-15T18:00:00.000Z')
    expect(nextKickoff([{ startTime: 'not a date' }], null, NOW)).toBeNull()
    expect(nextKickoff([], '2026-11-01T18:00:00.000Z', NOW)).toBeNull()
  })
})

describe('liveMoment', () => {
  it('says a roster read failure before anything else — it is not "nothing on"', () => {
    expect(liveMoment({ rosterFailed: true, hasRosterData: true, impact: impact({ livePlayers: 4 }), sportNextAt: null, nowMs: NOW })).toEqual({ kind: 'roster-failed' })
    expect(liveMoment({ rosterFailed: false, hasRosterData: false, impact: impact(), sportNextAt: null, nowMs: NOW })).toEqual({ kind: 'no-roster' })
  })

  it('is live while any starter is playing, and between games otherwise', () => {
    expect(liveMoment({ rosterFailed: false, hasRosterData: true, impact: impact({ livePlayers: 3, finishedPlayers: 2 }), sportNextAt: null, nowMs: NOW })).toEqual({ kind: 'live', playing: 3, done: 2 })
    expect(liveMoment({ rosterFailed: false, hasRosterData: true, impact: impact({ finishedPlayers: 13 }), sportNextAt: '2026-11-15T18:00:00.000Z', nowMs: NOW })).toEqual({
      kind: 'between',
      nextAt: '2026-11-15T18:00:00.000Z',
      done: 13,
    })
  })
})

describe('liveChips', () => {
  it('between games: playing, behind, close, then the next kickoff — four numbers, each linking to its section', () => {
    const chips = liveChips({ kind: 'between', nextAt: '2026-11-15T18:00:00.000Z', done: 13 }, glance(2, 6))
    expect(chips.map((c) => c.key)).toEqual(['playing', 'behind', 'close', 'next'])
    expect(chips.find((c) => c.key === 'behind')).toMatchObject({ value: 2, href: '#af-live-glance', tone: 'bad' })
    expect(chips.find((c) => c.key === 'next')).toMatchObject({ href: '#af-live-next' })
  })

  it('during games the fourth chip is "done today", and a zero links nowhere', () => {
    const chips = liveChips({ kind: 'live', playing: 4, done: 3 }, glance(0, 0))
    expect(chips.map((c) => c.key)).toEqual(['playing', 'behind', 'close', 'done'])
    expect(chips.find((c) => c.key === 'playing')).toMatchObject({ value: 4, tone: 'live' })
    expect(chips.find((c) => c.key === 'behind')).toMatchObject({ value: 0, href: null, tone: 'plain' })
  })

  it('with a league held there is no cross-league glance, so no matchup counts', () => {
    expect(liveChips({ kind: 'between', nextAt: null, done: 0 }, null).map((c) => c.key)).toEqual(['playing', 'done'])
    expect(liveChips({ kind: 'roster-failed' }, null)).toEqual([])
  })
})

describe('orderSportTabs', () => {
  it('puts sports with games first and keeps every empty sport listed, in order', () => {
    const tabs = orderSportTabs([
      { sport: 'NFL', slateCount: 0 },
      { sport: 'NBA', slateCount: 4 },
      { sport: 'WNBA', slateCount: 0 },
      { sport: 'NHL', slateCount: 10 },
    ])
    expect(tabs.map((t) => t.sport)).toEqual(['NBA', 'NHL', 'NFL', 'WNBA'])
  })
})

describe('live guide copy', () => {
  it('says the count in both languages and never uses «waiver» in Spanish', () => {
    expect(liveGuideMessages.en.headLive(1)).toBe('1 of your starters is playing right now')
    expect(liveGuideMessages.en.headLive(3)).toBe('3 of your starters are playing right now')
    expect(liveGuideMessages.es!.headLive!(3)).toMatch(/^3 /)
    const es = JSON.stringify(Object.values(liveGuideMessages.es!).map((v) => (typeof v === 'function' ? String(v) : v)))
    expect(es.toLowerCase()).not.toMatch(/waiver/)
    expect(PLAYS_SHOWN).toBe(5)
  })
})
