/**
 * Survivor's "forced bench" disadvantage on BOTH lineup saves — the lineup screen's
 * (persistRosterLineupWithEngine, which Chimmy's lineup actions also go through) and the redraft PATCH:
 * a player a forced bench sits this week cannot be put in a starting slot (409, EN/ES message); benching
 * him, or a commissioner override, still saves. A league that is NOT Survivor never even reads the
 * reward ledger. Harness copied from __tests__/guillotine/best-ball-guillotine-lineup-saves.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

const h = vi.hoisted(() => {
  const state = { settings: {} as unknown, survivorMode: true, language: 'en' as string | null }
  const tx = {
    roster: { update: vi.fn(async () => ({})) },
    redraftRosterPlayer: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 1 })) },
  }
  const league = () => ({
    id: 'L', sport: 'NFL', settings: state.settings, platform: 'manual', language: state.language,
    guillotineMode: false, leagueType: 'redraft', leagueVariant: 'standard', lockAllMoves: false, survivorMode: state.survivorMode,
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
const rewards = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/survivor/survivorRewardEngine', () => ({ listSurvivorRewards: rewards.list }))

import { persistRosterLineupWithEngine } from '@/lib/roster-lineup-engine/lineupService'
import { PATCH } from '@/app/api/redraft/roster/route'

const P = (id: string) => ({ id, name: id.toUpperCase() })
const engineSave = (sections: Record<string, Array<{ id: string; name: string }>>, source = 'user_save') =>
  persistRosterLineupWithEngine({
    leagueId: 'L', rosterId: 'af-1', season: 2026, week: 3,
    nextPlayerData: { lineup_sections: sections }, actorUserId: 'user-1', source, skipLockCheck: true,
  } as never)
const routeSave = (moves: Array<{ playerId: string; toSlot: string }>) =>
  PATCH(createMockNextRequest('http://localhost/api/redraft/roster', { method: 'PATCH', body: { rosterId: 'rr-1', week: 3, moves } }))

/** P2 is forced to the bench on af-1 for week 3. */
const benchP2 = { spec: { type: 'forced_bench', chooserRosterId: 'af-9', targetRosterId: 'af-1', playerId: 'p2' }, status: 'applied', applyWeek: 3 }

beforeEach(() => {
  vi.clearAllMocks()
  h.state.survivorMode = true
  h.state.language = 'en'
  rewards.list.mockResolvedValue([benchP2])
})

describe('the lineup screen save (persistRosterLineupWithEngine)', () => {
  it('refuses to start the forced-bench player that week, in English, and writes nothing', async () => {
    const r = await engineSave({ starters: [P('p2')], bench: [P('p1')], ir: [P('p3')] })
    expect(r).toEqual({ ok: false, status: 409, error: 'P2 is forced to the bench by a Survivor disadvantage and cannot start in week 3.' })
    expect(h.tx.roster.update).not.toHaveBeenCalled()
  })

  it('in Spanish for a Spanish league', async () => {
    h.state.language = 'es'
    const r = await engineSave({ starters: [P('p2')], bench: [P('p1')], ir: [P('p3')] })
    expect(r).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('banca obligatoria') })
  })

  it('a lineup that benches him saves; another week or a reversed reward does not bind', async () => {
    expect(await engineSave({ starters: [P('p1')], bench: [P('p2')], ir: [P('p3')] })).toEqual({ ok: true })
    rewards.list.mockResolvedValue([{ ...benchP2, applyWeek: 4 }])
    expect(await engineSave({ starters: [P('p2')], bench: [P('p1')], ir: [P('p3')] })).toEqual({ ok: true })
    rewards.list.mockResolvedValue([{ ...benchP2, status: 'reversed' }])
    expect(await engineSave({ starters: [P('p2')], bench: [P('p1')], ir: [P('p3')] })).toEqual({ ok: true })
  })

  it('a commissioner override is never refused', async () => {
    expect(await engineSave({ starters: [P('p2')], bench: [P('p1')], ir: [P('p3')] }, 'commissioner_override')).toEqual({ ok: true })
  })

  it('a league that is NOT Survivor is untouched: the ledger is never read and the save goes through', async () => {
    h.state.survivorMode = false
    expect(await engineSave({ starters: [P('p2')], bench: [P('p1')], ir: [P('p3')] })).toEqual({ ok: true })
    expect(rewards.list).not.toHaveBeenCalled()
  })
})

describe('the redraft lineup PATCH', () => {
  it('refuses moving the forced-bench player into a starting slot (409 SURVIVOR_FORCED_BENCH)', async () => {
    const res = await routeSave([{ playerId: 'p2', toSlot: 'QB' }])
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'SURVIVOR_FORCED_BENCH', error: expect.stringContaining('P2') })
    expect(h.tx.redraftRosterPlayer.updateMany).not.toHaveBeenCalled()
  })

  it('a non-Survivor league saves the same move and never reads the ledger', async () => {
    h.state.survivorMode = false
    const res = await routeSave([{ playerId: 'p2', toSlot: 'QB' }])
    expect(res.status).toBe(200)
    expect(rewards.list).not.toHaveBeenCalled()
  })
})

