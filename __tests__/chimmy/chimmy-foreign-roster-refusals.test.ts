// @vitest-environment node
/**
 * What Chimmy SAYS when it refuses on a Fleaflicker / MFL / Fantrax / Yahoo league.
 *
 * The canonical world port strips such a league's roster ids (`loadRosters`; pinned by
 * chimmy-grounding-foreign-roster-ids.test.ts), so every roster in its world is empty. Each builder
 * then refused with a reason that is a false claim about the team: "Jayden Reed is not on your
 * roster", "no player on your roster has a projection", "not every player named is on a roster in
 * this league" — or, for start/sit, silently returned nothing. They now refuse with
 * `roster_ids_unreadable` and the shared sentence, decided from `world.provenance.provider` (the
 * league's platform) BEFORE any roster-dependent refusal.
 *
 * Each CONTROL is a Sleeper league whose rosters are GENUINELY empty: there the old words are true
 * and must stay. The worlds here are the port's output shape, so no database is involved.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { buildStartSitScenario, buildWaiverScenario, type LineupScenarioDeps } from '@/lib/chimmy/lineupScenarioGrounding'
import { buildLineupOptimization, type LineupOptimizerDeps } from '@/lib/chimmy/lineupOptimizerGrounding'
import { buildBaselineLineupContext, type BaselineOptimizerDeps } from '@/lib/chimmy/lineupOptimizerOtherSports'
import { buildTradeScenario, type TradeScenarioDeps } from '@/lib/chimmy/tradeScenarioGrounding'
import { FOREIGN_IDS_UNREADABLE } from '@/lib/core-app/foreignIdSpaceCopy'
import type { CanonicalWorld } from '@/lib/decision-os/world/facts'

const WEEK = { season: '2026', week: 3 }

/** What the port hands back for this league: both rosters present, and (here) empty. */
const world = (provider: string, over: { sport?: string; slots?: string[] } = {}) =>
  ({
    league: {
      sport: over.sport ?? 'NFL',
      season: 2026,
      currentWeek: 3,
      scoringPresetId: 'ppr',
      scoringSettings: { scoring_settings: { rec: 1, rec_yd: 0.1, rush_yd: 0.1 } },
      rosterSettings: { starterSlots: over.slots ?? ['QB', 'RB', 'WR', 'BN'] },
    },
    teams: [
      { teamId: 't1', managerUserId: 'viewer-1', displayName: 'Mine', ownerName: 'Me' },
      { teamId: 't2', managerUserId: 'rival-2', displayName: 'Rival', ownerName: 'Rival' },
    ],
    rosters: [
      { rosterId: 'r1', teamId: 't1', playerIds: [], starterIds: [], reserveIds: [], taxiIds: [] },
      { rosterId: 'r2', teamId: 't2', playerIds: [], starterIds: [], reserveIds: [], taxiIds: [] },
    ],
    provenance: { sourceModels: ['Roster'], provider, sourceLeagueId: 'P1', assembledAt: '2026-09-28T00:00:00Z', freshness: { lastSyncedAt: null, isStale: true, staleReason: 'never_synced' } },
    completeness: { dataCompleteness: 50, warnings: [], unsupported: [] },
  }) as unknown as CanonicalWorld

const scenarioDeps = (provider: string): LineupScenarioDeps => ({
  resolveWorld: async () => world(provider),
  loadPlayerNames: async () => new Map(),
  latestWeek: async () => WEEK,
  loadWeekLines: async () => new Map(),
  findWeekPlayersByName: async ({ name }) => ({
    players: name === 'Rashod Bateman' ? [{ playerId: 'sl-bateman', name: 'Rashod Bateman', position: 'WR' }] : [],
    complete: true,
  }),
})

const waiver = (provider: string) =>
  buildWaiverScenario(
    { message: 'Should I add Rashod Bateman and drop Jayden Reed?', leagueId: 'L1', userId: 'viewer-1', engineClaims: null },
    scenarioDeps(provider),
  )
const startSit = (provider: string) =>
  buildStartSitScenario({ message: 'Should I start Jayden Reed or Tank Bigsby?', leagueId: 'L1', userId: 'viewer-1' }, scenarioDeps(provider))
const optimize = (provider: string) =>
  buildLineupOptimization({ leagueId: 'L1', userId: 'viewer-1' }, {
    resolveWorld: async () => world(provider),
    loadPlayers: async () => new Map(),
    latestWeek: async () => WEEK,
    loadWeekLines: async () => new Map(),
  } satisfies LineupOptimizerDeps)
const baseline = (provider: string) =>
  buildBaselineLineupContext({ leagueId: 'L1', userId: 'viewer-1' }, {
    resolveWorld: async () => world(provider, { sport: 'NBA', slots: ['PG', 'BN'] }),
    loadPlayers: async () => new Map(),
    // Non-empty, so the refusal under test is about the ROSTER, not about a missing projection base.
    baseline: async () => ({ sport: 'NBA', season: 2026, byName: new Map([['somebody', null]]) }) as never,
  } satisfies BaselineOptimizerDeps)
const trade = (provider: string) =>
  buildTradeScenario({ message: 'Trade Jayden Reed for Puka Nacua?', leagueId: 'L1', userId: 'viewer-1' }, {
    resolveWorld: async () => world(provider),
    loadPlayerNames: async () => new Map(),
    evaluate: vi.fn(async () => { throw new Error('not reached') }),
    grade: vi.fn(async () => { throw new Error('not reached') }),
  } as unknown as TradeScenarioDeps)

const refusal = (s: { status: string; reason?: string; detail?: string } | null) => {
  expect(s?.status).toBe('unresolved')
  return s as { reason: string; detail: string }
}

describe('waiver scenario', () => {
  it('a foreign league refuses because its ids are unreadable — not "X is not on your roster"', async () => {
    const r = refusal(await waiver('fleaflicker'))
    expect(r.reason).toBe('roster_ids_unreadable')
    expect(r.detail).toContain(FOREIGN_IDS_UNREADABLE)
    expect(r.detail).not.toMatch(/not on your roster/)
  })

  it('CONTROL: a Sleeper league where he genuinely is not rostered still says drop_not_on_roster', async () => {
    const r = refusal(await waiver('sleeper'))
    expect(r.reason).toBe('drop_not_on_roster')
    expect(r.detail).toBe('Jayden Reed is not on your roster, so cannot be dropped.')
  })
})

describe('start/sit scenario', () => {
  it('a foreign league now SAYS why, instead of returning nothing', async () => {
    const r = refusal(await startSit('mfl'))
    expect(r.reason).toBe('roster_ids_unreadable')
    expect(r.detail).toContain(FOREIGN_IDS_UNREADABLE)
  })

  it('CONTROL: a Sleeper league with neither player rostered is still not a start/sit question', async () => {
    expect(await startSit('sleeper')).toBeNull()
  })
})

describe('NFL lineup optimizer', () => {
  it('a foreign league refuses with the shared words — not no_league_projections', async () => {
    const r = refusal(await optimize('fantrax'))
    expect(r.reason).toBe('roster_ids_unreadable')
    expect(r.detail).toContain(FOREIGN_IDS_UNREADABLE)
    expect(r.detail).not.toMatch(/No player on your roster/)
  })

  it('CONTROL: a genuinely empty Sleeper roster still says no_league_projections', async () => {
    const r = refusal(await optimize('sleeper'))
    expect(r.reason).toBe('no_league_projections')
    expect(r.detail).toMatch(/^No player on your roster has a week 3 projection/)
  })
})

describe('other-sports lineup optimizer', () => {
  it('a foreign league is not told "no player on your roster has a projection"', async () => {
    const text = await baseline('yahoo')
    expect(text).toContain(FOREIGN_IDS_UNREADABLE)
    expect(text).not.toMatch(/No player on your roster/)
  })

  it('CONTROL: a genuinely empty Sleeper roster keeps the old words', async () => {
    const text = await baseline('sleeper')
    expect(text).toContain('No player on your roster has an AllFantasy NBA projection on file.')
    expect(text).not.toContain(FOREIGN_IDS_UNREADABLE)
  })
})

describe('trade scenario', () => {
  it('a foreign league refuses because its ids are unreadable — not players_not_rostered', async () => {
    const r = refusal(await trade('fleaflicker'))
    expect(r.reason).toBe('roster_ids_unreadable')
    expect(r.detail).toContain(FOREIGN_IDS_UNREADABLE)
    expect(r.detail).not.toMatch(/not on a roster/)
  })

  it('CONTROL: a Sleeper league where neither player is rostered still says players_not_rostered', async () => {
    const r = refusal(await trade('sleeper'))
    expect(r.reason).toBe('players_not_rostered')
  })
})
