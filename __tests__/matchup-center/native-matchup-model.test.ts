/**
 * The Matchup tab of a league that plays on AllFantasy: which season, which week, whose team, and
 * which games a week holds. Pure rules; the reads are tested in native-matchup-center-service.test.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  buildNativeBoard,
  buildNativeStarters,
  gamesForRoster,
  isByeWeek,
  nativeGameStatus,
  nativeMatchupWeek,
  pickNativeSeason,
  pickViewerRosterId,
  regularGameStatus,
  type NativeWeekGame,
} from '@/lib/matchup-center/nativeMatchupModel'

const game = (over: Partial<NativeWeekGame> & { id: string }): NativeWeekGame => ({
  kind: 'regular',
  label: null,
  homeRosterId: 'A',
  awayRosterId: 'B',
  homeScore: 0,
  awayScore: 0,
  status: 'upcoming',
  ...over,
})

describe('nativeGameStatus', () => {
  it('reads the score sync’s "active" as live, and anything unknown as not started', () => {
    expect(nativeGameStatus('final')).toBe('final')
    expect(nativeGameStatus('active')).toBe('live')
    expect(nativeGameStatus('in_progress')).toBe('live')
    expect(nativeGameStatus('scheduled')).toBe('upcoming')
    expect(nativeGameStatus(null)).toBe('upcoming')
  })
})

describe('regularGameStatus', () => {
  it('🛑 a points game the sync has touched but nobody has scored in has not started', () => {
    expect(regularGameStatus({ status: 'active', homeScore: 0, awayScore: 0, pointsLeague: true })).toBe('upcoming')
  })
  it('one point on either side and it is live', () => {
    expect(regularGameStatus({ status: 'active', homeScore: 0.5, awayScore: 0, pointsLeague: true })).toBe('live')
    expect(regularGameStatus({ status: 'active', homeScore: 0, awayScore: -1, pointsLeague: true })).toBe('live')
  })
  it('a final 0 - 0 stays final, and a category league keeps its own status', () => {
    expect(regularGameStatus({ status: 'final', homeScore: 0, awayScore: 0, pointsLeague: true })).toBe('final')
    expect(regularGameStatus({ status: 'active', homeScore: 0, awayScore: 0, pointsLeague: false })).toBe('live')
  })
})

describe('pickNativeSeason', () => {
  const s2026 = { season: 2026, currentWeek: 14 }
  const s2027 = { season: 2027, currentWeek: 0 }
  it('takes the year asked for when the league has it', () => {
    expect(pickNativeSeason([s2026, s2027], 2027)).toBe(s2027)
    expect(pickNativeSeason([s2026, s2027], 2026)).toBe(s2026)
  })
  it('otherwise the newest season that has started, so a rolled-over league keeps the one it played', () => {
    expect(pickNativeSeason([s2026, s2027], 2030)).toBe(s2026)
    expect(pickNativeSeason([s2026, s2027], null)).toBe(s2026)
  })
  it('falls back to the newest season when none has started, and to null when there is none', () => {
    expect(pickNativeSeason([{ season: 2026, currentWeek: 0 }, s2027], null)).toBe(s2027)
    expect(pickNativeSeason([], 2026)).toBeNull()
  })
})

describe('nativeMatchupWeek', () => {
  it('opens on the season’s own week, never on week 1 by default', () => {
    expect(nativeMatchupWeek(undefined, 7)).toBe(7)
    expect(nativeMatchupWeek(null, 2)).toBe(2)
  })
  it('a week the manager picked wins', () => {
    expect(nativeMatchupWeek(3, 7)).toBe(3)
  })
  it('a season that has not started, or a bad week, is week 1', () => {
    expect(nativeMatchupWeek(undefined, 0)).toBe(1)
    expect(nativeMatchupWeek(0, null)).toBe(1)
    expect(nativeMatchupWeek(2.5, 4)).toBe(4)
  })
})

describe('pickViewerRosterId', () => {
  const rosters = [
    { id: 'r1', ownerId: 'u1', managerUserId: null },
    { id: 'r9', ownerId: 'u2:team-2', managerUserId: 'u2' },
    { id: 'r3', ownerId: 'u2', managerUserId: null },
    { id: 'r4', ownerId: 'u5:team-2', managerUserId: 'u5' },
  ]
  it('the manager’s own team first', () => {
    expect(pickViewerRosterId(rosters, 'u2')).toBe('r3')
  })
  it('a manager who only runs an extra team gets that team', () => {
    expect(pickViewerRosterId(rosters, 'u5')).toBe('r4')
  })
  it('null for someone with no team (a commissioner who does not play)', () => {
    expect(pickViewerRosterId(rosters, 'nobody')).toBeNull()
  })
})

describe('a week’s games', () => {
  const games = [
    game({ id: 'g1', homeRosterId: 'A', awayRosterId: 'B' }),
    game({ id: 'g2', homeRosterId: 'C', awayRosterId: 'A' }),
    game({ id: 'g3', homeRosterId: 'D', awayRosterId: null }),
  ]
  it('a team that plays twice in a week has two games, in the schedule’s order', () => {
    expect(gamesForRoster(games, 'A').map((g) => g.id)).toEqual(['g1', 'g2'])
  })
  it('a bye is not a game', () => {
    expect(gamesForRoster(games, 'D')).toEqual([])
    expect(isByeWeek(games, 'D')).toBe(true)
    expect(isByeWeek(games, 'A')).toBe(false)
    // No row at all is not a bye: nothing is scheduled for that team.
    expect(isByeWeek(games, 'Z')).toBe(false)
  })
})

describe('buildNativeBoard', () => {
  const names: Record<string, string> = { A: 'Aces', B: 'Bears', C: 'Cubs', D: 'Ducks' }
  const nameOf = (id: string) => names[id] ?? 'Team'
  it('one line per game, the viewer’s first and byes last', () => {
    const board = buildNativeBoard(
      [
        game({ id: 'bye', homeRosterId: 'E', awayRosterId: null }),
        game({ id: 'g1', homeRosterId: 'A', awayRosterId: 'B', homeScore: 101.5, awayScore: 99, status: 'final' }),
        game({ id: 'g2', homeRosterId: 'C', awayRosterId: 'D', homeScore: 50, awayScore: 60, status: 'live' }),
      ],
      nameOf,
      'D',
    )
    expect(board.map((g) => g.id)).toEqual(['g2', 'g1', 'bye'])
    expect(board[0]).toMatchObject({ mine: true, status: 'live', home: { teamName: 'Cubs', totalPoints: 50 }, away: { teamName: 'Ducks', totalPoints: 60 } })
    expect(board[2].away).toBeNull()
  })
  it('🛑 a game that has not started shows no score, never 0.0', () => {
    const [g] = buildNativeBoard([game({ id: 'g1' })], nameOf, null)
    expect(g.home.totalPoints).toBeNull()
    expect(g.away?.totalPoints).toBeNull()
    expect(g.mine).toBe(false)
  })
})

describe('buildNativeStarters', () => {
  const players = [
    { playerId: 'p-wr', playerName: 'Wide Out', position: 'WR', team: 'DAL', slotType: 'WR' },
    { playerId: 'p-qb', playerName: 'Quarter Back', position: 'QB', team: 'KC', slotType: 'QB' },
    { playerId: 'p-bn', playerName: 'Bench Guy', position: 'RB', team: 'NYG', slotType: 'bench' },
    { playerId: 'p-gone', playerName: 'Dropped Since', position: 'RB', team: 'SF', slotType: 'RB' },
  ]
  it('a scored week draws the lineup the scoring counted, with its points, in lineup order', () => {
    const rows = buildNativeStarters({
      players,
      // Today's lineup has the bench player starting: it must not rewrite a week already played.
      currentStarterIds: new Set(['p-bn', 'p-qb']),
      scores: [
        { playerId: 'p-wr', points: 14.2, isStarter: true },
        { playerId: 'p-gone', points: 9, isStarter: true },
        { playerId: 'p-qb', points: 22.4, isStarter: true },
        { playerId: 'p-bn', points: 30, isStarter: false },
      ],
    })
    expect(rows.map((r) => [r.name, r.points])).toEqual([
      ['Quarter Back', 22.4],
      ['Dropped Since', 9],
      ['Wide Out', 14.2],
    ])
  })
  it('a week not scored yet draws today’s starters with no points', () => {
    const rows = buildNativeStarters({ players, currentStarterIds: new Set(['p-wr', 'p-qb']), scores: null })
    expect(rows.map((r) => [r.playerId, r.points])).toEqual([
      ['p-qb', null],
      ['p-wr', null],
    ])
  })
  it('a scored player nobody can name still gets a row', () => {
    const rows = buildNativeStarters({ players: [], currentStarterIds: new Set(), scores: [{ playerId: 'x', points: 3, isStarter: true }] })
    expect(rows).toEqual([{ playerId: 'x', name: 'Player', position: 'FLEX', team: null, points: 3 }])
  })
})
