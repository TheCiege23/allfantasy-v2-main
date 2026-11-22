/**
 * `expectedLineupVersion`: a save built on a roster that has since changed is refused, not applied over it.
 * This is what keeps a lineup change queued offline (lib/pwa/offlineLineupQueue.ts) from undoing a waiver
 * add or a change made on another device — and it does not loosen the kickoff lock, which the server
 * still applies at arrival.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type AnyArgs = any

const h = vi.hoisted(() => {
  const state = {
    league: { id: 'league-1', platform: 'manual' } as Record<string, any>,
    roster: { id: 'af-roster-1', leagueId: 'league-1', playerData: {}, redraftRosterId: null } as Record<string, any>,
    writes: [] as AnyArgs[],
    lockedPlayerIds: [] as string[],
  }
  const tx = {
    roster: {
      update: async (args: AnyArgs) => { state.writes.push(args); state.roster.playerData = args.data.playerData; return state.roster },
      // The conditional write: lands only if the stored roster is still the one the engine read.
      updateMany: async (args: AnyArgs) => {
        state.writes.push(args)
        if (JSON.stringify(state.roster.playerData) !== JSON.stringify(args.where.playerData.equals)) return { count: 0 }
        state.roster.playerData = args.data.playerData
        return { count: 1 }
      },
    },
  }
  const prisma = {
    league: { findUnique: async () => state.league },
    roster: { findFirst: async () => state.roster },
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  }
  return { state, prisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({ getRosterTemplateForLeague: vi.fn(async () => ({ slots: [] })) }))
vi.mock('@/lib/sport-defaults/LeagueVariantRegistry', () => ({ getFormatTypeForVariant: vi.fn(() => 'standard') }))
vi.mock('@/lib/roster-lineup-engine/rosterValidationService', () => ({ validateCanonicalRosterPayload: vi.fn(() => ({ ok: true, issues: [] })) }))
vi.mock('@/lib/roster-lineup-engine/lineupAssignmentSync', () => ({ syncAfRosterLineupAssignments: vi.fn(async () => {}) }))
vi.mock('@/lib/roster-lineup-engine/rosterMoveHistory', () => ({ recordAfRosterMoveHistory: vi.fn(async () => {}), hashPlayerDataSnapshot: () => 'h' }))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({
  resolveFullLineupLockContext: vi.fn(async () => ({ locked: false, lockedPlayerIds: h.state.lockedPlayerIds, policy: 'per_player', perPlayerReasons: {} })),
  upsertAfLineupLockState: vi.fn(async () => {}),
}))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn(async () => {}) }))

import { persistRosterLineupWithEngine } from '@/lib/roster-lineup-engine/lineupService'
import { lineupVersionOf } from '@/lib/roster/lineupVersion'

const BEFORE = {
  players: ['qb1', 'rb1', 'rb2'],
  starters: ['qb1', 'rb1'],
  lineup_sections: {
    starters: [{ id: 'qb1', position: 'QB', slotIndex: 0 }, { id: 'rb1', position: 'RB', slotIndex: 1 }],
    bench: [{ id: 'rb2', position: 'RB' }],
  },
}
const SWAPPED = {
  players: ['qb1', 'rb1', 'rb2'],
  starters: ['qb1', 'rb2'],
  lineup_sections: {
    starters: [{ id: 'qb1', position: 'QB', slotIndex: 0 }, { id: 'rb2', position: 'RB', slotIndex: 1 }],
    bench: [{ id: 'rb1', position: 'RB' }],
  },
}

const save = (expectedLineupVersion?: string) =>
  persistRosterLineupWithEngine({ leagueId: 'league-1', rosterId: 'af-roster-1', actorUserId: 'u1', nextPlayerData: SWAPPED, season: 2026, week: 5, source: 'user_save', expectedLineupVersion })

beforeEach(() => {
  h.state.roster = { id: 'af-roster-1', leagueId: 'league-1', playerData: structuredClone(BEFORE), redraftRosterId: null }
  h.state.writes = []
  h.state.lockedPlayerIds = []
})

describe('lineupVersionOf', () => {
  it('ignores what syncs rewrite without moving anyone', () => {
    const resynced = {
      ...BEFORE,
      players: ['rb2', 'qb1', 'rb1'],
      lineup_updated_at: '2026-10-30T00:00:00Z',
      lineup_sections: {
        starters: BEFORE.lineup_sections.starters.map((p) => ({ ...p, name: 'Renamed', projection: 22.4, gameTime: 'Sun 1:00' })),
        bench: [{ id: 'rb2', position: 'RB', status: 'questionable' }],
      },
    }
    expect(lineupVersionOf(resynced)).toBe(lineupVersionOf(BEFORE))
  })

  it('changes when a player moves, is added, or changes slot', () => {
    const v = lineupVersionOf(BEFORE)
    expect(lineupVersionOf(SWAPPED)).not.toBe(v)
    expect(lineupVersionOf({ ...BEFORE, players: [...BEFORE.players, 'wr9'], lineup_sections: { ...BEFORE.lineup_sections, bench: [...BEFORE.lineup_sections.bench, { id: 'wr9' }] } })).not.toBe(v)
    expect(lineupVersionOf({ ...BEFORE, lineup_sections: { ...BEFORE.lineup_sections, starters: [{ id: 'qb1', slotIndex: 0 }, { id: 'rb1', slotIndex: 2 }] } })).not.toBe(v)
  })
})

describe('persistRosterLineupWithEngine with expectedLineupVersion', () => {
  it('saves when the roster is still the one the edit was made on, through the conditional write', async () => {
    expect(await save(lineupVersionOf(BEFORE))).toEqual({ ok: true })
    expect(h.state.roster.playerData).toEqual(SWAPPED)
    expect(h.state.writes[0].where.playerData.equals).toEqual(BEFORE)
  })

  it('refuses, and writes nothing, when the roster changed since — a waiver add here', async () => {
    const madeOn = lineupVersionOf(BEFORE)
    h.state.roster.playerData = { ...BEFORE, players: [...BEFORE.players, 'wr9'], lineup_sections: { ...BEFORE.lineup_sections, bench: [{ id: 'rb2' }, { id: 'wr9' }] } }
    const r = await save(madeOn)
    expect(r).toMatchObject({ ok: false, status: 409, code: 'LINEUP_CONFLICT' })
    expect(h.state.writes).toHaveLength(0)
    expect(h.state.roster.playerData.players).toContain('wr9')
  })

  it('a matching version does not get past the kickoff lock', async () => {
    h.state.lockedPlayerIds = ['rb1']
    const r = await save(lineupVersionOf(BEFORE))
    expect(r).toMatchObject({ ok: false, status: 403 })
    expect(h.state.writes).toHaveLength(0)
  })

  it('no version sent: the save behaves as before', async () => {
    h.state.roster.playerData = { ...BEFORE, players: [...BEFORE.players, 'wr9'] }
    expect(await save()).toEqual({ ok: true })
  })
})
