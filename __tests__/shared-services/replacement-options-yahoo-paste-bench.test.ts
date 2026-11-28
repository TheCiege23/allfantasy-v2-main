/**
 * @vitest-environment node
 *
 * "Best on your bench" for a PASTED Yahoo league.
 *
 * The paste importer records who starts (`starters`) and who is on IR (`reserve`) from each pasted slot
 * (yahooSnapshotModel.ts `buildYahooSnapshotPayload`), in the plain roster arrays, with the raw name and
 * position in `player_metadata`. The bench is `players` minus both. Only declared (`sleeper:<id>`) bench
 * players are priced; an unmatched one is counted, never listed. A roster with no recorded starters gets
 * no bench list at all — never the whole roster passed off as a bench.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = { rosters: [] as Array<{ platformUserId: string; playerData: unknown }> }

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async () => ({ id: 'Y1', sport: 'NFL', season: 2026, platform: 'yahoo', platformLeagueId: 'P1' })),
    },
    roster: { findMany: vi.fn(async () => state.rosters) },
    fantasyProjection: {
      findFirst: vi.fn(async () => ({ week: 4 })),
      findMany: vi.fn(async ({ where }: { where: { playerId: { in?: string[]; notIn?: string[] } } }) => {
        const table: Record<string, number> = { '6038': 10, '7100': 12, '7101': 15, '7102': 30, '7000': 25 }
        if (where.playerId.in) return where.playerId.in.filter((id) => table[id] != null).map((id) => ({ playerId: id, projectedPoints: table[id]! }))
        return Object.entries(table)
          .filter(([id]) => !where.playerId.notIn?.includes(id))
          .map(([playerId, projectedPoints]) => ({ playerId, projectedPoints }))
      }),
    },
    sportsPlayer: {
      findMany: vi.fn(async () => [{ sleeperId: '7000', externalId: 'sleeper:7000', name: 'Pickup Guy', position: 'WR', team: 'KC' }]),
    },
  },
}))
vi.mock('@/lib/shared-services/game-day/UserPlayerExposureService', () => ({
  resolveLinkedPlatformUserIds: vi.fn(async () => ['owner-1']),
}))

import { resolveReplacementOptions } from '@/lib/shared-services/league-hub/replacementOptions'

const ARGS = { appUserId: 'u1', leagueId: 'Y1', affectedPlayerId: '6038' }
const declared = (n: number) => Array.from({ length: n }, (_, i) => `sleeper:${100 + i}`)
const PASTE = 'yahoo-paste:bench guy|WR|NYJ'

const metadata = {
  'sleeper:6038': { name: 'Affected Wideout', position: 'WR', team: 'MIA' },
  'sleeper:7100': { name: 'Bench Wideout', position: 'WR', team: 'DET' },
  'sleeper:7101': { name: 'Bench Back', position: 'RB', team: 'ATL' },
  'sleeper:7102': { name: 'Hurt Wideout', position: 'WR', team: 'SF' },
  [PASTE]: { name: 'Bench Guy', position: 'WR', team: 'NYJ' },
}
const PLAYERS = ['sleeper:6038', 'sleeper:7100', 'sleeper:7101', 'sleeper:7102', PASTE]

/** The user's pasted roster as the import writes it: plain arrays + player_metadata. */
function userRoster(extra: Record<string, unknown> = {}) {
  return {
    platformUserId: 'owner-1',
    playerData: { players: PLAYERS, starters: ['sleeper:6038'], reserve: ['sleeper:7102'], taxi: [], player_metadata: metadata, ...extra },
  }
}
// Keeps the league above the coverage bar: 26 declared ids of 27 league-wide.
const RIVAL = { platformUserId: 'owner-2', playerData: { players: declared(22) } }

beforeEach(() => {
  state.rosters = [userRoster(), RIVAL]
})

describe('resolveReplacementOptions — bench of a pasted Yahoo league', () => {
  it('reads the bench from the plain roster list: same position, priced, named from player_metadata', async () => {
    const r = await resolveReplacementOptions(ARGS)
    expect(r?.limitation).toBeNull()
    expect(r?.benchOptions.map((c) => c.name)).toEqual(['Bench Wideout'])
    expect(r?.benchOptions[0]?.delta).toBe(2)
  })

  it('counts an unmatched bench player instead of listing him, and never lists a starter or an IR player', async () => {
    const r = await resolveReplacementOptions(ARGS)
    const names = r?.benchOptions.map((c) => c.name) ?? []
    expect(names).not.toContain('Bench Guy')
    expect(names).not.toContain('Hurt Wideout')
    expect(names).not.toContain('Affected Wideout')
    expect(r?.benchUnmatched).toBe(1)
    expect(r?.benchLimitation ?? null).toBeNull()
  })

  it('the same answer when the roster also carries id-only lineup_sections (as the bootstrap writes them)', async () => {
    state.rosters = [
      userRoster({ lineup_sections: { starters: ['sleeper:6038'], bench: ['sleeper:7100', 'sleeper:7101', PASTE], ir: ['sleeper:7102'], taxi: [], devy: [] } }),
      RIVAL,
    ]
    const r = await resolveReplacementOptions(ARGS)
    expect(r?.benchOptions.map((c) => c.name)).toEqual(['Bench Wideout'])
    expect(r?.benchUnmatched).toBe(1)
    // The free-agent side still filters on the real position, not a placeholder "UTIL".
    expect(r?.freeAgentOptions.map((c) => c.name)).toEqual(['Pickup Guy'])
  })

  it('🛑 no recorded starters: no bench list and a stated reason — never the whole roster as bench', async () => {
    for (const starters of [[], undefined]) {
      state.rosters = [userRoster({ starters }), RIVAL]
      const r = await resolveReplacementOptions(ARGS)
      expect(r?.benchOptions).toEqual([])
      expect(r?.benchLimitation).toBe('starters_not_recorded')
      expect(r?.freeAgentOptions.map((c) => c.name)).toEqual(['Pickup Guy'])
    }
  })
})

describe('the bench copy', () => {
  it('says the bench cannot be told apart, and counts unmatched bench players — in English and Spanish', async () => {
    const { PASTED_BENCH_UNREADABLE, benchUnmatchedNote } = await import('@/lib/core-app/foreignIdSpaceCopy')
    const { coreUiCopy } = await import('@/lib/core-app/coreUiCopy')
    expect(PASTED_BENCH_UNREADABLE).toBe("Your bench can't be told apart from your starters in a pasted league.")
    expect(benchUnmatchedNote(1)).toBe("1 player on your bench couldn't be matched to ours.")
    for (const s of [PASTED_BENCH_UNREADABLE, benchUnmatchedNote(1), benchUnmatchedNote(3)]) expect(coreUiCopy(s, 'es')).not.toBe(s)
    expect(coreUiCopy(benchUnmatchedNote(3), 'es')).toContain('3 jugadores')
  })
})
