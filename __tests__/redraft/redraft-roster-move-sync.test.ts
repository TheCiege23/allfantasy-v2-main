import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  roster: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  sportsPlayer: { findFirst: vi.fn() },
  waiverTransaction: { create: vi.fn() },
  redraftRosterPlayer: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/player-identity/findSportsPlayerByLeagueId', () => ({ findSportsPlayerByLeagueId: vi.fn(async () => null) }))
vi.mock('@/lib/survivor/survivorStealThreeWaivers', () => ({ assertStealThreeWaiverHoldCleared: vi.fn(async () => undefined) }))
vi.mock('@/lib/waiver-wire/transaction-eligibility', () => ({ assertWaiverClaimEligibility: vi.fn(async () => undefined) }))

import { applyRedraftRosterMoves, planRedraftRosterMoveWrites } from '@/lib/league-runtime/redraftRosterMoveSync'
import { executeImmediateAddDrop } from '@/lib/waiver-wire/free-agent-service'

/** Live rows keyed `${redraftRosterId}:${playerId}`, answering `findFirst` like the real table. */
function liveRows(rows: Record<string, { id: string; position?: string }>) {
  db.redraftRosterPlayer.findFirst.mockImplementation(async ({ where }: { where: { rosterId: string; playerId: string } }) => {
    const row = rows[`${where.rosterId}:${where.playerId}`]
    return row ? { id: row.id, position: row.position ?? 'WR' } : null
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  db.league.findUnique.mockResolvedValue({ platform: 'allfantasy', sport: 'NFL' })
  db.roster.findMany.mockResolvedValue([
    { id: 'r1', redraftRosterId: 'rd1' },
    { id: 'r2', redraftRosterId: 'rd2' },
  ])
  db.sportsPlayer.findFirst.mockResolvedValue({ name: 'Puka Nacua', position: 'WR', team: 'LAR' })
  db.redraftRosterPlayer.create.mockImplementation((args: unknown) => ({ op: 'create', args }))
  db.redraftRosterPlayer.updateMany.mockImplementation((args: unknown) => ({ op: 'updateMany', args }))
  liveRows({})
})

describe('planRedraftRosterMoveWrites', () => {
  it('creates a scoring row for a native waiver add and retires the dropped player', async () => {
    liveRows({ 'rd1:drop1': { id: 'row-drop1' } })
    const writes = await planRedraftRosterMoveWrites(db as never, {
      leagueId: 'L1',
      acquisitionType: 'waiver',
      moves: [
        { playerId: 'add1', fromRosterId: null, toRosterId: 'r1' },
        { playerId: 'drop1', fromRosterId: 'r1', toRosterId: null },
      ],
      playerDataByRoster: new Map([['r1', { players: ['add1'], starters: [] }]]),
    })

    expect(writes).toHaveLength(2)
    expect(db.redraftRosterPlayer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rosterId: 'rd1',
        playerId: 'add1',
        playerName: 'Puka Nacua',
        position: 'WR',
        team: 'LAR',
        sport: 'NFL',
        slotType: 'bench',
        acquisitionType: 'waiver',
      }),
    })
    expect(db.redraftRosterPlayer.updateMany).toHaveBeenCalledWith({
      where: { id: 'row-drop1', droppedAt: null },
      data: { droppedAt: expect.any(Date) },
    })
  })

  it('moves the existing row to the receiving roster on a trade', async () => {
    liveRows({ 'rd1:p9': { id: 'row-p9', position: 'RB' } })
    await planRedraftRosterMoveWrites(db as never, {
      leagueId: 'L1',
      acquisitionType: 'trade',
      moves: [{ playerId: 'p9', fromRosterId: 'r1', toRosterId: 'r2' }],
      playerDataByRoster: new Map([['r2', { players: ['p9'] }]]),
    })

    expect(db.redraftRosterPlayer.create).not.toHaveBeenCalled()
    expect(db.redraftRosterPlayer.updateMany).toHaveBeenCalledWith({
      where: { id: 'row-p9', droppedAt: null },
      data: { rosterId: 'rd2', acquisitionType: 'trade', slotType: 'bench', isLocked: false },
    })
  })

  it('never writes redraft rows for an imported (shadow) league', async () => {
    db.league.findUnique.mockResolvedValue({ platform: 'sleeper', sport: 'NFL' })
    const writes = await planRedraftRosterMoveWrites(db as never, {
      leagueId: 'L1',
      acquisitionType: 'waiver',
      moves: [{ playerId: 'add1', fromRosterId: null, toRosterId: 'r1' }],
    })
    expect(writes).toEqual([])
    expect(db.roster.findMany).not.toHaveBeenCalled()
  })

  it('skips a roster with no linked RedraftRoster', async () => {
    db.roster.findMany.mockResolvedValue([{ id: 'r1', redraftRosterId: null }])
    const writes = await planRedraftRosterMoveWrites(db as never, {
      leagueId: 'L1',
      acquisitionType: 'waiver',
      moves: [{ playerId: 'add1', fromRosterId: null, toRosterId: 'r1' }],
    })
    expect(writes).toEqual([])
  })

  it('does not create a duplicate when the player is already live on the receiving roster', async () => {
    liveRows({ 'rd1:add1': { id: 'row-add1' } })
    const writes = await planRedraftRosterMoveWrites(db as never, {
      leagueId: 'L1',
      acquisitionType: 'free_agent',
      moves: [{ playerId: 'add1', fromRosterId: null, toRosterId: 'r1' }],
    })
    expect(writes).toEqual([])
    expect(db.redraftRosterPlayer.create).not.toHaveBeenCalled()
  })

  it('falls back to the id as the name when the player cannot be resolved', async () => {
    db.sportsPlayer.findFirst.mockResolvedValue(null)
    await applyRedraftRosterMoves(db as never, {
      leagueId: 'L1',
      acquisitionType: 'free_agent',
      moves: [{ playerId: 'mystery', fromRosterId: null, toRosterId: 'r1' }],
    })
    expect(db.redraftRosterPlayer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ playerId: 'mystery', playerName: 'mystery', position: 'UNK' }),
    })
  })
})

describe('executeImmediateAddDrop', () => {
  it('writes the scoring row inside the same transaction as the roster update', async () => {
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db))
    db.roster.findFirst.mockResolvedValue({ id: 'r1', playerData: { players: ['drop1'] } })
    db.waiverTransaction.create.mockResolvedValue({ id: 't1', addPlayerId: 'add1', dropPlayerId: 'drop1', faabSpent: null, processedAt: new Date() })
    liveRows({ 'rd1:drop1': { id: 'row-drop1' } })

    await executeImmediateAddDrop('L1', 'r1', { addPlayerId: 'add1', dropPlayerId: 'drop1' })

    expect(db.redraftRosterPlayer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ rosterId: 'rd1', playerId: 'add1', acquisitionType: 'free_agent' }),
    })
    expect(db.redraftRosterPlayer.updateMany).toHaveBeenCalledWith({
      where: { id: 'row-drop1', droppedAt: null },
      data: { droppedAt: expect.any(Date) },
    })
  })
})
