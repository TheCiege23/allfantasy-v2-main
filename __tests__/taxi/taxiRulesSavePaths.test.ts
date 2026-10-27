/**
 * Both lineup saves hold a move to the taxi rules (lib/taxi/taxiRulesService.ts): they hand the
 * check who left and joined the taxi squad, refuse with its reason, never check a commissioner
 * override, and log a promotion inside the save's own transaction. The rules themselves are in
 * taxiMoveRules.test.tsx; the harness is daily-lineup-save-paths.test.ts's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

const t = vi.hoisted(() => ({ check: vi.fn(), log: vi.fn() }))
const h = vi.hoisted(() => {
  const state = { settings: {} as unknown, sport: 'NBA' }
  const tx = {
    roster: { update: vi.fn(async () => ({})) },
    redraftRosterPlayer: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 1 })) },
  }
  const writeDailyLineupForSave = vi.fn(async () => ({ days: 1, rows: 1 }))
  const prisma = {
    league: {
      findUnique: vi.fn(async () => ({ id: 'L', sport: state.sport, settings: state.settings, platform: 'manual' })),
    },
    roster: { findFirst: vi.fn(async () => ({ id: 'af-1', leagueId: 'L', playerData: { lineup_sections: { taxi: [{ id: 'p1', name: 'P1' }] } }, redraftRosterId: 'rr-1' })) },
    redraftRoster: {
      findFirst: vi.fn(async () => ({
        id: 'rr-1',
        leagueId: 'L',
        ownerId: 'user-1',
        players: [
          { playerId: 'p1', playerName: 'P1', position: 'PG', team: 'BOS', sport: 'NBA', slotType: 'TAXI', isLocked: false, injuryStatus: null, byeWeek: null },
        ],
        season: { season: 2026, sport: state.sport, currentWeek: 1, totalWeeks: 20 },
      })),
    },
    sportsInjury: { findMany: vi.fn(async () => []) },
    sportsGame: { findMany: vi.fn(async () => []) },
    sportsPlayer: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  }
  return { state, tx, prisma, writeDailyLineupForSave }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/taxi/taxiRulesService', () => ({ checkTaxiSave: t.check, logTaxiPromotions: t.log }))
vi.mock('@/lib/redraft/dailyLineups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/redraft/dailyLineups')>()),
  writeDailyLineupForSave: h.writeDailyLineupForSave,
}))
// Engine path collaborators.
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
// Redraft route collaborators.
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'user-1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn().mockResolvedValue({ ok: true, status: 200 }) }))
vi.mock('@/lib/redraft/redraftRosterIdentity', () => ({
  resolveRedraftRosterLookup: vi.fn(async () => ({ season: { id: 's1', leagueId: 'L' }, roster: { id: 'rr-1', ownerId: 'user-1' } })),
}))
vi.mock('@/lib/redraft/rosterMoveHistory', () => ({ recordRedraftRosterMoveHistory: vi.fn() }))
vi.mock('@/lib/redraft/scoringEngine', () => ({ calculateScoreFromSportConfig: vi.fn() }))
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

const OK = { issues: [], promotions: ['p1'], seasonId: 's1', season: 2026 }
const REFUSED = { issues: [{ code: 'TAXI_PROMOTION_CLOSED', playerId: 'p1', message: "P1 can't be promoted off the taxi squad: promotions closed after week 10." }], promotions: ['p1'], seasonId: 's1', season: 2026 }

beforeEach(() => {
  vi.clearAllMocks()
  t.check.mockResolvedValue(OK)
})

const engineSave = (source = 'user_save') =>
  persistRosterLineupWithEngine({
    leagueId: 'L', rosterId: 'af-1', season: 2026, week: 11,
    nextPlayerData: { lineup_sections: { starters: [{ id: 'p1', name: 'P1' }] } }, actorUserId: 'user-1', source, skipLockCheck: true,
  } as never)

const routeSave = () =>
  PATCH(createMockNextRequest('http://localhost/api/redraft/roster', { method: 'PATCH', body: { rosterId: 'rr-1', week: 11, moves: [{ playerId: 'p1', toSlot: 'BN' }] } }))

describe('the lineup screen save', () => {
  it('hands the check the promotion, and refuses with its reason', async () => {
    t.check.mockResolvedValue(REFUSED)
    expect(await engineSave()).toEqual({ ok: false, status: 400, error: REFUSED.issues[0].message })
    expect(t.check).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'L', redraftRosterId: 'rr-1', week: 11, beforeTaxi: ['p1'], afterTaxi: [], afterRoster: ['p1'] }))
    expect(h.tx.roster.update).not.toHaveBeenCalled()
  })
  it('logs the promotion inside the save', async () => {
    expect(await engineSave()).toEqual({ ok: true })
    expect(t.log).toHaveBeenCalledWith(h.tx, expect.objectContaining({ leagueId: 'L', redraftRosterId: 'rr-1', week: 11, check: OK }))
  })
  it('a commissioner override is never checked', async () => {
    t.check.mockResolvedValue(REFUSED)
    expect(await engineSave('commissioner_override')).toEqual({ ok: true })
    expect(t.check).not.toHaveBeenCalled()
  })
})

describe('the redraft PATCH save', () => {
  it('refuses with the reason and its code, before anything is written', async () => {
    t.check.mockResolvedValue(REFUSED)
    const res = await routeSave()
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: REFUSED.issues[0].message, code: 'TAXI_PROMOTION_CLOSED' })
    expect(t.check).toHaveBeenCalledWith(expect.objectContaining({ redraftRosterId: 'rr-1', week: 11, beforeTaxi: ['p1'], afterTaxi: [], afterRoster: ['p1'] }))
    expect(h.tx.redraftRosterPlayer.updateMany).not.toHaveBeenCalled()
  })
  it('logs the promotion in the same transaction as the move', async () => {
    const res = await routeSave()
    expect(res.status).toBe(200)
    expect(t.log).toHaveBeenCalledWith(h.tx, expect.objectContaining({ leagueId: 'L', redraftRosterId: 'rr-1', week: 11, check: OK }))
  })
})
