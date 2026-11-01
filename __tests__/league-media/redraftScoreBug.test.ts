import { describe, expect, it } from 'vitest'
import { periodLabel, positionPillsForSport, scoreBugStatus, sportGlyph } from '@/lib/league-media/redraftScoreBug'

const live = (period: number, clock = '') => ({ status: 'STATUS_IN_PROGRESS', period, clock, completed: false, startTime: '2026-11-01T18:00:00Z' })

describe('periodLabel', () => {
  it('speaks each sport', () => {
    expect(periodLabel('NFL', 3)).toBe('Q3')
    expect(periodLabel('NCAAF', 5)).toBe('OT')
    expect(periodLabel('NBA', 4)).toBe('Q4')
    expect(periodLabel('NCAAB', 2)).toBe('2nd half')
    expect(periodLabel('NCAAB', 3)).toBe('OT')
    expect(periodLabel('NHL', 2)).toBe('P2')
    expect(periodLabel('NHL', 4)).toBe('OT')
    expect(periodLabel('MLB', 6)).toBe('Inn 6')
    expect(periodLabel('SOCCER', 1)).toBe('1st half')
    expect(periodLabel('SOCCER', 3)).toBe('ET')
  })
  it('prints no period rather than Q0 when the feed sent none', () => {
    for (const p of [0, -1, Number.NaN, 1.5]) expect(periodLabel('NFL', p)).toBeNull()
  })
})

describe('scoreBugStatus', () => {
  it('final wins over everything', () => {
    expect(scoreBugStatus('NFL', { ...live(4, '0:00'), completed: true })).toEqual({ label: 'Final', tone: 'final' })
    expect(scoreBugStatus('NFL', { ...live(4), status: 'STATUS_FINAL' })).toEqual({ label: 'Final', tone: 'final' })
  })
  it('live joins period and clock, and never invents either', () => {
    expect(scoreBugStatus('NFL', live(3, '8:42'))).toEqual({ label: 'Q3 · 8:42', tone: 'live' })
    expect(scoreBugStatus('MLB', live(6))).toEqual({ label: 'Inn 6', tone: 'live' })
    expect(scoreBugStatus('SOCCER', live(0, "67'"))).toEqual({ label: "67'", tone: 'live' })
    expect(scoreBugStatus('NHL', live(0))).toEqual({ label: 'Live', tone: 'live' })
    expect(scoreBugStatus('NBA', { ...live(2), status: 'STATUS_HALFTIME' })).toEqual({ label: 'Halftime', tone: 'live' })
  })
  it('upcoming shows the start time, and nothing for an unparseable one', () => {
    expect(scoreBugStatus('NFL', { ...live(0), status: 'STATUS_SCHEDULED' }).tone).toBe('upcoming')
    expect(scoreBugStatus('NFL', { ...live(0), status: 'STATUS_SCHEDULED', startTime: 'nope' })).toEqual({ label: '', tone: 'upcoming' })
  })
})

describe('positionPillsForSport / sportGlyph', () => {
  it('gives college and soccer their own positions (they used to get football pills)', () => {
    expect(positionPillsForSport('NCAAB')).toEqual(positionPillsForSport('NBA'))
    expect(positionPillsForSport('SOCCER')).toEqual(['All', 'GK', 'DEF', 'MID', 'FWD'])
    expect(positionPillsForSport('NCAAF')).toEqual(positionPillsForSport('NFL'))
    expect(positionPillsForSport('NHL')).toContain('G')
    expect(positionPillsForSport('MLB')).toContain('SS')
  })
  it('uses the sport ball, defaulting to football', () => {
    expect(['NFL', 'NCAAF', 'NBA', 'NCAAB', 'NHL', 'MLB', 'SOCCER', 'XYZ'].map(sportGlyph)).toEqual(['🏈', '🏈', '🏀', '🏀', '🏒', '⚾', '⚽', '🏈'])
  })
})
