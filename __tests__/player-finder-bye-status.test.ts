import { describe, expect, it } from 'vitest'

import { byeChip, byeStatus } from '@/lib/core-app/byeStatus'

/*
 * "Bye" only when the absence has the shape of a real bye slate; otherwise
 * "no game on the schedule" — see the module header for why.
 */

function slate(clubs: number): Record<string, string> {
  const all = ['ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS']
  return Object.fromEntries(all.slice(0, clubs).map((c) => [c, '2026-10-25T17:00:00.000Z']))
}

describe('byeStatus', () => {
  it('reads playing for a club on the map, through either spelling', () => {
    expect(byeStatus('WAS', slate(32), 9)).toBe('playing')
    expect(byeStatus('Washington Commanders', slate(32), 9)).toBe('playing')
  })

  it('calls a bye only in a bye week with an even absent count between two and six', () => {
    expect(byeStatus('WAS', slate(28), 9)).toBe('bye') // 4 absent, week 9
    expect(byeStatus('WAS', slate(26), 5)).toBe('bye') // 6 absent, week 5
    expect(byeStatus('WAS', slate(30), 14)).toBe('bye') // 2 absent, week 14
  })

  it('reads "no game on the schedule" outside that shape — a missing fixture is not a bye', () => {
    expect(byeStatus('WAS', slate(30), 1)).toBe('no-game') // week 1: nobody is on bye
    expect(byeStatus('WAS', slate(30), 16)).toBe('no-game')
    expect(byeStatus('WAS', slate(31), 9)).toBe('no-game') // an odd absent count is a data gap
    expect(byeStatus('WAS', slate(24), 9)).toBe('no-game') // eight absent is not an NFL slate
    expect(byeStatus('WAS', slate(28), null)).toBe('no-game') // no week to judge by
  })

  it('is unknown with no schedule or no club', () => {
    expect(byeStatus('WAS', {}, 9)).toBe('unknown')
    expect(byeStatus(null, slate(28), 9)).toBe('unknown')
  })

  it('chips only the two not-playing states', () => {
    expect(byeChip('bye', 9)).toEqual({ label: 'Bye · wk 9', tone: 'bad' })
    expect(byeChip('no-game', 9)).toEqual({ label: 'No game on the schedule', tone: 'warn' })
    expect(byeChip('playing', 9)).toBeNull()
    expect(byeChip('unknown', 9)).toBeNull()
  })
})
