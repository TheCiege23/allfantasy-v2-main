/**
 * The result and box-score lines under a FINAL starter on the Matchup board (2026-11-09):
 * lib/core-app/matchupGameLine.ts formats them, the loader attaches them only for final games,
 * and the board draws them only when they are present.
 */
import React from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { gameResultFor, nflStatLine } from '@/lib/core-app/matchupGameLine'
import { clubGameIndex, starterGameStates } from '@/lib/core-app/matchupGameState'
import { matchupFixture } from '@/app/e2e/redraft-core/matchup/fixtures'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, refresh() {}, prefetch() {} }), usePathname: () => '/core/matchup', useSearchParams: () => new URLSearchParams() }))

describe('gameResultFor', () => {
  const game = { home: 'PHI', away: 'NYG', homeScore: 11, awayScore: 19 }
  it('reads the result from the club’s side of the game', () => {
    expect(gameResultFor('NYG', game)).toEqual({ outcome: 'W', clubScore: 19, opponentScore: 11 })
    expect(gameResultFor('PHI', game)).toEqual({ outcome: 'L', clubScore: 11, opponentScore: 19 })
  })
  it('calls a level score a tie', () => {
    expect(gameResultFor('PHI', { ...game, homeScore: 20, awayScore: 20 })?.outcome).toBe('T')
  })
  it('refuses a club not in the game, or a missing score', () => {
    expect(gameResultFor('DAL', game)).toBeNull()
    expect(gameResultFor(null, game)).toBeNull()
    expect(gameResultFor('PHI', { ...game, homeScore: null })).toBeNull()
  })
})

describe('nflStatLine', () => {
  it('reads like a broadcast box score: passing, then rushing', () => {
    expect(nflStatLine({ pass_cmp: 12, pass_att: 19, pass_yd: 127, rush_att: 4, rush_yd: 22 })).toBe('12/19 CMP, 127 YD, 4 CAR, 22 YD')
  })
  it('shows touchdowns, interceptions and lost fumbles only when they happened', () => {
    expect(nflStatLine({ pass_cmp: 24, pass_att: 35, pass_yd: 274, pass_td: 1, pass_int: 0, rush_att: 4, rush_yd: 16, fum_lost: 0 }))
      .toBe('24/35 CMP, 274 YD, 1 TD, 4 CAR, 16 YD')
    expect(nflStatLine({ rush_att: 17, rush_yd: 57, rush_td: 1, rec: 4, rec_yd: 31, fum_lost: 1 }))
      .toBe('17 CAR, 57 YD, 1 TD, 4 REC, 31 YD, 1 FUM LOST')
  })
  it('drops a group with no volume — no "0 REC" on a quarterback', () => {
    expect(nflStatLine({ pass_cmp: 0, pass_att: 0, rec: 7, rec_yd: 98, rec_tgt: 9 })).toBe('7 REC, 98 YD')
  })
  it('keeps negative yards, which are real', () => {
    expect(nflStatLine({ rush_att: 2, rush_yd: -3 })).toBe('2 CAR, -3 YD')
  })
  it('formats a kicker', () => {
    expect(nflStatLine({ fgm: 2, fga: 3, xpm: 3 })).toBe('2/3 FG, 3 XP')
  })
  it('is null when nothing qualifies, or the payload is not an object', () => {
    expect(nflStatLine({})).toBeNull()
    expect(nflStatLine({ fum_lost: 1 })).toBeNull()
    expect(nflStatLine(null)).toBeNull()
    expect(nflStatLine([1, 2])).toBeNull()
    expect(nflStatLine('12 REC')).toBeNull()
  })
})

describe('clubGameIndex', () => {
  it('returns the same row the starter state is read from, extra columns intact', () => {
    const now = new Date('2026-11-09T20:00:00Z')
    const old = { homeTeam: 'PHI', awayTeam: 'NYG', status: 'in_progress', startTime: new Date('2026-11-09T18:00:00Z'), fetchedAt: new Date('2026-11-09T18:30:00Z'), seasonType: 'regular', homeScore: 3, awayScore: 0 }
    const fresh = { ...old, status: 'final', fetchedAt: new Date('2026-11-09T19:55:00Z'), homeScore: 11, awayScore: 19 }
    const games = [old, fresh]
    const state = starterGameStates(new Map([['p1', { team: 'NYG' }]]), games, now).get('p1')
    const row = clubGameIndex(games).get('NYG')
    expect(state).toBe('final')
    expect(row?.homeScore).toBe(11)
    expect(row?.status).toBe('final')
  })
})

describe('the board', () => {
  it('labels a live box score "so far" and never gives a live starter a result', async () => {
    const { default: Matchup } = await import('@/components/core-app/screens/Matchup')
    const { container } = render(<Matchup data={matchupFixture('NFL', 'live')} />)
    const live = [...container.querySelectorAll('.af-mu-board-row .af-mu-half[data-gs="live"]')]
    expect(live.length).toBeGreaterThan(0)
    for (const half of live) {
      expect(half.querySelector('.af-mu-half-result')).toBeNull()
      const line = half.querySelector('.af-mu-half-statline')
      if (!line) continue
      expect(line.getAttribute('data-live')).toBe('true')
      expect(line.querySelector('.af-mu-half-statline-live')?.textContent).toMatch(/^so far/)
    }
    expect(container.querySelector('.af-mu-half-statline[data-live="true"]')).toBeTruthy()
    // A final starter's line carries no "so far".
    for (const half of container.querySelectorAll('.af-mu-board-row .af-mu-half[data-gs="final"]')) {
      expect(half.querySelector('.af-mu-half-statline-live')).toBeNull()
    }
  })

  it('draws a result only under a final starter, and nothing under an upcoming one', async () => {
    const { default: Matchup } = await import('@/components/core-app/screens/Matchup')
    const { container } = render(<Matchup data={matchupFixture('NFL', 'live')} />)
    const halves = [...container.querySelectorAll('.af-mu-board-row .af-mu-half[data-state="player"]')]
    expect(halves.length).toBeGreaterThan(0)
    let finals = 0
    for (const half of halves) {
      const gs = half.getAttribute('data-gs')
      const result = half.querySelector('.af-mu-half-result')
      const stats = half.querySelector('.af-mu-half-statline')
      if (gs === 'final') {
        finals += 1
        expect(result?.textContent).toMatch(/^[WLT] \d+–\d+( (vs|@) [A-Z]+)?$/)
        expect(result?.querySelector('[data-outcome]')).toBeTruthy()
      } else {
        expect(result).toBeNull()
        // Since the game-window import, a LIVE starter may carry a "so far" line; an upcoming one never does.
        if (gs !== 'live') expect(stats).toBeNull()
      }
    }
    expect(finals).toBeGreaterThan(0)
  })

  it('draws neither line when the cell has none — no placeholder, no empty box', async () => {
    const { default: Matchup } = await import('@/components/core-app/screens/Matchup')
    const data = matchupFixture('NFL', 'final')
    if (data.lineups.available) for (const s of data.lineups.data) for (const c of [s.you, s.opponent]) if (c) { c.result = null; c.statLine = null }
    const { container } = render(<Matchup data={data} />)
    expect(container.querySelectorAll('.af-mu-half-result')).toHaveLength(0)
    expect(container.querySelectorAll('.af-mu-half-statline')).toHaveLength(0)
  })
})
