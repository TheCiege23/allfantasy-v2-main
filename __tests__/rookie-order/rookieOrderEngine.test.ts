import { describe, expect, it } from 'vitest'
import {
  computeRookieOrder,
  type RookieOrderPlayoffGame,
  type RookieOrderTeam,
} from '@/lib/rookie-order/rookieOrderEngine'
import { playoffGamesFromRedraftMatchups, playoffGamesFromSleeperBracket } from '@/lib/rookie-order/playoffGameAdapters'

function team(id: string, o: Partial<RookieOrderTeam> = {}): RookieOrderTeam {
  return { teamId: id, name: id, wins: 7, losses: 7, ties: 0, pointsFor: 1500, maxPf: 1700, playoffSeed: null, ...o }
}

/** 12 teams, 6 make it. Non-playoff max PF deliberately disagrees with points for. */
function league(): RookieOrderTeam[] {
  return [
    team('n1', { maxPf: 1400, pointsFor: 1390, wins: 5 }),
    team('n2', { maxPf: 1300, pointsFor: 1420, wins: 3 }),
    team('n3', { maxPf: 1500, pointsFor: 1300, wins: 6 }),
    team('n4', { maxPf: 1350, pointsFor: 1450, wins: 4 }),
    team('n5', { maxPf: 1600, pointsFor: 1380, wins: 6 }),
    team('n6', { maxPf: 1450, pointsFor: 1400, wins: 2 }),
    team('s1', { playoffSeed: 1 }),
    team('s2', { playoffSeed: 2 }),
    team('s3', { playoffSeed: 3 }),
    team('s4', { playoffSeed: 4 }),
    team('s5', { playoffSeed: 5 }),
    team('s6', { playoffSeed: 6 }),
  ]
}

const g = (round: number, a: string | null, b: string | null, winner: string | null = null): RookieOrderPlayoffGame => ({
  round,
  kind: 'championship',
  teamA: a,
  teamB: b,
  winner,
})

// Seeds 1-2 bye. QF: 3v6 (3 wins), 4v5 (4 wins). SF: 1v4 (4 wins), 2v3 (2 wins). Final: 2v4 (2 wins).
const qf = [g(1, 's3', 's6', 's3'), g(1, 's4', 's5', 's4')]
const sf = [g(2, 's1', 's4', 's4'), g(2, 's2', 's3', 's2')]
const fin = [g(3, 's2', 's4', 's2')]

const ids = (r: ReturnType<typeof computeRookieOrder>) => r.slots.map((s) => s.teamId)
const status = (r: ReturnType<typeof computeRookieOrder>) => r.slots.map((s) => s.status[0]).join('')

describe('computeRookieOrder — the season as it happens', () => {
  it('during the regular season everything is a provisional projection', () => {
    const r = computeRookieOrder({ teams: league(), regularSeasonComplete: false, playoffGames: [] })
    expect(r.phase).toBe('regular_season')
    expect(r.slots.every((s) => s.status === 'provisional')).toBe(true)
    expect(r.slots[0].teamId).toBe('n2') // lowest max PF in the league
  })

  it('end of regular season: non-playoff teams lock by reverse TRUE max PF, playoff teams provisional by worse seed', () => {
    const r = computeRookieOrder({ teams: league(), regularSeasonComplete: true, playoffGames: [g(1, 's3', 's6'), g(1, 's4', 's5')] })
    expect(r.phase).toBe('playoffs')
    expect(r.maxPfSource).toBe('max_pf')
    expect(ids(r)).toEqual(['n2', 'n4', 'n1', 'n6', 'n3', 'n5', 's6', 's5', 's4', 's3', 's2', 's1'])
    expect(status(r)).toBe('llllllpppppp')
  })

  it('after the quarterfinals the two losers lock, worse seed first', () => {
    const r = computeRookieOrder({ teams: league(), regularSeasonComplete: true, playoffGames: [...qf, g(2, 's1', 's4'), g(2, 's2', 's3')] })
    expect(ids(r).slice(6)).toEqual(['s6', 's5', 's4', 's3', 's2', 's1'])
    expect(status(r).slice(6)).toBe('llpppp')
    expect(r.slots[6].finish).toBe('Lost in Quarterfinal')
  })

  it('after the semifinals the losers lock — seed 3 before seed 1 even though seed 1 lost to a lower seed', () => {
    const r = computeRookieOrder({ teams: league(), regularSeasonComplete: true, playoffGames: [...qf, ...sf, g(3, 's2', 's4')] })
    expect(ids(r).slice(6)).toEqual(['s6', 's5', 's3', 's1', 's4', 's2'])
    expect(status(r).slice(6)).toBe('llllpp')
  })

  it('after the final: runner-up second to last, champion last, phase final, everything locked', () => {
    const r = computeRookieOrder({ teams: league(), regularSeasonComplete: true, playoffGames: [...qf, ...sf, ...fin] })
    expect(r.phase).toBe('final')
    expect(ids(r).slice(6)).toEqual(['s6', 's5', 's3', 's1', 's4', 's2'])
    expect(r.slots[10].finish).toBe('Runner-up')
    expect(r.slots[11]).toMatchObject({ teamId: 's2', finish: 'Champion', status: 'locked', slot: 12 })
    expect(r.slots.every((s) => s.status === 'locked')).toBe(true)
  })
})

describe('computeRookieOrder — options and edge cases', () => {
  it('a decided 3rd-place game orders the semifinal losers by finish, overriding seed', () => {
    const third: RookieOrderPlayoffGame = { round: 3, kind: 'placement', place: 3, teamA: 's1', teamB: 's3', winner: 's3' }
    const r = computeRookieOrder({ teams: league(), regularSeasonComplete: true, playoffGames: [...qf, ...sf, ...fin, third] })
    // s1 finished 4th, so it picks before 3rd-place s3.
    expect(ids(r).slice(8, 10)).toEqual(['s1', 's3'])
    expect(r.slots[8].finish).toBe('4th place')
  })

  it('an undecided 3rd-place game keeps the semifinal losers provisional', () => {
    const third: RookieOrderPlayoffGame = { round: 3, kind: 'placement', place: 3, teamA: 's1', teamB: 's3', winner: null }
    const r = computeRookieOrder({ teams: league(), regularSeasonComplete: true, playoffGames: [...qf, ...sf, third] })
    expect(status(r).slice(8, 10)).toBe('pp')
  })

  it('a 3rd-place game recorded as a bracket game is not treated as a second title game', () => {
    const legacyThird = g(3, 's1', 's3', 's3')
    const r = computeRookieOrder({ teams: league(), regularSeasonComplete: true, playoffGames: [...qf, ...sf, ...fin, legacyThird] })
    expect(r.phase).toBe('final')
    expect(r.slots[11].teamId).toBe('s2')
    expect(r.warnings).toEqual([])
  })

  it('withinRound reverse_max_pf orders same-round losers by max PF', () => {
    const teams = league().map((t) => (t.teamId === 's6' ? { ...t, maxPf: 1900 } : t.teamId === 's5' ? { ...t, maxPf: 1600 } : t))
    const r = computeRookieOrder({
      teams,
      regularSeasonComplete: true,
      playoffGames: qf,
      config: { withinRound: 'reverse_max_pf' },
    })
    expect(ids(r).slice(6, 8)).toEqual(['s5', 's6'])
  })

  it('falls back to points for for EVERY team when any max PF is missing, and says so', () => {
    const teams = league().map((t) => (t.teamId === 'n5' ? { ...t, maxPf: null } : t))
    const r = computeRookieOrder({ teams, regularSeasonComplete: true, playoffGames: [] })
    expect(r.maxPfSource).toBe('points_for')
    expect(r.warnings[0]).toMatch(/points for/)
    expect(ids(r).slice(0, 6)).toEqual(['n3', 'n5', 'n1', 'n6', 'n2', 'n4'])
  })

  it('reverse_record for non-playoff teams', () => {
    const r = computeRookieOrder({ teams: league(), regularSeasonComplete: true, playoffGames: [], config: { nonPlayoff: 'reverse_record' } })
    expect(ids(r).slice(0, 3)).toEqual(['n6', 'n2', 'n4'])
  })

  it('playoff: reverse_max_pf ignores playoff results', () => {
    const teams = league().map((t) => (t.playoffSeed ? { ...t, maxPf: 2000 - t.playoffSeed * 10 } : t))
    const r = computeRookieOrder({ teams, regularSeasonComplete: true, playoffGames: [...qf, ...sf, ...fin], config: { playoff: 'reverse_max_pf' } })
    expect(r.phase).toBe('final')
    expect(ids(r).slice(6)).toEqual(['s6', 's5', 's4', 's3', 's2', 's1'])
  })

  it('a 5-team bracket with a play-in: #4 v #5, then 1 v W, 2 v 3', () => {
    const teams = [team('a', { playoffSeed: 1 }), team('b', { playoffSeed: 2 }), team('c', { playoffSeed: 3 }), team('d', { playoffSeed: 4 }), team('e', { playoffSeed: 5 }), team('x', { maxPf: 1000 })]
    const games = [g(1, 'd', 'e', 'd'), g(2, 'a', 'd', 'a'), g(2, 'b', 'c', 'c'), g(3, 'a', 'c', 'c')]
    const r = computeRookieOrder({ teams, regularSeasonComplete: true, playoffGames: games })
    expect(ids(r)).toEqual(['x', 'e', 'd', 'b', 'a', 'c'])
    expect(r.slots.map((s) => s.finish)).toEqual([null, 'Lost in Quarterfinal', 'Lost in Semifinal', 'Lost in Semifinal', 'Runner-up', 'Champion'])
  })

  it('is deterministic on exact ties (teamId breaks them)', () => {
    const teams = [team('b'), team('a'), team('c')]
    const r = computeRookieOrder({ teams, regularSeasonComplete: true, playoffGames: [] })
    expect(ids(r)).toEqual(['a', 'b', 'c'])
  })
})

describe('playoff game adapters', () => {
  it('Sleeper: p=1 is the title game, p>1 is a placement game, unmapped rosters become null', () => {
    const games = playoffGamesFromSleeperBracket(
      [
        { r: 3, m: 7, t1: 2, t2: 4, w: 2, l: 4, p: 1 },
        { r: 3, m: 8, t1: 1, t2: 3, w: 3, l: 1, p: 3 },
        { r: 1, m: 1, t1: 9, t2: 6, w: 9, l: 6 },
      ],
      (id) => (id === 9 ? null : `s${id}`),
    )
    expect(games).toEqual([
      { round: 3, kind: 'championship', place: null, teamA: 's2', teamB: 's4', winner: 's2' },
      { round: 3, kind: 'placement', place: 3, teamA: 's1', teamB: 's3', winner: 's3' },
      { round: 1, kind: 'championship', place: null, teamA: null, teamB: 's6', winner: null },
    ])
  })

  it('native: drops consolation games, maps third_place to a 3rd-place placement game', () => {
    const games = playoffGamesFromRedraftMatchups([
      { roundNumber: 2, homeRosterId: 'a', awayRosterId: 'b', winnerRosterId: 'a', metadata: { bracketType: 'championship' } },
      { roundNumber: 2, homeRosterId: 'c', awayRosterId: 'd', winnerRosterId: null, metadata: { bracketType: 'third_place' } },
      { roundNumber: 101, homeRosterId: 'e', awayRosterId: 'f', winnerRosterId: 'e', metadata: { bracketType: 'consolation' } },
    ])
    expect(games).toEqual([
      { round: 2, kind: 'championship', place: null, teamA: 'a', teamB: 'b', winner: 'a' },
      { round: 2, kind: 'placement', place: 3, teamA: 'c', teamB: 'd', winner: null },
    ])
  })
})
