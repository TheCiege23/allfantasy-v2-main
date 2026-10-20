/**
 * Starter slot positions through the REAL lineup engine (`persistRosterLineupWithEngine`):
 *
 *  - the server rejects a positioned starter who is not eligible for his slot, using the SAME slot
 *    layout GET /api/league/roster hands the screen (`resolveLineupStarterSlots`);
 *  - a position is what the starter holds, not WHETHER he starts: `RedraftRosterPlayer.slotType`,
 *    the week's `af_roster_lineup_assignments`, the week finalizer's starter set and a daily league's
 *    `redraft_daily_lineups` rows come out identical for a positioned and an unpositioned save;
 *  - the per-player lock compares a starter's SLOT when both sides carry one.
 *
 * One in-memory store stands in for every table the save writes; the finalizer reads the same rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type AnyArgs = Record<string, any>

const h = vi.hoisted(() => {
  const state = {
    league: {} as Record<string, any>,
    roster: {} as Record<string, any>,
    template: { slots: [] } as Record<string, any>,
    lockedPlayerIds: [] as string[],
    rows: [] as Array<Record<string, any>>,
    assignments: [] as Array<Record<string, any>>,
    daily: [] as Array<Record<string, any>>,
  }
  const tx = {
    roster: { update: async (args: AnyArgs) => { state.roster.playerData = args.data.playerData; return state.roster } },
    redraftRosterPlayer: {
      findMany: async (args: AnyArgs) =>
        state.rows
          .filter((r) => r.rosterId === args.where.rosterId && r.droppedAt === null)
          .map((r) => ({ id: r.id, playerId: r.playerId, position: r.position, slotType: r.slotType })),
      updateMany: async (args: AnyArgs) => {
        let count = 0
        for (const r of state.rows) if (args.where.id.in.includes(r.id)) { r.slotType = args.data.slotType; count++ }
        return { count }
      },
    },
    afRosterLineupAssignment: {
      deleteMany: async (args: AnyArgs) => { state.assignments = state.assignments.filter((a) => !(a.rosterId === args.where.rosterId && a.week === args.where.week)); return { count: 0 } },
      createMany: async (args: AnyArgs) => { state.assignments.push(...args.data); return { count: args.data.length } },
    },
    redraftDailyLineup: {
      findMany: async () => [],
      deleteMany: async () => { state.daily = []; return { count: 0 } },
      createMany: async (args: AnyArgs) => { state.daily.push(...args.data); return { count: args.data.length } },
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
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({ getRosterTemplateForLeague: vi.fn(async () => h.state.template) }))
vi.mock('@/lib/sport-defaults/LeagueVariantRegistry', () => ({ getFormatTypeForVariant: vi.fn(() => 'standard') }))
vi.mock('@/lib/league/commissioner-roster-lock', () => ({ isCommissionerRosterLocked: vi.fn(async () => false) }))
vi.mock('@/lib/roster-lineup-engine/rosterMoveHistory', () => ({ recordAfRosterMoveHistory: vi.fn(async () => {}) }))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({
  resolveFullLineupLockContext: vi.fn(async () => ({ locked: false, lockedPlayerIds: h.state.lockedPlayerIds, policy: 'per_player', perPlayerReasons: {} })),
  upsertAfLineupLockState: vi.fn(async () => {}),
}))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn(async () => {}) }))

import { movedLockedLineupPlayer, persistRosterLineupWithEngine } from '@/lib/roster-lineup-engine/lineupService'
import { resolveLineupStarterSlots } from '@/lib/league/lineupStarterSlots'
import { expandStarterSlots } from '@/lib/league/lineup-expand-template'
import { buildPersistedRosterDataFromRosterState } from '@/lib/roster/buildPersistedRosterDataFromRosterState'
import { isScoringStarterSlot } from '@/lib/redraft/scoringEngine'
import { finalizeRedraftWeek } from '@/lib/redraft/weekFinalizer'
import { dailySlotFor, type DailyLineups } from '@/lib/redraft/dailyLineups'

const tslot = (slotName: string, allowedPositions: string[], starterCount: number, slotOrder: number, extra: AnyArgs = {}) => ({
  slotName, allowedPositions, starterCount, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: allowedPositions.length > 1, slotOrder, ...extra,
})
const NFL_TEMPLATE = {
  templateId: 'nfl', name: 'nfl', formatType: 'standard',
  slots: [tslot('QB', ['QB'], 1, 0), tslot('RB', ['RB'], 2, 1), tslot('WR', ['WR'], 1, 2), tslot('FLEX', ['RB', 'WR', 'TE'], 1, 3), tslot('BN', ['*'], 0, 4, { benchCount: 6, reserveCount: 1 })],
}
const NBA_TEMPLATE = {
  templateId: 'nba', name: 'nba', formatType: 'standard',
  slots: [tslot('PG', ['PG'], 1, 0), tslot('G', ['PG', 'SG'], 1, 1), tslot('UTIL', ['PG', 'SG', 'SF', 'PF', 'C'], 1, 2), tslot('BN', ['*'], 0, 3, { benchCount: 5, reserveCount: 1 })],
}
const LEAGUE_BASE = {
  id: 'league-1', platform: 'manual', leagueVariant: null, lifecycleState: 'in_season', lockAllMoves: false,
  irAllowOut: true, irAllowCovid: true, irAllowSuspended: true, irAllowNA: true, irAllowDNR: true, irAllowDoubtful: false,
  taxiSlots: 0, taxiAllowNonRookies: false, taxiYearsLimit: null, guillotineMode: false, bestBallMode: false, isDynasty: false, keeperPhaseActive: false,
}

type P = { id: string; position: string }
/** The screen's payload: one row per filled slot, with that slot's index (or none, for a legacy writer). */
function payload(layout: Array<P | null>, bench: P[], positioned: boolean) {
  const starters = layout
    .map((p, i) => (p ? { ...p, name: p.id, ...(positioned ? { slotIndex: i } : {}) } : null))
    .filter(Boolean)
  return JSON.parse(JSON.stringify(buildPersistedRosterDataFromRosterState({ starters, bench, ir: [], taxi: [], devy: [] }, {})))
}
const save = (nextPlayerData: Record<string, unknown>, week = 2) =>
  persistRosterLineupWithEngine({ leagueId: 'league-1', rosterId: 'af-roster-1', actorUserId: 'u1', nextPlayerData, season: 2026, week, source: 'user_save' })

function arrange(sport: 'NFL' | 'NBA', players: P[], storedPlayerData: unknown = {}) {
  h.state.league = { ...LEAGUE_BASE, sport, leagueType: sport === 'NFL' ? 'dynasty' : 'redraft', settings: sport === 'NBA' ? { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } } : {} }
  h.state.template = sport === 'NFL' ? NFL_TEMPLATE : NBA_TEMPLATE
  h.state.roster = { id: 'af-roster-1', leagueId: 'league-1', playerData: storedPlayerData, redraftRosterId: 'rr-1' }
  h.state.lockedPlayerIds = []
  h.state.rows = players.map((p, i) => ({ id: `row-${i}`, rosterId: 'rr-1', playerId: p.id, position: p.position, slotType: 'bench', sport, droppedAt: null }))
  h.state.assignments = []
  h.state.daily = []
}
const slotTypes = (): Record<string, string> => Object.fromEntries(h.state.rows.map((r) => [String(r.playerId), String(r.slotType)]))

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.useRealTimers())

// NFL: QB, RB1, RB2, WR, FLEX. RB2 left EMPTY, the FLEX holds an RB.
const qb = { id: 'qb', position: 'QB' }
const rbA = { id: 'rbA', position: 'RB' }
const rbB = { id: 'rbB', position: 'RB' }
const wr = { id: 'wr', position: 'WR' }
const rbF = { id: 'rbF', position: 'RB' }
const NFL_LAYOUT = [qb, rbA, null, wr, rbF]
const NFL_PLAYERS = [qb, rbA, rbB, wr, rbF]

describe('the server rejects an ineligible player in a slot', () => {
  it('a WR in an RB slot is refused with a 400, and nothing is written', async () => {
    arrange('NFL', NFL_PLAYERS)
    const bad = payload([qb, wr, null, null, rbF], [rbA, rbB], true) // wr at slot 1 = RB1
    const r = await save(bad)
    expect(r).toMatchObject({ ok: false, status: 400 })
    if (!r.ok) expect(r.error).toMatch(/RB1/)
    expect(h.state.roster.playerData).toEqual({})
    expect(h.state.assignments).toEqual([])
  })

  it('the same lineup with an empty slot in a legal layout saves, and the positions are stored', async () => {
    arrange('NFL', NFL_PLAYERS)
    expect(await save(payload(NFL_LAYOUT, [rbB], true))).toEqual({ ok: true })
    const stored = h.state.roster.playerData as { lineup_sections: { starters: Array<{ id: string; slotIndex: number }> } }
    expect(stored.lineup_sections.starters.map((r) => [r.id, r.slotIndex])).toEqual([['qb', 0], ['rbA', 1], ['wr', 3], ['rbF', 4]])
    // af_roster_lineup_assignments records each starter's SLOT; the other sections keep their order.
    const starters = h.state.assignments.filter((a) => a.section === 'starters').map((a) => [a.playerId, a.slotIndex])
    expect(starters).toEqual([['qb', 0], ['rbA', 1], ['wr', 3], ['rbF', 4]])
    expect(h.state.assignments.filter((a) => a.section === 'bench').map((a) => [a.playerId, a.slotIndex])).toEqual([['rbB', 0]])
  })

  it('an unpositioned save (every other writer) still writes compact assignment indices', async () => {
    arrange('NFL', NFL_PLAYERS)
    expect(await save(payload(NFL_LAYOUT, [rbB], false))).toEqual({ ok: true })
    expect(h.state.assignments.filter((a) => a.section === 'starters').map((a) => a.slotIndex)).toEqual([0, 1, 2, 3])
  })
})

describe('scoring and starter detection are unchanged for positioned slots', () => {
  async function weekly(positioned: boolean) {
    arrange('NFL', NFL_PLAYERS)
    expect(await save(payload(NFL_LAYOUT, [rbB], positioned))).toEqual({ ok: true })
    return { slotTypes: slotTypes(), sealed: await startersAtSeal() }
  }

  it('weekly (NFL): slotType, isScoringStarterSlot and the week finalizer\'s starters match', async () => {
    const positioned = await weekly(true)
    const legacy = await weekly(false)
    expect(positioned.slotTypes).toEqual(legacy.slotTypes)
    // A starter's slotType is his POSITION, whatever slot index he holds.
    expect(positioned.slotTypes).toEqual({ qb: 'QB', rbA: 'RB', rbB: 'bench', wr: 'WR', rbF: 'RB' })
    expect(Object.entries(positioned.slotTypes).filter(([, s]) => isScoringStarterSlot(s)).map(([id]) => id).sort()).toEqual(['qb', 'rbA', 'rbF', 'wr'])
    expect(positioned.sealed).toEqual(['qb', 'rbA', 'rbF', 'wr'])
    expect(positioned.sealed).toEqual(legacy.sealed)
  })

  it('daily (NBA): the redraft_daily_lineups rows match, day by day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-24T16:00:00.000Z'))
    const pg = { id: 'pg', position: 'PG' }
    const sg = { id: 'sg', position: 'SG' }
    const c = { id: 'c', position: 'C' }
    const players = [pg, sg, c]
    // PG slot empty; G holds the SG; UTIL holds the C.
    const run = async (positioned: boolean) => {
      arrange('NBA', players)
      expect(await save(payload([null, sg, c], [pg], positioned), 1)).toEqual({ ok: true })
      return h.state.daily.map((d) => `${d.scoringDay.toISOString().slice(0, 10)} ${d.playerId} ${d.slotType}`).sort()
    }
    const positioned = await run(true)
    const legacy = await run(false)
    expect(positioned.length).toBeGreaterThan(0)
    expect(positioned).toEqual(legacy)
    const lineups: DailyLineups = new Map([['rr-1', new Map()]])
    for (const d of h.state.daily) {
      const byPlayer = lineups.get('rr-1')!
      const byDay = byPlayer.get(d.playerId) ?? new Map<string, string>()
      byDay.set(d.scoringDay.toISOString().slice(0, 10), d.slotType)
      byPlayer.set(d.playerId, byDay)
    }
    const day = new Date('2026-10-25T12:00:00.000Z')
    expect(isScoringStarterSlot(dailySlotFor(lineups, 'rr-1', 'sg', day))).toBe(true)
    expect(isScoringStarterSlot(dailySlotFor(lineups, 'rr-1', 'c', day))).toBe(true)
    expect(isScoringStarterSlot(dailySlotFor(lineups, 'rr-1', 'pg', day))).toBe(false)
  })
})

describe('the slot layout the server validates against is the one the screen was given', () => {
  it('an NFL redraft league uses the locked default order (as GET /api/league/roster does)', () => {
    const slots = resolveLineupStarterSlots({ sport: 'NFL', leagueType: 'redraft', settings: {} }, NFL_TEMPLATE as never)
    expect(slots.map((s) => s.label)).toEqual(['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'K', 'DEF'])
    expect(slots[6].allowedPositions).toEqual(['RB', 'WR', 'TE'])
  })

  it('every other league expands its own template', () => {
    expect(resolveLineupStarterSlots({ sport: 'NFL', leagueType: 'dynasty', isDynasty: true, settings: {} }, NFL_TEMPLATE as never)).toEqual(expandStarterSlots(NFL_TEMPLATE as never))
    expect(resolveLineupStarterSlots({ sport: 'NBA', leagueType: 'redraft', settings: {} }, NBA_TEMPLATE as never)).toEqual(expandStarterSlots(NBA_TEMPLATE as never))
  })
})

describe('locked starters keep their exact SLOT', () => {
  const pd = (rows: Array<[string, number | undefined]>, bench: string[] = []) => ({
    lineup_sections: { starters: rows.map(([id, slotIndex]) => ({ id, position: 'RB', ...(slotIndex == null ? {} : { slotIndex }) })), bench: bench.map((id) => ({ id })) },
  })

  it('emptying a slot BEFORE a locked starter does not move him (his slot is unchanged)', () => {
    const before = pd([['a', 0], ['lockedRb', 2]])
    const after = pd([['lockedRb', 2]], ['a'])
    expect(movedLockedLineupPlayer(before, after, ['lockedRb'])).toBeNull()
  })

  it('moving a locked starter to another slot is caught even when his compact index is unchanged', () => {
    expect(movedLockedLineupPlayer(pd([['lockedRb', 1]]), pd([['lockedRb', 2]]), ['lockedRb'])).toBe('lockedRb')
  })

  it('without positions on both sides it compares the compact index, as before', () => {
    expect(movedLockedLineupPlayer(pd([['a', undefined], ['lockedRb', undefined]]), pd([['lockedRb', 1]], ['a']), ['lockedRb'])).toBe('lockedRb')
    expect(movedLockedLineupPlayer(pd([['lockedRb', undefined]]), pd([['lockedRb', 0]]), ['lockedRb'])).toBeNull()
  })

  it('the engine refuses a save that moves a locked starter between slots', async () => {
    arrange('NFL', NFL_PLAYERS, payload(NFL_LAYOUT, [rbB], true))
    h.state.lockedPlayerIds = ['rbF']
    // rbF from FLEX (4) into the empty RB2 (2).
    const r = await save(payload([qb, rbA, rbF, wr, null], [rbB], true))
    expect(r).toMatchObject({ ok: false, status: 403 })
  })
})

/** Who the finalizer seals as a starter for week 2, reading the assignment rows this save wrote. */
async function startersAtSeal(): Promise<string[]> {
  const statQueries: AnyArgs[] = []
  const prisma = {
    league: { findFirst: async () => ({ bestBallMode: false, leagueType: 'redraft', leagueVariant: null }) },
    redraftSeason: { findFirst: async () => ({ id: 'season-1', leagueId: 'league-1', sport: 'NFL', season: 2026 }) },
    redraftMatchup: { findMany: vi.fn().mockResolvedValueOnce([{ id: 'm1', status: 'active' }]).mockResolvedValue([{ status: 'final' }]) },
    sportsGame: {
      findMany: async () => [{ status: 'final', startTime: new Date('2026-09-21T20:15:00.000Z'), source: 'espn', fetchedAt: new Date('2026-09-22T08:00:00.000Z'), season: 2026, week: 2 }],
    },
    redraftRoster: { findMany: async () => [{ id: 'rr-1' }] },
    roster: { findMany: async () => [{ id: 'af-roster-1', redraftRosterId: 'rr-1', league: { platform: 'manual' } }] },
    afRosterLineupAssignment: {
      findMany: async () => h.state.assignments.map((a) => ({ rosterId: a.rosterId, section: a.section, playerId: a.playerId })),
    },
    redraftRosterPlayer: {
      // Every row reads as BENCH: the seal must take the starters from the week's assignment rows.
      findMany: async () => h.state.rows.map((r) => ({ rosterId: r.rosterId, playerId: r.playerId, sport: r.sport, slotType: 'bench', position: r.position })),
    },
    playerWeeklyScore: {
      findMany: async (args: AnyArgs) => {
        statQueries.push(args)
        return (args.where.playerId.in as string[]).map((playerId) => ({ playerId, sport: 'NFL' }))
      },
      createMany: async (args: AnyArgs) => ({ count: args.data.length }),
      updateMany: async () => ({ count: 0 }),
    },
  }
  const recalculateMatchups = vi.fn(async () => ({ updated: 1, incomplete: 0, summaries: [] as any[] }))
  const res = await finalizeRedraftWeek({ seasonId: 'season-1', week: 2 }, { prisma: prisma as any, now: () => new Date('2026-09-22T09:15:00.000Z'), recalculateMatchups })
  expect(res.refusal).toBeNull()
  return statQueries.flatMap((q) => q.where.playerId.in as string[]).sort()
}
