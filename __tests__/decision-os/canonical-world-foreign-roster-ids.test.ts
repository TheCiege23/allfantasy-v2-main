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

const state = { platform: 'fleaflicker' }

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async () => ({
        id: 'L1',
        sport: 'NFL',
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
      findMany: vi.fn(async () => [
        {
          id: 'r1',
          platformUserId: 'u1',
          playerData: { players: ['6038'], starters: ['6038'] },
          faabRemaining: null,
          waiverPriority: null,
          settings: null,
          league: { platform: state.platform },
        },
      ]),
    },
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
