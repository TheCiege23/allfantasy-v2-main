import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    status: 'open', records: [] as Array<Record<string, unknown>>,
    tail: Promise.resolve(), manualHold: Promise.resolve(), autoHold: Promise.resolve(),
    manualEntered: () => {}, autoEntered: () => {}, failAfterDefault: false,
  }
  const db = {
    league: { findFirst: vi.fn(async () => ({ keeperCount: 2, keeperCostSystem: 'round_based', keeperConflictRule: 'player_chooses', settings: {} })), update: vi.fn(async () => ({})) },
    keeperSelectionSession: {
      findFirst: vi.fn(async () => ({ id: 'K', leagueId: 'L', seasonId: 'S', status: state.status })),
      update: vi.fn(async () => { state.status = 'locked'; return {} }), updateMany: vi.fn(async () => ({ count: 1 })),
    },
    redraftRoster: { findFirst: vi.fn(async () => {
      state.manualEntered(); await state.manualHold
      return { id: 'R', players: [{ playerId: 'manual', playerName: 'Manual', position: 'WR', sport: 'NFL', droppedAt: null }] }
    }) },
    keeperEligibility: { findMany: vi.fn(async () => [{ playerId: 'manual', isEligible: true, projectedCostRound: 8, projectedCost: 'Round 8' }]) },
    draftSession: { findFirst: vi.fn(async () => ({ rounds: 15 })) },
    keeperRecord: {
      findMany: vi.fn(async () => state.records),
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => { state.records.push(create); return create }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { state.records.push(data); return data }),
      deleteMany: vi.fn(async () => ({ count: 0 })), updateMany: vi.fn(async () => ({ count: state.records.length })),
    },
    leagueAuditLog: { create: vi.fn(async () => ({})) },
    redraftSeason: { findFirst: vi.fn(async () => ({ id: 'previous' })) },
  }
  const keys: unknown[] = []
  const client = {
    ...db,
    $transaction: vi.fn(async (action: (tx: unknown) => Promise<unknown>) => {
      let release: (() => void) | undefined
      let savepoint: typeof state.records = []
      const tx = { ...db, $executeRaw: vi.fn(async (sql: TemplateStringsArray, ...values: unknown[]) => {
        const text = sql.join('')
        if (text.includes('pg_advisory_xact_lock')) {
          keys.push(values[0])
          const previous = state.tail
          state.tail = new Promise<void>((resolve) => { release = resolve })
          await previous
        } else if (text.startsWith('SAVEPOINT')) savepoint = [...state.records]
        else if (text.startsWith('ROLLBACK TO')) state.records = [...savepoint]
        return 1
      }) }
      try { return await action(tx) } finally { release?.() }
    }),
  }
  const apply = vi.fn(async (_league: string, _season: string, tx: typeof db) => {
    state.autoEntered(); await state.autoHold
    if ((await tx.keeperRecord.findMany()).some((record) => record.rosterId === 'R')) return
    await tx.keeperRecord.create({ data: { rosterId: 'R', playerId: 'automatic' } })
    if (state.failAfterDefault) throw new Error('write failed after first automatic keeper')
  })
  return { state, db, client, apply, keys, carryover: vi.fn(async () => ({})) }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.client }))
vi.mock('@/lib/keeper/eligibilityEngine', () => ({ computeKeeperEligibility: vi.fn() }))
vi.mock('@/lib/keeper/carryoverEngine', () => ({ executeSeasonCarryover: h.carryover }))
vi.mock('@/lib/keeper/missedDeadlineService', () => ({ KEEPER_SUBMITTED_NONE: 'keeper_submitted_none', applyMissedDeadlineRule: h.apply }))

import { lockKeeperSelections, submitKeeperSelections } from '@/lib/keeper/selectionEngine'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state.status = 'open'; h.state.records = []; h.state.tail = Promise.resolve()
  h.state.manualHold = Promise.resolve(); h.state.autoHold = Promise.resolve()
  h.state.manualEntered = () => {}; h.state.autoEntered = () => {}; h.state.failAfterDefault = false
  h.keys.length = 0
})

describe('keeper submissions racing the deadline runner', () => {
  it('keeps a manager submission that obtains the lock first, without appending defaults', async () => {
    const entered = deferred(), resume = deferred()
    h.state.manualEntered = entered.resolve; h.state.manualHold = resume.promise
    const submission = submitKeeperSelections('R', 'L', 'S', ['manual'])
    await entered.promise
    const deadline = lockKeeperSelections('L', 'K')
    resume.resolve()
    await Promise.all([submission, deadline])
    expect(h.state.records.map((record) => record.playerId)).toEqual(['manual'])
    expect(h.keys).toHaveLength(2)
    expect(h.keys[0]).toEqual(h.keys[1])
  })

  it('rejects a manager submission waiting behind a completed deadline lock', async () => {
    const entered = deferred(), resume = deferred()
    h.state.autoEntered = entered.resolve; h.state.autoHold = resume.promise
    const deadline = lockKeeperSelections('L', 'K')
    await entered.promise
    const submission = submitKeeperSelections('R', 'L', 'S', ['manual'])
    const rejected = expect(submission).rejects.toThrow('closed')
    resume.resolve()
    await Promise.all([deadline, rejected])
    expect(h.state.records.map((record) => record.playerId)).toEqual(['automatic'])
    expect(h.db.keeperRecord.upsert).not.toHaveBeenCalled()
  })

  it('rolls back partial defaults while preserving existing manager picks', async () => {
    h.state.records = [{ rosterId: 'other', playerId: 'kept' }]
    h.state.failAfterDefault = true
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try { await lockKeeperSelections('L', 'K') } finally { log.mockRestore() }
    expect(h.state.records.map((record) => record.playerId)).toEqual(['kept'])
    expect(h.state.status).toBe('locked')
  })

  it('runs automatic selection and carryover only once for two concurrent lock requests', async () => {
    await Promise.all([lockKeeperSelections('L', 'K'), lockKeeperSelections('L', 'K')])
    expect(h.apply).toHaveBeenCalledTimes(1)
    expect(h.carryover).toHaveBeenCalledTimes(1)
    expect(h.state.records.map((record) => record.playerId)).toEqual(['automatic'])
  })
})
