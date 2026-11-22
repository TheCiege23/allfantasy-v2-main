/**
 * Both lineup saves refuse a starter/bench shuffle in a CLASSIC Best Ball league too, not only in a best ball
 * Guilly league (lib/guillotine/guillotineBestBall.ts `lineupSetsItself`, scoring's own test). Before, the
 * refusal read `isBestBallGuillotine`, so a Classic save "succeeded" and changed nothing. IR/taxi moves, a
 * commissioner override and an import still save; a league that is not best ball saves as before. The harness
 * is __tests__/guillotine/best-ball-guillotine-lineup-saves.test.ts's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

const h = vi.hoisted(() => {
  const state = { settings: {} as unknown, league: { guillotineMode: false, leagueType: 'redraft', leagueVariant: null as string | null, bestBallMode: true as boolean | null } }
  const tx = {
    roster: { update: vi.fn(async () => ({})) },
    redraftRosterPlayer: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 1 })) },
  }
  const league = () => ({
    id: 'L', sport: 'NBA', settings: state.settings, platform: 'manual',
    ...state.league, lockAllMoves: false, survivorMode: false,
  })
  const prisma = {
    league: { findUnique: vi.fn(async () => league()) },
    roster: {
      findFirst: vi.fn(async () => ({
        id: 'af-1', leagueId: 'L', redraftRosterId: 'rr-1',
        playerData: { lineup_sections: { starters: [{ id: 'p1', name: 'P1' }], bench: [{ id: 'p2', name: 'P2' }], ir: [{ id: 'p3', name: 'P3' }] } },
      })),
    },
    redraftRoster: {
      findFirst: vi.fn(async () => ({
        id: 'rr-1', leagueId: 'L', ownerId: 'user-1',
        players: [
          { playerId: 'p1', playerName: 'P1', position: 'PG', team: 'BOS', sport: 'NBA', slotType: 'PG', isLocked: false, injuryStatus: null, byeWeek: null },
          { playerId: 'p2', playerName: 'P2', position: 'PG', team: 'NYK', sport: 'NBA', slotType: 'BN', isLocked: false, injuryStatus: null, byeWeek: null },
          { playerId: 'p3', playerName: 'P3', position: 'PG', team: 'LAL', sport: 'NBA', slotType: 'IR', isLocked: false, injuryStatus: 'OUT', byeWeek: null },
        ],
        season: { season: 2026, sport: 'NBA', currentWeek: 1, totalWeeks: 20 },
      })),
    },
    sportsInjury: { findMany: vi.fn(async () => []) },
    sportsGame: { findMany: vi.fn(async () => []) },
    sportsPlayer: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  }
  return { state, tx, prisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/taxi/taxiRulesService', () => ({
  checkTaxiSave: vi.fn(async () => ({ issues: [], promotions: [], seasonId: 's1', season: 2026 })),
  logTaxiPromotions: vi.fn(),
}))
vi.mock('@/lib/redraft/dailyLineups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/redraft/dailyLineups')>()),
  writeDailyLineupForSave: vi.fn(async () => ({ days: 1, rows: 1 })),
}))
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
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'user-1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn().mockResolvedValue({ ok: true, status: 200 }) }))
vi.mock('@/lib/redraft/redraftRosterIdentity', () => ({
  resolveRedraftRosterLookup: vi.fn(async () => ({ season: { id: 's1', leagueId: 'L' }, roster: { id: 'rr-1', ownerId: 'user-1' } })),
}))
vi.mock('@/lib/redraft/rosterMoveHistory', () => ({ recordRedraftRosterMoveHistory: vi.fn() }))
vi.mock('@/lib/redraft/scoringEngine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/redraft/scoringEngine')>()),
  calculateScoreFromSportConfig: vi.fn(),
}))
vi.mock('@/lib/redraft/lineupLock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/redraft/lineupLock')>()),
  hydrateRedraftLineupLocks: vi.fn(async (_db: unknown, args: { players: unknown[] }) => ({ players: args.players, warnings: [] })),
}))
vi.mock('@/lib/redraft/lineupValidation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/redraft/lineupValidation')>()),
  validateRedraftLineup: vi.fn(() => ({ ok: true, issues: [] })),
}))

import { persistRosterLineupWithEngine } from '@/lib/roster-lineup-engine/lineupService'
import { PATCH } from '@/app/api/redraft/roster/route'
import { BEST_BALL_LINEUP_CODE, BEST_BALL_LINEUP_MESSAGE, lineupSetsItself } from '@/lib/guillotine/guillotineBestBall'
import { leagueIsBestBall } from '@/lib/redraft/scoringEngine'

const P = (id: string) => ({ id, name: id.toUpperCase() })
const engineSave = (sections: Record<string, Array<{ id: string; name: string }>>, source = 'user_save') =>
  persistRosterLineupWithEngine({
    leagueId: 'L', rosterId: 'af-1', season: 2026, week: 3,
    nextPlayerData: { lineup_sections: sections }, actorUserId: 'user-1', source, skipLockCheck: true,
  } as never)
const routeSave = (moves: Array<{ playerId: string; toSlot: string }>) =>
  PATCH(createMockNextRequest('http://localhost/api/redraft/roster', { method: 'PATCH', body: { rosterId: 'rr-1', week: 3, moves } }))
const SHUFFLE = { starters: [P('p2')], bench: [P('p1')], ir: [P('p3')] }
const NOT_BEST_BALL = { guillotineMode: false, leagueType: 'redraft', leagueVariant: null, bestBallMode: false }

beforeEach(() => {
  vi.clearAllMocks()
  h.state.settings = {}
  h.state.league = { guillotineMode: false, leagueType: 'redraft', leagueVariant: null, bestBallMode: true }
})

describe("lineupSetsItself is scoring's own test", () => {
  it.each([
    [{ bestBallMode: true }, true],
    [{ leagueVariant: 'best_ball' }, true],
    [{ leagueType: 'best_ball' }, true],
    [{ guillotineMode: true, settings: { best_ball: true } }, true],
    [{ guillotineMode: true, settings: {} }, false],
    // An imported league carrying only the provider's flag: scoring reads its slots, so saves go through.
    [{ leagueType: 'redraft', settings: { best_ball: true } }, false],
    [{ leagueType: 'redraft' }, false],
  ])('%j -> %s', (league, expected) => {
    expect(lineupSetsItself(league)).toBe(expected)
    expect(leagueIsBestBall(league)).toBe(expected)
  })
})

describe('Classic Best Ball: the lineup screen save (persistRosterLineupWithEngine)', () => {
  it('refuses swapping a starter and a bench player, with the best ball code, and writes nothing', async () => {
    expect(await engineSave(SHUFFLE)).toEqual({ ok: false, status: 409, error: BEST_BALL_LINEUP_MESSAGE, code: BEST_BALL_LINEUP_CODE })
    expect(h.tx.roster.update).not.toHaveBeenCalled()
  })

  it('refuses it when best ball is carried by leagueType or the variant instead of the column', async () => {
    h.state.league = { guillotineMode: false, leagueType: 'best_ball', leagueVariant: null, bestBallMode: null }
    expect(await engineSave(SHUFFLE)).toMatchObject({ ok: false, code: BEST_BALL_LINEUP_CODE })
    h.state.league = { guillotineMode: false, leagueType: 'redraft', leagueVariant: 'best_ball', bestBallMode: null }
    expect(await engineSave(SHUFFLE)).toMatchObject({ ok: false, code: BEST_BALL_LINEUP_CODE })
  })

  it('refuses a system save that shuffles starters', async () => {
    expect(await engineSave(SHUFFLE, 'system')).toMatchObject({ ok: false, code: BEST_BALL_LINEUP_CODE })
  })

  it('still saves a move onto IR, and back off it', async () => {
    expect(await engineSave({ starters: [P('p1')], bench: [], ir: [P('p3'), P('p2')] })).toEqual({ ok: true })
    expect(await engineSave({ starters: [P('p1')], bench: [P('p2'), P('p3')], ir: [] })).toEqual({ ok: true })
  })

  it('a commissioner override and an import still save a shuffle', async () => {
    expect(await engineSave(SHUFFLE, 'commissioner_override')).toEqual({ ok: true })
    expect(await engineSave(SHUFFLE, 'import')).toEqual({ ok: true })
  })

  it('a league that is not best ball saves the shuffle as before', async () => {
    h.state.league = NOT_BEST_BALL
    expect(await engineSave(SHUFFLE)).toEqual({ ok: true })
  })
})

describe('Classic Best Ball: the redraft PATCH save', () => {
  it('refuses a bench player into a starting slot, with its code, before anything is written', async () => {
    const res = await routeSave([{ playerId: 'p2', toSlot: 'PG' }])
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: BEST_BALL_LINEUP_MESSAGE, code: 'best_ball_lineup' })
    expect(h.tx.redraftRosterPlayer.updateMany).not.toHaveBeenCalled()
  })

  it('still saves a move onto IR, and back off it', async () => {
    expect((await routeSave([{ playerId: 'p2', toSlot: 'IR' }])).status).toBe(200)
    expect((await routeSave([{ playerId: 'p3', toSlot: 'BN' }])).status).toBe(200)
  })

  it('a league that is not best ball saves the move as before', async () => {
    h.state.league = NOT_BEST_BALL
    expect((await routeSave([{ playerId: 'p2', toSlot: 'PG' }])).status).toBe(200)
  })
})
