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

describe('injuryStatusLookup', () => {
  it('returns the newest status of THIS athlete, and nothing for a shared name it cannot split', async () => {
    const { injuryStatusLookup } = await import('@/lib/injuries/matchInjuryRows')
    const statusOf = injuryStatusLookup(rows, 'NFL')
    expect(statusOf({ name: 'Justin Jefferson', team: 'MIN', position: 'WR' })).toBe('Questionable')
    expect(statusOf({ name: 'Justin Jefferson', team: 'CLE' })).toBe('Active')
    expect(statusOf({ name: 'Justin Jefferson' })).toBeNull()
  })
})

/*
 * 🛑 THE FEED LISTS ONLY THE ATHLETES IT REPORTS ON (2026-10-11). WR DeVonta Smith (PHI) was Out and
 * CB DeVonta Smith (CAR) had no row, so the name looked unique and the corner read as Out. A lone
 * candidate whose club or side of the ball contradicts the lookup is somebody else.
 */
describe('a lone namesake on the report', () => {
  const only = [{ id: 'wr', playerName: 'DeVonta Smith', team: 'Philadelphia Eagles', position: 'WR', status: 'Out' }]

  it('is not bound to the other club', () => {
    const m = matchInjuryRowsToPlayers(only, [{ name: 'DeVonta Smith', team: 'CAR', position: 'CB' }], 'NFL')
    expect(m.byPlayer.has('devonta smith')).toBe(false)
    expect(m.ambiguous).toEqual([])
  })

  it('is not bound across the side of the ball when no team is known', () => {
    const m = matchInjuryRowsToPlayers(only, [{ name: 'DeVonta Smith', position: 'CB' }], 'NFL')
    expect(m.byPlayer.has('devonta smith')).toBe(false)
  })

  it('still binds the athlete it belongs to, and a sub-position on the same side', () => {
    expect(ids(matchInjuryRowsToPlayers(only, [{ name: 'DeVonta Smith', team: 'PHI', position: 'WR' }], 'NFL'), 'devonta smith')).toEqual(['wr'])
    const edge = [{ id: 'de', playerName: 'Byron Young', team: 'Los Angeles Rams', position: 'DE', status: 'Out' }]
    expect(ids(matchInjuryRowsToPlayers(edge, [{ name: 'Byron Young', team: 'LAR', position: 'LB' }], 'NFL'), 'byron young')).toEqual(['de'])
  })
})

/*
 * 🛑 NEWEST CLAIM, NOT NEWEST FETCH (2026-10-11). Rolling Insights re-pulls Friday's "Questionable"
 * every 30 minutes; on Sunday ESPN said "Active". Callers query by `fetchedAt`, so whichever cron ran
 * last decided — Ja'Marr Chase and 14 more flipped back to Questionable after being cleared.
 */
describe('claim order', () => {
  const now = Date.UTC(2026, 9, 11, 16)
  const H = 3_600_000
  const friday = { id: 'ri', playerName: "Ja'Marr Chase", team: 'Cincinnati Bengals', position: null, status: 'Questionable', date: new Date(now - 50 * H), fetchedAt: new Date(now - 60_000) }
  const sunday = { id: 'espn', playerName: "Ja'Marr Chase", team: 'Cincinnati Bengals', position: 'WR', status: 'Active', date: new Date(now - 3 * H), fetchedAt: new Date(now - 20 * 60_000) }

  it('orders an athlete\'s rows by report, whatever order the caller fetched them in', () => {
    const m = matchInjuryRowsToPlayers([friday, sunday], [{ name: "Ja'Marr Chase", team: 'CIN' }], 'NFL')
    expect(ids(m, 'jamarr chase')).toEqual(['espn', 'ri'])
  })

  it('injuryStatusLookup returns the cleared word', async () => {
    const { injuryStatusLookup } = await import('@/lib/injuries/matchInjuryRows')
    expect(injuryStatusLookup([friday, sunday], 'NFL')({ name: "Ja'Marr Chase", team: 'CIN' })).toBe('Active')
  })

  it('a report re-fetched today is not newer than its own report date', async () => {
    const { injuryClaimAsOf } = await import('@/lib/injuries/matchInjuryRows')
    expect(injuryClaimAsOf(friday).getTime()).toBe(friday.date.getTime())
    // A frozen row stamped with a fresh date is no fresher than when we last saw it.
    const frozen = { date: new Date(now), fetchedAt: new Date(now - 17 * 24 * H) }
    expect(injuryClaimAsOf(frozen).getTime()).toBe(frozen.fetchedAt.getTime())
  })

  it('latestInjuryClaims keeps one newest claim per athlete, so a cleared player drops out of an injury list', async () => {
    const { latestInjuryClaims, isInjuryDesignation } = await import('@/lib/injuries/matchInjuryRows')
    const other = { id: 'other', playerName: 'Tee Higgins', team: 'Cincinnati Bengals', position: 'WR', status: 'Out', date: new Date(now - 5 * H), fetchedAt: new Date(now - H) }
    const list = latestInjuryClaims([friday, sunday, other], 'NFL').filter((r) => isInjuryDesignation(r.status))
    expect(list.map((r) => r.id)).toEqual(['other'])
  })
})
