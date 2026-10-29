/**
 * Inactive manager mode ends when the OWNER saves a lineup of their own (lib/inactive-manager), checked
 * through the REAL lineup engine. Harness copied from lineup-saved-layout-engine.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
const ended = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@/lib/inactive-manager/inactiveManagerService', () => ({ endInactiveManagerModeOnOwnerSave: ended }))

import { persistRosterLineupWithEngine } from '@/lib/roster-lineup-engine/lineupService'

const tslot = (slotName: string, allowedPositions: string[], starterCount: number, slotOrder: number, extra: AnyArgs = {}) => ({
  slotName, allowedPositions, starterCount, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: allowedPositions.length > 1, slotOrder, ...extra,
})
const NFL_TEMPLATE = {
  templateId: 'nfl', name: 'nfl', formatType: 'standard',
  slots: [tslot('QB', ['QB'], 1, 0), tslot('RB', ['RB'], 2, 1), tslot('WR', ['WR'], 1, 2), tslot('FLEX', ['RB', 'WR', 'TE'], 1, 3), tslot('BN', ['*'], 0, 4, { benchCount: 6, reserveCount: 1 })],
}
const LEAGUE_BASE = {
  id: 'league-1', platform: 'manual', leagueVariant: null, lifecycleState: 'in_season', lockAllMoves: false,
  irAllowOut: true, irAllowCovid: true, irAllowSuspended: true, irAllowNA: true, irAllowDNR: true, irAllowDoubtful: false,
  taxiSlots: 0, taxiAllowNonRookies: false, taxiYearsLimit: null, guillotineMode: false, bestBallMode: false, isDynasty: false, keeperPhaseActive: false,
}


const lineup = {
  lineup_sections: { starters: [{ id: 'qb', position: 'QB', slotIndex: 0 }], bench: [{ id: 'rb', position: 'RB' }], ir: [], taxi: [], devy: [] },
  starters: ['qb'],
}

function arrange(managed: boolean) {
  h.state.league = { ...LEAGUE_BASE, sport: 'NFL', leagueType: 'redraft', settings: managed ? { af_managed_lineups: { 'af-roster-1': { since: 'x', byUserId: 'commish' } } } : {} }
  h.state.template = { templateId: 'nfl', name: 'nfl', formatType: 'standard', slots: [tslot('QB', ['QB'], 1, 0), tslot('BN', ['*'], 0, 1, { benchCount: 6 })] }
  h.state.roster = { id: 'af-roster-1', leagueId: 'league-1', platformUserId: 'owner', playerData: lineup, redraftRosterId: null }
  h.state.lockedPlayerIds = []
  h.state.rows = []
}

const save = (source: 'user_save' | 'system' | 'commissioner_override', actorUserId: string) =>
  persistRosterLineupWithEngine({ leagueId: 'league-1', rosterId: 'af-roster-1', actorUserId, nextPlayerData: lineup, season: 2026, week: 3, source })

beforeEach(() => vi.clearAllMocks())

describe('inactive manager mode and the lineup engine', () => {
  it("ends when the owner saves their own lineup", async () => {
    arrange(true)
    expect(await save('user_save', 'owner')).toEqual({ ok: true })
    expect(ended).toHaveBeenCalledWith('league-1', 'af-roster-1', 'owner')
  })

  it("does not end on AllFantasy's own save, a commissioner override, or someone else's save", async () => {
    arrange(true)
    await save('system', 'owner')
    await save('commissioner_override', 'commish')
    await save('user_save', 'someone-else')
    expect(ended).not.toHaveBeenCalled()
  })

  it('costs an ordinary save nothing: no lookup when the team is not managed', async () => {
    arrange(false)
    await save('user_save', 'owner')
    expect(ended).not.toHaveBeenCalled()
  })

  it("never fails the owner's save when ending it throws", async () => {
    arrange(true)
    ended.mockRejectedValueOnce(new Error('db down'))
    expect(await save('user_save', 'owner')).toEqual({ ok: true })
  })
})
