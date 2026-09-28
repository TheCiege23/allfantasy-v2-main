import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  leagues: vi.fn(),
  platforms: vi.fn(),
  team: vi.fn(),
  identities: vi.fn(),
  injuries: vi.fn(),
  games: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findMany: h.platforms }, sportsGame: { findMany: h.games } },
}))
vi.mock('@/lib/chimmy/tools/leagueByName', () => ({ listMemberLeagues: h.leagues }))
vi.mock('@/lib/ai-payload/resolveAiTeamContext', () => ({ resolveAiTeamContext: h.team }))
vi.mock('@/lib/player-identity/resolveRosterPlayerIdentities', () => ({ resolveRosterPlayerIdentities: h.identities }))
vi.mock('@/lib/injuries/injuryReadPort', () => ({ resolveInjuryFacts: h.injuries }))

import { nameList, scanWithinBudget } from '@/lib/chimmy/tools/boundedScan'
import { buildMyRosterInjuriesContext } from '@/lib/chimmy/tools/myRosterInjuriesTool'

/*
 * 2026-09-27: an account-wide NFL injury answer read 39 rosters and said "24 further league(s)
 * were not scanned (cap 40)" — a count, naming none. These pin the replacement: a time budget,
 * every unchecked league NAMED, and coverage stated before the findings.
 */

const never = () => new Promise<never>(() => {})

describe('scanWithinBudget', () => {
  it('does everything when time allows, in input order, with bounded concurrency', async () => {
    let live = 0
    let peak = 0
    const r = await scanWithinBudget([1, 2, 3, 4, 5, 6, 7], { concurrency: 3, budgetMs: 10_000, perItemTimeoutMs: 1_000 }, async (n) => {
      live++
      peak = Math.max(peak, live)
      await new Promise((res) => setTimeout(res, 5 * (8 - n)))
      live--
      return n * 10
    })
    expect(r.done.map((d) => d.result)).toEqual([10, 20, 30, 40, 50, 60, 70])
    expect(r.timedOut).toEqual([])
    expect(r.failed).toEqual([])
    expect(r.notStarted).toEqual([])
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('starts nothing new once the budget is spent, and reports the rest as notStarted', async () => {
    let clock = 0
    const r = await scanWithinBudget(['a', 'b', 'c', 'd'], { concurrency: 1, budgetMs: 100, perItemTimeoutMs: 1_000, now: () => clock }, async (x) => {
      clock += 60 // each item "takes" 60ms of budget
      return x
    })
    expect(r.done.map((d) => d.item)).toEqual(['a', 'b'])
    expect(r.notStarted).toEqual(['c', 'd'])
  })

  it('reports a hung item timedOut and a throwing one failed, without stopping the scan', async () => {
    const r = await scanWithinBudget(['ok', 'hang', 'boom', 'ok2'], { concurrency: 2, budgetMs: 10_000, perItemTimeoutMs: 30 }, async (x) => {
      if (x === 'hang') return never()
      if (x === 'boom') throw new Error('db down')
      return x
    })
    expect(r.done.map((d) => d.item)).toEqual(['ok', 'ok2'])
    expect(r.timedOut).toEqual(['hang'])
    expect(r.failed).toEqual(['boom'])
    expect(r.notStarted).toEqual([])
  })

  it('nameList names up to the limit and counts the rest', () => {
    expect(nameList(['A', 'B', 'C'], 2)).toBe('A, B (+1 more)')
    expect(nameList(['A', 'B'], 2)).toBe('A, B')
  })
})

function league(i: number) {
  return { id: `L${i}`, name: `League ${String(i).padStart(2, '0')}`, sport: 'NFL', season: 2026 }
}

function teamWith(name: string) {
  return {
    starters: [{ playerId: `p-${name}`, name, position: 'RB', team: 'KC', injuryStatus: null }],
    bench: [], injuredReserve: [], taxi: [],
  }
}

const NOW = new Date('2026-09-28T05:00:00Z')

beforeEach(() => {
  vi.resetAllMocks()
  h.platforms.mockResolvedValue([])
  h.identities.mockResolvedValue(new Map())
  h.games.mockResolvedValue([])
  h.injuries.mockResolvedValue({
    byPlayer: new Map(), ambiguous: [], newestFetchedAt: NOW, feedStale: false, coverage: { sourceAvailable: true, reason: null },
  })
})

describe('buildMyRosterInjuriesContext coverage', () => {
  it('🛑 reads all 65 current leagues — the old cap stopped at 40 — and says coverage is complete', async () => {
    h.leagues.mockResolvedValue(Array.from({ length: 65 }, (_, i) => league(i + 1)))
    h.team.mockImplementation(async ({ leagueId }: { leagueId: string }) => teamWith(`Player ${leagueId}`))

    const out = await buildMyRosterInjuriesContext({ userId: 'u1', sport: 'NFL' })
    expect(h.team).toHaveBeenCalledTimes(65)
    expect(out).toContain('65 league(s) read')
    expect(out).toContain('SCAN COVERAGE: all 65 current-season league(s) were reached.')
    expect(out).not.toContain('PARTIAL SCAN')
  })

  it('names every league the time budget did not reach, BEFORE any finding', async () => {
    h.leagues.mockResolvedValue(Array.from({ length: 5 }, (_, i) => league(i + 1)))
    let clock = 0
    h.team.mockImplementation(async ({ leagueId }: { leagueId: string }) => {
      clock += 60
      return teamWith(`Player ${leagueId}`)
    })

    const out = await buildMyRosterInjuriesContext({
      userId: 'u1', sport: 'NFL', scan: { concurrency: 1, budgetMs: 100, now: () => clock },
    })
    const lines = out.split('\n')
    expect(lines[1]).toContain('⚠ PARTIAL SCAN — 2 of 5 current-season leagues were checked; 3 were NOT.')
    expect(lines[1]).toContain('not reached in the time available (3): League 03, League 04, League 05')
    expect(lines[1]).toContain('Open the answer by saying the check covered 2 of 5 leagues')
    expect(lines[1]).toContain('Never say "all your leagues"')
    expect(out).toContain('3 league(s) were not checked at all (named under PARTIAL SCAN above)')
  })

  it('names a league whose roster read hung, separately from the ones never reached', async () => {
    h.leagues.mockResolvedValue([league(1), league(2), league(3)])
    h.team.mockImplementation(async ({ leagueId }: { leagueId: string }) =>
      leagueId === 'L2' ? never() : teamWith(`Player ${leagueId}`),
    )
    const out = await buildMyRosterInjuriesContext({ userId: 'u1', sport: 'NFL', scan: { perItemTimeoutMs: 30 } })
    expect(out).toContain('⚠ PARTIAL SCAN — 2 of 3 current-season leagues were checked; 1 were NOT.')
    expect(out).toContain('started but did not finish (1): League 02')
    expect(out).not.toContain('not reached in the time available')
  })

  it('names leagues beyond the hard cap too', async () => {
    h.leagues.mockResolvedValue(Array.from({ length: 4 }, (_, i) => league(i + 1)))
    h.team.mockImplementation(async ({ leagueId }: { leagueId: string }) => teamWith(`Player ${leagueId}`))
    const out = await buildMyRosterInjuriesContext({ userId: 'u1', sport: 'NFL', scan: { maxLeagues: 3 } })
    expect(h.team).toHaveBeenCalledTimes(3)
    expect(out).toContain('not reached in the time available (1): League 04')
  })

  it('"no reported injuries" over a partial scan still carries the partial line above it', async () => {
    h.leagues.mockResolvedValue([league(1), league(2)])
    h.team.mockImplementation(async ({ leagueId }: { leagueId: string }) =>
      leagueId === 'L2' ? never() : teamWith('Healthy Guy'),
    )
    const out = await buildMyRosterInjuriesContext({ userId: 'u1', sport: 'NFL', scan: { perItemTimeoutMs: 30 } })
    const partial = out.indexOf('PARTIAL SCAN')
    const none = out.indexOf('No player on those rosters has a current injury designation on file')
    expect(partial).toBeGreaterThan(-1)
    expect(none).toBeGreaterThan(partial)
  })
})

/* 2026-09-28: an answer said "8 leagues have a team with nothing synced" and could name only 6 — the list was cut at 6. */
describe('gap lists name every league up to the shared limit', () => {
  it('names all 8 leagues with nothing synced, and all 8 unreadable ones', async () => {
    h.leagues.mockResolvedValue(Array.from({ length: 16 }, (_, i) => league(i + 1)))
    h.team.mockImplementation(async ({ leagueId }: { leagueId: string }) => {
      const n = Number(leagueId.slice(1))
      if (n <= 8) return { starters: [], bench: [], injuredReserve: [], taxi: [] }
      return null
    })
    const out = await buildMyRosterInjuriesContext({ userId: 'u1', sport: 'NFL' })
    expect(out).toContain('8 league(s) have a team with no players synced (League 01, League 02, League 03, League 04, League 05, League 06, League 07, League 08)')
    expect(out).toContain('8 league(s) have no claimed or synced team for this user (League 09, League 10, League 11, League 12, League 13, League 14, League 15, League 16)')
  })
})
