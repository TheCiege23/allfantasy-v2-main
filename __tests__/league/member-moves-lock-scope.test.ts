/**
 * The commissioner's move lock (`League.lockAllMoves`) on the write paths that skipped it.
 *
 * The screens' own paths already refused under it — the lineup save (persistRosterLineupWithEngine →
 * validateCanonicalRosterPayload), the waiver claim and add/drop (assertWaiverClaimEligibility) and the
 * redraft trade routes (lib/redraft/tradeMoveLock.ts). Three routes with no UI caller wrote anyway, which
 * made the lock a matter of which URL a member typed:
 *  - PATCH /api/redraft/roster (lineup and IR slot moves),
 *  - POST /api/redraft/waivers and POST /waiver-wire/claim (redraft waiver claims the waiver cron processes).
 * And the commissioner's own roster override was refused BY the lock, because `skipLockCheck` did not
 * reach the payload validation where the lock is also checked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

const h = vi.hoisted(() => {
  const state = { lockAllMoves: false, lifecycle: 'in_season', draft: 'completed' }
  const tx = {
    roster: { update: vi.fn(async () => ({})) },
    redraftRosterPlayer: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 1 })) },
  }
  const prisma = {
    league: {
      findUnique: vi.fn(async () => ({ id: 'L', sport: 'NFL', settings: {}, platform: 'manual', lifecycleState: state.lifecycle, lockAllMoves: state.lockAllMoves })),
    },
    roster: { findFirst: vi.fn(async () => ({ id: 'af-1', leagueId: 'L', playerData: {}, redraftRosterId: 'rr-1' })) },
    redraftRoster: {
      findFirst: vi.fn(async () => ({
        id: 'rr-1',
        leagueId: 'L',
        seasonId: 's1',
        ownerId: 'user-1',
        waiverPriority: 3,
        faabBalance: 100,
        players: [
          { playerId: 'p1', playerName: 'P1', position: 'QB', team: 'BUF', sport: 'NFL', slotType: 'QB', isLocked: false, injuryStatus: null, byeWeek: null },
        ],
        season: { season: 2026, sport: 'NFL', currentWeek: 1, totalWeeks: 17 },
      })),
    },
    leagueWaiverSettings: { findUnique: vi.fn(async () => null) },
    redraftSeason: { findFirst: vi.fn(async () => ({ id: 's1', status: 'active' })), count: vi.fn(async () => 0) },
    draftSession: { findFirst: vi.fn(async () => ({ status: state.draft })) },
    redraftWaiverClaim: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'c1', ...data })),
    },
    sportsPlayer: { findUnique: vi.fn(async () => ({ name: 'Add Guy' })), findMany: vi.fn(async () => []) },
    sportsInjury: { findMany: vi.fn(async () => []) },
    sportsGame: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  }
  return { state, tx, prisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'user-1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn().mockResolvedValue({ ok: true, status: 200 }) }))
vi.mock('@/lib/ai-learning-system/recordEvent', () => ({ recordAfLearningEvent: vi.fn() }))
vi.mock('@/lib/ai-learning-system/resolveLeagueSport', () => ({ resolveLeagueSport: vi.fn(async () => 'NFL') }))
// Lineup engine collaborators (the validator itself is checked for real at the bottom).
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({ getRosterTemplateForLeague: vi.fn(async () => ({ slots: [] })) }))
vi.mock('@/lib/sport-defaults/LeagueVariantRegistry', () => ({ getFormatTypeForVariant: vi.fn(() => 'standard') }))
vi.mock('@/lib/roster-lineup-engine/rosterValidationService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/roster-lineup-engine/rosterValidationService')>()),
  validateCanonicalRosterPayload: vi.fn(() => ({ ok: true, issues: [] })),
}))
vi.mock('@/lib/roster-lineup-engine/lineupAssignmentSync', () => ({ syncAfRosterLineupAssignments: vi.fn(async () => {}) }))
vi.mock('@/lib/roster-lineup-engine/rosterMoveHistory', () => ({ recordAfRosterMoveHistory: vi.fn(async () => {}) }))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({
  resolveFullLineupLockContext: vi.fn(async () => ({ locked: false, lockedPlayerIds: [], policy: 'per_player', perPlayerReasons: {} })),
  upsertAfLineupLockState: vi.fn(async () => {}),
}))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn(async () => {}) }))
// Redraft roster route collaborators.
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

import { PATCH as patchRedraftRoster } from '@/app/api/redraft/roster/route'
import { POST as postRedraftWaiver, DELETE as deleteRedraftWaiver } from '@/app/api/redraft/waivers/route'
import { POST as postWaiverWireClaim } from '@/app/waiver-wire/claim/route'
import { persistRosterLineupWithEngine } from '@/lib/roster-lineup-engine/lineupService'
import { validateCanonicalRosterPayload } from '@/lib/roster-lineup-engine/rosterValidationService'

beforeEach(() => {
  vi.clearAllMocks()
  h.state.lockAllMoves = false
  h.state.lifecycle = 'in_season'
  h.state.draft = 'completed'
})

const lineupMove = (toSlot: string) =>
  patchRedraftRoster(
    createMockNextRequest('http://localhost/api/redraft/roster', {
      method: 'PATCH',
      body: { rosterId: 'rr-1', week: 1, moves: [{ playerId: 'p1', toSlot }] },
    }),
  )

const redraftClaim = () =>
  postRedraftWaiver(
    createMockNextRequest('http://localhost/api/redraft/waivers', {
      method: 'POST',
      body: { rosterId: 'rr-1', seasonId: 's1', leagueId: 'L', addPlayerId: 'p9', addPlayerName: 'Add Guy' },
    }),
  )

const waiverWireClaim = () =>
  postWaiverWireClaim(
    new Request('http://localhost/waiver-wire/claim', {
      method: 'POST',
      body: JSON.stringify({ leagueId: 'L', playerId: 'p9', bidAmount: 5 }),
    }),
  )

describe('PATCH /api/redraft/roster — lineup and IR moves', () => {
  it('refuses a lineup move under the lock and writes nothing', async () => {
    h.state.lockAllMoves = true
    const res = await lineupMove('BN')
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('MOVE_LOCKED')
    expect(h.tx.redraftRosterPlayer.updateMany).not.toHaveBeenCalled()
  })

  it('refuses an IR move the same way', async () => {
    h.state.lockAllMoves = true
    expect((await lineupMove('IR')).status).toBe(409)
    expect(h.tx.redraftRosterPlayer.updateMany).not.toHaveBeenCalled()
  })

  it('saves when the league is not locked (control)', async () => {
    const res = await lineupMove('BN')
    expect(res.status).toBe(200)
    expect(h.tx.redraftRosterPlayer.updateMany).toHaveBeenCalledTimes(1)
  })
})

describe('redraft waiver claims', () => {
  it('refuses a pre-draft claim even when the commissioner move lock is off', async () => {
    h.state.lifecycle = 'setup'; h.state.draft = 'in_progress'
    const res = await redraftClaim()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('pre_draft_locked')
    expect(h.prisma.redraftWaiverClaim.create).not.toHaveBeenCalled()
  })
  it('POST /api/redraft/waivers refuses under the lock and queues nothing', async () => {
    h.state.lockAllMoves = true
    const res = await redraftClaim()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('MOVE_LOCKED')
    expect(h.prisma.redraftWaiverClaim.create).not.toHaveBeenCalled()
  })

  it('POST /api/redraft/waivers queues a claim when unlocked (control)', async () => {
    expect((await redraftClaim()).status).toBe(200)
    expect(h.prisma.redraftWaiverClaim.create).toHaveBeenCalledTimes(1)
  })

  it('POST /waiver-wire/claim refuses under the lock and queues nothing', async () => {
    h.state.lockAllMoves = true
    const res = await waiverWireClaim()
    expect(res.status).toBe(409)
    expect(h.prisma.redraftWaiverClaim.create).not.toHaveBeenCalled()
  })

  it('POST /waiver-wire/claim queues a claim when unlocked (control)', async () => {
    expect((await waiverWireClaim()).status).toBe(200)
    expect(h.prisma.redraftWaiverClaim.create).toHaveBeenCalledTimes(1)
  })

  it('cancelling a pending claim stays open under the lock: it moves nothing', async () => {
    h.state.lockAllMoves = true
    ;(h.prisma.redraftWaiverClaim as Record<string, unknown>).findFirst = vi.fn(async () => ({ id: 'c1', rosterId: 'rr-1', seasonId: 's1', leagueId: 'L', status: 'pending' }))
    ;(h.prisma.redraftWaiverClaim as Record<string, unknown>).update = vi.fn(async () => ({}))
    const res = await deleteRedraftWaiver(
      createMockNextRequest('http://localhost/api/redraft/waivers', { method: 'DELETE', body: { claimId: 'c1', rosterId: 'rr-1' } }),
    )
    expect(res.status).toBe(200)
    ;(h.prisma.redraftWaiverClaim as Record<string, unknown>).findFirst = vi.fn(async () => null)
  })
})

describe('the commissioner override is exempt from the lock it works around', () => {
  const save = (source: 'user_save' | 'commissioner_override') =>
    persistRosterLineupWithEngine({
      leagueId: 'L',
      rosterId: 'af-1',
      season: 2026,
      week: 1,
      nextPlayerData: { starters: ['p1'] },
      actorUserId: 'user-1',
      source,
      skipLockCheck: source === 'commissioner_override',
    } as never)

  const lockSeen = () =>
    (vi.mocked(validateCanonicalRosterPayload).mock.calls.at(-1)?.[1] as { league: { lockAllMoves: unknown } }).league.lockAllMoves

  it('a member save is validated against the lock; the commissioner override is not', async () => {
    h.state.lockAllMoves = true
    await save('user_save')
    expect(lockSeen()).toBe(true)
    await save('commissioner_override')
    expect(lockSeen()).toBe(false)
  })

  it('and that flag is what the validator refuses on (the real validator, both ways)', async () => {
    const real = (await vi.importActual<typeof import('@/lib/roster-lineup-engine/rosterValidationService')>(
      '@/lib/roster-lineup-engine/rosterValidationService',
    )).validateCanonicalRosterPayload
    const ctx = (lockAllMoves: boolean) =>
      ({ league: { id: 'L', sport: 'NFL', settings: {}, lifecycleState: 'in_season', lockAllMoves }, template: { slots: [] }, season: 2026, week: 1 }) as never
    const codes = (lock: boolean) => real({ starters: [], bench: [] }, ctx(lock)).issues.map((i) => i.code)
    expect(codes(true)).toContain('league_lock_all')
    expect(codes(false)).not.toContain('league_lock_all')
  })
})
