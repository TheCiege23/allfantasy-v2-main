import { describe, expect, it } from 'vitest'
import { GAME_VIEW_SPORTS, trimEspnGameSummary } from '@/lib/live/espnGameSummary'
import { NCAAB_OPTS, rawNcaab } from './fixtures/espn-ncaab-summary'

const trim = () => trimEspnGameSummary(rawNcaab(), NCAAB_OPTS)!

describe('trimEspnGameSummary — college basketball', () => {
  it('is basketball with two halves and the college court; OT is the third period', () => {
    const d = trim()
    expect(d.basketball).toMatchObject({ periods: 'halves', court: 'college' })
    expect(d.hockey).toBeNull()
    expect(d.baseball).toBeNull()
    expect(d.home).toMatchObject({ abbrev: 'UCLA', score: 95, linescores: [43, 43, 9] })
    expect(d.away).toMatchObject({ abbrev: 'ILL', rank: 10 })
    expect(GAME_VIEW_SPORTS).toContain('NCAAB')
  })

  it('keeps free throws — made and missed, both typed MadeFreeThrow with a real rim spot — off the chart', () => {
    const shots = trim().basketball!.shots
    expect(shots.map((s) => s.id)).toEqual(['three', 'miss2', 'ot'])
    expect(shots.find((s) => s.id === 'three')).toMatchObject({ x: 47, y: 6, made: true, value: 3, athleteId: 'wagler' })
  })

  it('last play skips the challenge and the end markers; substitutions are dropped', () => {
    const d = trim()
    expect(d.lastPlay?.text).toBe('Donovan Dent makes layup')
    expect(d.lastPlayAthleteIds).toEqual(['dent'])
    expect(d.basketball!.plays.map((p) => p.id)).not.toContain('sub')
  })

  it('leaders, team stats and the box score read like the NBA shape', () => {
    const d = trim()
    expect(d.leaders.away.map((l) => l.category)).toEqual(['points', 'rebounds', 'assists'])
    expect(d.teamStats.find((s) => s.key === 'fieldGoalsMade-fieldGoalsAttempted')).toMatchObject({ away: '28/69', home: '34/67' })
    const ill = d.basketball!.box.away!
    expect(ill.players.map((p) => `${p.athleteId}:${p.starter}:${p.didNotPlay}`)).toEqual([
      'wagler:true:false',
      'boswell:true:false',
      'ivisic:false:false',
      'walkon:false:true',
    ])
    expect(ill.players[3]!.reason).toBeNull()
    expect(d.players.wagler![0]!.group).toBe('basketball')
  })

  it('the college court follows the sport; the halves follow the data', () => {
    expect(trimEspnGameSummary(rawNcaab(), { ...NCAAB_OPTS, sport: 'NBA' })!.basketball!.court).toBe('pro')
    const quarters = rawNcaab()
    quarters.plays = quarters.plays.map((p) => (p.period ? { ...p, period: { number: p.period.number, displayValue: `${p.period.number}st Quarter` } } : p))
    expect(trimEspnGameSummary(quarters, NCAAB_OPTS)!.basketball!.periods).toBe('quarters')
  })
})
