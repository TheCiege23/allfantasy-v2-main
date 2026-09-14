import { describe, expect, it } from 'vitest'
import { GAME_VIEW_SPORTS, trimEspnGameSummary } from '@/lib/live/espnGameSummary'
import { WNBA_OPTS, rawWnba } from './fixtures/espn-wnba-summary'

/* Real values: NY Liberty @ Dallas Wings, 2026-07-20 (401892393), Final/OT 99-98. */
const trim = () => trimEspnGameSummary(rawWnba(), WNBA_OPTS)!

describe('trimEspnGameSummary — WNBA', () => {
  it('is basketball in quarters on the WNBA court, with OT as the fifth period', () => {
    const d = trim()
    expect(GAME_VIEW_SPORTS).toContain('WNBA')
    expect(d.basketball).toMatchObject({ periods: 'quarters', court: 'wnba' })
    expect(d.hockey).toBeNull()
    expect(d.baseball).toBeNull()
    expect(d.home).toMatchObject({ abbrev: 'DAL', score: 98, linescores: [22, 25, 21, 15, 15] })
    expect(d.away).toMatchObject({ abbrev: 'NY', score: 99, linescores: [25, 25, 9, 24, 16] })
  })

  it('the WNBA court follows the sport: the same summary read as NBA draws the pro court', () => {
    expect(trimEspnGameSummary(rawWnba(), { ...WNBA_OPTS, sport: 'NBA' })!.basketball!.court).toBe('pro')
    expect(trimEspnGameSummary(rawWnba(), { ...WNBA_OPTS, sport: 'NCAAB' })!.basketball!.court).toBe('college')
  })

  it('charts real shot spots and leaves the sentinel free throw off', () => {
    const shots = trim().basketball!.shots
    expect(shots.map((s) => s.id)).toEqual(['40189239317', '40189239355', '401892393587'])
    // "Pauline Astier makes 27-foot three point jumper" — (14, 25) is 27.3 ft from the rim.
    expect(shots[0]).toMatchObject({ x: 14, y: 25, made: true, value: 3, period: 1 })
    expect(shots[2]).toMatchObject({ x: 37, y: 12, made: true, period: 5, clock: '4:39' })
  })

  it('drops the substitution; the last play is the OT basket, not the end markers', () => {
    const d = trim()
    expect(d.basketball!.plays.map((p) => p.id)).not.toContain('40189239359')
    expect(d.lastPlay?.text).toBe('Azzi Fudd makes 17-foot pullup jump shot (Jessica Shepard assists)')
  })

  it('box score, leaders and team stats read like the NBA shape', () => {
    const d = trim()
    const ny = d.basketball!.box.away!
    expect(ny.players.map((p) => `${p.shortName}:${p.starter}:${p.didNotPlay}`)).toEqual([
      'B. Stewart:true:false',
      'J. Jones:true:false',
      'R. Carrera:false:false',
      'A. Maley:false:true',
    ])
    expect(ny.labels.slice(0, 3)).toEqual(['MIN', 'PTS', 'FG'])
    expect(d.leaders.home.map((l) => l.category)).toEqual(['points', 'rebounds', 'assists'])
    expect(d.leaders.away[0]?.name).toBe('Breanna Stewart')
    expect(d.teamStats.find((s) => s.key === 'fieldGoalsMade-fieldGoalsAttempted')).toMatchObject({ away: '35/84', home: '36/76' })
  })
})
