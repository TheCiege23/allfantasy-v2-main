import { describe, it, expect } from 'vitest'
import { evaluateLineupRules, evaluateLineupRulesWithParity, type LineupRuleContext } from '@/lib/decision-os/lineup/rules'
import { canonicalResultToVerdicts, toCanonicalPlayerData, buildCanonicalValidatorDep } from '@/lib/decision-os/lineup/canonicalAdapter'
import type { RuleVerdict } from '@/lib/decision-os/core/decision'
import type { LockState } from '@/lib/decision-os/lineup/world'
import type { RedraftLineupPlayer, RedraftLineupValidationResult } from '@/lib/redraft/lineupValidation'
import { fakeRosterConfig, fakePlayers } from './lineupFakes'

const unlocked: LockState = { locked: false, policy: 'football_weekly', reason: null, provenance: 'derived_approximate', uncertainty: null }
const ctx = (): LineupRuleContext => ({ sport: 'NFL', week: 1, players: fakePlayers(), rosterConfig: fakeRosterConfig(), lockState: unlocked })

const redraft = (...codes: string[]): (() => RedraftLineupValidationResult) => () => ({
  ok: codes.length === 0,
  errorCount: codes.length,
  warningCount: 0,
  issues: codes.map((code) => ({ code, severity: 'error' as const, message: code })),
})
const canonicalDep = (...codes: string[]) => (): RuleVerdict[] =>
  codes.map((code) => ({ rule: `lineup.canonical.${code}`, verdict: 'illegal' as const, message: code, severity: 'critical' as const }))

describe('validator composition — active gate unchanged', () => {
  it('evaluateLineupRules returns ONLY the primary validator + lock (no canonical verdicts)', () => {
    const verdicts = evaluateLineupRules(ctx(), { validateRedraft: redraft('starter_position_ineligible'), validateCanonical: canonicalDep('duplicate_player') })
    expect(verdicts.some((v) => v.rule.startsWith('lineup.canonical.'))).toBe(false)
    expect(verdicts.some((v) => v.rule === 'lineup.legality.starter_position_ineligible')).toBe(true)
  })
})

describe('validator parity', () => {
  it('both pass → equivalent, retirement-safe (empty)', () => {
    const r = evaluateLineupRulesWithParity(ctx(), { validateRedraft: redraft(), validateCanonical: canonicalDep() })
    expect(r.parity.agreeOnSharedScope).toBe(true)
    expect(r.retirementSafe).toBe(true)
    expect(r.parity.reason).toBe('equivalent')
  })

  it('both fail identically on a shared category → agree', () => {
    const r = evaluateLineupRulesWithParity(ctx(), { validateRedraft: redraft('starter_position_ineligible'), validateCanonical: canonicalDep('starter_position_ineligible') })
    expect(r.parity.agreeOnSharedScope).toBe(true)
    expect(r.parity.sharedDisagreements).toEqual([])
  })

  it('shared disagreement (one flags, the other does not) → not safe', () => {
    const r = evaluateLineupRulesWithParity(ctx(), { validateRedraft: redraft('starter_position_ineligible'), validateCanonical: canonicalDep() })
    expect(r.parity.agreeOnSharedScope).toBe(false)
    expect(r.parity.sharedDisagreements).toContain('position_ineligible')
    expect(r.parity.reason).toBe('shared_disagreement')
    expect(r.retirementSafe).toBe(false)
  })

  it('normalizes equivalent codes (bench_slot_overflow ≡ section_overflow)', () => {
    const r = evaluateLineupRulesWithParity(ctx(), { validateRedraft: redraft('bench_slot_overflow'), validateCanonical: canonicalDep('section_overflow') })
    expect(r.parity.sharedDisagreements).toEqual([]) // same normalized category
    expect(r.parity.agreeOnSharedScope).toBe(true)
  })

  it('complementary coverage (each unique category) → agree on shared, NOT retirement-safe', () => {
    const r = evaluateLineupRulesWithParity(ctx(), { validateRedraft: redraft('missing_required_position'), validateCanonical: canonicalDep('ir_ineligible_status') })
    expect(r.parity.agreeOnSharedScope).toBe(true)
    expect(r.parity.coverageDifferences.sort()).toEqual(['ir_eligibility', 'required_slot'])
    expect(r.parity.reason).toBe('complementary_coverage')
    expect(r.retirementSafe).toBe(false)
    expect(r.parity.diffs.length).toBeGreaterThan(0)
  })

  it('Decision OS continues safely when the canonical validator throws', () => {
    const r = evaluateLineupRulesWithParity(ctx(), { validateRedraft: redraft('starter_position_ineligible'), validateCanonical: () => { throw new Error('canonical boom') } })
    expect(r.canonicalVerdicts).toEqual([])
    expect(r.parity.reason).toBe('canonical_validator_error')
    expect(r.retirementSafe).toBe(false)
    // the active gate still produced primary verdicts (decision unaffected)
    expect(r.verdicts.some((v) => v.rule === 'lineup.legality.starter_position_ineligible')).toBe(true)
  })
})

describe('canonical adapter', () => {
  it('maps a canonical result to lineup.canonical.* verdicts', () => {
    const verdicts = canonicalResultToVerdicts({ ok: false, issues: [{ code: 'duplicate_player', message: 'dup' }] })
    expect(verdicts[0]).toMatchObject({ rule: 'lineup.canonical.duplicate_player', verdict: 'illegal', severity: 'critical' })
  })

  it('converts players into canonical sections by slot', () => {
    const players = [
      { playerId: 's', position: 'QB', sport: 'NFL', slotType: 'QB', playerName: 'S' },
      { playerId: 'b', position: 'RB', sport: 'NFL', slotType: 'BENCH', playerName: 'B' },
      { playerId: 'i', position: 'WR', sport: 'NFL', slotType: 'IR', playerName: 'I' },
    ] as RedraftLineupPlayer[]
    const data = toCanonicalPlayerData(players) as Record<string, unknown[]>
    expect(data.starters).toHaveLength(1)
    expect(data.bench).toHaveLength(1)
    expect(data.ir).toHaveLength(1)
  })

  it('buildCanonicalValidatorDep wires a validator into the Rule Framework seam', () => {
    const dep = buildCanonicalValidatorDep({ validate: () => ({ ok: false, issues: [{ code: 'ir_ineligible_status', message: 'x' }] }), ctx: {} })
    const verdicts = dep(ctx())
    expect(verdicts.some((v) => v.rule === 'lineup.canonical.ir_ineligible_status')).toBe(true)
  })
})
