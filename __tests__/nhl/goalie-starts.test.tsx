/**
 * Projected starting goalies (2026-11-28): lib/nhl/goalieStarts.ts (the rule), goalieStartsLoad.ts
 * (the DB read) and GoalieStartChip (what a row shows). "Projected" until the game is on — never
 * "confirmed", because no source we hold publishes confirmed starters.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const db = vi.hoisted(() => ({ playerGameStat: { findMany: vi.fn() }, playerIdentityMap: { findMany: vi.fn() } }))
const games = vi.hoisted(() => ({ rows: [] as unknown[] }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/redraft/weekGames', () => ({ readWeekGames: vi.fn(async () => games.rows) }))

import { projectGoalieStarts, type GoalieLine } from '@/lib/nhl/goalieStarts'
import { loadGoalieStarts } from '@/lib/nhl/goalieStartsLoad'
import { GoalieStartChip } from '@/components/league/native/screens/GoalieStartChip'

const day = (n: number) => new Date(Date.UTC(2026, 10, n)).toISOString().slice(0, 10) // Nov n
const line = (playerId: string, name: string, d: number, toi: number, team = 'TOR'): GoalieLine => ({ playerId, name, team, day: day(d), toi })

/** Woll starts 8 of 10 (Nov 10-19), Stolarz the other 2; each game lists the dressed backup at 0:00. */
function season(): GoalieLine[] {
  const out: GoalieLine[] = []
  for (let d = 10; d <= 19; d++) {
    const stolarz = d === 13 || d === 17
    out.push(line('woll', 'Joseph Woll', d, stolarz ? 0 : 60), line('stol', 'Anthony Stolarz', d, stolarz ? 60 : 0))
  }
  return out
}

describe('projectGoalieStarts', () => {
  it("projects the team's No. 1 as likely, with the reason", () => {
    const [p] = projectGoalieStarts({ lines: season(), upcoming: [{ day: day(21), team: 'TOR', opponent: 'BOS', home: true }] })
    expect(p).toMatchObject({ status: 'projected', confidence: 'likely', goalie: { name: 'Joseph Woll' }, alternate: { name: 'Anthony Stolarz' }, starts: 8, games: 10 })
    expect(p.basis).toBe('Joseph Woll has started 8 of the last 10 games.')
  })

  it('on the second night of a back-to-back the backup is projected, as a lean', () => {
    const lines = [...season(), line('woll', 'Joseph Woll', 20, 60), line('stol', 'Anthony Stolarz', 20, 0)]
    const [p] = projectGoalieStarts({ lines, upcoming: [{ day: day(21), team: 'TOR', opponent: 'BOS', home: false }] })
    expect(p).toMatchObject({ status: 'projected', confidence: 'lean', goalie: { name: 'Anthony Stolarz' }, alternate: { name: 'Joseph Woll' } })
    expect(p.basis).toContain('back-to-back')
  })

  it('once the game is on, the goalie with ice time is in net — and a reliever is named too', () => {
    const lines = [...season(), line('stol', 'Anthony Stolarz', 21, 31), line('woll', 'Joseph Woll', 21, 12)]
    const [p] = projectGoalieStarts({ lines, upcoming: [{ day: day(21), team: 'TOR', opponent: 'BOS', home: true }] })
    expect(p).toMatchObject({ status: 'in_net', confidence: 'confirmed_in_game', goalie: { name: 'Anthony Stolarz' }, alternate: { name: 'Joseph Woll' } })
  })

  it('says nothing on too little history, and skips a game whose starter cannot be told', () => {
    const few = [line('a', 'A', 18, 60, 'SEA'), line('a', 'A', 19, 60, 'SEA')]
    expect(projectGoalieStarts({ lines: few, upcoming: [{ day: day(21), team: 'SEA', opponent: 'VAN', home: true }] })).toEqual([])
    const tied = [...season(), line('woll', 'Joseph Woll', 20, 30), line('stol', 'Anthony Stolarz', 20, 30)]
    const [p] = projectGoalieStarts({ lines: tied, upcoming: [{ day: day(21), team: 'TOR', opponent: 'BOS', home: true }] })
    // Nov 20 is a tie, so it is not counted and is not "last night's start" either: no back-to-back switch.
    expect(p.goalie.name).toBe('Joseph Woll')
    expect(p.games).toBe(10)
  })

  it('a split crease is a lean on the one with more starts', () => {
    const lines: GoalieLine[] = []
    for (let d = 10; d <= 19; d++) {
      const a = d % 2 === 0 || d === 11
      lines.push(line('a', 'Goalie A', d, a ? 60 : 0, 'NJD'), line('b', 'Goalie B', d, a ? 0 : 60, 'NJD'))
    }
    const [p] = projectGoalieStarts({ lines, upcoming: [{ day: day(22), team: 'NJD', opponent: 'NYR', home: true }] })
    expect(p).toMatchObject({ confidence: 'lean', goalie: { name: 'Goalie A' }, starts: 6 })
  })
})

describe('loadGoalieStarts (DB only)', () => {
  it('reads goalie lines and the slate, uses shots when the vendor printed 0:00 for a goalie who played', async () => {
    const now = new Date('2026-11-21T17:00:00Z')
    const rows = []
    for (let d = 10; d <= 19; d++) {
      // Woll's clock reads 0 on every line (the vendor quirk), but he faced shots: he played.
      rows.push({ playerId: 'woll', team: 'TOR', gameDate: new Date(`${day(d)}T00:00:00Z`), normalizedStatMap: { stats: { time_on_ice_minutes: 0, shots_against: 28 } } })
      rows.push({ playerId: 'stol', team: 'TOR', gameDate: new Date(`${day(d)}T00:00:00Z`), normalizedStatMap: { stats: { time_on_ice_minutes: 0, shots_against: 0 } } })
    }
    db.playerGameStat.findMany.mockResolvedValue(rows)
    db.playerIdentityMap.findMany.mockResolvedValue([{ id: 'woll', canonicalName: 'Joseph Woll' }, { id: 'stol', canonicalName: 'Anthony Stolarz' }])
    const start = new Date('2026-11-22T00:30:00Z') // 7:30pm ET Nov 21
    games.rows = [
      { homeTeam: 'TOR', awayTeam: 'BOS', startTime: start, status: 'scheduled' },
      { homeTeam: 'Toronto Maple Leafs', awayTeam: 'Boston Bruins', startTime: start, status: 'scheduled' }, // same game, other feed
    ]
    const { projections } = await loadGoalieStarts({ now })
    const where = db.playerGameStat.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ sportType: 'NHL', season: 2026, gameId: { endsWith: ':goalies' } })
    const tor = projections.filter((p) => p.team === 'TOR')
    expect(tor).toHaveLength(1)
    expect(tor[0]).toMatchObject({ day: '2026-11-21', goalie: { name: 'Joseph Woll' }, starts: 10, games: 10, home: true })
  })
})

describe('GoalieStartChip', () => {
  afterEach(cleanup)
  const base = { day: '2099-01-01', team: 'TOR', opponent: 'BOS', home: true, starts: 8, games: 10, basis: 'Joseph Woll has started 8 of the last 10 games.' }

  it('says "projected" and gives the reason — never "confirmed"', () => {
    const p = { ...base, status: 'projected' as const, confidence: 'likely' as const, goalie: { playerId: 'w', name: 'Joseph Woll' }, alternate: { playerId: 's', name: 'Anthony Stolarz' } }
    const { rerender } = render(<GoalieStartChip entry={{ projection: p, role: 'starter' }} />)
    const chip = screen.getByTestId('goalie-start-chip')
    expect(chip.textContent).toMatch(/^Proj\. start /)
    expect(chip.getAttribute('title')).toContain('not a confirmed lineup')
    expect(chip.getAttribute('title')).toContain('8 of the last 10')
    rerender(<GoalieStartChip entry={{ projection: p, role: 'alternate' }} />)
    expect(screen.getByTestId('goalie-start-chip').textContent).toMatch(/^Proj\. backup /)
    expect(document.body.textContent).not.toMatch(/confirmed/i)
  })

  it('"In net" only once the game is on', () => {
    const p = { ...base, status: 'in_net' as const, confidence: 'confirmed_in_game' as const, goalie: { playerId: 's', name: 'Anthony Stolarz' }, alternate: null }
    render(<GoalieStartChip entry={{ projection: p, role: 'starter' }} />)
    expect(screen.getByTestId('goalie-start-chip').textContent).toBe('In net')
  })
})
