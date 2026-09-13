import { describe, expect, it } from 'vitest'
import { GAME_VIEW_SPORTS, SPRAY_PLATE, trimEspnGameSummary } from '@/lib/live/espnGameSummary'
import { IDS, MLB_OPTS, rawMlb } from './fixtures/espn-mlb-summary'

const final = () => trimEspnGameSummary(rawMlb(), MLB_OPTS)!
const live = () => trimEspnGameSummary(rawMlb({ live: true }), MLB_OPTS)!
const byId = (d: ReturnType<typeof final>) => Object.fromEntries(d.baseball!.atBats.map((a) => [a.id.slice(-4), a]))

describe('trimEspnGameSummary — MLB', () => {
  it('is baseball, not basketball or hockey: the pitching group decides', () => {
    const d = final()
    expect(d.baseball).not.toBeNull()
    expect(d.basketball).toBeNull()
    expect(d.hockey).toBeNull()
    expect(GAME_VIEW_SPORTS).toContain('MLB')
  })

  it('groups plays into at-bats by atBatId; inning markers are not at-bats', () => {
    const atBats = final().baseball!.atBats
    expect(atBats.map((a) => a.id.slice(-4))).toEqual(['0001', '0002', '0101'])
    expect(atBats.map((a) => `${a.half}${a.inning}:${a.battingTeamId}`)).toEqual(['top1:27', 'top1:27', 'bottom1:6'])
    expect(atBats[0]).toMatchObject({ batterId: IDS.mccarthy, pitcherId: IDS.jobe, complete: true })
  })

  it('a strikeout after a foul has no batted ball, even though the foul and end marker carry spots', () => {
    const k = byId(final())['0001']!
    expect(k.battedBall).toBeNull()
    expect(k.result).toBe('McCarthy struck out swinging.')
    expect(k.resultType).toBe('Strikeout')
    expect(k.pitches.map((p) => p.kind)).toEqual(['strike', 'foul', 'strike'])
    expect(k.pitches[2]).toMatchObject({ number: 3, strikes: 3, velocity: 95, pitchType: 'Four-seam FB', x: 74, y: 200 })
  })

  it('places the home run in feet from the plate: the measured spot reads as 394 ft to right', () => {
    const hr = byId(final())['0002']!
    expect(hr.battedBall).toMatchObject({ kind: 'hr', trajectory: 'F', call: 'Home Run' })
    // The substitution logged after the end marker is an event, not the at-bat's result.
    expect(hr).toMatchObject({ result: 'Amador homered to right (394 feet).', resultType: 'Home Run' })
    expect(hr.events).toEqual(['Beck in left field.'])
    expect(hr.battedBall!.x).toBeGreaterThan(0)
    expect(Math.abs(Math.hypot(hr.battedBall!.x, hr.battedBall!.y) - 394)).toBeLessThan(1)
    expect(hr).toMatchObject({ scoring: true, awayScore: 1, homeScore: 0 })
    expect(SPRAY_PLATE).toEqual({ x: 125.5, y: 205.5, feetPerUnit: 2.37 })
  })

  it("the at-bat's result is its LAST play-result; the steal before it is an event", () => {
    const t = byId(final())['0101']!
    expect(t.result).toBe('McGonigle tripled to center, Peck scored.')
    expect(t.events).toEqual(['Peck stole second.'])
    expect(t.battedBall).toMatchObject({ kind: 'hit', x: 10.7, y: 344.8 })
    expect(t.resultType).toBe('Triple')
  })

  it('line score H/E, grouped team stats, box score and pitchers of record', () => {
    const d = final()
    const b = d.baseball!
    expect(b.hitsErrors).toEqual({ home: { hits: 1, errors: 1 }, away: { hits: 1, errors: 0 } })
    expect(d.teamStats.map((s) => `${s.key}=${s.away}/${s.home}`)).toEqual([
      'batting.hits=5/8',
      'batting.homeRuns=1/2',
      'fielding.errors=0/1',
    ])
    expect(b.box.away!.batting!.players.map((p) => `${p.shortName}:${p.batOrder}:${p.starter}:${p.position}`)).toEqual([
      'J. McCarthy:1:true:CF',
      'J. Beck:1:false:LF',
      'A. Amador:2:true:2B',
    ])
    expect(b.box.away!.pitching!.players[0]).toMatchObject({ athleteId: IDS.hughes, note: 'L, 0-8' })
    expect(b.box.home!.batting!.totals[1]).toBe('1')
    expect(b.decisions.map((x) => `${x.label}:${x.athleteId}:${x.teamId}`)).toEqual([
      `Winning Pitcher:${IDS.jobe}:6`,
      `Losing Pitcher:${IDS.hughes}:27`,
    ])
    expect(b.current).toBeNull()
    expect(d.players[IDS.mccarthy]![0]!.group).toBe('batting')
    expect(d.players[IDS.jobe]![0]!.group).toBe('pitching')
  })

  it('live: count, batter, pitcher and runners from situation; the at-bat in progress is incomplete', () => {
    const d = live()
    const b = d.baseball!
    expect(b.current).toEqual({
      balls: 1,
      strikes: 1,
      outs: 0,
      batterId: IDS.greene,
      pitcherId: IDS.hughes,
      on: { first: false, second: false, third: true },
      runners: { first: null, second: null, third: IDS.mcgonigle },
    })
    const up = b.atBats[b.atBats.length - 1]!
    expect(up).toMatchObject({ batterId: IDS.greene, complete: false, result: null, resultType: null })
    expect(up.events).toEqual(['Keith at third base.', 'Hughes threw a wild pitch.'])
    expect(up.pitches.map((p) => `${p.kind}@${p.x},${p.y}`)).toEqual(['strike@111,144', 'ball@182,230'])
    // The last play is the last at-bat WITH a result, not the pitch in progress.
    expect(d.lastPlay).toMatchObject({ text: 'McGonigle tripled to center, Peck scored.', scoring: true })
    expect(d.lastPlayAthleteIds).toEqual([IDS.mcgonigle, IDS.hughes])
  })
})
