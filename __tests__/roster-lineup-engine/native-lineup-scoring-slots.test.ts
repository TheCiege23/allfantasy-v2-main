/**
 * A native lineup save must change WHO SCORES.
 *
 * 🛑 THE BUG. Native scoring reads `RedraftRosterPlayer.slotType` (`finalizeRedraftWeek`, live
 * `scoreRosterStarters`), and the lineup engine wrote only `Roster.playerData`. A manager could
 * bench an OUT player, see "Lineup saved", and still be scored on him at the week's seal.
 *
 * So this drives the REAL `persistRosterLineupWithEngine` and the REAL `finalizeRedraftWeek`
 * over one shared in-memory `redraft_roster_players` table, and reads the starter set the
 * finalizer actually queries stats for — the effect, not the write.
 *
 * ⚠ The top-level `prisma.redraftRosterPlayer` THROWS. The sync must run on the transaction
 * client, so the lineup and the scoring projection commit together; a write outside the
 * transaction fails these tests rather than passing them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type AnyArgs = Record<string, any>
type Row = { id: string; rosterId: string; playerId: string; position: string; slotType: string; sport: string; droppedAt: Date | null }

const h = vi.hoisted(() => {
  const state = {
    rows: [] as Array<Record<string, any>>,
    league: { id: 'league-1', platform: 'manual' as string | null } as Record<string, any>,
    roster: { id: 'af-roster-1', leagueId: 'league-1', playerData: {}, redraftRosterId: 'rr-1' as string | null } as Record<string, any>,
    updateManyCalls: [] as AnyArgs[],
  }
  const redraftRosterPlayer = {
    findMany: async (args: AnyArgs) =>
      state.rows
        .filter((r) => r.rosterId === args.where.rosterId && r.droppedAt === null)
        .map((r) => ({ id: r.id, playerId: r.playerId, position: r.position, slotType: r.slotType })),
    updateMany: async (args: AnyArgs) => {
      state.updateManyCalls.push(args)
      let count = 0
      for (const r of state.rows) {
        if (args.where.id.in.includes(r.id)) {
          r.slotType = args.data.slotType
          count++
        }
      }
      return { count }
    },
  }
  const tx = {
    roster: { update: async (args: AnyArgs) => { state.roster.playerData = args.data.playerData; return state.roster } },
    redraftRosterPlayer,
  }
  const prisma = {
    league: { findUnique: async () => state.league },
    roster: { findFirst: async () => state.roster },
    redraftRosterPlayer: new Proxy({}, { get: () => { throw new Error('redraftRosterPlayer written outside the transaction') } }),
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  }
  return { state, prisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({ getRosterTemplateForLeague: vi.fn(async () => ({ slots: [] })) }))
vi.mock('@/lib/sport-defaults/LeagueVariantRegistry', () => ({ getFormatTypeForVariant: vi.fn(() => 'standard') }))
vi.mock('@/lib/roster-lineup-engine/rosterValidationService', () => ({ validateCanonicalRosterPayload: vi.fn(() => ({ ok: true, issues: [] })) }))
vi.mock('@/lib/roster-lineup-engine/lineupAssignmentSync', () => ({ syncAfRosterLineupAssignments: vi.fn(async () => {}) }))
vi.mock('@/lib/roster-lineup-engine/rosterMoveHistory', () => ({ recordAfRosterMoveHistory: vi.fn(async () => {}) }))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({
  resolveFullLineupLockContext: vi.fn(async () => ({ locked: false, lockedPlayerIds: [], policy: 'per_player', perPlayerReasons: {} })),
  upsertAfLineupLockState: vi.fn(async () => {}),
}))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn(async () => {}) }))

import { persistRosterLineupWithEngine } from '@/lib/roster-lineup-engine/lineupService'
import { finalizeRedraftWeek } from '@/lib/redraft/weekFinalizer'
import { engineLineupView, redraftSlotChanges, slotCategory } from '@/lib/league-runtime/redraftSlotType'

const AFTER_GRACE = new Date('2026-09-22T09:15:00.000Z')

function row(id: string, playerId: string, position: string, slotType: string): Row {
  return { id, rosterId: 'rr-1', playerId, position, slotType, sport: 'NFL', droppedAt: null }
}

/** The finalizer's own fake prisma, reading the SAME rows the lineup save writes. */
function finalizerPrisma() {
  const statQueries: AnyArgs[] = []
  const prisma = {
    league: { findFirst: async () => ({ bestBallMode: false, leagueType: 'redraft', leagueVariant: null }) },
    redraftSeason: { findFirst: async () => ({ id: 'season-1', leagueId: 'league-1', sport: 'NFL', season: 2026 }) },
    redraftMatchup: { findMany: vi.fn().mockResolvedValueOnce([{ id: 'm1', status: 'active' }]).mockResolvedValue([{ status: 'final' }]) },
    sportsGame: {
      findMany: async () => [
        { status: 'final', startTime: new Date('2026-09-21T20:15:00.000Z'), source: 'espn', fetchedAt: new Date('2026-09-22T08:00:00.000Z'), season: 2026, week: 2 },
      ],
    },
    redraftRoster: { findMany: async () => [{ id: 'rr-1' }] },
    // No week lineup rows (the assignment writer is mocked above), so the seal reads `slotType` —
    // the column this suite proves the save keeps current. Per-week reads: week-finalizer.test.ts.
    roster: { findMany: async () => [] },
    afRosterLineupAssignment: { findMany: async () => [] },
    redraftRosterPlayer: {
      findMany: async (args: AnyArgs) =>
        h.state.rows
          .filter((r) => args.where.rosterId.in.includes(r.rosterId) && r.droppedAt === null)
          .map((r) => ({ playerId: r.playerId, sport: r.sport, slotType: r.slotType })),
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
  return { prisma: prisma as any, statQueries }
}

/** Who the finalizer would seal as a starter for week 2 — the ids it asks the stat table about. */
async function startersAtSeal(): Promise<string[]> {
  const { prisma, statQueries } = finalizerPrisma()
  const recalculateMatchups = vi.fn(async () => ({ updated: 1, incomplete: 0, summaries: [] as any[] }))
  const res = await finalizeRedraftWeek({ seasonId: 'season-1', week: 2 }, { prisma, now: () => AFTER_GRACE, recalculateMatchups })
  expect(res.refusal).toBeNull()
  return statQueries.flatMap((q) => q.where.playerId.in as string[]).sort()
}

/** Kincaid (TE) is ruled out; Kraft comes off the bench. The top-level `starters` is left STALE,
 * exactly as `/api/leagues/roster/save` leaves it when a client sends only `lineup_sections`. */
const BEFORE = {
  starters: ['qb1', 'kincaid', 'flexrb'],
  lineup_sections: {
    starters: [{ id: 'qb1', position: 'QB' }, { id: 'kincaid', position: 'TE' }, { id: 'flexrb', position: 'RB' }],
    bench: [{ id: 'kraft', position: 'TE' }],
    ir: [{ id: 'hurt', position: 'WR' }],
  },
}
const AFTER_SWAP = {
  starters: ['qb1', 'kincaid', 'flexrb'],
  lineup_sections: {
    starters: [{ id: 'qb1', position: 'QB' }, { id: 'kraft', position: 'TE' }, { id: 'flexrb', position: 'RB' }],
    bench: [{ id: 'kincaid', position: 'TE' }],
    ir: [{ id: 'hurt', position: 'WR' }],
  },
}

function save(nextPlayerData: Record<string, unknown>) {
  return persistRosterLineupWithEngine({
    leagueId: 'league-1',
    rosterId: 'af-roster-1',
    actorUserId: 'u1',
    nextPlayerData,
    season: 2026,
    week: 2,
    source: 'user_save',
  })
}

beforeEach(() => {
  h.state.rows = [
    row('r-qb', 'qb1', 'QB', 'QB'),
    row('r-kincaid', 'kincaid', 'TE', 'TE'),
    // A starter stored under its lineup SLOT, not its position — must survive a save untouched.
    row('r-flex', 'flexrb', 'RB', 'FLEX'),
    row('r-kraft', 'kraft', 'TE', 'bench'),
    row('r-hurt', 'hurt', 'WR', 'ir'),
    // On the redraft roster but named on no lineup list — the save is not the place to retire him.
    row('r-ghost', 'ghost', 'WR', 'bench'),
  ]
  h.state.league = { id: 'league-1', platform: 'manual' }
  h.state.roster = { id: 'af-roster-1', leagueId: 'league-1', playerData: BEFORE, redraftRosterId: 'rr-1' }
  h.state.updateManyCalls = []
})

describe('a native lineup save changes who the week finalizer scores', () => {
  it('swapping a ruled-out starter for a bench player moves the starter set at the seal', async () => {
    expect(await startersAtSeal()).toEqual(['flexrb', 'kincaid', 'qb1'])

    expect(await save(AFTER_SWAP)).toEqual({ ok: true })

    expect(await startersAtSeal()).toEqual(['flexrb', 'kraft', 'qb1'])
    const bySlot = Object.fromEntries(h.state.rows.map((r) => [r.playerId, r.slotType]))
    expect(bySlot).toEqual({ qb1: 'QB', kincaid: 'bench', flexrb: 'FLEX', kraft: 'TE', hurt: 'ir', ghost: 'bench' })
  })

  it('writes only the rows that moved — an unchanged starter keeps its stored label', async () => {
    await save(AFTER_SWAP)
    const touched = h.state.updateManyCalls.flatMap((c) => c.where.id.in as string[]).sort()
    expect(touched).toEqual(['r-kincaid', 'r-kraft'])
  })

  it('saving the same lineup again writes nothing', async () => {
    await save(BEFORE)
    expect(h.state.updateManyCalls).toEqual([])
  })

  it('an IMPORTED league is a shadow twin — its redraft rows are never touched', async () => {
    h.state.league = { id: 'league-1', platform: 'sleeper' }
    const before = await startersAtSeal()

    expect(await save(AFTER_SWAP)).toEqual({ ok: true })

    expect(h.state.updateManyCalls).toEqual([])
    expect(await startersAtSeal()).toEqual(before)
  })

  it('a native roster with no linked redraft roster saves without reaching redraft tables', async () => {
    h.state.roster = { ...h.state.roster, redraftRosterId: null }
    expect(await save(AFTER_SWAP)).toEqual({ ok: true })
    expect(h.state.updateManyCalls).toEqual([])
  })
})

describe('redraftSlotChanges — the projection rule the save path applies', () => {
  const rows = [
    { id: 'a', playerId: 'kincaid', position: 'TE', slotType: 'TE' },
    { id: 'b', playerId: 'kraft', position: 'TE', slotType: 'bench' },
  ]

  it('reads lineup_sections over a stale legacy starters array', () => {
    expect(redraftSlotChanges(AFTER_SWAP, rows)).toEqual([
      { id: 'a', playerId: 'kincaid', from: 'TE', to: 'bench' },
      { id: 'b', playerId: 'kraft', from: 'bench', to: 'TE' },
    ])
    expect(engineLineupView(AFTER_SWAP)).toEqual({ lineup_sections: AFTER_SWAP.lineup_sections })
  })

  it('falls back to the legacy lists when there are no sections', () => {
    const legacy = { players: ['kincaid', 'kraft'], starters: ['kraft'], reserve: ['kincaid'] }
    expect(redraftSlotChanges(legacy, rows)).toEqual([
      { id: 'a', playerId: 'kincaid', from: 'TE', to: 'ir' },
      { id: 'b', playerId: 'kraft', from: 'bench', to: 'TE' },
    ])
  })

  it('moves to taxi and devy, and compares categories rather than labels', () => {
    const pd = { lineup_sections: { taxi: [{ id: 'kincaid' }], devy: [{ id: 'kraft' }] } }
    expect(redraftSlotChanges(pd, rows).map((c) => c.to)).toEqual(['taxi', 'devy'])
    expect(slotCategory('FLEX')).toBe('starter')
    expect(slotCategory('BN')).toBe('bench')
    expect(slotCategory('reserve')).toBe('ir')
  })
})
