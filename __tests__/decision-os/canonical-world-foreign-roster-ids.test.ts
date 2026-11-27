/**
 * @vitest-environment node
 *
 * 🛑 A foreign league's roster ids must never reach the canonical world's Sleeper-first reads.
 *
 * Fleaflicker / MFL / Fantrax / Yahoo rosters hold that provider's own ids — short numbers in
 * Sleeper's range. Measured on production 2026-09-27: 51 of the 248 ids on the one Fleaflicker league
 * equal a real `SportsPlayer.sleeperId`. `loadPlayerMetadataRows` (and the injury, value and
 * projection reads beside it) asks the Sleeper space first, so a raw id there named a stranger.
 * `loadRosters` is the one point every one of those reads is fed from; this drives the REAL port and
 * the REAL assembler with only the database stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  platform: 'fleaflicker',
  sport: 'NFL',
  playerData: { players: ['6038'], starters: ['6038'] } as Record<string, unknown>,
  /** PlayerIdentityMap rows the Fleaflicker/MFL bridge reads; none = the league is not readable. */
  bridgeRows: [] as Array<{ fleaflickerId?: string; mflId?: string; sleeperId: string }>,
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async () => ({
        id: 'L1',
        sport: state.sport,
        season: 2026,
        scoring: null,
        scoringPresetId: null,
        leagueType: 'redraft',
        isDynasty: false,
        rosterSize: null,
        starters: null,
        irSlots: null,
        taxiSlots: null,
        waiverType: null,
        waiverBudget: null,
        waiverMinBid: null,
        waiverHours: null,
        tradeReviewHours: null,
        tradeDeadlineWeek: null,
        draftPickTrading: null,
        settings: null,
        lastSyncedAt: null,
        syncStatus: null,
        platform: state.platform,
        platformLeagueId: 'P1',
      })),
    },
    leagueTeam: { findMany: vi.fn(async () => []) },
    roster: {
      // Both the port's roster read and the bridge's coverage read come through here.
      findMany: vi.fn(async () => [
        {
          id: 'r1',
          leagueId: 'L1',
          platformUserId: 'u1',
          playerData: state.playerData,
          faabRemaining: null,
          waiverPriority: null,
          settings: null,
          league: { platform: state.platform, sport: state.sport },
        },
      ]),
    },
    playerIdentityMap: { findMany: vi.fn(async () => state.bridgeRows) },
    redraftRoster: { findMany: vi.fn(async () => []) },
    teamPerformance: { findMany: vi.fn(async () => []) },
    sportsPlayer: {
      /* The fake player table: '6038' IS a real Sleeper id, and it is somebody else. */
      findMany: vi.fn(async ({ where }: { where: { OR?: Array<{ sleeperId?: { in: string[] } }> } }) => {
        const asked = where.OR?.[0]?.sleeperId?.in ?? []
        return asked.includes('6038')
          ? [{ externalId: 'sleeper:6038', sleeperId: '6038', name: 'Wrong Player', position: 'WR', team: 'KC', status: 'Out', source: 'sleeper' }]
          : []
      }),
    },
  },
}))

import { resolveCanonicalWorld } from '@/lib/decision-os/world'
import { loadPlayerMetadataRows } from '@/lib/decision-os/world/port'

async function namesFor(platform: string) {
  state.platform = platform
  const world = await resolveCanonicalWorld('L1')
  const ids = world!.rosters.flatMap((r) => r.playerIds)
  const rows = await loadPlayerMetadataRows('NFL', ids)
  return { ids, names: rows.map((r) => r.name) }
}

beforeEach(() => {
  state.platform = 'fleaflicker'
  state.playerData = { players: ['6038'], starters: ['6038'] }
  state.bridgeRows = []
  state.sport = 'NFL'
})

describe('canonical world — a Fleaflicker league the identity bridge can read', () => {
  it('bridged ids become Sleeper ids; an unbridged one stays in its slot, prefixed, never bare', async () => {
    // 4 of 5 translate: exactly the 80% the bridge requires before a league is read through it.
    state.playerData = { players: ['6038', '7000', '7001', '7002', '7003'], starters: ['6038', '7003'] }
    state.bridgeRows = [
      { fleaflickerId: '6038', sleeperId: 's9999' },
      { fleaflickerId: '7000', sleeperId: 's7000' },
      { fleaflickerId: '7001', sleeperId: 's7001' },
      { fleaflickerId: '7002', sleeperId: 's7002' },
    ]
    state.platform = 'fleaflicker'
    const world = await resolveCanonicalWorld('L1')
    const roster = world!.rosters[0]!
    expect(roster.playerIds).toEqual(['s9999', 's7000', 's7001', 's7002', 'unbridged:7003'])
    expect(roster.starterIds).toEqual(['s9999', 'unbridged:7003'])
    const rows = await loadPlayerMetadataRows('NFL', roster.playerIds)
    expect(rows.map((r) => r.name)).not.toContain('Wrong Player')
  })

  /*
   * 🛑 THE BRIDGE IS NFL (`PlayerIdentityMap` rows with `sport: 'NFL'`). A Fleaflicker / MFL league of
   * another sport is never read through it, however much of it would "translate": its ids are that
   * sport's, and an NFL bridge row sharing the number is an NFL stranger. It reads as unreadable
   * (stripped), never as NFL players. Mirrors `espnSportOf` for ESPN.
   */
  it('🛑 a non-NFL Fleaflicker league is not bridged, even at 100% coverage — it is stripped', async () => {
    state.playerData = { players: ['6038', '7000', '7001'], starters: ['6038'] }
    // Every id bridges on both columns: 100% coverage on Fleaflicker and on MFL.
    state.bridgeRows = ['6038', '7000', '7001'].map((id) => ({ fleaflickerId: id, mflId: id, sleeperId: id === '6038' ? '6038' : `s${id}` }))
    for (const sport of ['NBA', 'MLB', 'NHL']) {
      state.sport = sport
      for (const platform of ['fleaflicker', 'mfl']) {
        state.platform = platform
        const world = await resolveCanonicalWorld('L1')
        expect(world!.rosters.flatMap((r) => r.playerIds)).toEqual([])
        expect(world!.rosters.flatMap((r) => r.starterIds)).toEqual([])
      }
    }
  })

  it('CONTROL: the same rosters in an NFL Fleaflicker league at 100% ARE bridged', async () => {
    state.playerData = { players: ['6038', '7000', '7001'], starters: ['6038'] }
    state.bridgeRows = [
      { fleaflickerId: '6038', sleeperId: '6038' },
      { fleaflickerId: '7000', sleeperId: 's7000' },
      { fleaflickerId: '7001', sleeperId: 's7001' },
    ]
    const world = await resolveCanonicalWorld('L1')
    expect(world!.rosters.flatMap((r) => r.playerIds)).toEqual(['6038', 's7000', 's7001'])
  })

  it('below the bridge’s coverage rule the roster is stripped exactly as before', async () => {
    state.playerData = { players: ['6038', '7000', '7001'], starters: ['6038'] }
    state.bridgeRows = [{ fleaflickerId: '7000', sleeperId: 's7000' }] // 1 of 3
    const world = await resolveCanonicalWorld('L1')
    expect(world!.rosters.flatMap((r) => r.playerIds)).toEqual([])
  })
})

/*
 * A PASTED Yahoo league (2026-11-26): resolved players are stored `sleeper:<id>`, unmatched ones
 * `yahoo-paste:…` (declaredSleeperId.ts). The declared ids are the bridge, read with no registry query.
 * Unlike a thin Fleaflicker league it is bridged even below the coverage bar, because the strip would
 * keep its declared ids and silently DROP the rest; bridged, every unmatched player stays countable.
 */
describe('canonical world — a pasted Yahoo league', () => {
  it('declared ids become bare Sleeper ids; an unmatched player stays in his slot, prefixed', async () => {
    state.platform = 'yahoo'
    state.playerData = { players: ['sleeper:6038', 'yahoo-paste:some guy|wr|kc'], starters: ['yahoo-paste:some guy|wr|kc', 'sleeper:6038'] }
    const world = await resolveCanonicalWorld('L1')
    const roster = world!.rosters[0]!
    expect(roster.playerIds).toEqual(['6038', 'unbridged:yahoo-paste:some guy|wr|kc'])
    expect(roster.starterIds).toEqual(['unbridged:yahoo-paste:some guy|wr|kc', '6038'])
    const rows = await loadPlayerMetadataRows('NFL', roster.playerIds)
    expect(rows.map((r) => r.name)).toEqual(['Wrong Player'])
  })

  it('🛑 a bare Yahoo id is never read as a Sleeper id', async () => {
    state.platform = 'yahoo'
    state.playerData = { players: ['6038'], starters: ['6038'] }
    const world = await resolveCanonicalWorld('L1')
    expect(world!.rosters.flatMap((r) => r.playerIds)).toEqual(['unbridged:6038'])
    expect((await namesFor('yahoo')).names).not.toContain('Wrong Player')
  })
})

describe('canonical world — a foreign league’s roster ids', () => {
  it('🛑 a Fleaflicker roster id that equals a Sleeper id never reaches the metadata read', async () => {
    const { ids, names } = await namesFor('fleaflicker')
    expect(ids).not.toContain('6038')
    expect(names).not.toContain('Wrong Player')
  })

  it('🛑 the same for MFL, Fantrax and Yahoo', async () => {
    for (const platform of ['mfl', 'fantrax', 'yahoo']) {
      expect((await namesFor(platform)).names).not.toContain('Wrong Player')
    }
  })

  it('CONTROL: the same id in a Sleeper league IS resolved and named', async () => {
    const { ids, names } = await namesFor('sleeper')
    expect(ids).toContain('6038')
    expect(names).toEqual(['Wrong Player'])
  })
})
