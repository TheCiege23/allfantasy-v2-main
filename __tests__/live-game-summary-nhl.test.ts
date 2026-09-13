import { describe, expect, it } from 'vitest'
import { GAME_VIEW_SPORTS, hockeyAttackSigns, trimEspnGameSummary } from '@/lib/live/espnGameSummary'

/*
 * A hand-cut subset of ESPN's NHL summary for LA @ BOS (401803363, Final/OT),
 * keeping the field names and values measured on 2026-09-13. BOS home (1), LA
 * away (8). BOS shoots at +x in P1/P3 and −x in P2/OT; LA the mirror — which is
 * what the real game showed, including the overtime winner at x −83.
 */
function rawNhl() {
  const athlete = (id: string, displayName: string, shortName: string, position: string) => ({
    id,
    displayName,
    shortName,
    jersey: '1',
    position: { abbreviation: position },
  })
  const play = (o: Record<string, unknown>) => ({ participants: [], strength: { text: 'Even Strength' }, ...o })
  const skaterLabels = ['BS', 'HT', 'TK', '+/-', 'TOI', 'PPTOI', 'SHTOI', 'ESTOI', 'SHFT', 'G', 'YTDG', 'A', 'S', 'SM', 'SOG', 'FW', 'FL', 'FO%', 'GV', 'PN', 'PIM']
  const goalieLabels = ['GA', 'SA', 'SOS', 'SOSA', 'SV', 'SV%', 'ESSV', 'PPSV', 'SHSV', 'TOI', 'YTDG', 'PIM']
  return {
    header: {
      competitions: [
        {
          status: { type: { state: 'post', shortDetail: 'Final/OT' }, period: 4, displayClock: '0:00' },
          competitors: [
            { homeAway: 'home', score: '2', team: { id: '1', abbreviation: 'BOS', displayName: 'Boston Bruins', color: '231f20' }, record: [{ type: 'total', summary: '36-22-6' }], linescores: ['0', '0', '1', '1'].map((v) => ({ displayValue: v })) },
            { homeAway: 'away', score: '1', team: { id: '8', abbreviation: 'LA', displayName: 'Los Angeles Kings', color: '121212' }, record: [{ type: 'total', summary: '26-23-15' }], linescores: ['0', '0', '1', '0'].map((v) => ({ displayValue: v })) },
          ],
        },
      ],
    },
    leaders: [
      { team: { id: '1' }, leaders: [{ name: 'goals', displayName: 'Goals', leaders: [{ displayValue: '1', value: 1, athlete: { id: 'mcavoy', displayName: 'Charlie McAvoy', shortName: 'C. McAvoy', position: { abbreviation: 'D' } } }] }] },
    ],
    boxscore: {
      teams: [
        { team: { id: '1' }, statistics: [{ name: 'shotsTotal', displayValue: '23' }, { name: 'faceoffPercent', displayValue: '55.1' }, { name: 'hits', displayValue: '21' }] },
        { team: { id: '8' }, statistics: [{ name: 'shotsTotal', displayValue: '16' }, { name: 'faceoffPercent', displayValue: '44.9' }, { name: 'hits', displayValue: '22' }] },
      ],
      players: [
        {
          team: { id: '1' },
          statistics: [
            { name: 'forwards', labels: skaterLabels, athletes: [{ athlete: athlete('pasta', 'David Pastrnak', 'D. Pastrnak', 'RW'), stats: ['0', '1', '0', '1', '21:10', '0', '0', '0', '24', '0', '40', '1', '4', '1', '4', '0', '0', '0.0', '1', '0', '0'] }] },
            { name: 'defenses', labels: skaterLabels, athletes: [{ athlete: athlete('mcavoy', 'Charlie McAvoy', 'C. McAvoy', 'D'), stats: ['2', '1', '0', '1', '24:00', '0', '0', '0', '28', '1', '7', '0', '3', '1', '3', '0', '0', '0.0', '0', '0', '0'] }] },
            { name: 'skaters', labels: skaterLabels, athletes: [] },
            { name: 'goalies', labels: goalieLabels, athletes: [{ athlete: athlete('swayman', 'Jeremy Swayman', 'J. Swayman', 'G'), stats: ['1', '16', '0', '0', '15', '.938', '14', '1', '0', '61:34', '0', '0'] }] },
          ],
        },
        {
          team: { id: '8' },
          statistics: [
            { name: 'forwards', labels: skaterLabels, athletes: [] },
            { name: 'defenses', labels: skaterLabels, athletes: [{ athlete: athlete('doughty', 'Drew Doughty', 'D. Doughty', 'D'), stats: ['1', '0', '0', '0', '25:00', '0', '0', '0', '30', '1', '4', '0', '2', '0', '2', '0', '0', '0.0', '0', '0', '2'] }] },
            { name: 'goalies', labels: goalieLabels, athletes: [{ athlete: athlete('kuemper', 'Darcy Kuemper', 'D. Kuemper', 'G'), stats: ['2', '23', '0', '0', '21', '.913', '18', '3', '0', '60:18', '0', '0'] }] },
          ],
        },
      ],
    },
    plays: [
      play({ id: 'ps', type: { text: 'Period Start' }, text: 'Start of 1st Period', period: { number: 1 }, clock: { displayValue: '20:00' } }),
      play({ id: 'b1', type: { text: 'Shot' }, text: 'David Pastrnak Wrist Shot saved by Darcy Kuemper', period: { number: 1 }, clock: { displayValue: '15:00' }, team: { id: '1' }, shootingPlay: true, coordinate: { x: 70, y: 10 }, participants: [{ athlete: { id: 'pasta' }, type: 'shooter' }, { athlete: { id: 'kuemper' }, type: 'saver' }] }),
      play({ id: 'l1', type: { text: 'Missed' }, text: 'Drew Doughty Wide of Net', period: { number: 1 }, clock: { displayValue: '12:00' }, team: { id: '8' }, shootingPlay: true, coordinate: { x: -60, y: -5 }, participants: [{ athlete: { id: 'doughty' }, type: 'shooter' }] }),
      play({ id: 'st', type: { text: 'Stoppage' }, text: 'Icing', period: { number: 1 }, clock: { displayValue: '11:00' }, coordinate: { x: 0, y: 0 } }),
      play({ id: 'b2', type: { text: 'Shot' }, text: 'David Pastrnak Snap Shot saved by Darcy Kuemper', period: { number: 2 }, clock: { displayValue: '9:00' }, team: { id: '1' }, shootingPlay: true, coordinate: { x: -75, y: 12 }, participants: [{ athlete: { id: 'pasta' }, type: 'shooter' }] }),
      play({ id: 'l3', type: { text: 'Goal' }, text: 'Drew Doughty Goal (4) Slap Shot', period: { number: 3 }, clock: { displayValue: '5:00' }, team: { id: '8' }, shootingPlay: true, scoringPlay: true, awayScore: 1, homeScore: 1, coordinate: { x: -30, y: 33 }, participants: [{ athlete: { id: 'doughty' }, type: 'scorer' }] }),
      play({ id: 'pen', type: { text: 'Tripping' }, text: 'Drew Doughty Tripping against David Pastrnak', period: { number: 3 }, clock: { displayValue: '3:00' }, team: { id: '8' }, coordinate: { x: 10, y: 5 }, strength: { text: 'Power Play' } }),
      play({ id: 'ot', type: { text: 'Goal' }, text: 'Charlie McAvoy Goal (7) Backhand, assists: David Pastrnak (53)', period: { number: 4 }, clock: { displayValue: '1:12' }, team: { id: '1' }, shootingPlay: true, scoringPlay: true, awayScore: 1, homeScore: 2, coordinate: { x: -83, y: -2 }, participants: [{ athlete: { id: 'mcavoy' }, type: 'scorer' }, { athlete: { id: 'pasta' }, type: 'assister' }] }),
      play({ id: 'pe', type: { text: 'Period End' }, text: 'End of OT', period: { number: 4 }, clock: { displayValue: '0:00' } }),
      play({ id: 'eg', type: { text: 'End of Game' }, text: 'Game End', period: { number: 4 }, clock: { displayValue: '0:00' } }),
    ],
    gameInfo: { venue: { fullName: 'TD Garden', address: { city: 'Boston', state: 'MA' } }, attendance: 17850 },
  }
}

const opts = { sport: 'NHL', gameId: '401803363', fetchedAt: '2026-09-13T20:00:00.000Z' }

describe('hockeyAttackSigns', () => {
  it('pools regulation periods: a shot at −x in P2 is a vote for +x in P1', () => {
    const signs = hockeyAttackSigns([
      { teamId: 'A', period: 1, x: 60 },
      { teamId: 'A', period: 2, x: -70 },
      { teamId: 'A', period: 3, x: 50 },
      { teamId: 'B', period: 1, x: -40 },
      { teamId: 'B', period: 2, x: 30 },
    ])
    expect(signs.get('A')).toBe(1)
    expect(signs.get('B')).toBe(-1)
  })

  it('ignores overtime as evidence', () => {
    // Three OT shots pointing the "wrong" way must not flip a team decided in regulation.
    const signs = hockeyAttackSigns([
      { teamId: 'A', period: 1, x: 60 },
      { teamId: 'A', period: 4, x: 60 },
      { teamId: 'A', period: 4, x: 60 },
      { teamId: 'A', period: 4, x: 60 },
    ])
    expect(signs.get('A')).toBe(1)
  })
})

describe('trimEspnGameSummary — NHL', () => {
  it('is hockey, not basketball: goalies group decides, and there is no drive', () => {
    const d = trimEspnGameSummary(rawNhl(), opts)!
    expect(d.hockey).not.toBeNull()
    expect(d.basketball).toBeNull()
    expect(d.drive).toBeNull()
    expect(d.home.linescores).toEqual([0, 0, 1, 1])
  })

  it('normalises every shot to the attacked net: the P2 shot and the OT winner flip to +x', () => {
    const shots = trimEspnGameSummary(rawNhl(), opts)!.hockey!.shots
    const byId = Object.fromEntries(shots.map((s) => [s.id, s]))
    expect(byId.b1).toMatchObject({ x: 70, y: 10, kind: 'shot' })
    expect(byId.b2).toMatchObject({ x: 75, y: -12 })
    expect(byId.l1).toMatchObject({ x: 60, y: 5, kind: 'missed' })
    expect(byId.l3).toMatchObject({ x: 30, y: -33, kind: 'goal' })
    // The measured overtime winner: x −83 in the raw feed, 83 from centre ice toward the net.
    expect(byId.ot).toMatchObject({ x: 83, y: 2, kind: 'goal' })
    // Penalties and stoppages are not shots.
    expect(Object.keys(byId)).not.toContain('pen')
  })

  it('drops stoppages from plays; the last play skips period end / game end and names its players', () => {
    const d = trimEspnGameSummary(rawNhl(), opts)!
    expect(d.hockey!.plays.map((p) => p.id)).not.toContain('st')
    expect(d.lastPlay?.text).toMatch(/McAvoy Goal/)
    expect(d.lastPlayAthleteIds).toEqual(['mcavoy', 'pasta'])
    expect(d.hockey!.plays.find((p) => p.id === 'pen')?.strength).toBe('Power Play')
  })

  it('box score: forwards then defense as skaters, goalies separately, per side', () => {
    const box = trimEspnGameSummary(rawNhl(), opts)!.hockey!.box
    expect(box.home!.skaters.map((s) => `${s.unit}:${s.athleteId}`)).toEqual(['F:pasta', 'D:mcavoy'])
    expect(box.home!.goalies.map((g) => g.athleteId)).toEqual(['swayman'])
    expect(box.away!.goalies[0]?.stats[box.away!.goalieLabels.indexOf('SV%')]).toBe('.913')
  })

  it('uses hockey team stats and a leader without mainStat still shows its number', () => {
    const d = trimEspnGameSummary(rawNhl(), opts)!
    expect(d.teamStats.map((s) => s.key)).toEqual(['shotsTotal', 'faceoffPercent', 'hits'])
    expect(d.leaders.home[0]).toMatchObject({ category: 'goals', mainValue: '1', summary: null })
  })

  it('NHL is a covered game-view sport', () => {
    expect(GAME_VIEW_SPORTS).toContain('NHL')
  })
})
