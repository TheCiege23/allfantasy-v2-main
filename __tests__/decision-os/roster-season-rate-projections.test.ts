/**
 * NBA / NHL / MLB / college basketball / soccer points leagues, 2026-11-20 (owner's call): the asker's roster reaches Chimmy priced under the
 * league's own points — the league value board's per-game rate through `loadLeaguePlayerMetrics`, the read My Team
 * makes — instead of only canonical rows labelled "NOT this league". A category league has no points: it keeps
 * those rows and says why.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  loadRosterProjectionBasis,
  priceRosterForLeague,
  type RosterLeagueProjectionDeps,
} from '@/lib/decision-os/grounding/rosterLeagueProjections'
import { serializeDecisionOsGroundingForPrompt } from '@/lib/decision-os/grounding/serialize'
import type { LeaguePlayerMetrics } from '@/lib/af-projections/leaguePlayerMetrics'

const roster = {
  starters: [
    { playerId: 'nba-1', name: 'Star Centre', position: 'C' },
    { playerId: 'nba-2', name: 'Spark Guard', position: 'PG' },
  ],
  bench: [
    { playerId: 'nba-3', name: 'Deep Bench', position: 'SF' },
    { playerId: 'nba-4', name: 'Bench Big', position: 'PF' },
  ],
}

const row = (rosterPlayerId: string, perGame: number, weekGames: number | null) => ({
  playerId: `key-${rosterPlayerId}`,
  rosterPlayerId,
  playerName: rosterPlayerId,
  position: 'C',
  perGame,
  rank: 1,
  positionRank: 1,
  weekGames,
  weekly: weekGames == null ? null : Math.round(perGame * weekGames * 100) / 100,
  fullSeason: null,
  fullSeasonBasis: null,
  restOfSeason: null,
  tradeValue: null,
  tradeValueUnit: null,
  dynastyTradeValue: null,
})

function metrics(over: Partial<LeaguePlayerMetrics> = {}): LeaguePlayerMetrics {
  return {
    leagueId: 'lg',
    sport: 'NBA',
    season: 2026,
    week: 5,
    unit: 'fantasy points',
    // nba-3 is not on the board; nba-4 is, with this week's games not known.
    rows: [row('nba-1', 48.5, 3), row('nba-2', 31.2, 4), row('nba-4', 22, null)],
    ...over,
  }
}

function deps(over: Partial<RosterLeagueProjectionDeps> = {}): RosterLeagueProjectionDeps {
  return {
    latestWeek: vi.fn(async () => ({ season: '2026', week: 12 })),
    loadWeekLines: vi.fn(async () => new Map()),
    loadLeague: vi.fn(async () => ({ sport: 'NBA', platform: 'sleeper', settings: {} })),
    crosswalk: vi.fn(async () => new Map()),
    authorize: vi.fn(async () => true),
    loadRosterMetrics: vi.fn(async () => metrics()),
    ...over,
  }
}

async function price(sport: string, d: RosterLeagueProjectionDeps) {
  const basis = await loadRosterProjectionBasis({ leagueId: 'lg', sport, userId: 'user-1' }, d)
  return priceRosterForLeague({ basis, rosterValue: roster, sport }, d)
}

describe('board-sport points leagues are priced on the league value board', () => {
  it.each(['NBA', 'NHL', 'MLB', 'NCAAB', 'SOCCER'])('%s: the per-game rate under this league, times this week’s games', async (sport) => {
    const d = deps({ loadRosterMetrics: vi.fn(async () => metrics({ sport })) })
    const slice = await price(sport, d)
    expect(slice.present).toBe(true)
    const byId = new Map(slice.value!.map((r) => [r.playerId, r]))
    expect(byId.get('nba-1')).toMatchObject({ basis: 'season_rate', perGame: 48.5, weekGames: 3, points: 145.5, week: 5, leagueScored: true })
    expect(byId.get('nba-2')).toMatchObject({ perGame: 31.2, weekGames: 4, points: 124.8 })
  })

  it('reads My Team’s own read: the roster’s ids, through loadRosterMetrics', async () => {
    const d = deps()
    await price('NBA', d)
    expect(d.loadRosterMetrics).toHaveBeenCalledWith({ leagueId: 'lg', rosterIds: ['nba-1', 'nba-2', 'nba-3', 'nba-4'] })
    // Never the NFL path's weekly feed or crosswalk.
    expect(d.loadWeekLines).not.toHaveBeenCalled()
    expect(d.latestWeek).not.toHaveBeenCalled()
  })

  it('a player off the board is said in words, never 0; unknown games give no week total', async () => {
    const slice = await price('NBA', deps())
    const byId = new Map(slice.value!.map((r) => [r.playerId, r]))
    expect(byId.get('nba-3')).toMatchObject({ perGame: null, points: null })
    expect(byId.get('nba-4')).toMatchObject({ perGame: 22, weekGames: null, points: null })
    const absent = { present: false, value: null, asOf: null, servedFrom: null, confidence: null, conclusive: { ok: true }, gap: null }
    const text = serializeDecisionOsGroundingForPrompt({
      leagueId: 'lg',
      userId: 'u',
      builtAt: new Date().toISOString(),
      importAssertions: absent,
      leagueRules: absent,
      marketValues: absent,
      devyValues: absent,
      projections: absent,
      contextFacts: null,
      contextLookups: null,
      commissionerIntelligence: absent,
      leagueIntelligence: absent,
      portfolio: absent,
      rosterProjections: slice,
      gaps: [],
      meta: { durationMs: 1, engineMs: null, sources: [], killedFeeds: [] },
    } as unknown as Parameters<typeof serializeDecisionOsGroundingForPrompt>[0])
    expect(text).toMatch(/Week 5 2026, priced on this league's own value board/)
    expect(text).toContain('Star Centre (C) 48.5 pts/game · 3 games this week → 145.5 pts')
    expect(text).toContain('Deep Bench (SF) not on this league’s value board (NOT zero)')
    expect(text).toContain('Bench Big (PF) 22 pts/game · this week’s games not known')
    expect(text).toContain("priced on this league's own value board")
    expect(text).toContain('A season rate, NOT a game-by-game forecast')
    // Never the NFL wording, which promises a re-scored weekly line.
    expect(text).not.toContain('Byes and injuries are not applied here (My Team counts a bye')
  })

  it('starters first, then the bench by rate', async () => {
    const slice = await price('NBA', deps())
    expect(slice.value!.map((r) => r.playerId)).toEqual(['nba-1', 'nba-2', 'nba-4', 'nba-3'])
  })
})

describe('what is not priced, and why', () => {
  it('🛑 a category league has no points: not_requested, and it says so — no invented points', async () => {
    const slice = await price('NBA', deps({ loadRosterMetrics: vi.fn(async () => metrics({ unit: 'category score' })) }))
    expect(slice.present).toBe(false)
    expect(slice.gap).toMatchObject({ reason: 'not_requested' })
    expect(slice.gap?.detail).toContain('category league')
  })

  it('🛑 access is checked first; no access, no read', async () => {
    const d = deps({ authorize: vi.fn(async () => false) })
    const slice = await price('NBA', d)
    expect(slice.present).toBe(false)
    expect(slice.gap).toMatchObject({ reason: 'not_computed' })
    expect(d.loadRosterMetrics).not.toHaveBeenCalled()
  })

  it('no asker, no read', async () => {
    const d = deps()
    const basis = await loadRosterProjectionBasis({ leagueId: 'lg', sport: 'NBA' }, d)
    expect(basis).toMatchObject({ ok: false })
    expect(d.authorize).not.toHaveBeenCalled()
  })

  it('a board that cannot be read, or reads another sport, is a stated gap', async () => {
    for (const loadRosterMetrics of [vi.fn(async () => null), vi.fn(async () => metrics({ sport: 'NFL' })), vi.fn(async () => { throw new Error('db') })]) {
      const slice = await price('NBA', deps({ loadRosterMetrics }))
      expect(slice.present).toBe(false)
      expect(slice.gap).toMatchObject({ reason: 'not_computed' })
    }
  })

  it('nobody on the board: a stated gap, not a list of nulls', async () => {
    const slice = await price('NBA', deps({ loadRosterMetrics: vi.fn(async () => metrics({ rows: [] })) }))
    expect(slice.present).toBe(false)
    expect(slice.gap?.detail).toContain("value board")
  })

  it('an authorize that throws synchronously never rejects (the packet build awaits it)', async () => {
    const d = deps({ authorize: (() => { throw new Error('boom') }) as never })
    await expect(loadRosterProjectionBasis({ leagueId: 'lg', sport: 'NBA', userId: 'u' }, d)).resolves.toMatchObject({ ok: false })
  })
})

describe('the packet hands the asker to the basis, so access is checked before the board is read', () => {
  it('passes userId', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(`${process.cwd()}/lib/decision-os/grounding/packet.ts`, 'utf8')
    expect(src).toMatch(/loadRosterProjectionBasis\(\{ leagueId, sport: args\.sport, userId: args\.userId \}\)/)
  })
})
