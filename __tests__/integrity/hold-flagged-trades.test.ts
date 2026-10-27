/**
 * "Hold flagged trades" (lib/integrity/holdFlaggedTrades.ts): the check at acceptance, and which trades
 * a review window must leave for the commissioner.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const db = vi.hoisted(() => ({ integrityFlag: { findMany: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/integrity/leagueEntitlement', () => ({ checkLeagueCommissionerEntitlement: vi.fn() }))
vi.mock('@/lib/integrity/CollusionDetectionEngine', () => ({ scanTradeForCollusion: vi.fn() }))

import { heldTradeIds, readHoldFlaggedTrades, shouldHoldAcceptedTrade } from '@/lib/integrity/holdFlaggedTrades'

const ON = { integrity_hold_flagged_trades: true }
const ref = { kind: 'af' as const, tradeId: 'T1' }

beforeEach(() => vi.clearAllMocks())

describe('readHoldFlaggedTrades', () => {
  it('is off unless switched on', () => {
    expect(readHoldFlaggedTrades(null)).toBe(false)
    expect(readHoldFlaggedTrades({})).toBe(false)
    expect(readHoldFlaggedTrades({ integrity_hold_flagged_trades: 'yes' })).toBe(false)
    expect(readHoldFlaggedTrades(ON)).toBe(true)
  })
})

describe('shouldHoldAcceptedTrade', () => {
  it('holds a trade the collusion check flags', async () => {
    const scan = vi.fn(async () => ({ flags: [{}] }))
    expect(await shouldHoldAcceptedTrade({ leagueId: 'L1', settings: ON, ref }, { entitled: async () => true, scan })).toBe(true)
    expect(scan).toHaveBeenCalledWith('L1', 'T1', ref)
  })

  it('lets a clean trade through', async () => {
    expect(await shouldHoldAcceptedTrade({ leagueId: 'L1', settings: ON, ref }, { entitled: async () => true, scan: async () => ({ flags: [] }) })).toBe(false)
  })

  it('does not even scan when the league has it off', async () => {
    const scan = vi.fn()
    expect(await shouldHoldAcceptedTrade({ leagueId: 'L1', settings: {}, ref }, { entitled: async () => true, scan })).toBe(false)
    expect(scan).not.toHaveBeenCalled()
  })

  it('does nothing without AF Commissioner', async () => {
    const scan = vi.fn()
    expect(await shouldHoldAcceptedTrade({ leagueId: 'L1', settings: ON, ref }, { entitled: async () => false, scan })).toBe(false)
    expect(scan).not.toHaveBeenCalled()
  })

  it('fails open: a check that throws never freezes trading', async () => {
    const scan = vi.fn(async () => { throw new Error('review down') })
    expect(await shouldHoldAcceptedTrade({ leagueId: 'L1', settings: ON, ref }, { entitled: async () => true, scan })).toBe(false)
  })

  it('keys a redraft proposal on its proposal id', async () => {
    const scan = vi.fn(async () => ({ flags: [] }))
    const r = { kind: 'redraft' as const, proposalId: 'P9' }
    await shouldHoldAcceptedTrade({ leagueId: 'L1', settings: ON, ref: r }, { entitled: async () => true, scan })
    expect(scan).toHaveBeenCalledWith('L1', 'P9', r)
  })
})

describe('heldTradeIds', () => {
  it('only open collusion flags in leagues that hold flagged trades', async () => {
    db.integrityFlag.findMany.mockResolvedValue([
      { tradeTransactionId: 'P1', league: { settings: ON } },
      { tradeTransactionId: 'P2', league: { settings: {} } },
    ])
    expect(await heldTradeIds()).toEqual(['P1'])
    expect(db.integrityFlag.findMany.mock.calls[0]![0].where).toMatchObject({ flagType: 'collusion', status: 'open' })
  })
})
