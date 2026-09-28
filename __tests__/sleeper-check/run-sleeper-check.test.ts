import { describe, expect, it, vi } from 'vitest'

// Nothing here may reach a database or Sleeper: every read is injected below.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { MAX_CHECK_LEAGUES, runSleeperCheck, type SleeperCheckDeps } from '@/lib/sleeper-check/sleeperCheck'

const NOW = new Date('2026-10-25T16:10:00.000Z')

function deps(over: Partial<SleeperCheckDeps> = {}): SleeperCheckDeps & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    now: () => NOW,
    nflSeason: async () => '2026',
    resolveUser: vi.fn(async (u: string) => {
      calls.push(`user:${u}`)
      return u === 'guap' ? { user_id: 'u1', username: 'guap', display_name: 'Guap', avatar: 'abc' } : null
    }),
    userLeagues: vi.fn(async () => [
      { league_id: 'L1', name: 'KBFL', settings: { best_ball: 0 } },
      { league_id: 'BB', name: 'Best Ball Mania', settings: { best_ball: 1 } },
    ]),
    leagueRosters: vi.fn(async (id: string) => {
      calls.push(`rosters:${id}`)
      return [
        { owner_id: 'u1', players: ['kincaid', 'kraft'], starters: ['kincaid'] },
        { owner_id: 'someone-else', players: ['other'], starters: ['other'] },
      ]
    }),
    playerRows: vi.fn(async () => [
      { sleeperId: 'kincaid', name: 'Dalton Kincaid', position: 'TE', team: 'BUF', sport: 'NFL', imageUrl: null },
      { sleeperId: 'kraft', name: 'Tucker Kraft', position: 'TE', team: 'GB', sport: 'NFL', imageUrl: null },
    ]),
    injuries: vi.fn(async () => new Map([['kincaid', 'Out']])),
    takeLeagueRead: () => true,
    ...over,
  }
}

describe('runSleeperCheck', () => {
  it('username → leagues → only THIS user\'s players, with injuries and a lineup alert', async () => {
    const d = deps()
    const res = await runSleeperCheck('Guap', d)
    if (res.status !== 'ok') throw new Error(res.status)

    expect(res).toMatchObject({ username: 'guap', displayName: 'Guap', season: '2026', asOf: NOW.toISOString() })
    expect(res.leagues).toEqual([
      { leagueId: 'L1', name: 'KBFL', bestBall: false, read: true },
      { leagueId: 'BB', name: 'Best Ball Mania', bestBall: true, read: true },
    ])
    expect(res.players.map((p) => p.sleeperId).sort()).toEqual(['kincaid', 'kraft'])
    expect(res.alerts.map((p) => p.sleeperId)).toEqual(['kincaid'])
    expect(res.alerts[0]).toMatchObject({ starting: 2, startingSetLineup: 1 })
  })

  it('looks the username up lowercase first, URL-encoded', async () => {
    const d = deps()
    await runSleeperCheck('Guap', d)
    expect(d.calls[0]).toBe('user:guap')
    await runSleeperCheck('odd.name', d)
    expect(d.resolveUser).toHaveBeenCalledWith(encodeURIComponent('odd.name'))
  })

  it('not found is not an outage, and an outage is not "not found"', async () => {
    expect((await runSleeperCheck('nobody', deps())).status).toBe('not_found')
    const down = deps({ resolveUser: vi.fn(async () => { throw new Error('Sleeper API 503') }) })
    expect((await runSleeperCheck('guap', down)).status).toBe('unavailable')
  })

  it('a league Sleeper fails on is counted, not fatal', async () => {
    const d = deps({
      leagueRosters: vi.fn(async (id: string) => {
        if (id === 'BB') throw new Error('Sleeper API 500')
        return [{ owner_id: 'u1', players: ['kincaid'], starters: ['kincaid'] }]
      }),
    })
    const res = await runSleeperCheck('guap', d)
    if (res.status !== 'ok') throw new Error(res.status)
    expect(res.leaguesUnavailable).toBe(1)
    expect(res.leagues.find((l) => l.leagueId === 'BB')?.read).toBe(false)
  })

  it('a spent league-read budget reads fewer leagues and says so — it never fetches past it', async () => {
    let left = 1
    const d = deps({ takeLeagueRead: () => left-- > 0 })
    const res = await runSleeperCheck('guap', d)
    if (res.status !== 'ok') throw new Error(res.status)
    expect(res.leaguesDeferred).toBe(1)
    expect(d.calls.filter((c) => c.startsWith('rosters:'))).toHaveLength(1)
  })

  it('caps the leagues it reads', async () => {
    const many = Array.from({ length: MAX_CHECK_LEAGUES + 5 }, (_, i) => ({ league_id: `L${i}`, name: `L${i}` }))
    const d = deps({ userLeagues: vi.fn(async () => many) })
    const res = await runSleeperCheck('guap', d)
    if (res.status !== 'ok') throw new Error(res.status)
    expect(res.leagues).toHaveLength(MAX_CHECK_LEAGUES)
    expect(res.leaguesNotShown).toBe(5)
    expect(d.calls.filter((c) => c.startsWith('rosters:'))).toHaveLength(MAX_CHECK_LEAGUES)
  })
})
