import { describe, it, expect } from 'vitest'
import { categorizeTradeFailure, evaluateTradeRules, evaluateTradeRulesWithParity, type TradeRuleContext } from '@/lib/decision-os/trade/rules'
import type { RuleVerdict } from '@/lib/decision-os/core/decision'
import { fakeWorld, fakeAssets } from './tradeFakes'

const ctx = (over: Partial<TradeRuleContext> = {}): TradeRuleContext => ({
  world: fakeWorld(),
  assets: fakeAssets(),
  snapshotAvailable: true,
  ...over,
})

describe('trade rules — categorization', () => {
  it('maps thrown legality messages to categories', () => {
    expect(categorizeTradeFailure('Trade deadline has passed.')).toBe('trade_deadline_passed')
    expect(categorizeTradeFailure('A selected player is locked this week.')).toBe('player_locked')
    expect(categorizeTradeFailure('Insufficient FAAB for this trade.')).toBe('faab_insufficient')
    expect(categorizeTradeFailure('Asset roster direction is invalid')).toBe('asset_direction_invalid')
    expect(categorizeTradeFailure('Roster not found for season')).toBe('missing_roster')
    expect(categorizeTradeFailure('This would leave the roster in an illegal state')).toBe('roster_legality')
  })
})

describe('trade Rule Framework — read-only legality', () => {
  it('legal trade → no illegal verdicts', async () => {
    const verdicts = await evaluateTradeRules(ctx(), {})
    expect(verdicts.every((v) => v.verdict !== 'illegal')).toBe(true)
  })

  it('deadline passed → temporarily_illegal', async () => {
    const verdicts = await evaluateTradeRules(ctx({ world: fakeWorld({ currentWeek: 14 }) }), {})
    expect(verdicts.some((v) => v.rule === 'trade.legality.trade_deadline_passed' && v.verdict === 'temporarily_illegal')).toBe(true)
  })

  it('FAAB asset over the sending roster balance → illegal', async () => {
    const assets = [{ fromRosterId: 'rosterA', toRosterId: 'rosterB', assetType: 'faab', playerId: null, playerName: null, faabAmount: 999 }]
    const verdicts = await evaluateTradeRules(ctx({ assets }), {})
    expect(verdicts.some((v) => v.rule === 'trade.legality.faab_insufficient' && v.verdict === 'illegal')).toBe(true)
  })

  it('missing snapshot → illegal verdict (defensive)', async () => {
    const verdicts = await evaluateTradeRules(ctx({ snapshotAvailable: false }), {})
    expect(verdicts.some((v) => v.rule === 'trade.legality.missing_snapshot')).toBe(true)
  })

  it('a thrown legality validator is caught + mapped, never propagates', async () => {
    const verdicts = await evaluateTradeRules(ctx(), { assertLegality: async () => { throw new Error('Insufficient FAAB for this trade.') } })
    expect(verdicts.some((v) => v.rule === 'trade.legality.faab_insufficient')).toBe(true)
  })
})

describe('trade validator parity — compose a second validator, never retire', () => {
  const canon = (...codes: string[]) => (): RuleVerdict[] =>
    codes.map((c) => ({ rule: `trade.canonical.${c}`, verdict: 'illegal' as const, message: c, severity: 'critical' as const }))

  it('complementary coverage (canonical-only category) → agree on shared, NOT retirement-safe', async () => {
    const r = await evaluateTradeRulesWithParity(ctx(), { validateCanonical: canon('collusion_suspected') })
    expect(r.parity.agreeOnSharedScope).toBe(true)
    expect(r.parity.coverageDifferences).toContain('collusion_suspected')
    expect(r.parity.reason).toBe('complementary_coverage')
    expect(r.retirementSafe).toBe(false)
  })

  it('survives a canonical validator that throws (active gate unaffected)', async () => {
    const r = await evaluateTradeRulesWithParity(ctx({ world: fakeWorld({ currentWeek: 14 }) }), {
      validateCanonical: () => { throw new Error('boom') },
    })
    expect(r.canonicalVerdicts).toEqual([])
    expect(r.parity.reason).toBe('canonical_validator_error')
    expect(r.verdicts.some((v) => v.rule === 'trade.legality.trade_deadline_passed')).toBe(true)
  })
})
