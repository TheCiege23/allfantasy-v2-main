/**
 * "Hold flagged trades" (lib/integrity/holdFlaggedTrades.ts): the check at acceptance, and which trades
 * a review window must leave for the commissioner. Default (owner decision 2026-10-27): hold only the
 * serious flags — a heavily lopsided trade, or an eliminated team dumping starters — and alert on the rest.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const db = vi.hoisted(() => ({ integrityFlag: { findMany: vi.fn() }, leagueIntegritySettings: { findUnique: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/integrity/leagueEntitlement', () => ({ checkLeagueCommissionerEntitlement: vi.fn() }))
vi.mock('@/lib/integrity/CollusionDetectionEngine', () => ({ scanTradeForCollusion: vi.fn() }))

import {
  flagIsHeld,
  heldTradeIds,
  parseHoldFlaggedTradesMode,
  readHoldFlaggedTradesMode,
  shouldHoldAcceptedTrade,
} from '@/lib/integrity/holdFlaggedTrades'

const ALL = { integrity_hold_flagged_trades: 'all' }
const DEFAULT = {}
const ref = { kind: 'af' as const, tradeId: 'T1' }
const flag = (...codes: string[]) => ({ evidence: { flags: codes.map((code) => ({ code })) } })
const on = { entitled: async () => true, monitoringOn: async () => true }

beforeEach(() => vi.clearAllMocks())

describe('the setting', () => {
  it('defaults to serious flags only, and still reads the older on/off switch', () => {
    expect(readHoldFlaggedTradesMode(null)).toBe('severe')
    expect(readHoldFlaggedTradesMode({})).toBe('severe')
    expect(readHoldFlaggedTradesMode({ integrity_hold_flagged_trades: 'nonsense' })).toBe('severe')
    expect(readHoldFlaggedTradesMode({ integrity_hold_flagged_trades: true })).toBe('all')
    expect(readHoldFlaggedTradesMode({ integrity_hold_flagged_trades: false })).toBe('off')
    expect(readHoldFlaggedTradesMode({ integrity_hold_flagged_trades: 'off' })).toBe('off')
  })

  it('accepts only the three choices, or the on/off switch', () => {
    expect(parseHoldFlaggedTradesMode('severe')).toBe('severe')
    expect(parseHoldFlaggedTradesMode(true)).toBe('all')
    expect(parseHoldFlaggedTradesMode(false)).toBe('off')
    expect(parseHoldFlaggedTradesMode('sometimes')).toBeNull()
    expect(parseHoldFlaggedTradesMode(1)).toBeNull()
  })

  it('serious means a lopsided trade or an eliminated team dumping, nothing milder', () => {
    expect(flagIsHeld('severe', ['heavily_lopsided'])).toBe(true)
    expect(flagIsHeld('severe', ['repeat_partners', 'eliminated_team_dumping'])).toBe(true)
    expect(flagIsHeld('severe', ['repeat_partners', 'deadline_rush'])).toBe(false)
    expect(flagIsHeld('all', ['deadline_rush'])).toBe(true)
    expect(flagIsHeld('off', ['heavily_lopsided'])).toBe(false)
  })
})

describe('shouldHoldAcceptedTrade', () => {
  it('by default holds a heavily lopsided trade', async () => {
    const scan = vi.fn(async () => ({ flags: [flag('heavily_lopsided')] }))
    expect(await shouldHoldAcceptedTrade({ leagueId: 'L1', settings: DEFAULT, ref }, { ...on, scan })).toBe(true)
    expect(scan).toHaveBeenCalledWith('L1', 'T1', ref)
  })

  it('by default lets a milder flag through — the commissioner is alerted, not asked', async () => {
    const scan = vi.fn(async () => ({ flags: [flag('repeat_partners')] }))
    expect(await shouldHoldAcceptedTrade({ leagueId: 'L1', settings: DEFAULT, ref }, { ...on, scan })).toBe(false)
  })

  it('"every flag" holds the milder one too', async () => {
    const scan = vi.fn(async () => ({ flags: [flag('repeat_partners')] }))
    expect(await shouldHoldAcceptedTrade({ leagueId: 'L1', settings: ALL, ref }, { ...on, scan })).toBe(true)
  })

  it('lets a clean trade through', async () => {
    expect(await shouldHoldAcceptedTrade({ leagueId: 'L1', settings: ALL, ref }, { ...on, scan: async () => ({ flags: [] }) })).toBe(false)
  })

  it('does not even scan when the commissioner switched it off', async () => {
    const scan = vi.fn()
    expect(await shouldHoldAcceptedTrade({ leagueId: 'L1', settings: { integrity_hold_flagged_trades: 'off' }, ref }, { ...on, scan })).toBe(false)
    expect(scan).not.toHaveBeenCalled()
  })

  it('does nothing without AF Commissioner', async () => {
    const scan = vi.fn()
    expect(await shouldHoldAcceptedTrade({ leagueId: 'L1', settings: DEFAULT, ref }, { ...on, entitled: async () => false, scan })).toBe(false)
    expect(scan).not.toHaveBeenCalled()
  })

  it('does nothing when the league turned collusion monitoring off', async () => {
    const scan = vi.fn()
    expect(await shouldHoldAcceptedTrade({ leagueId: 'L1', settings: DEFAULT, ref }, { ...on, monitoringOn: async () => false, scan })).toBe(false)
    expect(scan).not.toHaveBeenCalled()
  })

  it('reads monitoring from the league settings row; no row means on', async () => {
    const scan = vi.fn(async () => ({ flags: [flag('heavily_lopsided')] }))
    db.leagueIntegritySettings.findUnique.mockResolvedValueOnce({ collusionMonitoringEnabled: false })
    expect(await shouldHoldAcceptedTrade({ leagueId: 'L1', settings: DEFAULT, ref }, { entitled: async () => true, scan })).toBe(false)
    db.leagueIntegritySettings.findUnique.mockResolvedValueOnce(null)
    expect(await shouldHoldAcceptedTrade({ leagueId: 'L1', settings: DEFAULT, ref }, { entitled: async () => true, scan })).toBe(true)
  })

  it('fails open: a check that throws never freezes trading', async () => {
    const scan = vi.fn(async () => { throw new Error('review down') })
    expect(await shouldHoldAcceptedTrade({ leagueId: 'L1', settings: DEFAULT, ref }, { ...on, scan })).toBe(false)
  })

  it('keys a redraft proposal on its proposal id', async () => {
    const scan = vi.fn(async () => ({ flags: [] }))
    const r = { kind: 'redraft' as const, proposalId: 'P9' }
    await shouldHoldAcceptedTrade({ leagueId: 'L1', settings: ALL, ref: r }, { ...on, scan })
    expect(scan).toHaveBeenCalledWith('L1', 'P9', r)
  })
})

describe('heldTradeIds', () => {
  const row = (id: string, leagueId: string, settings: unknown, ...codes: string[]) => ({
    tradeTransactionId: id,
    leagueId,
    evidenceJson: { flags: codes.map((code) => ({ code })) },
    league: { settings },
  })

  it('leaves for the commissioner exactly the open flags the league holds', async () => {
    db.integrityFlag.findMany.mockResolvedValue([
      row('P1', 'L1', DEFAULT, 'heavily_lopsided'),
      row('P2', 'L1', DEFAULT, 'repeat_partners'),
      row('P3', 'L2', ALL, 'repeat_partners'),
      row('P4', 'L3', { integrity_hold_flagged_trades: false }, 'heavily_lopsided'),
    ])
    expect(await heldTradeIds({ entitled: async () => true })).toEqual(['P1', 'P3'])
    expect(db.integrityFlag.findMany.mock.calls[0]![0].where).toMatchObject({ flagType: 'collusion', status: 'open' })
  })

  it('a league without the plan holds nothing, and the plan is looked up once per league', async () => {
    db.integrityFlag.findMany.mockResolvedValue([
      row('P1', 'L1', ALL, 'heavily_lopsided'),
      row('P2', 'L1', ALL, 'heavily_lopsided'),
      row('P3', 'L2', ALL, 'heavily_lopsided'),
    ])
    const entitled = vi.fn(async (id: string) => id === 'L2')
    expect(await heldTradeIds({ entitled })).toEqual(['P3'])
    expect(entitled).toHaveBeenCalledTimes(2)
  })
})
