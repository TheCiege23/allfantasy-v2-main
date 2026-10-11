import { describe, expect, it } from 'vitest'

import { foldInjuryTeam, matchInjuryRowsToPlayers } from '@/lib/injuries/matchInjuryRows'

/*
 * Shared names, measured live 2026-10-11. The Vikings WR Justin Jefferson was Questionable while a
 * Browns LB of the same name had an ESPN "Active" row; Jaylon Jones was Out for Jacksonville and
 * Active for Tennessee. A name-keyed reader taking the newest row hands one the other's status.
 */
const rows = [
  { id: 'lb', playerName: 'Justin Jefferson', team: 'Cleveland Browns', position: 'LB', status: 'Active' },
  { id: 'wr-ri', playerName: 'Justin Jefferson', team: 'Minnesota Vikings', position: null, status: 'Questionable' },
  { id: 'wr-espn', playerName: 'Justin Jefferson', team: 'Minnesota Vikings', position: 'WR', status: 'Questionable' },
  { id: 'odunze', playerName: 'Rome Odunze', team: 'Chicago Bears', position: 'WR', status: 'Active' },
  { id: 'odunze-noteam', playerName: 'Rome Odunze', team: null, position: null, status: 'Active' },
]
const ids = (m: ReturnType<typeof matchInjuryRowsToPlayers<(typeof rows)[number]>>, name: string) =>
  m.byPlayer.get(name)?.map((r) => r.id)

describe('matchInjuryRowsToPlayers', () => {
  it('🛑 a shared name with no team or position is REFUSED, not guessed', () => {
    const m = matchInjuryRowsToPlayers(rows, [{ name: 'Justin Jefferson' }], 'NFL')
    expect(m.byPlayer.has('justin jefferson')).toBe(false)
    expect(m.ambiguous).toEqual(['Justin Jefferson'])
  })

  it('a roster team code picks the right athlete against a feed\'s full team name', () => {
    const wr = matchInjuryRowsToPlayers(rows, [{ name: 'Justin Jefferson', team: 'MIN' }], 'NFL')
    expect(ids(wr, 'justin jefferson')).toEqual(['wr-ri', 'wr-espn'])
    const lb = matchInjuryRowsToPlayers(rows, [{ name: 'Justin Jefferson', team: 'CLE' }], 'NFL')
    expect(ids(lb, 'justin jefferson')).toEqual(['lb'])
  })

  it('position alone separates them when the caller has no team', () => {
    const m = matchInjuryRowsToPlayers(rows, [{ name: 'Justin Jefferson', position: 'lb' }], 'NFL')
    expect(ids(m, 'justin jefferson')).toEqual(['lb'])
  })

  it('a unique name binds with no team at all, and a team-less row joins its only candidate', () => {
    const m = matchInjuryRowsToPlayers(rows, [{ name: 'Rome Odunze' }], 'NFL')
    expect(ids(m, 'rome odunze')).toEqual(['odunze', 'odunze-noteam'])
  })

  it('a name nobody reported is simply absent (no news), not ambiguous', () => {
    const m = matchInjuryRowsToPlayers(rows, [{ name: 'Percy Butler', team: 'WAS' }], 'NFL')
    expect(m.byPlayer.size).toBe(0)
    expect(m.ambiguous).toEqual([])
  })
})

describe('foldInjuryTeam', () => {
  it('folds NFL names and codes to one code, and leaves other sports verbatim upper-cased', () => {
    expect(foldInjuryTeam('Minnesota Vikings', 'NFL')).toBe('MIN')
    expect(foldInjuryTeam('min', 'nfl')).toBe('MIN')
    expect(foldInjuryTeam('Florida Panthers', 'NHL')).toBe('FLORIDA PANTHERS')
    expect(foldInjuryTeam('  ', 'NFL')).toBeNull()
  })
})
