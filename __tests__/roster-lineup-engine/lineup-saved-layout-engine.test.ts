/**
 * Saved-layout starter slots through the REAL lineup engine. Harness copied from
 * __tests__/roster-lineup-engine/lineup-slot-positions-engine.test.ts.
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

// ── Saved-layout redraft league (owner, 2026-10-20) ─────────────────────────────────────────────
// A redraft-core NFL league that saved the 6-slot cut lineup QB, RB, WR, WR, TE, DEF. The screen
// (GET /api/league/roster) and the engine must both index THAT list — not the 9-slot default.

const CUT_SETTINGS = { starter_slots: { QB: 1, RB: 1, WR: 2, TE: 1, DEF: 1 }, bench_slots: 6, ir_slots: 1 }
const sQb = { id: 'sQb', position: 'QB' }
const sRb = { id: 'sRb', position: 'RB' }
const sWr1 = { id: 'sWr1', position: 'WR' }
const sWr2 = { id: 'sWr2', position: 'WR' }
const sTe = { id: 'sTe', position: 'TE' }
const sDef = { id: 'sDef', position: 'DEF' }
const SAVED_PLAYERS = [sQb, sRb, sWr1, sWr2, sTe, sDef]

const SAVED_TEMPLATE = {
  templateId: 'saved-NFL-league-1', name: 'Saved League Roster', formatType: 'standard',
  slots: [
    tslot('QB', ['QB'], 1, 0), tslot('RB', ['RB'], 1, 1), tslot('WR', ['WR'], 2, 2), tslot('TE', ['TE'], 1, 3),
    tslot('DST', ['DEF', 'DST', 'D/ST'], 1, 4), tslot('BENCH', ['QB', 'RB', 'WR', 'TE', 'DEF', 'DST', 'D/ST'], 0, 5, { benchCount: 6 }),
    tslot('IR', ['QB', 'RB', 'WR', 'TE', 'DEF', 'DST', 'D/ST'], 0, 6, { reserveCount: 1 }),
  ],
}

function arrangeSavedLayout(settings: Record<string, unknown>) {
  h.state.league = { ...LEAGUE_BASE, sport: 'NFL', leagueType: 'redraft', isDynasty: false, settings }
  // What getRosterTemplateForLeague returns for this league in production: RosterTemplateService builds
  // a `saved-NFL-<leagueId>` template from the same saved layout (roster-template-saved-layout.test.ts).
  h.state.template = SAVED_TEMPLATE
  h.state.roster = { id: 'af-roster-1', leagueId: 'league-1', playerData: {}, redraftRosterId: 'rr-1' }
  h.state.lockedPlayerIds = []
  h.state.rows = SAVED_PLAYERS.map((p, i) => ({ id: `row-${i}`, rosterId: 'rr-1', playerId: p.id, position: p.position, slotType: 'bench', sport: 'NFL', droppedAt: null }))
  h.state.assignments = []
  h.state.daily = []
}

describe('a redraft league with a saved layout is validated against THAT layout', () => {
  it('resolveLineupStarterSlots expands the saved 6 slots, not the 9-slot default', () => {
    const slots = resolveLineupStarterSlots({ sport: 'NFL', leagueType: 'redraft', settings: CUT_SETTINGS }, NFL_TEMPLATE as never)
    expect(slots.map((s) => s.label)).toEqual(['QB', 'RB', 'WR1', 'WR2', 'TE', 'DEF'])
  })

  it('a positioned save of the saved lineup succeeds; each slotIndex resolves against the saved list', async () => {
    arrangeSavedLayout(CUT_SETTINGS)
    // slotIndex 2 and 3 are WR1 / WR2 in the saved list (they would be RB2 / WR1 in the default).
    expect(await save(payload([sQb, sRb, sWr1, sWr2, sTe, sDef], [], true))).toEqual({ ok: true })
    const stored = h.state.roster.playerData as { lineup_sections: { starters: Array<{ id: string; slotIndex: number }> } }
    expect(stored.lineup_sections.starters.map((r) => [r.id, r.slotIndex])).toEqual([
      ['sQb', 0], ['sRb', 1], ['sWr1', 2], ['sWr2', 3], ['sTe', 4], ['sDef', 5],
    ])
  })

  it('a WR in the saved RB slot is still refused', async () => {
    arrangeSavedLayout(CUT_SETTINGS)
    const r = await save(payload([sQb, sWr1, null, sWr2, sTe, sDef], [sRb], true)) // sWr1 at slot 1 = RB
    expect(r).toMatchObject({ ok: false, status: 400 })
  })

  it('a redraft league with no saved layout still gets the 9-slot default', () => {
    const slots = resolveLineupStarterSlots({ sport: 'NFL', leagueType: 'redraft', settings: {} }, NFL_TEMPLATE as never)
    expect(slots).toHaveLength(9)
  })
})
