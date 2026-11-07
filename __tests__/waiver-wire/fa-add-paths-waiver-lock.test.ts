// @vitest-environment node
/**
 * Every free-agent path holds the league waiver lock, and the native add sees the redraft engine's awards.
 *
 *   1. The redraft engine's hourly run (`processWaiverWindow`) took no lock: an instant add landing
 *      between its "is he rostered" read and its write put one player on two rosters.
 *   2. Even serialized, the native add checked `Roster.playerData` only, which that engine never writes,
 *      so it could take a player the run had just awarded (redraftRosterHolder.ts).
 *   3. The waiver runtime's add and commissioner run (`/api/redraft/waiver-runtime`) took no lock either.
 *
 * Test 1 is a real interleaving against an in-memory roster table: the run is paused after its read,
 * the add is fired, then the run is released. Exactly one roster may end up holding the player.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { rosterId: string; playerId: string; droppedAt: Date | null }

const h = vi.hoisted(() => ({
  locks: new Map<string, string>(),
  rows: [] as Array<{ rosterId: string; playerId: string; droppedAt: Date | null }>,
  /** Resolves when the paused run may continue past its availability read. */
  release: null as null | (() => void),
  gate: null as null | Promise<void>,
  owners: { rrA: 'uA', rrB: 'uB' } as Record<string, string>,
  platform: 'allfantasy' as string,
  chopGate: { hold: false } as { hold: false } | { hold: true; week: number; message: string },
}))

vi.mock('@/lib/automation/locks', () => ({
  acquireAutomationLock: vi.fn(async (key: string, { owner }: { owner: string }) => {
    const held = h.locks.get(key)
    if (held && held !== owner) return { ok: false, reason: 'Lock held (postgres)' }
    h.locks.set(key, owner)
    return { ok: true, backend: 'postgres' }
  }),
  releaseAutomationLock: vi.fn(async (key: string, owner: string) => {
    if (h.locks.get(key) === owner) h.locks.delete(key)
  }),
}))

const live = (where: { playerId?: string; rosterId?: string }) =>
  h.rows.find((r) => r.droppedAt === null && (!where.playerId || r.playerId === where.playerId) && (!where.rosterId || r.rosterId === where.rosterId))

const db = vi.hoisted(() => ({}) as Record<string, any>)
vi.mock('@/lib/prisma', () => ({ prisma: db }))
Object.assign(db, {
  league: { findUnique: vi.fn(async () => ({ sport: 'NFL', platform: h.platform })) },
  redraftSeason: { findFirst: vi.fn(async () => ({ id: 's1', leagueId: 'L', sport: 'NFL' })) },
  redraftWaiverClaim: {
    findMany: vi.fn(async () => [{ id: 'c1', rosterId: 'rrA', addPlayerId: 'P', addPlayerName: 'Star', bidAmount: 10, priority: 1, dropPlayerId: null }]),
    update: vi.fn(async () => ({})),
  },
  survivorGameState: { findUnique: vi.fn(async () => null) },
  redraftRoster: {
    findFirst: vi.fn(async () => ({ id: 'rrA', isEliminated: false, faabBalance: 100 })),
    findMany: vi.fn(async () => []),
    update: vi.fn(async () => ({})),
  },
  redraftRosterPlayer: {
    findFirst: vi.fn(async ({ where }: { where: { playerId: string } }) => {
      const r = live({ playerId: where.playerId })
      return r ? { rosterId: r.rosterId, roster: { ownerId: h.owners[r.rosterId] } } : null
    }),
    create: vi.fn(async ({ data }: { data: Row }) => {
      h.rows.push({ rosterId: data.rosterId, playerId: data.playerId, droppedAt: null })
      return {}
    }),
  },
  sportsPlayer: {
    // The run pauses here: after its availability read, before its write.
    findFirst: vi.fn(async () => {
      if (h.gate) await h.gate
      return { name: 'Star', position: 'RB', team: 'KC' }
    }),
  },
  redraftLeagueTransaction: { create: vi.fn(async () => ({})) },
  roster: {
    findFirst: vi.fn(async () => ({ id: 'gB', playerData: [], redraftRosterId: 'rrB', platformUserId: 'uB' })),
    update: vi.fn(async () => ({})),
  },
  waiverTransaction: {
    create: vi.fn(async () => ({ id: 't1', addPlayerId: 'P', dropPlayerId: null, faabSpent: null, processedAt: new Date() })),
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
})

vi.mock('@/lib/player-identity/findSportsPlayerByLeagueId', () => ({ findSportsPlayerByLeagueId: vi.fn(async () => null) }))
vi.mock('@/lib/guillotine/blindWaiverCutoff', () => ({ guillotineClaimsCutoff: vi.fn(async () => null) }))
vi.mock('@/lib/guillotine/chopBeforeWaivers', () => ({ guillotineChopPendingForWaivers: vi.fn(async () => h.chopGate) }))
vi.mock('@/lib/pirate/claimReservation', () => ({ assertNotReservedByPirateClaim: vi.fn() }))
vi.mock('@/lib/pirate/rosterCapacity', () => ({ assertPirateAcquisitionCapacity: vi.fn() }))
vi.mock('@/lib/idp/capEngine', () => ({ assignIdpCapSalaryForWaiverClaim: vi.fn(async () => null) }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: async () => undefined }), EVENT: {} }))
vi.mock('@/lib/survivor/playerBoundIdolTransfer', () => ({ movePlayerBoundIdolsInTransaction: vi.fn() }))
vi.mock('@/lib/league/faabMirror', () => ({ copyRedraftFaabToGeneric: vi.fn() }))
vi.mock('@/lib/waiver-wire/transaction-eligibility', () => ({ assertWaiverClaimEligibility: vi.fn(async () => undefined) }))
vi.mock('@/lib/survivor/survivorStealThreeWaivers', () => ({ assertStealThreeWaiverHoldCleared: vi.fn() }))
// The native add mirrors into `RedraftRosterPlayer` through this; it writes into the same table here.
vi.mock('@/lib/league-runtime/redraftRosterMoveSync', () => ({
  applyRedraftRosterMoves: vi.fn(async (_tx: unknown, input: { moves: Array<{ playerId: string; toRosterId: string | null }> }) => {
    for (const m of input.moves) if (m.toRosterId === 'gB') h.rows.push({ rosterId: 'rrB', playerId: m.playerId, droppedAt: null })
  }),
}))

import { processWaiverWindow } from '@/lib/redraft/waiverEngine'
import { executeImmediateAddDrop, WAIVER_RUN_IN_PROGRESS_MESSAGE } from '@/lib/waiver-wire/free-agent-service'
import { leagueWaiverLockKey } from '@/lib/waiver-wire/leagueWaiverLock'
import { addNflRedraftFreeAgent, processNflRedraftWaiverWindow } from '@/lib/waiver-runtime/resolveNflRedraftWaiverRuntime'

const holders = (playerId: string) => h.rows.filter((r) => r.playerId === playerId && r.droppedAt === null).map((r) => r.rosterId)

beforeEach(() => {
  vi.clearAllMocks()
  h.locks = new Map()
  h.rows = []
  h.gate = null
  h.release = null
  h.platform = 'allfantasy'
  h.chopGate = { hold: false }
})

describe('the redraft waiver run and an instant add, interleaved', () => {
  it('one player lands on one roster: the add waits for the run, then sees its award and is refused', async () => {
    h.gate = new Promise<void>((resolve) => { h.release = resolve })
    const run = processWaiverWindow('L', 's1')
    // Let the run reach its pause (lock taken, availability read done).
    await new Promise((r) => setTimeout(r, 20))
    const add = executeImmediateAddDrop('L', 'gB', { addPlayerId: 'P' }).then(
      () => 'added',
      (e: Error) => e.message,
    )
    // Give an unlocked add every chance to finish first.
    await new Promise((r) => setTimeout(r, 50))
    h.release!()
    const [ran, added] = await Promise.all([run, add])

    expect(holders('P')).toEqual(['rrA'])
    expect(ran).toEqual([{ claimId: 'c1', status: 'approved' }])
    expect(added).toBe('This player is already on another roster in this league.')
    expect(h.locks.size).toBe(0)
  }, 10_000)
})

describe('the native add sees the redraft engine', () => {
  it('refuses a player another team holds only in RedraftRosterPlayer', async () => {
    h.rows.push({ rosterId: 'rrA', playerId: 'P', droppedAt: null })
    await expect(executeImmediateAddDrop('L', 'gB', { addPlayerId: 'P' })).rejects.toThrow('already on another roster')
    expect(db.roster.update).not.toHaveBeenCalled()
  })

  it("does not refuse the team's own row, and ignores an imported league's shadow rows", async () => {
    h.rows.push({ rosterId: 'rrB', playerId: 'P', droppedAt: null })
    await expect(executeImmediateAddDrop('L', 'gB', { addPlayerId: 'P' })).resolves.toMatchObject({ ok: true })
    h.rows = [{ rosterId: 'rrA', playerId: 'Q', droppedAt: null }]
    h.platform = 'sleeper'
    await expect(executeImmediateAddDrop('L', 'gB', { addPlayerId: 'Q' })).resolves.toMatchObject({ ok: true })
  })
})

describe('the waiver runtime holds the same lock', () => {
  it('add_free_agent is refused with "try again" while the league is held, and writes nothing', async () => {
    vi.useFakeTimers()
    h.locks.set(leagueWaiverLockKey('L'), 'waiver-process:run-1')
    const attempt = addNflRedraftFreeAgent({ seasonId: 's1', rosterId: 'rrB', addPlayerId: 'P' })
    const settled = expect(attempt).rejects.toThrow(WAIVER_RUN_IN_PROGRESS_MESSAGE)
    await vi.runAllTimersAsync()
    await settled
    vi.useRealTimers()
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(db.redraftRosterPlayer.create).not.toHaveBeenCalled()
  })

  it("the commissioner's runtime run is refused while the league is held", async () => {
    vi.useFakeTimers()
    h.locks.set(leagueWaiverLockKey('L'), 'instant-add:x')
    const attempt = processNflRedraftWaiverWindow({ leagueId: 'L', seasonId: 's1' })
    const settled = expect(attempt).rejects.toThrow('already processing')
    await vi.runAllTimersAsync()
    await settled
    vi.useRealTimers()
    expect(db.redraftRosterPlayer.create).not.toHaveBeenCalled()
  })

  it('the hourly redraft run leaves claims pending while the league is held', async () => {
    vi.useFakeTimers()
    h.locks.set(leagueWaiverLockKey('L'), 'instant-add:x')
    const attempt = processWaiverWindow('L', 's1')
    await vi.runAllTimersAsync()
    await expect(attempt).resolves.toEqual([])
    vi.useRealTimers()
    expect(db.redraftWaiverClaim.update).not.toHaveBeenCalled()
    expect(db.redraftRosterPlayer.create).not.toHaveBeenCalled()
  })
})

describe('the hourly redraft run and a Guilly chop that has not landed', () => {
  it('settles nothing while the chop is due (lib/guillotine/chopBeforeWaivers.ts)', async () => {
    h.chopGate = { hold: true, week: 5, message: 'x' }
    await expect(processWaiverWindow('L', 's1')).resolves.toEqual([])
    expect(db.redraftWaiverClaim.update).not.toHaveBeenCalled()
    expect(db.redraftRosterPlayer.create).not.toHaveBeenCalled()
    expect(db.sportsPlayer.findFirst).not.toHaveBeenCalled()
  })
})

describe("the runtime add runs the native eligibility check inside the lock", () => {
  it('a refusing precheck stops the add before anything is read or written, with the lock held', async () => {
    let heldDuringCheck = false
    const precheck = vi.fn(async () => {
      heldDuringCheck = h.locks.has(leagueWaiverLockKey('L'))
      throw new Error('This player is already on another roster in this league.')
    })
    await expect(addNflRedraftFreeAgent({ seasonId: 's1', rosterId: 'rrB', addPlayerId: 'P', precheck })).rejects.toThrow('already on another roster')
    expect(heldDuringCheck).toBe(true)
    expect(db.sportsPlayer.findFirst).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(h.locks.size).toBe(0)
  })
})
