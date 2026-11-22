/**
 * Both lineup save paths pin a daily-lineup league's lineup to its days (lib/redraft/dailyLineups.ts),
 * INSIDE the save's own transaction, and leave every other league alone. The writer itself is covered
 * in daily-lineup-scoring.test.ts; this pins that the two callers reach it, and only when opted in.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

const DAILY_ON = { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } }

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
    roster: { findFirst: vi.fn(async () => ({ id: 'af-1', leagueId: 'L', playerData: {}, redraftRosterId: 'rr-1' })) },
    redraftRoster: {
      findFirst: vi.fn(async () => ({
        id: 'rr-1',
        leagueId: 'L',
        ownerId: 'user-1',
        players: [
          { playerId: 'p1', playerName: 'P1', position: 'PG', team: 'BOS', sport: 'NBA', slotType: 'PG', isLocked: false, injuryStatus: null, byeWeek: null },
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

beforeEach(() => {
  vi.clearAllMocks()
  h.state.settings = {}
  h.state.sport = 'NBA'
})

const engineSave = () =>
  persistRosterLineupWithEngine({
    leagueId: 'L',
    rosterId: 'af-1',
    season: 2026,
    week: 1,
    nextPlayerData: { starters: ['p1'] },
    actorUserId: 'user-1',
    source: 'user_save',
    skipLockCheck: true,
  } as never)

const routeSave = () =>
  PATCH(
    createMockNextRequest('http://localhost/api/redraft/roster', {
      method: 'PATCH',
      body: { rosterId: 'rr-1', week: 1, moves: [{ playerId: 'p1', toSlot: 'BN' }] },
    }),
  )

describe('the AF engine save', () => {
  it('pins an opted-in league\'s lineup to its days, on the transaction client', async () => {
    h.state.settings = DAILY_ON
    expect(await engineSave()).toEqual({ ok: true })
    expect(h.writeDailyLineupForSave).toHaveBeenCalledTimes(1)
    const [client, args] = h.writeDailyLineupForSave.mock.calls[0] as unknown as [unknown, Record<string, unknown>]
    expect(client).toBe(h.tx)
    expect(args).toMatchObject({ leagueId: 'L', redraftRosterId: 'rr-1', sport: 'NBA', season: 2026, week: 1, source: 'user' })
  })

  it('leaves every other league alone', async () => {
    expect(await engineSave()).toEqual({ ok: true })
    h.state.sport = 'NFL'
    h.state.settings = DAILY_ON
    expect(await engineSave()).toEqual({ ok: true })
    expect(h.writeDailyLineupForSave).not.toHaveBeenCalled()
  })
})

describe('the redraft PATCH save', () => {
  it('pins an opted-in league\'s lineup to its days, in the same transaction as the move', async () => {
    h.state.settings = DAILY_ON
    const res = await routeSave()
    expect(res.status).toBe(200)
    expect(h.tx.redraftRosterPlayer.updateMany).toHaveBeenCalledTimes(1)
    expect(h.writeDailyLineupForSave).toHaveBeenCalledTimes(1)
    const [client, args] = h.writeDailyLineupForSave.mock.calls[0] as unknown as [unknown, Record<string, unknown>]
    expect(client).toBe(h.tx)
    expect(args).toMatchObject({ leagueId: 'L', redraftRosterId: 'rr-1', sport: 'NBA', season: 2026, week: 1 })
    // The slots the move replaced, for back-filling earlier days.
    expect(args.before).toEqual(new Map([['p1', 'PG']]))
  })

  it('leaves a league not opted in alone', async () => {
    h.state.settings = { sportConfig: { lineupLockType: 'daily' } }
    const res = await routeSave()
    expect(res.status).toBe(200)
    expect(h.tx.redraftRosterPlayer.updateMany).toHaveBeenCalledTimes(1)
    expect(h.writeDailyLineupForSave).not.toHaveBeenCalled()
  })
})
