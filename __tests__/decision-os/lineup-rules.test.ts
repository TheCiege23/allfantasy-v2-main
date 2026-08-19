import { describe, it, expect } from 'vitest'
import { evaluateLineupRules, compareLegalityParity } from '@/lib/decision-os/lineup/rules'
import { isLegal } from '@/lib/decision-os/core/decision'
import type { LockState } from '@/lib/decision-os/lineup/world'
import type { RedraftLineupValidationResult } from '@/lib/redraft/lineupValidation'
import { fakeRosterConfig, fakePlayers, fakeValidate } from './lineupFakes'

const unlocked: LockState = { locked: false, policy: 'football_weekly', reason: null, provenance: 'derived_approximate', uncertainty: null }
const locked: LockState = { locked: true, policy: 'football_weekly', reason: 'Locked.', provenance: 'derived_approximate', uncertainty: null }

const ctx = (lockState: LockState) => ({ sport: 'NFL', week: 1, players: fakePlayers(), rosterConfig: fakeRosterConfig(), lockState })

describe('Lineup Rule Modules (validity before optimality)', () => {
  it('a legal lineup → no illegal verdicts (isLegal true)', () => {
    const verdicts = evaluateLineupRules(ctx(unlocked), { validateRedraft: fakeValidate() })
    expect(isLegal(verdicts)).toBe(true)
  })

  it('an empty required slot (legacy error) → an illegal verdict (isLegal false)', () => {
    const validate = fakeValidate({
      ok: false,
      errorCount: 1,
      issues: [{ code: 'empty_starter', severity: 'error', message: 'QB slot is empty.', slotType: 'QB' }],
    })
    const verdicts = evaluateLineupRules(ctx(unlocked), { validateRedraft: validate })
    expect(isLegal(verdicts)).toBe(false)
    expect(verdicts.some((v) => v.rule === 'lineup.legality.empty_starter' && v.verdict === 'illegal')).toBe(true)
  })

  it('editing a locked lineup → a temporarily_illegal lock verdict', () => {
    const verdicts = evaluateLineupRules(ctx(locked), { validateRedraft: fakeValidate() })
    expect(verdicts.some((v) => v.rule === 'lineup.lock.editing_locked' && v.verdict === 'temporarily_illegal')).toBe(true)
  })

  it('warnings map to non-illegal verdicts (legal but flagged)', () => {
    const validate = fakeValidate({
      warningCount: 1,
      issues: [{ code: 'questionable_starter', severity: 'warning', message: 'Q tag.', playerId: 'p2' }],
    })
    const verdicts = evaluateLineupRules(ctx(unlocked), { validateRedraft: validate })
    expect(isLegal(verdicts)).toBe(true)
    expect(verdicts.some((v) => v.severity === 'warning')).toBe(true)
  })
})

describe('Legality Parity (Rule Framework vs legacy validator)', () => {
  it('passes when the Rule Framework wraps the legacy error set faithfully', () => {
    const legacy: RedraftLineupValidationResult = {
      ok: false,
      errorCount: 1,
      warningCount: 0,
      issues: [{ code: 'empty_starter', severity: 'error', message: 'QB empty.' }],
    }
    const verdicts = evaluateLineupRules(ctx(unlocked), { validateRedraft: () => legacy })
    expect(compareLegalityParity(verdicts, legacy).passed).toBe(true)
  })

  it('flags a diff when verdicts and legacy disagree', () => {
    const legacy: RedraftLineupValidationResult = {
      ok: false,
      errorCount: 1,
      warningCount: 0,
      issues: [{ code: 'empty_starter', severity: 'error', message: 'QB empty.' }],
    }
    // verdicts from a DIFFERENT (faked) validator → mismatch
    const verdicts = evaluateLineupRules(ctx(unlocked), { validateRedraft: fakeValidate() })
    const parity = compareLegalityParity(verdicts, legacy)
    expect(parity.passed).toBe(false)
    expect(parity.diffs.length).toBeGreaterThan(0)
  })
})
